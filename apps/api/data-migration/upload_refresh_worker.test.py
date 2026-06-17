from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path

import upload_refresh_worker
from upload_refresh_worker import UploadRefreshConfig, build_snapshot_refresher, run_upload_refresh_once


class UploadRefreshWorkerTests(unittest.TestCase):
    def test_new_completed_upload_triggers_refresh(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config = self._config(Path(temp_dir))
            self._write_status(config.status_file, latest_upload_id=10)
            calls: list[str] = []

            result = run_upload_refresh_once(
                config,
                latest_upload_reader=lambda: {"id": 11, "status": "completed", "imported_match_count": 3},
                refresher=lambda: calls.append("refresh") or {"status": "completed", "reason": "upload refresh completed"},
            )

            self.assertEqual(result["status"], "completed")
            self.assertEqual(result["uploadId"], 11)
            self.assertEqual(calls, ["refresh"])

    def test_force_refresh_skips_upload_watermark_check(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config = self._config(Path(temp_dir))
            calls: list[str] = []

            result = run_upload_refresh_once(
                config,
                latest_upload_reader=lambda: self.fail("latest upload should not be read"),
                refresher=lambda: calls.append("refresh") or {"status": "completed", "reason": "server version changed"},
                force_refresh=True,
            )

            self.assertEqual(result["status"], "completed")
            self.assertTrue(result["forced"])
            self.assertEqual(result["refreshReasons"], ["forced"])
            self.assertEqual(calls, ["refresh"])

    def test_existing_upload_watermark_skips_refresh(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config = self._config(Path(temp_dir))
            self._write_status(config.status_file, latest_upload_id=11)

            result = run_upload_refresh_once(
                config,
                latest_upload_reader=lambda: {"id": 11, "status": "completed", "imported_match_count": 3},
                refresher=lambda: self.fail("refresh should not run"),
            )

            self.assertEqual(result["status"], "skipped")
            self.assertEqual(result["reason"], "upload already refreshed")

    def test_battle_festival_upload_newer_than_snapshot_triggers_refresh(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config = self._config(Path(temp_dir))
            self._write_status(config.status_file, latest_upload_id=75)
            self._write_battle_festival_snapshot(config.battle_festival_snapshot_file, source_upload_id=73)
            calls: list[str] = []

            result = run_upload_refresh_once(
                config,
                latest_upload_reader=lambda: {
                    "latest_upload": {"id": 75, "status": "completed", "imported_match_count": 2},
                    "latest_battle_festival_upload": {
                        "id": 74,
                        "status": "completed",
                        "imported_match_count": 0,
                        "mode_scope": "battle_festival",
                    },
                },
                refresher=lambda: calls.append("refresh") or {"status": "completed", "reason": "upload refresh completed"},
            )

            self.assertEqual(result["status"], "completed")
            self.assertEqual(result["uploadId"], 75)
            self.assertEqual(result["battleFestivalUploadId"], 74)
            self.assertEqual(result["battleFestivalSnapshotUploadId"], 73)
            self.assertEqual(result["refreshReasons"], ["battle_festival"])
            self.assertEqual(calls, ["refresh"])

    def test_battle_festival_upload_current_snapshot_skips_refresh(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config = self._config(Path(temp_dir))
            self._write_status(config.status_file, latest_upload_id=75)
            self._write_battle_festival_snapshot(config.battle_festival_snapshot_file, source_upload_id=74)

            result = run_upload_refresh_once(
                config,
                latest_upload_reader=lambda: {
                    "latest_upload": {"id": 75, "status": "completed", "imported_match_count": 2},
                    "latest_battle_festival_upload": {
                        "id": 74,
                        "status": "completed",
                        "imported_match_count": 0,
                        "mode_scope": "battle_festival",
                    },
                },
                refresher=lambda: self.fail("refresh should not run"),
            )

            self.assertEqual(result["status"], "skipped")
            self.assertEqual(result["reason"], "upload already refreshed")
            self.assertEqual(result["battleFestivalUploadId"], 74)
            self.assertEqual(result["battleFestivalSnapshotUploadId"], 74)

    def test_missing_battle_festival_snapshot_triggers_refresh(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config = self._config(Path(temp_dir))
            self._write_status(config.status_file, latest_upload_id=75)
            calls: list[str] = []

            result = run_upload_refresh_once(
                config,
                latest_upload_reader=lambda: {
                    "latest_upload": {"id": 75, "status": "completed", "imported_match_count": 2},
                    "latest_battle_festival_upload": {
                        "id": 74,
                        "status": "completed",
                        "imported_match_count": 0,
                        "mode_scope": "battle_festival",
                    },
                },
                refresher=lambda: calls.append("refresh") or {"status": "completed", "reason": "upload refresh completed"},
            )

            self.assertEqual(result["status"], "completed")
            self.assertEqual(result["battleFestivalUploadId"], 74)
            self.assertEqual(result["battleFestivalSnapshotUploadId"], 0)
            self.assertEqual(calls, ["refresh"])

    def test_failed_status_does_not_advance_upload_watermark(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config = self._config(Path(temp_dir))
            self._write_status_payload(
                config.status_file,
                {
                    "refresh": {"status": "failed"},
                    "snapshot": {"sourceRunId": 10},
                    "latestRun": {"id": 12, "uploadWatermark": 11},
                    "latestUpload": {"id": 11},
                },
            )
            calls: list[str] = []

            result = run_upload_refresh_once(
                config,
                latest_upload_reader=lambda: {"id": 11, "status": "completed", "imported_match_count": 3},
                refresher=lambda: calls.append("refresh") or {"status": "completed", "reason": "retry"},
            )

            self.assertEqual(result["status"], "completed")
            self.assertEqual(result["uploadId"], 11)
            self.assertEqual(calls, ["refresh"])

    def test_snapshot_run_mismatch_does_not_skip_upload(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config = self._config(Path(temp_dir))
            self._write_status_payload(
                config.status_file,
                {
                    "refresh": {"status": "completed"},
                    "snapshot": {"sourceRunId": 151},
                    "latestRun": {"id": 153, "uploadWatermark": 67},
                    "latestUpload": {"id": 67},
                },
            )
            calls: list[str] = []

            result = run_upload_refresh_once(
                config,
                latest_upload_reader=lambda: {"id": 67, "status": "completed", "imported_match_count": 418},
                refresher=lambda: calls.append("refresh") or {"status": "completed", "reason": "retry"},
            )

            self.assertEqual(result["status"], "completed")
            self.assertEqual(result["uploadId"], 67)
            self.assertEqual(calls, ["refresh"])

    def test_failed_status_keeps_watermark_when_snapshot_matches_run(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config = self._config(Path(temp_dir))
            self._write_status_payload(
                config.status_file,
                {
                    "refresh": {"status": "failed"},
                    "snapshot": {"sourceRunId": 158},
                    "latestRun": {"id": 158, "uploadWatermark": 67},
                    "latestUpload": {"id": 67},
                },
            )

            result = run_upload_refresh_once(
                config,
                latest_upload_reader=lambda: {"id": 67, "status": "completed", "imported_match_count": 418},
                refresher=lambda: self.fail("refresh should not run"),
            )

            self.assertEqual(result["status"], "skipped")
            self.assertEqual(result["reason"], "upload already refreshed")

    def test_zero_import_upload_skips_refresh(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config = self._config(Path(temp_dir))

            result = run_upload_refresh_once(
                config,
                latest_upload_reader=lambda: {"id": 12, "status": "completed", "imported_match_count": 0},
                refresher=lambda: self.fail("refresh should not run"),
            )

            self.assertEqual(result, {"status": "skipped", "reason": "no new completed upload"})

    def test_manifest_only_battle_festival_upload_triggers_refresh(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config = self._config(Path(temp_dir))
            calls: list[str] = []

            result = run_upload_refresh_once(
                config,
                latest_upload_reader=lambda: {
                    "id": 13,
                    "status": "completed",
                    "imported_match_count": 0,
                    "mode_scope": "battle_festival",
                },
                refresher=lambda: calls.append("refresh") or {"status": "completed", "reason": "upload refresh completed"},
            )

            self.assertEqual(result["status"], "completed")
            self.assertEqual(result["uploadId"], 13)
            self.assertEqual(calls, ["refresh"])

    def test_latest_upload_query_joins_package_scope(self) -> None:
        self.assertIn("LEFT JOIN shared_contribution_packages", upload_refresh_worker.LATEST_UPLOAD_QUERY)
        self.assertIn("COALESCE(NULLIF(p.mode_scope, ''), u.mode_scope", upload_refresh_worker.LATEST_UPLOAD_QUERY)
        self.assertIn("latest_battle_festival_upload", upload_refresh_worker.LATEST_UPLOAD_QUERY)
        self.assertIn("mode_scope = 'battle_festival'", upload_refresh_worker.LATEST_UPLOAD_QUERY)

    def test_lock_skip_result_is_returned(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config = self._config(Path(temp_dir))

            result = run_upload_refresh_once(
                config,
                latest_upload_reader=lambda: {"id": 12, "status": "completed", "imported_match_count": 4},
                refresher=lambda: {"status": "skipped", "reason": "refresh already running"},
            )

            self.assertEqual(result["status"], "skipped")
            self.assertEqual(result["reason"], "refresh already running")

    def test_reader_failure_writes_sanitized_status(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            config = self._config(root)
            config.snapshot_file.parent.mkdir(parents=True, exist_ok=True)
            config.snapshot_file.write_text(json.dumps({"metadata": {"sourceRunId": 8}}), encoding="utf-8")

            result = run_upload_refresh_once(
                config,
                latest_upload_reader=lambda: (_ for _ in ()).throw(RuntimeError(f"failed at {root}\\secret token=abc123")),
                refresher=lambda: self.fail("refresh should not run"),
            )

            self.assertEqual(result["status"], "failed")
            status_text = config.status_file.read_text(encoding="utf-8")
            self.assertNotIn(str(root), status_text)
            self.assertNotIn("abc123", status_text)
            status = json.loads(status_text)
            self.assertEqual(status["refresh"]["status"], "failed")

    def test_snapshot_refresher_passes_tier_list_paths(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            config = replace(self._config(root), live_status_file=root / "live/leaderboard-refresh-status.json")
            captured: dict[str, Path] = {}
            original_refresh = upload_refresh_worker.refresh_static_snapshot_after_upload

            def fake_refresh_static_snapshot_after_upload(**kwargs):
                captured["tier_list_snapshot_file"] = kwargs["tier_list_snapshot_file"]
                captured["tier_list_configs_file"] = kwargs["tier_list_configs_file"]
                captured["battle_festival_snapshot_file"] = kwargs["battle_festival_snapshot_file"]
                captured["battle_festival_configs_file"] = kwargs["battle_festival_configs_file"]
                captured["live_status_file"] = kwargs["live_status_file"]
                return {"status": "completed"}

            upload_refresh_worker.refresh_static_snapshot_after_upload = fake_refresh_static_snapshot_after_upload
            try:
                result = build_snapshot_refresher(config)()
            finally:
                upload_refresh_worker.refresh_static_snapshot_after_upload = original_refresh

            self.assertEqual(result["status"], "completed")
            self.assertEqual(captured["tier_list_snapshot_file"], config.tier_list_snapshot_file)
            self.assertEqual(captured["tier_list_configs_file"], config.tier_list_configs_file)
            self.assertEqual(captured["battle_festival_snapshot_file"], config.battle_festival_snapshot_file)
            self.assertEqual(captured["battle_festival_configs_file"], config.battle_festival_configs_file)
            self.assertEqual(captured["live_status_file"], config.live_status_file)

    def test_docker_node_runner_uses_configured_node_container(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir).resolve()
            captured: dict[str, list[str]] = {}
            original_which = upload_refresh_worker.shutil.which
            original_run_checked = upload_refresh_worker._run_checked

            def fake_run_checked(command: list[str], check: bool = True) -> subprocess.CompletedProcess[str]:
                captured["command"] = command
                return subprocess.CompletedProcess(command, 0, "", "")

            upload_refresh_worker.shutil.which = lambda _: None
            upload_refresh_worker._run_checked = fake_run_checked
            try:
                runner = upload_refresh_worker.DockerNodeRunner(root, node_container="eiketsu-leaderboard-api")
                runner(
                    ["node", str(root / "apps/api/leaderboard-snapshot/refresh-snapshot.mjs")],
                    {
                        "NODE_OPTIONS": "--max-old-space-size=4096",
                        "LEADERBOARD_LEGACY_ROOT": str(root / "apps/api/data/legacy-service"),
                        "IGNORED": str(root / "ignored"),
                    },
                )
            finally:
                upload_refresh_worker.shutil.which = original_which
                upload_refresh_worker._run_checked = original_run_checked

            self.assertEqual(
                captured["command"],
                [
                    "docker",
                    "exec",
                    "-w",
                    "/work",
                    "-e",
                    "NODE_OPTIONS=--max-old-space-size=4096",
                    "-e",
                    "LEADERBOARD_LEGACY_ROOT=/work/apps/api/data/legacy-service",
                    "eiketsu-leaderboard-api",
                    "node",
                    "/work/apps/api/leaderboard-snapshot/refresh-snapshot.mjs",
                ],
            )

    def test_docker_node_runner_preserves_node_options_when_cwd_is_repo_root(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir).resolve()
            captured: dict[str, list[str]] = {}
            original_which = upload_refresh_worker.shutil.which
            original_run_checked = upload_refresh_worker._run_checked
            original_cwd = Path.cwd()

            def fake_run_checked(command: list[str], check: bool = True) -> subprocess.CompletedProcess[str]:
                captured["command"] = command
                return subprocess.CompletedProcess(command, 0, "", "")

            upload_refresh_worker.shutil.which = lambda _: None
            upload_refresh_worker._run_checked = fake_run_checked
            try:
                os.chdir(root)
                runner = upload_refresh_worker.DockerNodeRunner(root, node_container="eiketsu-leaderboard-api")
                runner(
                    ["node", str(root / "apps/api/leaderboard-snapshot/refresh-snapshot.mjs")],
                    {
                        "NODE_OPTIONS": "--max-old-space-size=4096",
                        "LEADERBOARD_LEGACY_ROOT": str(root / "apps/api/data/legacy-service"),
                    },
                )
            finally:
                os.chdir(original_cwd)
                upload_refresh_worker.shutil.which = original_which
                upload_refresh_worker._run_checked = original_run_checked

            self.assertIn("NODE_OPTIONS=--max-old-space-size=4096", captured["command"])
            self.assertNotIn("NODE_OPTIONS=/work/--max-old-space-size=4096", captured["command"])

    def _config(self, root: Path) -> UploadRefreshConfig:
        return UploadRefreshConfig(
            repo_root=root,
            legacy_root=root / "apps/api/data/legacy-service",
            snapshot_file=root / "apps/api/data/leaderboard-snapshot.json",
            match_search_index_file=root / "apps/api/data/match-search-index.json",
            tier_list_snapshot_file=root / "apps/api/data/tier-list-snapshot.json",
            tier_list_configs_file=root / "apps/api/data/tier-list-configs.json",
            battle_festival_snapshot_file=root / "apps/api/data/battle-festival-snapshot.json",
            battle_festival_configs_file=root / "apps/api/data/battle-festival-configs.json",
            status_file=root / "apps/api/data/leaderboard-refresh-status.json",
        )

    def _write_status(self, path: Path, latest_upload_id: int) -> None:
        self._write_status_payload(path, {"latestUpload": {"id": latest_upload_id}})

    def _write_status_payload(self, path: Path, payload: dict) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(payload, ensure_ascii=False),
            encoding="utf-8",
        )

    def _write_battle_festival_snapshot(self, path: Path, source_upload_id: int) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps({"metadata": {"sourceUploadId": source_upload_id}}, ensure_ascii=False),
            encoding="utf-8",
        )


if __name__ == "__main__":
    unittest.main()
