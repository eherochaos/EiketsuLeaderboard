from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from upload_refresh_worker import UploadRefreshConfig, run_upload_refresh_once


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

    def test_zero_import_upload_skips_refresh(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config = self._config(Path(temp_dir))

            result = run_upload_refresh_once(
                config,
                latest_upload_reader=lambda: {"id": 12, "status": "completed", "imported_match_count": 0},
                refresher=lambda: self.fail("refresh should not run"),
            )

            self.assertEqual(result, {"status": "skipped", "reason": "no new completed upload"})

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

    def _config(self, root: Path) -> UploadRefreshConfig:
        return UploadRefreshConfig(
            repo_root=root,
            legacy_root=root / "apps/api/data/legacy-service",
            snapshot_file=root / "apps/api/data/leaderboard-snapshot.json",
            match_search_index_file=root / "apps/api/data/match-search-index.json",
            status_file=root / "apps/api/data/leaderboard-refresh-status.json",
        )

    def _write_status(self, path: Path, latest_upload_id: int) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps({"latestUpload": {"id": latest_upload_id}}, ensure_ascii=False),
            encoding="utf-8",
        )


if __name__ == "__main__":
    unittest.main()
