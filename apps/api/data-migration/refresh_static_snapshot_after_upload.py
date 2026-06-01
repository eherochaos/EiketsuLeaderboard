from __future__ import annotations

import argparse
import importlib.util
import json
import os
import shutil
import subprocess
from collections.abc import Callable
from pathlib import Path
from typing import Any


DEFAULT_LEGACY_ROOT = Path("apps/api/data/legacy-service")
DEFAULT_SNAPSHOT_FILE = Path("apps/api/data/leaderboard-snapshot.json")


CommandRunner = Callable[[list[str], dict[str, str]], subprocess.CompletedProcess[str]]
Exporter = Callable[[Path], dict[str, Any]]


def refresh_static_snapshot_after_upload(
    repo_root: Path | None = None,
    legacy_root: Path | None = None,
    snapshot_file: Path | None = None,
    live_snapshot_file: Path | None = None,
    node_bin: str = "node",
    exporter: Exporter | None = None,
    runner: CommandRunner | None = None,
) -> dict[str, Any]:
    root = (repo_root or Path.cwd()).resolve()
    legacy = _resolve(root, legacy_root or DEFAULT_LEGACY_ROOT)
    snapshot = _resolve(root, snapshot_file or DEFAULT_SNAPSHOT_FILE)
    live_snapshot = _resolve(root, live_snapshot_file) if live_snapshot_file else None
    lock_path = snapshot.with_name(f".{snapshot.name}.refresh.lock")

    lock_handle = _acquire_lock(lock_path)
    if lock_handle is None:
        return {"status": "skipped", "reason": "refresh already running"}

    try:
        export_manifest = _refresh_legacy_export(legacy, exporter or _default_exporter)
        official_card_result = _refresh_official_card_data(root, legacy, node_bin, runner or _default_runner)
        snapshot_result = _refresh_snapshot(root, legacy, snapshot, node_bin, runner or _default_runner)
        live_result = _publish_live_snapshot(snapshot, live_snapshot) if live_snapshot else None
        return {
            "status": "completed",
            "legacy_root": str(legacy),
            "snapshot_file": str(snapshot),
            "live_snapshot_file": str(live_snapshot) if live_snapshot else "",
            "export": export_manifest,
            "official_card_data": official_card_result,
            "snapshot": snapshot_result,
            "live_snapshot": live_result,
        }
    finally:
        lock_handle.close()
        lock_path.unlink(missing_ok=True)


def _refresh_legacy_export(legacy_root: Path, exporter: Exporter) -> dict[str, Any]:
    next_root = legacy_root.with_name(f"{legacy_root.name}.next")
    prev_root = legacy_root.with_name(f"{legacy_root.name}.prev")
    shutil.rmtree(next_root, ignore_errors=True)
    manifest = exporter(next_root)

    shutil.rmtree(prev_root, ignore_errors=True)
    moved_current = False
    try:
        if legacy_root.exists():
            legacy_root.rename(prev_root)
            moved_current = True
        next_root.rename(legacy_root)
    except Exception:
        if not legacy_root.exists() and moved_current and prev_root.exists():
            prev_root.rename(legacy_root)
        raise
    return manifest


def _refresh_official_card_data(
    repo_root: Path,
    legacy_root: Path,
    node_bin: str,
    runner: CommandRunner,
) -> dict[str, Any]:
    base_json = legacy_root / "cards" / "datalist_api_base.json"
    if not base_json.is_file():
        return {"status": "skipped", "reason": "datalist_api_base.json missing"}
    command = [
        node_bin,
        str(repo_root / "apps/api/leaderboard-snapshot/refresh-official-card-data.mjs"),
        str(base_json),
    ]
    env = _snapshot_env(legacy_root, None)
    runner(command, env)
    return {"status": "completed"}


def _refresh_snapshot(
    repo_root: Path,
    legacy_root: Path,
    snapshot_file: Path,
    node_bin: str,
    runner: CommandRunner,
) -> dict[str, Any]:
    command = [node_bin, str(repo_root / "apps/api/leaderboard-snapshot/refresh-snapshot.mjs")]
    runner(command, _snapshot_env(legacy_root, snapshot_file))
    return {"status": "completed"}


def _publish_live_snapshot(snapshot_file: Path, live_snapshot_file: Path) -> dict[str, Any]:
    live_snapshot_file.parent.mkdir(parents=True, exist_ok=True)
    temporary = live_snapshot_file.with_name(f".{live_snapshot_file.name}.{os.getpid()}.tmp")
    shutil.copyfile(snapshot_file, temporary)
    os.replace(temporary, live_snapshot_file)
    return {"status": "completed"}


def _default_exporter(output_dir: Path) -> dict[str, Any]:
    module_path = Path(__file__).with_name("export_legacy_service_from_postgres.py")
    spec = importlib.util.spec_from_file_location("export_legacy_service_from_postgres", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("export_legacy_service_from_postgres.py is not importable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.export_legacy_service_from_postgres(output_dir)


def _default_runner(command: list[str], env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, check=True, env=env, text=True, capture_output=True)


def _snapshot_env(legacy_root: Path, snapshot_file: Path | None) -> dict[str, str]:
    env = dict(os.environ)
    env["LEADERBOARD_LEGACY_ROOT"] = str(legacy_root)
    if snapshot_file is not None:
        env["LEADERBOARD_SNAPSHOT_FILE"] = str(snapshot_file)
    return env


def _resolve(root: Path, path: Path | None) -> Path:
    if path is None:
        raise ValueError("path is required")
    return path if path.is_absolute() else (root / path).resolve()


def _acquire_lock(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        return None
    return os.fdopen(fd, "w", encoding="utf-8")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Refresh static leaderboard snapshot after a client upload.")
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--legacy-root", type=Path, default=DEFAULT_LEGACY_ROOT)
    parser.add_argument("--snapshot-file", type=Path, default=DEFAULT_SNAPSHOT_FILE)
    parser.add_argument("--live-snapshot-file", type=Path, default=None)
    parser.add_argument("--node-bin", default="node")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    result = refresh_static_snapshot_after_upload(
        repo_root=args.repo_root,
        legacy_root=args.legacy_root,
        snapshot_file=args.snapshot_file,
        live_snapshot_file=args.live_snapshot_file,
        node_bin=args.node_bin,
    )
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
