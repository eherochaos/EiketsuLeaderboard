from __future__ import annotations

import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

import repair_battle_festival_upload_period as module


class RepairBattleFestivalUploadPeriodTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.db_path = Path(self.temp_dir.name) / "service.db"
        self._create_database()

    def test_dry_run_is_default_and_does_not_write(self) -> None:
        args = module.build_parser().parse_args(
            [
                "--sqlite-file",
                str(self.db_path),
                "--upload-id",
                "109",
                "--target-version",
                "Ver.3.5.0D",
                "--date-from",
                "2026-07-18",
                "--date-to",
                "2026-07-20",
                "--source",
                "official",
            ]
        )
        self.assertFalse(args.apply)

        result = self._repair()

        self.assertEqual(result["status"], "dry_run")
        self.assertEqual(result["uploadId"], 109)
        self.assertEqual(result["targetVersion"], "Ver.3.5.0D")
        self.assertEqual(result["linkedMatchCount"], 2)
        self.assertEqual(result["wouldUpdateUploadCount"], 1)
        self.assertEqual(result["wouldUpdatePackageCount"], 1)
        self.assertEqual(result["updatedUploadCount"], 0)
        self.assertEqual(result["updatedPackageCount"], 0)
        self.assertEqual(self._period_rows(), [("", "2026-07-17", "2026-07-18")] * 2)
        self.assertNotIn("packageId", result)

    def test_apply_updates_upload_and_linked_package(self) -> None:
        result = self._repair(apply=True)

        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["updatedUploadCount"], 1)
        self.assertEqual(result["updatedPackageCount"], 1)
        self.assertEqual(
            self._period_rows(),
            [("official", "2026-07-18", "2026-07-20")] * 2,
        )

    def test_apply_is_idempotent(self) -> None:
        first = self._repair(apply=True)
        second = self._repair(apply=True)

        self.assertEqual(first["status"], "completed")
        self.assertEqual(second["status"], "unchanged")
        self.assertEqual(second["wouldUpdateUploadCount"], 0)
        self.assertEqual(second["wouldUpdatePackageCount"], 0)
        self.assertEqual(second["updatedUploadCount"], 0)
        self.assertEqual(second["updatedPackageCount"], 0)

    def test_rejects_missing_or_incomplete_upload(self) -> None:
        with self.assertRaises(module.RepairValidationError) as missing:
            self._repair(upload_id=999)
        self.assertEqual(missing.exception.code, "upload_not_found")

        self._execute("UPDATE server_uploads SET status = 'failed' WHERE id = 109")
        with self.assertRaises(module.RepairValidationError) as incomplete:
            self._repair()
        self.assertEqual(incomplete.exception.code, "upload_not_completed")

    def test_rejects_non_battle_festival_upload(self) -> None:
        self._execute("UPDATE server_uploads SET mode_scope = 'tier_list' WHERE id = 109")

        with self.assertRaises(module.RepairValidationError) as caught:
            self._repair(apply=True)

        self.assertEqual(caught.exception.code, "upload_not_battle_festival")
        self.assertEqual(self._period_rows(), [("", "2026-07-17", "2026-07-18")] * 2)

    def test_rejects_match_outside_official_period(self) -> None:
        self._execute("UPDATE matches SET played_at = '2026-07-21 08:00:00' WHERE id = 12")

        with self.assertRaises(module.RepairValidationError) as caught:
            self._repair(apply=True)

        self.assertEqual(caught.exception.code, "linked_match_outside_period")
        self.assertEqual(self._period_rows(), [("", "2026-07-17", "2026-07-18")] * 2)

    def test_rejects_linked_match_without_exact_battle_festival_mode(self) -> None:
        self._execute("UPDATE matches SET mode = '\u6226\u796d' WHERE id = 12")

        with self.assertRaises(module.RepairValidationError) as caught:
            self._repair(apply=True)

        self.assertEqual(caught.exception.code, "linked_match_mode_mismatch")
        self.assertEqual(self._period_rows(), [("", "2026-07-17", "2026-07-18")] * 2)

    def test_rejects_target_match_version_and_count_mismatches(self) -> None:
        with self.assertRaises(module.RepairValidationError) as target:
            self._repair(target_version="Ver.other")
        self.assertEqual(target.exception.code, "upload_target_version_mismatch")

        self._execute("UPDATE matches SET version = 'Ver.other' WHERE id = 12")
        with self.assertRaises(module.RepairValidationError) as version:
            self._repair()
        self.assertEqual(version.exception.code, "linked_match_version_mismatch")

        self._execute("UPDATE matches SET version = 'Ver.3.5.0D' WHERE id = 12")
        self._execute("UPDATE server_uploads SET imported_match_count = 1 WHERE id = 109")
        with self.assertRaises(module.RepairValidationError) as counts:
            self._repair()
        self.assertEqual(counts.exception.code, "upload_package_count_mismatch")

    def test_rejects_non_official_source_and_invalid_period(self) -> None:
        with self.assertRaises(module.RepairValidationError) as source:
            self._repair(source="manual")
        self.assertEqual(source.exception.code, "source_must_be_official")

        with self.assertRaises(module.RepairValidationError) as period:
            self._repair(date_from="2026-07-20", date_to="2026-07-20")
        self.assertEqual(period.exception.code, "invalid_official_period")

    def test_apply_rolls_back_upload_when_package_update_fails(self) -> None:
        self._execute(
            """
            CREATE TRIGGER reject_package_period
            BEFORE UPDATE OF festival_period_source ON shared_contribution_packages
            BEGIN
              SELECT RAISE(ABORT, 'blocked');
            END
            """
        )

        with self.assertRaises(sqlite3.DatabaseError):
            self._repair(apply=True)

        self.assertEqual(self._period_rows(), [("", "2026-07-17", "2026-07-18")] * 2)

    def _repair(
        self,
        *,
        upload_id: int = 109,
        target_version: str = "Ver.3.5.0D",
        date_from: str = "2026-07-18",
        date_to: str = "2026-07-20",
        source: str = "official",
        apply: bool = False,
    ) -> dict:
        return module.repair_battle_festival_upload_period_sqlite(
            self.db_path,
            upload_id=upload_id,
            target_version=target_version,
            date_from=date_from,
            date_to=date_to,
            source=source,
            apply=apply,
        )

    def _period_rows(self) -> list[tuple[str, str, str]]:
        with closing(sqlite3.connect(self.db_path)) as connection:
            upload = connection.execute(
                """
                SELECT festival_period_source, festival_date_from, festival_date_to
                FROM server_uploads
                WHERE id = 109
                """
            ).fetchone()
            package = connection.execute(
                """
                SELECT festival_period_source, festival_date_from, festival_date_to
                FROM shared_contribution_packages
                WHERE package_id = 'pkg-battle'
                """
            ).fetchone()
        return [tuple(upload), tuple(package)]

    def _execute(self, statement: str) -> None:
        with closing(sqlite3.connect(self.db_path)) as connection:
            with connection:
                connection.execute(statement)

    def _create_database(self) -> None:
        with closing(sqlite3.connect(self.db_path)) as connection:
            with connection:
                connection.executescript(
                    """
                    CREATE TABLE server_uploads (
                      id INTEGER PRIMARY KEY,
                      package_id TEXT,
                      status TEXT NOT NULL,
                      target_version TEXT NOT NULL,
                      mode_scope TEXT NOT NULL,
                      festival_date_from TEXT NOT NULL DEFAULT '',
                      festival_date_to TEXT NOT NULL DEFAULT '',
                      festival_period_source TEXT NOT NULL DEFAULT '',
                      match_count INTEGER NOT NULL,
                      imported_match_count INTEGER NOT NULL
                    );
                    CREATE TABLE shared_contribution_packages (
                      package_id TEXT PRIMARY KEY,
                      status TEXT NOT NULL,
                      target_version TEXT NOT NULL,
                      mode_scope TEXT NOT NULL,
                      festival_date_from TEXT NOT NULL DEFAULT '',
                      festival_date_to TEXT NOT NULL DEFAULT '',
                      festival_period_source TEXT NOT NULL DEFAULT '',
                      match_count INTEGER NOT NULL,
                      imported_match_count INTEGER NOT NULL
                    );
                    CREATE TABLE shared_contribution_matches (
                      package_id TEXT NOT NULL,
                      match_id INTEGER NOT NULL
                    );
                    CREATE TABLE matches (
                      id INTEGER PRIMARY KEY,
                      mode TEXT NOT NULL,
                      version TEXT NOT NULL,
                      played_at TEXT NOT NULL
                    );
                    """
                )
                connection.execute(
                    """
                    INSERT INTO server_uploads (
                      id, package_id, status, target_version, mode_scope,
                      festival_date_from, festival_date_to, festival_period_source,
                      match_count, imported_match_count
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        109,
                        "pkg-battle",
                        "completed",
                        "Ver.3.5.0D",
                        "battle_festival",
                        "2026-07-17",
                        "2026-07-18",
                        "",
                        2,
                        2,
                    ),
                )
                connection.execute(
                    """
                    INSERT INTO shared_contribution_packages (
                      package_id, status, target_version, mode_scope,
                      festival_date_from, festival_date_to, festival_period_source,
                      match_count, imported_match_count
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        "pkg-battle",
                        "completed",
                        "Ver.3.5.0D",
                        "battle_festival",
                        "2026-07-17",
                        "2026-07-18",
                        "",
                        2,
                        2,
                    ),
                )
                connection.executemany(
                    "INSERT INTO matches (id, mode, version, played_at) VALUES (?, ?, ?, ?)",
                    [
                        (11, "\u6226\u796d\u308a", "Ver.3.5.0D", "2026-07-18 08:00:00"),
                        (12, "\u6226\u796d\u308a", "Ver.3.5.0D", "2026-07-19 08:00:00"),
                    ],
                )
                connection.executemany(
                    "INSERT INTO shared_contribution_matches (package_id, match_id) VALUES (?, ?)",
                    [("pkg-battle", 11), ("pkg-battle", 12)],
                )


if __name__ == "__main__":
    unittest.main()
