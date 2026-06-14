from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import shutil
import subprocess
import time
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_LEGACY_ROOT = Path("apps/api/data/legacy-service")
DEFAULT_SNAPSHOT_FILE = Path("apps/api/data/leaderboard-snapshot.json")
DEFAULT_STATUS_FILE = Path("apps/api/data/leaderboard-refresh-status.json")
DEFAULT_MATCH_SEARCH_INDEX_FILE = Path("apps/api/data/match-search-index.json")
DEFAULT_TIER_LIST_SNAPSHOT_FILE = Path("apps/api/data/tier-list-snapshot.json")
DEFAULT_TIER_LIST_CONFIGS_FILE = Path("apps/api/data/tier-list-configs.json")
DEFAULT_BATTLE_FESTIVAL_SNAPSHOT_FILE = Path("apps/api/data/battle-festival-snapshot.json")
DEFAULT_BATTLE_FESTIVAL_CONFIGS_FILE = Path("apps/api/data/battle-festival-configs.json")
STATUS_SCHEMA_VERSION = 1
RECENT_STATUS_LIMIT = 20
DEFAULT_NODE_OPTIONS = "--max-old-space-size=4096"
REFRESH_LOCK_STALE_SECONDS = 30 * 60


CommandRunner = Callable[[list[str], dict[str, str]], subprocess.CompletedProcess[str]]
Exporter = Callable[[Path], dict[str, Any]]
RunRefresher = Callable[[], dict[str, Any]]


def refresh_static_snapshot_after_upload(
    repo_root: Path | None = None,
    legacy_root: Path | None = None,
    snapshot_file: Path | None = None,
    match_search_index_file: Path | None = None,
    tier_list_snapshot_file: Path | None = None,
    tier_list_configs_file: Path | None = None,
    battle_festival_snapshot_file: Path | None = None,
    battle_festival_configs_file: Path | None = None,
    status_file: Path | None = None,
    live_snapshot_file: Path | None = None,
    live_status_file: Path | None = None,
    node_bin: str = "node",
    refresh_run: bool = True,
    refresh_reason: str = "",
    exporter: Exporter | None = None,
    run_refresher: RunRefresher | None = None,
    runner: CommandRunner | None = None,
) -> dict[str, Any]:
    root = (repo_root or Path.cwd()).resolve()
    legacy = _resolve(root, legacy_root or DEFAULT_LEGACY_ROOT)
    snapshot = _resolve(root, snapshot_file or DEFAULT_SNAPSHOT_FILE)
    match_search_index = _resolve(root, match_search_index_file or DEFAULT_MATCH_SEARCH_INDEX_FILE)
    tier_list_snapshot = _resolve(root, tier_list_snapshot_file or DEFAULT_TIER_LIST_SNAPSHOT_FILE)
    tier_list_configs = _resolve(root, tier_list_configs_file or DEFAULT_TIER_LIST_CONFIGS_FILE)
    battle_festival_snapshot = _resolve(root, battle_festival_snapshot_file or DEFAULT_BATTLE_FESTIVAL_SNAPSHOT_FILE)
    battle_festival_configs = _resolve(root, battle_festival_configs_file or DEFAULT_BATTLE_FESTIVAL_CONFIGS_FILE)
    status_path = _resolve(root, status_file or DEFAULT_STATUS_FILE)
    live_snapshot = _resolve(root, live_snapshot_file) if live_snapshot_file else None
    live_status = _resolve(root, live_status_file) if live_status_file else None
    lock_path = snapshot.with_name(f".{snapshot.name}.refresh.lock")

    lock_handle = _acquire_lock(lock_path)
    if lock_handle is None:
        result = {"status": "skipped", "reason": "refresh already running"}
        _write_refresh_status(status_path, live_status, legacy, snapshot, battle_festival_snapshot, result)
        return result

    started_at = _utc_now()
    started_clock = time.monotonic()
    _write_refresh_status(
        status_path,
        live_status,
        legacy,
        snapshot,
        battle_festival_snapshot,
        {"status": "running", "startedAt": started_at},
        started_at=started_at,
    )
    try:
        run_result = (
            _refresh_server_run(run_refresher or _default_run_refresher)
            if refresh_run
            else {"status": "skipped", "reason": "run refresh disabled"}
        )
        export_manifest = _refresh_legacy_export(legacy, exporter or _default_exporter)
        official_card_result = _refresh_official_card_data(root, legacy, node_bin, runner or _default_runner)
        snapshot_result = _refresh_snapshot(
            root,
            legacy,
            snapshot,
            tier_list_snapshot,
            tier_list_configs,
            battle_festival_snapshot,
            battle_festival_configs,
            node_bin,
            runner or _default_runner,
        )
        match_search_result = _refresh_match_search_index(root, legacy, snapshot, match_search_index, node_bin, runner or _default_runner)
        consistency_result = _validate_refresh_run_consistency(snapshot, tier_list_snapshot, match_search_index)
        live_result = _publish_live_snapshot(snapshot, live_snapshot) if live_snapshot else None
        result = {
            "status": "completed",
            "reason": _sanitize_text(refresh_reason),
            "durationMs": _duration_ms(started_clock),
            "run": run_result,
            "export": export_manifest,
            "official_card_data": official_card_result,
            "snapshot": snapshot_result,
            "match_search_index": match_search_result,
            "consistency": consistency_result,
            "live_snapshot": live_result,
        }
        _write_refresh_status(
            status_path,
            live_status,
            legacy,
            snapshot,
            battle_festival_snapshot,
            result,
            started_at=started_at,
            finished_at=_utc_now(),
            export_manifest=export_manifest,
            run_result=run_result,
        )
        _validate_refresh_run_consistency(snapshot, tier_list_snapshot, match_search_index, status_path)
        if live_status:
            _validate_refresh_run_consistency(snapshot, tier_list_snapshot, match_search_index, live_status)
        return result
    except Exception as exc:
        result = {
            "status": "failed",
            "durationMs": _duration_ms(started_clock),
            "error": _sanitize_text(str(exc)),
        }
        _write_refresh_status(
            status_path,
            live_status,
            legacy,
            snapshot,
            battle_festival_snapshot,
            result,
            started_at=started_at,
            finished_at=_utc_now(),
        )
        raise
    finally:
        lock_handle.close()
        lock_path.unlink(missing_ok=True)


def write_refresh_status_only(
    repo_root: Path | None = None,
    legacy_root: Path | None = None,
    snapshot_file: Path | None = None,
    battle_festival_snapshot_file: Path | None = None,
    status_file: Path | None = None,
    live_status_file: Path | None = None,
    refresh_status: str = "completed",
    refresh_reason: str = "status updated",
) -> dict[str, Any]:
    root = (repo_root or Path.cwd()).resolve()
    legacy = _resolve(root, legacy_root or DEFAULT_LEGACY_ROOT)
    snapshot = _resolve(root, snapshot_file or DEFAULT_SNAPSHOT_FILE)
    battle_festival_snapshot = _resolve(root, battle_festival_snapshot_file or DEFAULT_BATTLE_FESTIVAL_SNAPSHOT_FILE)
    status_path = _resolve(root, status_file or DEFAULT_STATUS_FILE)
    live_status = _resolve(root, live_status_file) if live_status_file else None
    result = {"status": refresh_status, "reason": _sanitize_text(refresh_reason)}
    _write_refresh_status(status_path, live_status, legacy, snapshot, battle_festival_snapshot, result, finished_at=_utc_now())
    return result


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
    tier_list_snapshot_file: Path,
    tier_list_configs_file: Path,
    battle_festival_snapshot_file: Path,
    battle_festival_configs_file: Path,
    node_bin: str,
    runner: CommandRunner,
) -> dict[str, Any]:
    command = [node_bin, str(repo_root / "apps/api/leaderboard-snapshot/refresh-snapshot.mjs")]
    runner(
        command,
        _snapshot_env(
            legacy_root,
            snapshot_file,
            None,
            tier_list_snapshot_file,
            tier_list_configs_file,
            battle_festival_snapshot_file,
            battle_festival_configs_file,
        ),
    )
    return {
        "status": "completed",
        "tierListSnapshot": "completed",
        "tierListConfigs": "completed",
        "battleFestivalSnapshot": "completed",
        "battleFestivalConfigs": "completed",
    }


def _refresh_match_search_index(
    repo_root: Path,
    legacy_root: Path,
    snapshot_file: Path,
    match_search_index_file: Path,
    node_bin: str,
    runner: CommandRunner,
) -> dict[str, Any]:
    command = [node_bin, str(repo_root / "apps/api/leaderboard-snapshot/match-search-index.mjs")]
    runner(command, _snapshot_env(legacy_root, snapshot_file, match_search_index_file))
    return {"status": "completed"}


def _validate_refresh_run_consistency(
    snapshot_file: Path,
    tier_list_snapshot_file: Path,
    match_search_index_file: Path,
    status_file: Path | None = None,
) -> dict[str, Any]:
    source_run_id = _read_source_run_id(snapshot_file, "leaderboard snapshot", "metadata")
    checks = {
        "tier list snapshot": _read_source_run_id(tier_list_snapshot_file, "tier list snapshot", "metadata"),
        "match search index": _read_source_run_id(match_search_index_file, "match search index", "metadata"),
    }
    if status_file is not None:
        checks["refresh status"] = _read_source_run_id(status_file, "refresh status", "snapshot")
    for label, value in checks.items():
        if value != source_run_id:
            raise RuntimeError(
                f"refresh run mismatch: {label} sourceRunId {value or 'missing'} "
                f"!= leaderboard snapshot sourceRunId {source_run_id}"
            )
    return {"status": "completed", "sourceRunId": source_run_id}


def _read_source_run_id(path: Path, label: str, section: str) -> str:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        raise RuntimeError(f"refresh run mismatch: {label} sourceRunId missing")
    container = payload.get(section) if isinstance(payload, dict) else {}
    container = container if isinstance(container, dict) else {}
    value = container.get("sourceRunId")
    if value is None or value == "":
        raise RuntimeError(f"refresh run mismatch: {label} sourceRunId missing")
    return str(value)


def _publish_live_snapshot(snapshot_file: Path, live_snapshot_file: Path) -> dict[str, Any]:
    _copy_file_atomically(snapshot_file, live_snapshot_file)
    return {"status": "completed"}


def _refresh_server_run(run_refresher: RunRefresher) -> dict[str, Any]:
    result = run_refresher()
    return _sanitize_json(result if isinstance(result, dict) else {"status": "completed", "result": result})


def _default_run_refresher() -> dict[str, Any]:
    try:
        from eiketsu_env.config import load_settings
        from eiketsu_env.services.leaderboard import refresh_public_leaderboard_snapshots
    except ModuleNotFoundError:
        return {"status": "skipped", "reason": "server run refresh module unavailable"}

    return refresh_public_leaderboard_snapshots(load_settings())


def _write_refresh_status(
    status_file: Path,
    live_status_file: Path | None,
    legacy_root: Path,
    snapshot_file: Path,
    battle_festival_snapshot_file: Path | None,
    refresh_result: dict[str, Any],
    *,
    started_at: str = "",
    finished_at: str = "",
    export_manifest: dict[str, Any] | None = None,
    run_result: dict[str, Any] | None = None,
) -> None:
    payload = _build_refresh_status(
        legacy_root,
        snapshot_file,
        battle_festival_snapshot_file,
        refresh_result,
        started_at=started_at,
        finished_at=finished_at,
        export_manifest=export_manifest,
        run_result=run_result,
    )
    _atomic_write_json(status_file, payload)
    if live_status_file:
        _copy_file_atomically(status_file, live_status_file)


def _build_refresh_status(
    legacy_root: Path,
    snapshot_file: Path,
    battle_festival_snapshot_file: Path | None,
    refresh_result: dict[str, Any],
    *,
    started_at: str = "",
    finished_at: str = "",
    export_manifest: dict[str, Any] | None = None,
    run_result: dict[str, Any] | None = None,
) -> dict[str, Any]:
    generated_at = finished_at or _utc_now()
    safe_refresh = _sanitize_json(refresh_result)
    refresh = {
        "status": str(safe_refresh.get("status") or "unknown"),
        "reason": str(safe_refresh.get("reason") or ""),
        "error": str(safe_refresh.get("error") or ""),
        "startedAt": started_at or str(safe_refresh.get("startedAt") or ""),
        "finishedAt": finished_at,
        "durationMs": int(safe_refresh.get("durationMs") or 0),
    }
    recent_runs = _read_recent_runs(legacy_root / "tables" / "server_leaderboard_runs.jsonl")
    recent_uploads = _read_recent_uploads(
        legacy_root / "tables" / "server_uploads.jsonl",
        legacy_root / "tables" / "server_users.jsonl",
        legacy_root / "tables" / "shared_contribution_packages.jsonl",
    )
    manifest = export_manifest if export_manifest is not None else _read_export_manifest(legacy_root)
    return {
        "schemaVersion": STATUS_SCHEMA_VERSION,
        "generatedAt": generated_at,
        "refresh": refresh,
        "runRefresh": _sanitize_json(run_result or safe_refresh.get("run") or {}),
        "snapshot": _read_snapshot_summary(snapshot_file),
        "battleFestivalSnapshot": _read_battle_festival_snapshot_summary(battle_festival_snapshot_file),
        "export": _sanitize_export_manifest(manifest),
        "latestRun": recent_runs[0] if recent_runs else None,
        "recentRuns": recent_runs,
        "latestUpload": recent_uploads[0] if recent_uploads else None,
        "recentUploads": recent_uploads,
    }


def _read_snapshot_summary(snapshot_file: Path) -> dict[str, Any]:
    try:
        payload = json.loads(snapshot_file.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}
    metadata = payload.get("metadata") if isinstance(payload, dict) else {}
    metadata = metadata if isinstance(metadata, dict) else {}
    home = payload.get("home") if isinstance(payload, dict) else {}
    home = home if isinstance(home, dict) else {}
    return {
        "sourceRunId": metadata.get("sourceRunId"),
        "sourceKind": metadata.get("sourceKind"),
        "targetVersion": metadata.get("targetVersion"),
        "dateFrom": metadata.get("dateFrom"),
        "dateTo": metadata.get("dateTo"),
        "updatedAt": metadata.get("updatedAt"),
        "sampleSize": metadata.get("sampleSize"),
        "clusterRows": len(payload.get("clusterRows") or []) if isinstance(payload, dict) else 0,
        "tierRows": len(payload.get("tierRows") or []) if isinstance(payload, dict) else 0,
        "homeTierRows": len(home.get("tierRows") or []),
    }


def _read_battle_festival_snapshot_summary(snapshot_file: Path | None) -> dict[str, Any]:
    if snapshot_file is None:
        return {}
    try:
        payload = json.loads(snapshot_file.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}
    metadata = payload.get("metadata") if isinstance(payload, dict) else {}
    metadata = metadata if isinstance(metadata, dict) else {}
    battle_festival = payload.get("battleFestival") if isinstance(payload, dict) else {}
    battle_festival = battle_festival if isinstance(battle_festival, dict) else {}
    merit_summary = battle_festival.get("meritSummary") if isinstance(battle_festival, dict) else {}
    merit_summary = merit_summary if isinstance(merit_summary, dict) else {}
    return {
        "sourceUploadId": metadata.get("sourceUploadId"),
        "sourcePackageId": metadata.get("sourcePackageId"),
        "sourceImportedMatchCount": metadata.get("sourceImportedMatchCount"),
        "sourceMatchCount": metadata.get("sourceMatchCount"),
        "sourceUploadCreatedAt": metadata.get("sourceUploadCreatedAt"),
        "sourceKind": metadata.get("sourceKind"),
        "targetVersion": metadata.get("targetVersion"),
        "dateFrom": metadata.get("dateFrom"),
        "dateTo": metadata.get("dateTo"),
        "updatedAt": metadata.get("updatedAt"),
        "sampleSize": metadata.get("sampleSize"),
        "tierRows": len(payload.get("tierRows") or []) if isinstance(payload, dict) else 0,
        "meritRows": len(battle_festival.get("meritRows") or []),
        "meritPlayerCount": merit_summary.get("meritPlayerCount"),
        "meritSampleCount": merit_summary.get("meritSampleCount"),
    }


def _read_recent_runs(path: Path, limit: int = RECENT_STATUS_LIMIT) -> list[dict[str, Any]]:
    rows = _read_recent_jsonl(path, limit)
    return [
        {
            "id": row.get("id"),
            "status": row.get("status"),
            "targetVersion": row.get("target_version"),
            "dateFrom": row.get("date_from"),
            "dateTo": row.get("date_to"),
            "modeScope": row.get("mode_scope") or "tier_list",
            "festivalDateFrom": row.get("festival_date_from") or "",
            "festivalDateTo": row.get("festival_date_to") or "",
            "uploadWatermark": row.get("upload_watermark"),
            "uploadCount": row.get("upload_count"),
            "packageCount": row.get("package_count"),
            "matchCount": row.get("match_count"),
            "sideSampleCount": row.get("side_sample_count"),
            "rowCount": row.get("row_count"),
            "startedAt": row.get("started_at"),
            "generatedAt": row.get("generated_at"),
            "error": _sanitize_text(row.get("error_text") or ""),
        }
        for row in rows
    ]


def _read_recent_uploads(
    path: Path,
    users_path: Path | None = None,
    packages_path: Path | None = None,
    limit: int = RECENT_STATUS_LIMIT,
) -> list[dict[str, Any]]:
    rows = _read_recent_jsonl(path, limit)
    users_by_id = _read_upload_users(users_path) if users_path else {}
    packages_by_id = _read_upload_packages(packages_path) if packages_path else {}
    uploads = []
    for row in rows:
        user = users_by_id.get(row.get("user_id")) or {}
        package = packages_by_id.get(row.get("package_id")) or {}
        contributor_name = row.get("contributor_name") or user.get("contributorName") or ""
        user_public_id = row.get("user_public_id") or user.get("userPublicId") or ""
        mode_scope = _merged_upload_scope(row, package)
        uploads.append(
            {
                "id": row.get("id"),
                "contributorName": _sanitize_text(contributor_name),
                "userPublicId": _sanitize_text(user_public_id),
                "targetVersion": row.get("target_version"),
                "dateFrom": row.get("date_from"),
                "dateTo": row.get("date_to"),
                "modeScope": mode_scope or "tier_list",
                "festivalDateFrom": package.get("festival_date_from") or row.get("festival_date_from") or "",
                "festivalDateTo": package.get("festival_date_to") or row.get("festival_date_to") or "",
                "status": row.get("status"),
                "matchCount": row.get("match_count"),
                "importedMatchCount": row.get("imported_match_count"),
                "createdAt": row.get("created_at"),
                "updatedAt": row.get("updated_at"),
                "errors": _sanitize_json(row.get("error_summary_json") or []),
            }
        )
    return uploads


def _merged_upload_scope(upload: dict[str, Any], package: dict[str, Any]) -> str:
    for value in (package.get("mode_scope"), upload.get("mode_scope")):
        if str(value or "") == "battle_festival":
            return "battle_festival"
    return str(upload.get("mode_scope") or package.get("mode_scope") or "")


def _read_upload_packages(path: Path | None) -> dict[Any, dict[str, str]]:
    if path is None:
        return {}
    packages: dict[Any, dict[str, str]] = {}
    for row in _read_recent_jsonl(path, 100000):
        package_id = row.get("package_id")
        if package_id is None:
            continue
        packages[package_id] = {
            "mode_scope": str(row.get("mode_scope") or ""),
            "festival_date_from": str(row.get("festival_date_from") or ""),
            "festival_date_to": str(row.get("festival_date_to") or ""),
        }
    return packages


def _read_upload_users(path: Path | None) -> dict[Any, dict[str, str]]:
    if path is None:
        return {}
    users: dict[Any, dict[str, str]] = {}
    for row in _read_recent_jsonl(path, 100000):
        user_id = row.get("id")
        if user_id is None:
            continue
        users[user_id] = {
            "contributorName": _sanitize_text(row.get("contributor_name") or ""),
            "userPublicId": _sanitize_text(row.get("public_id") or ""),
        }
    return users


def _read_recent_jsonl(path: Path, limit: int) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(row, dict):
                rows.append(row)
    return list(reversed(rows[-limit:]))


def _read_export_manifest(legacy_root: Path) -> dict[str, Any]:
    try:
        payload = json.loads((legacy_root / "manifest.json").read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _sanitize_export_manifest(manifest: dict[str, Any]) -> dict[str, Any]:
    tables = manifest.get("tables") if isinstance(manifest, dict) else {}
    cards = manifest.get("cards") if isinstance(manifest, dict) else {}
    return {
        "tables": tables if isinstance(tables, dict) else {},
        "cards": cards if isinstance(cards, dict) else {},
    }


def _atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def _copy_file_atomically(source_file: Path, target_file: Path) -> None:
    target_file.parent.mkdir(parents=True, exist_ok=True)
    temporary = target_file.with_name(f".{target_file.name}.{os.getpid()}.tmp")
    shutil.copyfile(source_file, temporary)
    os.replace(temporary, target_file)


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


def _snapshot_env(
    legacy_root: Path,
    snapshot_file: Path | None,
    match_search_index_file: Path | None = None,
    tier_list_snapshot_file: Path | None = None,
    tier_list_configs_file: Path | None = None,
    battle_festival_snapshot_file: Path | None = None,
    battle_festival_configs_file: Path | None = None,
) -> dict[str, str]:
    env = dict(os.environ)
    env.setdefault("NODE_OPTIONS", DEFAULT_NODE_OPTIONS)
    env["LEADERBOARD_LEGACY_ROOT"] = str(legacy_root)
    if snapshot_file is not None:
        env["LEADERBOARD_SNAPSHOT_FILE"] = str(snapshot_file)
    if match_search_index_file is not None:
        env["LEADERBOARD_MATCH_SEARCH_INDEX_FILE"] = str(match_search_index_file)
    if tier_list_snapshot_file is not None:
        env["LEADERBOARD_TIER_LIST_SNAPSHOT_FILE"] = str(tier_list_snapshot_file)
    if tier_list_configs_file is not None:
        env["LEADERBOARD_TIER_LIST_CONFIGS_FILE"] = str(tier_list_configs_file)
    if battle_festival_snapshot_file is not None:
        env["LEADERBOARD_BATTLE_FESTIVAL_SNAPSHOT_FILE"] = str(battle_festival_snapshot_file)
    if battle_festival_configs_file is not None:
        env["LEADERBOARD_BATTLE_FESTIVAL_CONFIGS_FILE"] = str(battle_festival_configs_file)
    return env


_WINDOWS_PATH_RE = re.compile(r"[A-Za-z]:\\[^\s'\"<>]+")
_UNIX_PATH_RE = re.compile(r"(?<!\w)/(?:[^\s'\"<>:]+/)+[^\s'\"<>]*")
_SECRET_VALUE_RE = re.compile(r"(?i)\b(token|cookie|secret|password|authorization)\b\s*[:=]\s*[^\s,;]+")


def _sanitize_text(value: Any) -> str:
    text = str(value or "")
    text = _SECRET_VALUE_RE.sub(lambda match: f"{match.group(1)}=[redacted]", text)
    text = _WINDOWS_PATH_RE.sub("[path]", text)
    text = _UNIX_PATH_RE.sub("[path]", text)
    return text[:400]


def _sanitize_json(value: Any) -> Any:
    if isinstance(value, dict):
        safe = {}
        for key, item in value.items():
            key_text = str(key)
            if re.search(r"(?i)(token|cookie|secret|password|authorization|content_hash|user_id)", key_text):
                continue
            safe[key_text] = _sanitize_json(item)
        return safe
    if isinstance(value, list):
        return [_sanitize_json(item) for item in value[:RECENT_STATUS_LIMIT]]
    if isinstance(value, str):
        return _sanitize_text(value)
    return value


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _duration_ms(started_clock: float) -> int:
    return int(round((time.monotonic() - started_clock) * 1000))


def _resolve(root: Path, path: Path | None) -> Path:
    if path is None:
        raise ValueError("path is required")
    return path if path.is_absolute() else (root / path).resolve()


def _acquire_lock(path: Path, stale_after_seconds: int = REFRESH_LOCK_STALE_SECONDS):
    path.parent.mkdir(parents=True, exist_ok=True)
    lock_handle = _create_lock_file(path, stale_after_seconds)
    if lock_handle is not None:
        return lock_handle

    if not _is_stale_lock(path, stale_after_seconds):
        return None

    try:
        path.unlink()
    except FileNotFoundError:
        pass
    except OSError:
        return None

    return _create_lock_file(path, stale_after_seconds)


def _create_lock_file(path: Path, stale_after_seconds: int):
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        return None
    handle = os.fdopen(fd, "w", encoding="utf-8")
    try:
        json.dump(
            {
                "pid": os.getpid(),
                "startedAt": _utc_now(),
                "staleAfterSeconds": stale_after_seconds,
            },
            handle,
            ensure_ascii=False,
            sort_keys=True,
        )
        handle.write("\n")
        handle.flush()
    except Exception:
        handle.close()
        path.unlink(missing_ok=True)
        raise
    return handle


def _is_stale_lock(path: Path, stale_after_seconds: int) -> bool:
    if stale_after_seconds <= 0:
        return False
    try:
        modified_at = path.stat().st_mtime
    except OSError:
        return False
    return time.time() - modified_at > stale_after_seconds


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Refresh static leaderboard snapshot after a client upload.")
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--legacy-root", type=Path, default=DEFAULT_LEGACY_ROOT)
    parser.add_argument("--snapshot-file", type=Path, default=DEFAULT_SNAPSHOT_FILE)
    parser.add_argument("--match-search-index-file", type=Path, default=DEFAULT_MATCH_SEARCH_INDEX_FILE)
    parser.add_argument("--tier-list-snapshot-file", type=Path, default=DEFAULT_TIER_LIST_SNAPSHOT_FILE)
    parser.add_argument("--tier-list-configs-file", type=Path, default=DEFAULT_TIER_LIST_CONFIGS_FILE)
    parser.add_argument("--battle-festival-snapshot-file", type=Path, default=DEFAULT_BATTLE_FESTIVAL_SNAPSHOT_FILE)
    parser.add_argument("--battle-festival-configs-file", type=Path, default=DEFAULT_BATTLE_FESTIVAL_CONFIGS_FILE)
    parser.add_argument("--status-file", type=Path, default=DEFAULT_STATUS_FILE)
    parser.add_argument("--live-snapshot-file", type=Path, default=None)
    parser.add_argument("--live-status-file", type=Path, default=None)
    parser.add_argument("--node-bin", default="node")
    parser.add_argument("--skip-run-refresh", action="store_true")
    parser.add_argument("--status-only", action="store_true")
    parser.add_argument("--refresh-status", default="completed")
    parser.add_argument("--refresh-reason", default="status updated")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if args.status_only:
        result = write_refresh_status_only(
            repo_root=args.repo_root,
            legacy_root=args.legacy_root,
            snapshot_file=args.snapshot_file,
            battle_festival_snapshot_file=args.battle_festival_snapshot_file,
            status_file=args.status_file,
            live_status_file=args.live_status_file,
            refresh_status=args.refresh_status,
            refresh_reason=args.refresh_reason,
        )
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
        return 0

    result = refresh_static_snapshot_after_upload(
        repo_root=args.repo_root,
        legacy_root=args.legacy_root,
        snapshot_file=args.snapshot_file,
        match_search_index_file=args.match_search_index_file,
        tier_list_snapshot_file=args.tier_list_snapshot_file,
        tier_list_configs_file=args.tier_list_configs_file,
        battle_festival_snapshot_file=args.battle_festival_snapshot_file,
        battle_festival_configs_file=args.battle_festival_configs_file,
        status_file=args.status_file,
        live_snapshot_file=args.live_snapshot_file,
        live_status_file=args.live_status_file,
        node_bin=args.node_bin,
        refresh_run=not args.skip_run_refresh,
        refresh_reason=args.refresh_reason,
    )
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
