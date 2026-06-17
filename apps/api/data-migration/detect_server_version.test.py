from __future__ import annotations

import sqlite3
import unittest
from contextlib import closing, contextmanager
from pathlib import Path
from typing import Iterator
from uuid import uuid4

import detect_server_version as module


@contextmanager
def temporary_db_path() -> Iterator[Path]:
    root = Path("output") / "test-tmp"
    root.mkdir(parents=True, exist_ok=True)
    db_path = root / f"{uuid4().hex}.db"
    try:
        yield db_path
    finally:
        db_path.unlink(missing_ok=True)


class DetectServerVersionTests(unittest.TestCase):
    def test_no_evidence_does_not_update(self) -> None:
        result = module.apply_detected_version(
            [],
            {"target_version": "Ver.3.5.0B"},
            lambda *_args: self.fail("setter should not run"),
            probe_date="2026-06-17",
        )

        self.assertEqual(result["status"], "no_evidence")
        self.assertEqual(result["detailSampleCount"], 0)

    def test_unchanged_version_does_not_update(self) -> None:
        result = module.apply_detected_version(
            [{"version": "Ver.3.5.0C", "date": "2026-06-17 09:12"}],
            {"target_version": "Ver.3.5.0C"},
            lambda *_args: self.fail("setter should not run"),
            probe_date="2026-06-17",
        )

        self.assertEqual(result["status"], "unchanged")
        self.assertEqual(result["candidate"]["targetVersion"], "Ver.3.5.0C")

    def test_latest_detail_sample_selects_candidate_version(self) -> None:
        calls: list[tuple[str, str, str]] = []

        result = module.apply_detected_version(
            [
                {"version": "Ver.3.5.0B", "date": "2026-06-17 09:01", "mode": "ranked"},
                {"version": "Ver.3.5.0C", "date": "2026-06-17 09:08", "mode": "ranked"},
            ],
            {"target_version": "Ver.3.5.0B"},
            lambda version, date_from, date_to: calls.append((version, date_from, date_to)) or {"status": "completed"},
            probe_date="2026-06-17",
        )

        self.assertEqual(result["status"], "changed")
        self.assertEqual(result["candidate"]["targetVersion"], "Ver.3.5.0C")
        self.assertEqual(calls, [("Ver.3.5.0C", "2026-06-17", "2026-06-17")])

    def test_invalid_versions_are_ignored(self) -> None:
        result = module.apply_detected_version(
            [
                {"version": "Ver.3.5.0", "date": "2026-06-17 09:01"},
                {"version": "3.5.0C", "date": "2026-06-17 09:02"},
            ],
            {"target_version": "Ver.3.5.0B"},
            lambda *_args: self.fail("setter should not run"),
            probe_date="2026-06-17",
        )

        self.assertEqual(result["status"], "no_evidence")

    def test_older_candidate_does_not_downgrade_current_version(self) -> None:
        result = module.apply_detected_version(
            [{"version": "Ver.3.5.0C", "date": "2026-06-17 09:12"}],
            {"target_version": "Ver.3.5.0D"},
            lambda *_args: self.fail("setter should not run"),
            probe_date="2026-06-17",
        )

        self.assertEqual(result["status"], "older_candidate")
        self.assertEqual(result["currentTargetVersion"], "Ver.3.5.0D")

    def test_sqlite_config_updates_to_detected_version(self) -> None:
        with temporary_db_path() as db_path:
            self._create_database(db_path)

            result = module.apply_detected_version_sqlite(
                db_path,
                [{"version": "Ver.3.5.0C", "date": "2026-06-17 10:03"}],
                probe_date="2026-06-17",
            )

            self.assertEqual(result["status"], "changed")
            with closing(sqlite3.connect(db_path)) as connection:
                row = connection.execute(
                    """
                    SELECT target_version, date_from, date_to
                    FROM server_share_config
                    WHERE id = 2
                    """
                ).fetchone()
            self.assertEqual(row, ("Ver.3.5.0C", "2026-06-17", "2026-06-17"))

    def _create_database(self, db_path: Path) -> None:
        with closing(sqlite3.connect(db_path)) as connection:
            with connection:
                connection.execute(
                    """
                    CREATE TABLE server_share_config (
                      id INTEGER PRIMARY KEY,
                      schema_version TEXT NOT NULL,
                      target_version TEXT NOT NULL,
                      date_from TEXT NOT NULL,
                      date_to TEXT NOT NULL,
                      include_solo INTEGER NOT NULL,
                      include_battle_festival INTEGER NOT NULL,
                      high_ranker_rank INTEGER NOT NULL,
                      report_formats_json TEXT NOT NULL,
                      reports_json TEXT NOT NULL,
                      created_at TEXT NOT NULL,
                      updated_at TEXT NOT NULL
                    )
                    """
                )
                connection.executemany(
                    """
                    INSERT INTO server_share_config (
                      id,
                      schema_version,
                      target_version,
                      date_from,
                      date_to,
                      include_solo,
                      include_battle_festival,
                      high_ranker_rank,
                      report_formats_json,
                      reports_json,
                      created_at,
                      updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            1,
                            "share_v1",
                            "Ver.3.5.0A",
                            "2026-05-20",
                            "2026-05-23",
                            0,
                            0,
                            100,
                            '["md","csv"]',
                            '["overview"]',
                            "2026-05-20T00:00:00Z",
                            "2026-05-23T00:00:00Z",
                        ),
                        (
                            2,
                            "share_v1",
                            "Ver.3.5.0B",
                            "2026-05-27",
                            "2026-06-16",
                            0,
                            0,
                            100,
                            '["md","csv"]',
                            '["overview"]',
                            "2026-05-27T00:00:00Z",
                            "2026-06-16T00:00:00Z",
                        ),
                    ],
                )


if __name__ == "__main__":
    unittest.main()
