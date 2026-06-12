from __future__ import annotations

import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

import enable_battle_festival_scope as module


class EnableBattleFestivalScopeTests(unittest.TestCase):
    def test_adds_columns_and_enables_latest_config(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            db_path = Path(root) / "service.db"
            self._create_database(db_path)

            result = module.enable_battle_festival_scope_sqlite(db_path)

            self.assertEqual(result["status"], "completed")
            self.assertIn("server_share_config.include_battle_festival", result["addedColumns"])
            self.assertIn("server_leaderboard_runs.include_battle_festival", result["addedColumns"])
            with closing(sqlite3.connect(db_path)) as connection:
                rows = connection.execute(
                    "SELECT target_version, include_battle_festival FROM server_share_config ORDER BY id"
                ).fetchall()
            self.assertEqual(rows, [("Ver.old", 0), ("Ver.current", 1)])

    def test_target_version_limits_config_update(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            db_path = Path(root) / "service.db"
            self._create_database(db_path)

            module.enable_battle_festival_scope_sqlite(db_path, target_version="Ver.old")

            with closing(sqlite3.connect(db_path)) as connection:
                rows = connection.execute(
                    "SELECT target_version, include_battle_festival FROM server_share_config ORDER BY id"
                ).fetchall()
            self.assertEqual(rows, [("Ver.old", 1), ("Ver.current", 0)])

    def _create_database(self, db_path: Path) -> None:
        with closing(sqlite3.connect(db_path)) as connection:
            with connection:
                connection.execute(
                    """
                    CREATE TABLE server_share_config (
                      id INTEGER PRIMARY KEY,
                      target_version TEXT NOT NULL,
                      updated_at TEXT NOT NULL
                    )
                    """
                )
                connection.execute(
                    """
                    CREATE TABLE server_leaderboard_runs (
                      id INTEGER PRIMARY KEY,
                      target_version TEXT NOT NULL
                    )
                    """
                )
                connection.executemany(
                    "INSERT INTO server_share_config (id, target_version, updated_at) VALUES (?, ?, ?)",
                    [
                        (1, "Ver.old", "2026-06-01T00:00:00"),
                        (2, "Ver.current", "2026-06-13T00:00:00"),
                    ],
                )


if __name__ == "__main__":
    unittest.main()
