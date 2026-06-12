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
    row = session.execute(
        text(
            '''
            SELECT id, status, imported_match_count, match_count, target_version,
                   date_from, date_to, created_at, updated_at
            FROM server_uploads
            WHERE status = 'completed'
              AND COALESCE(imported_match_count, 0) > 0
            ORDER BY id DESC
            LIMIT 1
            '''
        )
    ).mappings().first()

print(json.dumps(dict(row) if row else None, ensure_ascii=False, default=json_default))
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
        latest_upload = (latest_upload_reader or build_latest_upload_reader(config))()
    except Exception as exc:
        return _record_failure_status(config, f"upload refresh check failed: {exc}")

    if not _is_refreshable_upload(latest_upload):
        return {"status": "skipped", "reason": "no new completed upload"}

    upload_id = _to_int(latest_upload.get("id"))
    watermark = read_upload_watermark(config.status_file)
    if upload_id <= watermark:
        return {
            "status": "skipped",
            "reason": "upload already refreshed",
            "uploadId": upload_id,
            "uploadWatermark": watermark,
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
        "refresh": refresh_result,
    }


def read_upload_watermark(status_file: Path) -> int:
    try:
        payload = json.loads(status_file.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return 0
    latest_upload = payload.get("latestUpload") if isinstance(payload, dict) else {}
    if not isinstance(latest_upload, dict):
        return 0
    return _to_int(latest_upload.get("id"))


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
    runner = DockerNodeRunner(config.repo_root)

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
    def __init__(self, repo_root: Path) -> None:
        self.repo_root = repo_root.resolve()

    def __call__(self, command: list[str], env: dict[str, str]) -> subprocess.CompletedProcess[str]:
        if shutil.which(command[0]):
            return subprocess.run(command, check=True, env=env, text=True, capture_output=True)

        docker_args = [self._to_work_path(value) for value in command[1:]]
        docker_env = {
            key: self._to_work_path(value)
            for key, value in env.items()
            if key.startswith("LEADERBOARD_")
        }
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
        status_file=config.status_file,
        live_status_file=config.live_status_file,
        refresh_status="failed",
        refresh_reason=reason,
    )
    return {"status": "failed", "reason": _sanitize_text(reason)}


def _is_refreshable_upload(upload: dict[str, Any] | None) -> bool:
    if not isinstance(upload, dict):
        return False
    return str(upload.get("status") or "") == "completed" and _to_int(upload.get("imported_match_count")) > 0


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
    return subprocess.run(command, check=check, text=True, capture_output=True)


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
