from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import shutil
import stat
import tempfile
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Sequence


REQUIRED_FILES = (
    Path("db/models.py"),
    Path("services/share.py"),
    Path("services/server_share.py"),
)
CHECK_CHANGES_REQUIRED_EXIT_CODE = 3


class PatchError(RuntimeError):
    """运行时包与已确认版本不匹配时终止修补。"""


@dataclass(frozen=True)
class LineAnchor:
    value: str
    prefix: bool = False

    def matches(self, content: str) -> bool:
        return content.startswith(self.value) if self.prefix else content == self.value


@dataclass(frozen=True)
class PatchOperation:
    name: str
    region_kind: str
    region_name: str
    before: tuple[LineAnchor, ...]
    insertion: str
    after: tuple[LineAnchor, ...]
    required_pattern: str = ""


@dataclass(frozen=True)
class PlannedFile:
    path: Path
    relative_path: Path
    original_bytes: bytes
    patched_bytes: bytes
    pending_operations: tuple[str, ...]
    satisfied_operations: tuple[str, ...]

    @property
    def changed(self) -> bool:
        return self.original_bytes != self.patched_bytes


MODEL_DATE_FROM = (
    'festival_date_from: Mapped[str] = mapped_column(String(10), nullable=False, default="")'
)
MODEL_DATE_TO = (
    'festival_date_to: Mapped[str] = mapped_column(String(10), nullable=False, default="")'
)
MODEL_PERIOD_SOURCE = (
    'festival_period_source: Mapped[str] = mapped_column(String(32), nullable=False, default="")'
)

PATCH_OPERATIONS = {
    Path("db/models.py"): (
        PatchOperation(
            name="SharedContributionPackage.festival_period_source",
            region_kind="class",
            region_name="SharedContributionPackage",
            before=(LineAnchor(MODEL_DATE_FROM), LineAnchor(MODEL_DATE_TO)),
            insertion=MODEL_PERIOD_SOURCE,
            after=(
                LineAnchor(
                    "schema_version: Mapped[str] = mapped_column(String(32), nullable=False)"
                ),
            ),
        ),
        PatchOperation(
            name="ServerUpload.festival_period_source",
            region_kind="class",
            region_name="ServerUpload",
            before=(LineAnchor(MODEL_DATE_FROM), LineAnchor(MODEL_DATE_TO)),
            insertion=MODEL_PERIOD_SOURCE,
            after=(
                LineAnchor(
                    'status: Mapped[str] = mapped_column(String(32), nullable=False, '
                    'default="received", index=True)'
                ),
            ),
        ),
    ),
    Path("services/share.py"): (
        PatchOperation(
            name="_update_package_row.festival_period_source",
            region_kind="function",
            region_name="_update_package_row",
            before=(
                LineAnchor(
                    'package.festival_date_from = str(manifest.get("festival_date_from") or "")'
                ),
                LineAnchor(
                    'package.festival_date_to = str(manifest.get("festival_date_to") or "")'
                ),
            ),
            insertion=(
                'package.festival_period_source = '
                'str(manifest.get("festival_period_source") or "")'
            ),
            after=(
                LineAnchor(
                    "package.schema_version = "
                    'str(manifest.get("schema_version") or SHARE_SCHEMA_VERSION)'
                ),
            ),
        ),
    ),
    Path("services/server_share.py"): (
        PatchOperation(
            name="import_uploaded_package.ServerUpload.festival_period_source",
            region_kind="function",
            region_name="import_uploaded_package",
            before=(
                LineAnchor(
                    'festival_date_from=str(manifest.get("festival_date_from") or ""),'
                ),
                LineAnchor(
                    'festival_date_to=str(manifest.get("festival_date_to") or ""),'
                ),
            ),
            insertion=(
                'festival_period_source=str('
                'manifest.get("festival_period_source") or ""),'
            ),
            after=(LineAnchor("status=", prefix=True),),
            required_pattern=r"\bServerUpload[ \t]*\(",
        ),
        PatchOperation(
            name="_upload_to_payload.festival_period_source",
            region_kind="function",
            region_name="_upload_to_payload",
            before=(
                LineAnchor('"festival_date_from": upload.festival_date_from,'),
                LineAnchor('"festival_date_to": upload.festival_date_to,'),
            ),
            insertion='"festival_period_source": upload.festival_period_source,',
            after=(LineAnchor('"status": upload.status,'),),
        ),
    ),
}


def resolve_package_root(package_root: Path | None = None) -> Path:
    if package_root is not None:
        candidates = _package_root_candidates(package_root.expanduser().resolve())
    else:
        spec = importlib.util.find_spec("eiketsu_env")
        locations = list(spec.submodule_search_locations or []) if spec is not None else []
        candidates = [Path(location).resolve() for location in locations]

    for candidate in candidates:
        if all((candidate / relative_path).is_file() for relative_path in REQUIRED_FILES):
            return candidate

    checked = ", ".join(str(path) for path in candidates) or "无可用候选目录"
    missing = ", ".join(str(path) for path in REQUIRED_FILES)
    raise PatchError(f"无法定位完整 eiketsu_env 包；已检查：{checked}；必须包含：{missing}")


def _package_root_candidates(path: Path) -> list[Path]:
    candidates = [path, path / "eiketsu_env", path / "src" / "eiketsu_env"]
    unique: list[Path] = []
    for candidate in candidates:
        if candidate not in unique:
            unique.append(candidate)
    return unique


def plan_runtime_patch(package_root: Path) -> tuple[PlannedFile, ...]:
    resolved_root = resolve_package_root(package_root)
    planned_files: list[PlannedFile] = []

    for relative_path in REQUIRED_FILES:
        path = resolved_root / relative_path
        original_bytes = path.read_bytes()
        text, encoding = _decode_source(path, original_bytes)
        pending: list[str] = []
        satisfied: list[str] = []

        for operation in PATCH_OPERATIONS[relative_path]:
            text, was_inserted = _apply_operation(text, path, operation)
            (pending if was_inserted else satisfied).append(operation.name)

        planned_files.append(
            PlannedFile(
                path=path,
                relative_path=relative_path,
                original_bytes=original_bytes,
                patched_bytes=_encode_source(text, encoding),
                pending_operations=tuple(pending),
                satisfied_operations=tuple(satisfied),
            )
        )

    return tuple(planned_files)


def check_runtime_patch(package_root: Path) -> dict[str, object]:
    resolved_root = resolve_package_root(package_root)
    plan = plan_runtime_patch(resolved_root)
    changed_files = [item for item in plan if item.changed]
    return _result(
        mode="check",
        status="changes_required" if changed_files else "already_patched",
        package_root=resolved_root,
        plan=plan,
        backups=(),
    )


def apply_runtime_patch(package_root: Path) -> dict[str, object]:
    resolved_root = resolve_package_root(package_root)
    plan = plan_runtime_patch(resolved_root)
    changed_files = [item for item in plan if item.changed]
    if not changed_files:
        return _result(
            mode="apply",
            status="already_patched",
            package_root=resolved_root,
            plan=plan,
            backups=(),
        )

    backups = tuple(_create_backup(item.path) for item in changed_files)
    for item in changed_files:
        _atomic_write(item.path, item.patched_bytes)

    verified = plan_runtime_patch(resolved_root)
    if any(item.changed for item in verified):
        raise PatchError("写入后校验失败：仍有未应用的 festival_period_source 补丁")

    return _result(
        mode="apply",
        status="patched",
        package_root=resolved_root,
        plan=plan,
        backups=backups,
    )


def _apply_operation(
    source: str,
    path: Path,
    operation: PatchOperation,
) -> tuple[str, bool]:
    start, end = _region_bounds(
        source,
        path=path,
        kind=operation.region_kind,
        name=operation.region_name,
    )
    region = source[start:end]
    if operation.required_pattern:
        marker_count = len(re.findall(operation.required_pattern, region))
        if marker_count != 1:
            raise PatchError(
                f"{path}: {operation.name} 要求目标区域内恰有一个 "
                f"{operation.required_pattern!r}，实际 {marker_count} 个"
            )

    patched_region, was_inserted = _patch_sequence(region, path, operation)
    return source[:start] + patched_region + source[end:], was_inserted


def _region_bounds(source: str, *, path: Path, kind: str, name: str) -> tuple[int, int]:
    if kind == "class":
        header_pattern = rf"^class[ \t]+{re.escape(name)}\b[^\r\n]*:"
    elif kind == "function":
        header_pattern = (
            rf"^(?:async[ \t]+def|def)[ \t]+{re.escape(name)}[ \t]*\("
        )
    else:
        raise PatchError(f"未知区域类型：{kind}")

    matches = list(re.finditer(header_pattern, source, flags=re.MULTILINE))
    if len(matches) != 1:
        raise PatchError(
            f"{path}: 必须恰好找到一个顶层 {kind} {name}，实际 {len(matches)} 个"
        )

    start = matches[0].start()
    next_top_level = re.search(
        r"^(?:class[ \t]+\w|(?:async[ \t]+def|def)[ \t]+\w)",
        source[matches[0].end() :],
        flags=re.MULTILINE,
    )
    end = (
        matches[0].end() + next_top_level.start()
        if next_top_level is not None
        else len(source)
    )
    return start, end


def _patch_sequence(
    region: str,
    path: Path,
    operation: PatchOperation,
) -> tuple[str, bool]:
    lines = region.splitlines(keepends=True)
    old_sequence = operation.before + operation.after
    new_sequence = (
        operation.before + (LineAnchor(operation.insertion),) + operation.after
    )
    old_matches = _find_sequence(lines, old_sequence)
    new_matches = _find_sequence(lines, new_sequence)

    if len(new_matches) == 1 and not old_matches:
        return region, False
    if len(old_matches) != 1 or new_matches:
        raise PatchError(
            f"{path}: {operation.name} 锚点不兼容；"
            f"旧序列 {len(old_matches)} 个，新序列 {len(new_matches)} 个"
        )

    insertion_index = old_matches[0] + len(operation.before)
    indent, _ = _line_parts(lines[insertion_index - 1])
    newline = _line_ending(lines[insertion_index - 1]) or _preferred_newline(region)
    lines.insert(insertion_index, f"{indent}{operation.insertion}{newline}")
    return "".join(lines), True


def _find_sequence(
    lines: Sequence[str],
    sequence: Sequence[LineAnchor],
) -> list[int]:
    matches: list[int] = []
    if not sequence:
        return matches

    for start in range(0, len(lines) - len(sequence) + 1):
        indent = ""
        is_match = True
        for offset, anchor in enumerate(sequence):
            current_indent, content = _line_parts(lines[start + offset])
            if offset == 0:
                indent = current_indent
            if current_indent != indent or not anchor.matches(content):
                is_match = False
                break
        if is_match:
            matches.append(start)
    return matches


def _line_parts(line: str) -> tuple[str, str]:
    body = line.rstrip("\r\n")
    content = body.lstrip(" \t")
    return body[: len(body) - len(content)], content


def _line_ending(line: str) -> str:
    if line.endswith("\r\n"):
        return "\r\n"
    if line.endswith("\n"):
        return "\n"
    return ""


def _preferred_newline(source: str) -> str:
    return "\r\n" if "\r\n" in source else "\n"


def _decode_source(path: Path, payload: bytes) -> tuple[str, str]:
    encoding = "utf-8-sig" if payload.startswith(b"\xef\xbb\xbf") else "utf-8"
    try:
        return payload.decode(encoding), encoding
    except UnicodeDecodeError as exc:
        raise PatchError(f"{path}: 仅支持 UTF-8 Python 源文件") from exc


def _encode_source(source: str, encoding: str) -> bytes:
    return source.encode(encoding)


def _create_backup(path: Path) -> Path:
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
    backup = path.with_name(
        f"{path.name}.bak-{timestamp}-{uuid.uuid4().hex[:8]}"
    )
    shutil.copy2(path, backup)
    return backup


def _atomic_write(path: Path, payload: bytes) -> None:
    file_mode = stat.S_IMODE(path.stat().st_mode)
    descriptor, temporary_name = tempfile.mkstemp(
        dir=path.parent,
        prefix=f".{path.name}.",
        suffix=".tmp",
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary_path, file_mode)
        os.replace(temporary_path, path)
    finally:
        temporary_path.unlink(missing_ok=True)


def _result(
    *,
    mode: str,
    status: str,
    package_root: Path,
    plan: Sequence[PlannedFile],
    backups: Sequence[Path],
) -> dict[str, object]:
    changed_files = [str(item.relative_path) for item in plan if item.changed]
    pending_operations = [
        operation
        for item in plan
        for operation in item.pending_operations
    ]
    return {
        "status": status,
        "mode": mode,
        "packageRoot": str(package_root),
        "changedFiles": changed_files,
        "pendingOperations": pending_operations,
        "backupFiles": [str(path) for path in backups],
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Patch festival_period_source passthrough in an installed eiketsu_env package."
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--apply", action="store_true")
    parser.add_argument(
        "--package-root",
        type=Path,
        default=None,
        help="eiketsu_env 目录，或包含 eiketsu_env/src/eiketsu_env 的父目录。",
    )
    args = parser.parse_args(argv)

    try:
        package_root = resolve_package_root(args.package_root)
        result = (
            check_runtime_patch(package_root)
            if args.check
            else apply_runtime_patch(package_root)
        )
    except (OSError, PatchError) as exc:
        print(
            json.dumps(
                {"status": "error", "error": str(exc)},
                ensure_ascii=False,
                sort_keys=True,
            )
        )
        return 1

    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    if args.check and result["status"] == "changes_required":
        return CHECK_CHANGES_REQUIRED_EXIT_CODE
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
