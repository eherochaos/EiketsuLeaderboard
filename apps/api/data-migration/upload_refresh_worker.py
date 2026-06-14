from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any

from refresh_static_snapshot_after_upload import (
    refresh_static_snapshot_after_upload,
    write_refresh_status_only,
    _sanitize_text,
)


DEFAULT_REFRESH_REASON = "upload refresh completed"

LatestUploadReader = Callable[[], dict[str, Any] | None]
SnapshotRefresher = Callable[[], dict[str, Any]]


LATEST_UPLOAD_QUERY = r"""
import json
from datetime import date, datetime

from sqlalchemy import text

from eiketsu_env.config import load_settings
from eiketsu_env.db.session import make_session_factory


def json_default(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return str(value)


settings = load_settings()
with make_session_factory(settings)() as session:
    rows = session.execute(
        text(
            '''
            WITH upload_scope AS (
                SELECT u.id, u.package_id, u.status, u.imported_match_count, u.match_count, u.target_version,
                       u.date_from, u.date_to,
                       COALESCE(NULLIF(p.mode_scope, ''), u.mode_scope, '') AS mode_scope,
                       COALESCE(NULLIF(p.festival_date_from, ''), u.festival_date_from, '') AS festival_date_from,
                       COALESCE(NULLIF(p.festival_date_to, ''), u.festival_date_to, '') AS festival_date_to,
                       u.created_at, u.updated_at
                FROM server_uploads u
                LEFT JOIN shared_contribution_packages p ON p.package_id = u.package_id
                WHERE u.status = 'completed'
            ),
            refreshable_uploads AS (
                SELECT *
                FROM upload_scope
                WHERE COALESCE(imported_match_count, 0) > 0
                   OR mode_scope = 'battle_festival'
            ),
            latest_upload AS (
                SELECT *
                FROM refreshable_uploads
                ORDER BY id DESC
                LIMIT 1
            ),
            latest_battle_festival_upload AS (
                SELECT *
                FROM refreshable_uploads
                WHERE mode_scope = 'battle_festival'
                ORDER BY id DESC
                LIMIT 1
            )
            SELECT 'latest_upload' AS upload_key, *
            FROM latest_upload
            UNION ALL
            SELECT 'latest_battle_festival_upload' AS upload_key, *
            FROM latest_battle_festival_upload
            '''
        )
    ).mappings().all()

payload = {"latest_upload": None, "latest_battle_festival_upload": None}
for row in rows:
    item = dict(row)
    key = item.pop("upload_key", "")
    if key in payload:
        payload[key] = item

print(json.dumps(payload, ensure_ascii=False, default=json_default))
"""


@dataclass(frozen=True)
class UploadRefreshConfig:
    repo_root: Path
    legacy_root: Path
    snapshot_file: Path
    match_search_index_file: Path
    tier_list_snapshot_file: Path
    tier_list_configs_file: Path
    status_file: Path
    battle_festival_snapshot_file: Path = Path("apps/api/data/battle-festival-snapshot.json")
    battle_festival_configs_file: Path = Path("apps/api/data/battle-festival-configs.json")
    live_snapshot_file: Path | None = None
    live_status_file: Path | None = None
    node_bin: str = "node"
    node_container: str = ""
    postgres_container: str = ""
    export_container: str = ""
    export_asset_root: Path | None = None
    refresh_reason: str = DEFAULT_REFRESH_REASON


def run_upload_refresh_once(
    config: UploadRefreshConfig,
    latest_upload_reader: LatestUploadReader | None = None,
    refresher: SnapshotRefresher | None = None,
) -> dict[str, Any]:
    try:
        latest_state = (latest_upload_reader or build_latest_upload_reader(config))()
    except Exception as exc:
        return _record_failure_status(config, f"upload refresh check failed: {exc}")

    latest_upload = _latest_upload_from_state(latest_state)
    latest_battle_festival_upload = _latest_battle_festival_upload_from_state(latest_state)
    if not _is_refreshable_upload(latest_upload) and not _is_refreshable_upload(latest_battle_festival_upload):
        return {"status": "skipped", "reason": "no new completed upload"}

    upload_id = _to_int(latest_upload.get("id")) if _is_refreshable_upload(latest_upload) else 0
    watermark = read_upload_watermark(config.status_file)
    battle_festival_upload_id = (
        _to_int(latest_battle_festival_upload.get("id"))
        if _is_refreshable_upload(latest_battle_festival_upload)
        else 0
    )
    battle_festival_snapshot_upload_id = read_battle_festival_snapshot_upload_id(config.battle_festival_snapshot_file)
    pending_uploads = _pending_refresh_uploads(
        latest_upload,
        latest_battle_festival_upload,
        watermark,
        battle_festival_snapshot_upload_id,
    )
    if not pending_uploads:
        return {
            "status": "skipped",
            "reason": "upload already refreshed",
            "uploadId": upload_id,
            "uploadWatermark": watermark,
            "battleFestivalUploadId": battle_festival_upload_id,
            "battleFestivalSnapshotUploadId": battle_festival_snapshot_upload_id,
            "pendingUploads": [],
        }

    try:
        refresh_result = (refresher or build_snapshot_refresher(config))()
    except Exception as exc:
        return _record_failure_status(config, f"upload refresh failed: {exc}")

    refresh_status = str(refresh_result.get("status") or "completed")
    return {
        "status": refresh_status,
        "reason": refresh_result.get("reason") or "",
        "uploadId": upload_id,
        "uploadWatermark": watermark,
        "battleFestivalUploadId": battle_festival_upload_id,
        "battleFestivalSnapshotUploadId": battle_festival_snapshot_upload_id,
        "pendingUploads": pending_uploads,
        "refreshReasons": [str(item.get("scope") or "") for item in pending_uploads],
        "refresh": refresh_result,
    }


def read_upload_watermark(status_file: Path) -> int:
    try:
        payload = json.loads(status_file.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return 0
    if not isinstance(payload, dict):
        return 0
    latest_run = payload.get("latestRun")
    snapshot = payload.get("snapshot")
    if isinstance(latest_run, dict) and isinstance(snapshot, dict):
        latest_run_id = _to_int(latest_run.get("id"))
        snapshot_run_id = _to_int(snapshot.get("sourceRunId"))
        if latest_run_id and snapshot_run_id:
            if latest_run_id != snapshot_run_id:
                return 0
            run_watermark = _to_int(latest_run.get("uploadWatermark"))
            if run_watermark:
                return run_watermark
    refresh = payload.get("refresh")
    if isinstance(refresh, dict) and str(refresh.get("status") or "") != "completed":
        return 0
    latest_upload = payload.get("latestUpload")
    if not isinstance(latest_upload, dict):
        return 0
    return _to_int(latest_upload.get("id"))


def read_battle_festival_snapshot_upload_id(snapshot_file: Path) -> int:
    try:
        payload = json.loads(snapshot_file.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return 0
    metadata = payload.get("metadata") if isinstance(payload, dict) else {}
    metadata = metadata if isinstance(metadata, dict) else {}
    return _to_int(metadata.get("sourceUploadId"))


def build_latest_upload_reader(config: UploadRefreshConfig) -> LatestUploadReader:
    if config.postgres_container:
        return lambda: read_latest_upload_from_postgres_container(config.postgres_container)
    return read_latest_upload_from_local_postgres


def read_latest_upload_from_postgres_container(container: str) -> dict[str, Any] | None:
    completed = _run_checked(["docker", "exec", container, "python", "-c", LATEST_UPLOAD_QUERY])
    return _parse_json(completed.stdout)


def read_latest_upload_from_local_postgres() -> dict[str, Any] | None:
    completed = subprocess.run(
        [sys.executable, "-c", LATEST_UPLOAD_QUERY],
        check=True,
        text=True,
        capture_output=True,
    )
    return _parse_json(completed.stdout)


def build_snapshot_refresher(config: UploadRefreshConfig) -> SnapshotRefresher:
    exporter = build_docker_exporter(config) if config.export_container else None
    run_refresher = build_docker_run_refresher(config) if config.export_container else None
    runner = DockerNodeRunner(config.repo_root, node_container=config.node_container)

    def refresh() -> dict[str, Any]:
        return refresh_static_snapshot_after_upload(
            repo_root=config.repo_root,
            legacy_root=config.legacy_root,
            snapshot_file=config.snapshot_file,
            match_search_index_file=config.match_search_index_file,
            tier_list_snapshot_file=config.tier_list_snapshot_file,
            tier_list_configs_file=config.tier_list_configs_file,
            battle_festival_snapshot_file=config.battle_festival_snapshot_file,
            battle_festival_configs_file=config.battle_festival_configs_file,
            status_file=config.status_file,
            live_snapshot_file=config.live_snapshot_file,
            live_status_file=config.live_status_file,
            node_bin=config.node_bin,
            refresh_reason=config.refresh_reason,
            exporter=exporter,
            run_refresher=run_refresher,
            runner=runner,
        )

    return refresh


def build_docker_exporter(config: UploadRefreshConfig):
    def export(output_dir: Path) -> dict[str, Any]:
        container_root = f"/tmp/eiketsu-legacy-service-export-{os.getpid()}"
        container_settings = f"/tmp/eiketsu-export-settings-{os.getpid()}"
        export_script = config.repo_root / "apps/api/data-migration/export_legacy_service_from_postgres.py"
        _run_checked(
            [
                "docker",
                "exec",
                config.export_container,
                "rm",
                "-rf",
                container_root,
                container_settings,
                "/tmp/export_legacy_service_from_postgres.py",
            ]
        )
        try:
            _run_checked(["docker", "cp", str(export_script), f"{config.export_container}:/tmp/export_legacy_service_from_postgres.py"])
            command = ["python", "/tmp/export_legacy_service_from_postgres.py", "--output", container_root]
            if config.export_asset_root and config.export_asset_root.is_dir():
                _run_checked(["docker", "exec", config.export_container, "mkdir", "-p", f"{container_settings}/assets"])
                _run_checked(["docker", "cp", f"{config.export_asset_root}/.", f"{config.export_container}:{container_settings}/assets"])
                command = ["env", f"EIKETSU_ENV_ROOT={container_settings}", *command]
            completed = _run_checked(["docker", "exec", config.export_container, *command])
            shutil.rmtree(output_dir, ignore_errors=True)
            _run_checked(["docker", "cp", f"{config.export_container}:{container_root}", str(output_dir)])
            return _parse_json_object(completed.stdout)
        finally:
            _run_checked(
                [
                    "docker",
                    "exec",
                    config.export_container,
                    "rm",
                    "-rf",
                    container_root,
                    container_settings,
                    "/tmp/export_legacy_service_from_postgres.py",
                ],
                check=False,
            )

    return export


def build_docker_run_refresher(config: UploadRefreshConfig) -> Callable[[], dict[str, Any]]:
    def refresh_run() -> dict[str, Any]:
        script = config.repo_root / "apps/api/data-migration/refresh_public_leaderboard_run.py"
        _run_checked(["docker", "cp", str(script), f"{config.export_container}:/tmp/refresh_public_leaderboard_run.py"])
        try:
            completed = _run_checked(["docker", "exec", config.export_container, "python", "/tmp/refresh_public_leaderboard_run.py"])
            return _parse_json_object(completed.stdout)
        finally:
            _run_checked(["docker", "exec", config.export_container, "rm", "-f", "/tmp/refresh_public_leaderboard_run.py"], check=False)

    return refresh_run


class DockerNodeRunner:
    def __init__(self, repo_root: Path, node_container: str = "") -> None:
        self.repo_root = repo_root.resolve()
        self.node_container = node_container

    def __call__(self, command: list[str], env: dict[str, str]) -> subprocess.CompletedProcess[str]:
        if shutil.which(command[0]):
            completed = subprocess.run(command, check=False, env=env, text=True, capture_output=True)
            if completed.returncode != 0:
                raise RuntimeError(_format_command_failure(command, completed))
            return completed

        docker_args = [self._to_work_path(value) for value in command[1:]]
        docker_env = {
            key: self._to_work_path(value)
            for key, value in env.items()
            if key == "NODE_OPTIONS" or key.startswith("LEADERBOARD_")
        }
        if self.node_container:
            docker_command = ["docker", "exec", "-w", "/work"]
            for key, value in docker_env.items():
                docker_command.extend(["-e", f"{key}={value}"])
            docker_command.extend([self.node_container, command[0], *docker_args])
            return _run_checked(docker_command)

        docker_command = [
            "docker",
            "run",
            "--rm",
            "--user",
            f"{os.getuid()}:{os.getgid()}",
            "-v",
            f"{self.repo_root}:/work",
            "-w",
            "/work",
        ]
        for key, value in docker_env.items():
            docker_command.extend(["-e", f"{key}={value}"])
        docker_command.extend(["node:22-alpine", "node", *docker_args])
        return _run_checked(docker_command)

    def _to_work_path(self, value: str) -> str:
        if not value:
            return value
        path = Path(value)
        try:
            resolved = path.resolve()
        except OSError:
            return value
        try:
            relative = resolved.relative_to(self.repo_root)
        except ValueError:
            return value
        return "/work" if not str(relative) else f"/work/{relative.as_posix()}"


def _record_failure_status(config: UploadRefreshConfig, reason: str) -> dict[str, Any]:
    write_refresh_status_only(
        repo_root=config.repo_root,
        legacy_root=config.legacy_root,
        snapshot_file=config.snapshot_file,
        battle_festival_snapshot_file=config.battle_festival_snapshot_file,
        status_file=config.status_file,
        live_status_file=config.live_status_file,
        refresh_status="failed",
        refresh_reason=reason,
    )
    return {"status": "failed", "reason": _sanitize_text(reason)}


def _latest_upload_from_state(state: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(state, dict):
        return None
    latest_upload = state.get("latest_upload")
    if isinstance(latest_upload, dict):
        return latest_upload
    if "latest_battle_festival_upload" in state:
        return None
    return state


def _latest_battle_festival_upload_from_state(state: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(state, dict):
        return None
    latest_upload = state.get("latest_battle_festival_upload")
    if isinstance(latest_upload, dict):
        return latest_upload
    if "latest_battle_festival_upload" in state:
        return None
    return state if str(state.get("mode_scope") or "") == "battle_festival" else None


def _pending_refresh_uploads(
    latest_upload: dict[str, Any] | None,
    latest_battle_festival_upload: dict[str, Any] | None,
    upload_watermark: int,
    battle_festival_snapshot_upload_id: int,
) -> list[dict[str, Any]]:
    pending: list[dict[str, Any]] = []
    upload_id = _to_int(latest_upload.get("id")) if _is_refreshable_upload(latest_upload) else 0
    if upload_id > upload_watermark:
        pending.append(
            {
                "scope": "global",
                "uploadId": upload_id,
                "uploadWatermark": upload_watermark,
            }
        )

    battle_festival_upload_id = (
        _to_int(latest_battle_festival_upload.get("id"))
        if _is_refreshable_upload(latest_battle_festival_upload)
        else 0
    )
    if battle_festival_upload_id > battle_festival_snapshot_upload_id:
        pending.append(
            {
                "scope": "battle_festival",
                "uploadId": battle_festival_upload_id,
                "snapshotUploadId": battle_festival_snapshot_upload_id,
            }
        )
    return pending


def _is_refreshable_upload(upload: dict[str, Any] | None) -> bool:
    if not isinstance(upload, dict):
        return False
    if str(upload.get("status") or "") != "completed":
        return False
    return _to_int(upload.get("imported_match_count")) > 0 or str(upload.get("mode_scope") or "") == "battle_festival"


def _to_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _parse_json(text: str) -> dict[str, Any] | None:
    value = json.loads(text or "null")
    return value if isinstance(value, dict) else None


def _parse_json_object(text: str) -> dict[str, Any]:
    value = json.loads(text or "{}")
    return value if isinstance(value, dict) else {}


def _run_checked(command: list[str], check: bool = True) -> subprocess.CompletedProcess[str]:
    completed = subprocess.run(command, check=False, text=True, capture_output=True)
    if check and completed.returncode != 0:
        raise RuntimeError(_format_command_failure(command, completed))
    return completed


def _format_command_failure(command: list[str], completed: subprocess.CompletedProcess[str]) -> str:
    return (
        f"command failed with exit code {completed.returncode}; "
        f"stderr: {_tail_text(completed.stderr)}; "
        f"stdout: {_tail_text(completed.stdout)}; "
        f"command: {command}"
    )


def _tail_text(value: str, limit: int = 240) -> str:
    text = str(value or "").strip()
    return text[-limit:] if len(text) > limit else text


def _json_default(value: Any) -> str:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return str(value)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Refresh static leaderboard data after new server uploads.")
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--legacy-root", type=Path, default=Path("apps/api/data/legacy-service"))
    parser.add_argument("--snapshot-file", type=Path, default=Path("apps/api/data/leaderboard-snapshot.json"))
    parser.add_argument("--match-search-index-file", type=Path, default=Path("apps/api/data/match-search-index.json"))
    parser.add_argument("--tier-list-snapshot-file", type=Path, default=Path("apps/api/data/tier-list-snapshot.json"))
    parser.add_argument("--tier-list-configs-file", type=Path, default=Path("apps/api/data/tier-list-configs.json"))
    parser.add_argument("--battle-festival-snapshot-file", type=Path, default=Path("apps/api/data/battle-festival-snapshot.json"))
    parser.add_argument("--battle-festival-configs-file", type=Path, default=Path("apps/api/data/battle-festival-configs.json"))
    parser.add_argument("--status-file", type=Path, default=Path("apps/api/data/leaderboard-refresh-status.json"))
    parser.add_argument("--live-snapshot-file", type=Path, default=None)
    parser.add_argument("--live-status-file", type=Path, default=None)
    parser.add_argument("--node-bin", default="node")
    parser.add_argument("--node-container", default="")
    parser.add_argument("--postgres-container", default="")
    parser.add_argument("--export-container", default="")
    parser.add_argument("--export-asset-root", type=Path, default=None)
    parser.add_argument("--refresh-reason", default=DEFAULT_REFRESH_REASON)
    parser.add_argument("--loop", action="store_true")
    parser.add_argument("--interval-seconds", type=int, default=60)
    return parser


def config_from_args(args: argparse.Namespace) -> UploadRefreshConfig:
    repo_root = args.repo_root.resolve()
    export_container = args.export_container or args.postgres_container
    return UploadRefreshConfig(
        repo_root=repo_root,
        legacy_root=_resolve(repo_root, args.legacy_root),
        snapshot_file=_resolve(repo_root, args.snapshot_file),
        match_search_index_file=_resolve(repo_root, args.match_search_index_file),
        tier_list_snapshot_file=_resolve(repo_root, args.tier_list_snapshot_file),
        tier_list_configs_file=_resolve(repo_root, args.tier_list_configs_file),
        battle_festival_snapshot_file=_resolve(repo_root, args.battle_festival_snapshot_file),
        battle_festival_configs_file=_resolve(repo_root, args.battle_festival_configs_file),
        status_file=_resolve(repo_root, args.status_file),
        live_snapshot_file=_resolve(repo_root, args.live_snapshot_file) if args.live_snapshot_file else None,
        live_status_file=_resolve(repo_root, args.live_status_file) if args.live_status_file else None,
        node_bin=args.node_bin,
        node_container=args.node_container,
        postgres_container=args.postgres_container,
        export_container=export_container,
        export_asset_root=args.export_asset_root,
        refresh_reason=args.refresh_reason,
    )


def _resolve(root: Path, path: Path) -> Path:
    return path if path.is_absolute() else (root / path).resolve()


def main() -> int:
    args = build_parser().parse_args()
    config = config_from_args(args)
    exit_code = 0
    while True:
        result = run_upload_refresh_once(config)
        print(json.dumps(result, ensure_ascii=False, default=_json_default, sort_keys=True))
        if result.get("status") == "failed":
            exit_code = 1
        if not args.loop:
            return exit_code
        time.sleep(max(5, args.interval_seconds))


if __name__ == "__main__":
    raise SystemExit(main())
