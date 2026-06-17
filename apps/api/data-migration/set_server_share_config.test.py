from __future__ import annotations

import sqlite3
import unittest
from contextlib import closing, contextmanager
from pathlib import Path
from typing import Iterator
from uuid import uuid4

import set_server_share_config as module


@contextmanager
def temporary_db_path() -> Iterator[Path]:
    root = Path("output") / "test-tmp"
    root.mkdir(parents=True, exist_ok=True)
    db_path = root / f"{uuid4().hex}.db"
    try:
        yield db_path
    finally:
        db_path.unlink(missing_ok=True)


class SetServerShareConfigTests(unittest.TestCase):
    def test_updates_latest_config_row(self) -> None:
        with temporary_db_path() as db_path:
            self._create_database(db_path)

            result = module.set_server_share_config_sqlite(db_path)

            self.assertEqual(result["status"], "completed")
            self.assertEqual(result["configId"], 2)
            self.assertEqual(result["current"]["targetVersion"], "Ver.3.5.0C")
            self.assertEqual(result["current"]["dateFrom"], "2026-06-17")
            self.assertEqual(result["current"]["dateTo"], "2026-06-17")
            with closing(sqlite3.connect(db_path)) as connection:
                rows = connection.execute(
                    """
                    SELECT id, target_version, date_from, date_to, include_solo, include_battle_festival
                    FROM server_share_config
                    ORDER BY id
                    """
                ).fetchall()

            self.assertEqual(
                rows,
                [
                    (1, "Ver.old", "2026-05-01", "2026-05-31", 0, 0),
                    (2, "Ver.3.5.0C", "2026-06-17", "2026-06-17", 0, 0),
                ],
            )

    def test_inserts_config_when_table_is_empty(self) -> None:
        with temporary_db_path() as db_path:
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

            result = module.set_server_share_config_sqlite(db_path, date_to="2026-06-20")

            self.assertEqual(result["updatedRows"], 1)
            with closing(sqlite3.connect(db_path)) as connection:
                row = connection.execute(
                    """
                    SELECT schema_version, target_version, date_from, date_to, high_ranker_rank
                    FROM server_share_config
                    """
                ).fetchone()
            self.assertEqual(row, ("share_v1", "Ver.3.5.0C", "2026-06-17", "2026-06-20", 100))

    def test_does_not_downgrade_newer_current_version(self) -> None:
        with temporary_db_path() as db_path:
            self._create_database(db_path)
            with closing(sqlite3.connect(db_path)) as connection:
                with connection:
                    connection.execute(
                        """
                        UPDATE server_share_config
                        SET target_version = 'Ver.3.5.0D', date_from = '2026-06-24', date_to = '2026-06-24'
                        WHERE id = 2
                        """
                    )

            result = module.set_server_share_config_sqlite(db_path)

            self.assertEqual(result["status"], "skipped")
            self.assertEqual(result["reason"], "current target version is newer")
            self.assertEqual(result["updatedRows"], 0)
            with closing(sqlite3.connect(db_path)) as connection:
                row = connection.execute(
                    """
                    SELECT target_version, date_from, date_to
                    FROM server_share_config
                    WHERE id = 2
                    """
                ).fetchone()
            self.assertEqual(row, ("Ver.3.5.0D", "2026-06-24", "2026-06-24"))

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
                            "Ver.old",
                            "2026-05-01",
                            "2026-05-31",
                            0,
                            0,
                            100,
                            '["md","csv"]',
                            '["overview"]',
                            "2026-05-01T00:00:00Z",
                            "2026-05-31T00:00:00Z",
                        ),
                        (
                            2,
                            "share_v1",
                            "Ver.current",
                            "2026-06-01",
                            "2026-06-16",
                            1,
                            1,
                            50,
                            '["md"]',
                            '["overview"]',
                            "2026-06-01T00:00:00Z",
                            "2026-06-16T00:00:00Z",
                        ),
                    ],
                )


if __name__ == "__main__":
    unittest.main()
