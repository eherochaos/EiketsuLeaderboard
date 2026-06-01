from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from refresh_static_snapshot_after_upload import refresh_static_snapshot_after_upload, write_refresh_status_only


class RefreshStaticSnapshotAfterUploadTests(unittest.TestCase):
    def test_refresh_static_snapshot_replaces_export_and_publishes_live_file(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            legacy_root = repo_root / "apps/api/data/legacy-service"
            snapshot_file = repo_root / "apps/api/data/leaderboard-snapshot.json"
            status_file = repo_root / "apps/api/data/leaderboard-refresh-status.json"
            live_snapshot_file = repo_root / "live/leaderboard-snapshot.json"
            live_status_file = repo_root / "live/leaderboard-refresh-status.json"
            calls: list[tuple[list[str], dict[str, str]]] = []

            (legacy_root / "tables").mkdir(parents=True)
            (legacy_root / "tables" / "old.jsonl").write_text("{}\n", encoding="utf-8")

            def fake_exporter(output_dir: Path) -> dict:
                (output_dir / "cards").mkdir(parents=True)
                (output_dir / "tables").mkdir(parents=True)
                (output_dir / "cards" / "datalist_api_base.json").write_text("{}\n", encoding="utf-8")
                (output_dir / "tables" / "server_leaderboard_rows.jsonl").write_text("{}\n", encoding="utf-8")
                return {"tables": {"server_leaderboard_rows": 1}}

            def fake_runner(command: list[str], env: dict[str, str]) -> subprocess.CompletedProcess[str]:
                calls.append((command, env))
                if command[-1].endswith("refresh-snapshot.mjs"):
                    snapshot_file.parent.mkdir(parents=True, exist_ok=True)
                    snapshot_file.write_text(json.dumps({"metadata": {"sourceRunId": 7}}), encoding="utf-8")
                return subprocess.CompletedProcess(command, 0, "", "")

            result = refresh_static_snapshot_after_upload(
                repo_root=repo_root,
                legacy_root=legacy_root,
                snapshot_file=snapshot_file,
                status_file=status_file,
                live_snapshot_file=live_snapshot_file,
                live_status_file=live_status_file,
                exporter=fake_exporter,
                run_refresher=lambda: {"status": "completed", "run_id": 6},
                runner=fake_runner,
            )

            self.assertEqual(result["status"], "completed")
            self.assertEqual(result["run"]["run_id"], 6)
            self.assertEqual(result["export"]["tables"]["server_leaderboard_rows"], 1)
            self.assertTrue((legacy_root / "tables" / "server_leaderboard_rows.jsonl").is_file())
            self.assertTrue((legacy_root.with_name("legacy-service.prev") / "tables" / "old.jsonl").is_file())
            self.assertEqual(json.loads(live_snapshot_file.read_text(encoding="utf-8"))["metadata"]["sourceRunId"], 7)
            status = json.loads(status_file.read_text(encoding="utf-8"))
            live_status = json.loads(live_status_file.read_text(encoding="utf-8"))
            self.assertEqual(status["refresh"]["status"], "completed")
            self.assertEqual(status["runRefresh"]["run_id"], 6)
            self.assertEqual(status["snapshot"]["sourceRunId"], 7)
            self.assertEqual(live_status["snapshot"]["sourceRunId"], 7)
            self.assertNotIn(str(repo_root), json.dumps(status, ensure_ascii=False))
            self.assertEqual(len(calls), 2)
            self.assertEqual(calls[-1][1]["LEADERBOARD_LEGACY_ROOT"], str(legacy_root))
            self.assertEqual(calls[-1][1]["LEADERBOARD_SNAPSHOT_FILE"], str(snapshot_file))

    def test_refresh_static_snapshot_skips_when_lock_exists(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            snapshot_file = repo_root / "apps/api/data/leaderboard-snapshot.json"
            snapshot_file.parent.mkdir(parents=True, exist_ok=True)
            snapshot_file.with_name(f".{snapshot_file.name}.refresh.lock").write_text("busy", encoding="utf-8")

            result = refresh_static_snapshot_after_upload(repo_root=repo_root, snapshot_file=snapshot_file)

            self.assertEqual(result, {"status": "skipped", "reason": "refresh already running"})
            status_file = repo_root / "apps/api/data/leaderboard-refresh-status.json"
            status = json.loads(status_file.read_text(encoding="utf-8"))
            self.assertEqual(status["refresh"]["status"], "skipped")
            self.assertEqual(status["refresh"]["reason"], "refresh already running")

    def test_refresh_failure_writes_sanitized_status(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            legacy_root = repo_root / "apps/api/data/legacy-service"
            snapshot_file = repo_root / "apps/api/data/leaderboard-snapshot.json"
            status_file = repo_root / "apps/api/data/leaderboard-refresh-status.json"

            def fake_exporter(output_dir: Path) -> dict:
                output_dir.mkdir(parents=True)
                return {"tables": {}}

            def fake_runner(command: list[str], env: dict[str, str]) -> subprocess.CompletedProcess[str]:
                raise RuntimeError(f"failed at {repo_root}\\secret token=abc123")

            with self.assertRaises(RuntimeError):
                refresh_static_snapshot_after_upload(
                    repo_root=repo_root,
                    legacy_root=legacy_root,
                    snapshot_file=snapshot_file,
                    status_file=status_file,
                    exporter=fake_exporter,
                    run_refresher=lambda: {"status": "completed"},
                    runner=fake_runner,
                )

            status_text = status_file.read_text(encoding="utf-8")
            status = json.loads(status_text)
            self.assertEqual(status["refresh"]["status"], "failed")
            self.assertNotIn(str(repo_root), status_text)
            self.assertNotIn("abc123", status_text)

    def test_refresh_status_includes_sanitized_upload_user_info(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            legacy_root = repo_root / "apps/api/data/legacy-service"
            tables_root = legacy_root / "tables"
            snapshot_file = repo_root / "apps/api/data/leaderboard-snapshot.json"
            status_file = repo_root / "apps/api/data/leaderboard-refresh-status.json"
            tables_root.mkdir(parents=True)
            snapshot_file.parent.mkdir(parents=True, exist_ok=True)
            snapshot_file.write_text(json.dumps({"metadata": {"sourceRunId": 8}}), encoding="utf-8")
            (tables_root / "server_users.jsonl").write_text(
                json.dumps(
                    {
                        "id": 11,
                        "public_id": "u_public",
                        "contributor_name": "alice token=secret",
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )
            (tables_root / "server_uploads.jsonl").write_text(
                json.dumps(
                    {
                        "id": 21,
                        "user_id": 11,
                        "target_version": "Ver.3.5.0B",
                        "date_from": "2026-06-01",
                        "date_to": "2026-06-01",
                        "status": "completed",
                        "match_count": 12,
                        "imported_match_count": 10,
                        "error_summary_json": [],
                        "created_at": "2026-06-01T12:00:00",
                        "updated_at": "2026-06-01T12:01:00",
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )

            write_refresh_status_only(
                repo_root=repo_root,
                legacy_root=legacy_root,
                snapshot_file=snapshot_file,
                status_file=status_file,
            )

            status_text = status_file.read_text(encoding="utf-8")
            status = json.loads(status_text)
            upload = status["latestUpload"]
            self.assertEqual(upload["id"], 21)
            self.assertEqual(upload["contributorName"], "alice token=[redacted]")
            self.assertEqual(upload["userPublicId"], "u_public")
            self.assertNotIn("user_id", json.dumps(upload, ensure_ascii=False))
            self.assertNotIn("secret", status_text)


if __name__ == "__main__":
    unittest.main()
