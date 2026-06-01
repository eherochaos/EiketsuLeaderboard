from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from refresh_static_snapshot_after_upload import refresh_static_snapshot_after_upload


class RefreshStaticSnapshotAfterUploadTests(unittest.TestCase):
    def test_refresh_static_snapshot_replaces_export_and_publishes_live_file(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            legacy_root = repo_root / "apps/api/data/legacy-service"
            snapshot_file = repo_root / "apps/api/data/leaderboard-snapshot.json"
            live_snapshot_file = repo_root / "live/leaderboard-snapshot.json"
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
                live_snapshot_file=live_snapshot_file,
                exporter=fake_exporter,
                runner=fake_runner,
            )

            self.assertEqual(result["status"], "completed")
            self.assertEqual(result["export"]["tables"]["server_leaderboard_rows"], 1)
            self.assertTrue((legacy_root / "tables" / "server_leaderboard_rows.jsonl").is_file())
            self.assertTrue((legacy_root.with_name("legacy-service.prev") / "tables" / "old.jsonl").is_file())
            self.assertEqual(json.loads(live_snapshot_file.read_text(encoding="utf-8"))["metadata"]["sourceRunId"], 7)
            self.assertEqual(len(calls), 2)
            self.assertEqual(calls[-1][1]["LEADERBOARD_LEGACY_ROOT"], str(legacy_root))
            self.assertEqual(calls[-1][1]["LEADERBOARD_SNAPSHOT_FILE"], str(snapshot_file))

    def test_refresh_static_snapshot_skips_when_lock_exists(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            snapshot_file = repo_root / "apps/api/data/leaderboard-snapshot.json"
            snapshot_file.parent.mkdir(parents=True)
            snapshot_file.with_name(f".{snapshot_file.name}.refresh.lock").write_text("busy", encoding="utf-8")

            result = refresh_static_snapshot_after_upload(repo_root=repo_root, snapshot_file=snapshot_file)

            self.assertEqual(result, {"status": "skipped", "reason": "refresh already running"})


if __name__ == "__main__":
    unittest.main()
