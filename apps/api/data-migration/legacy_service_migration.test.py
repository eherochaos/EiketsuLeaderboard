from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from legacy_service_migration import (
    REQUIRED_RUNTIME_TABLES,
    database_inventory,
    export_bundle,
)


class LegacyServiceMigrationTests(unittest.TestCase):
    def test_required_runtime_table_count_matches_spec(self) -> None:
        self.assertEqual(len(REQUIRED_RUNTIME_TABLES), 21)

    def test_export_bundle_redacts_sensitive_service_values(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            db_path = root / "legacy.db"
            catalog_path = root / "card_catalog.json"
            overlay_path = root / "card_catalog_overlay.json"
            output_dir = root / "out"

            create_legacy_db(db_path)
            catalog_path.write_text(
                json.dumps(
                    {
                        "cards": [
                            {
                                "hash_id": "card-a",
                                "card_code": "A001",
                                "name": "Card A",
                                "faction": "blue",
                                "cost": "2.0",
                                "unitType": "spear",
                                "image_keys": {"card_small": "card-a"},
                                "secret_note": "do-not-export",
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )
            overlay_path.write_text(
                json.dumps(
                    {
                        "generated_for": "Ver.test",
                        "cards": [
                            {
                                "hash_id": "card-b",
                                "card_code": "B001",
                                "name": "Card B",
                                "faction": "red",
                                "cost": "1.0",
                                "unitType": "bow",
                                "image_keys": {"card_small": "card-b"},
                                "extra": "drop-me",
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )

            manifest = export_bundle(db_path, output_dir, catalog_path, overlay_path)

            self.assertEqual(manifest["required_table_count"], 21)
            self.assertEqual(manifest["missing_required_tables"], [])
            self.assertTrue(manifest["redactions"]["server_invites.code"])

            invite_rows = read_jsonl(output_dir / "tables" / "server_invites.jsonl")
            self.assertEqual(invite_rows[0]["code"], "")
            self.assertEqual(invite_rows[0]["code_prefix"], "SAMP")
            self.assertNotIn("SAMPLE-CODE", json.dumps(invite_rows))

            token_rows = read_jsonl(output_dir / "tables" / "server_api_tokens.jsonl")
            self.assertEqual(token_rows[0]["token_hash"], "hash-only")
            self.assertNotIn("clear-value", json.dumps(token_rows))

            snapshot_rows = read_jsonl(output_dir / "tables" / "raw_snapshots.jsonl")
            self.assertNotIn("local_path", snapshot_rows[0])
            self.assertTrue(snapshot_rows[0]["legacy_local_path_redacted"])

            package_rows = read_jsonl(output_dir / "tables" / "shared_contribution_packages.jsonl")
            self.assertNotIn("file_path", package_rows[0])
            self.assertEqual(package_rows[0]["file_name"], "package.jsonl")

            card_catalog = json.loads((output_dir / "cards" / "card_catalog.json").read_text(encoding="utf-8"))
            self.assertEqual(card_catalog["cards"][0]["hash_id"], "card-a")
            self.assertNotIn("secret_note", card_catalog["cards"][0])

            card_overlay = json.loads((output_dir / "cards" / "card_catalog_overlay.json").read_text(encoding="utf-8"))
            self.assertEqual(card_overlay["generated_for"], "Ver.test")
            self.assertNotIn("extra", card_overlay["cards"][0])

    def test_inventory_reports_missing_required_tables(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "empty.db"
            with closing(sqlite3.connect(db_path)) as connection:
                connection.execute("CREATE TABLE matches (id INTEGER)")
                connection.commit()

            inventory = database_inventory(db_path)

            self.assertIn("match_aliases", inventory["missing_required_tables"])
            self.assertNotIn("matches", inventory["missing_required_tables"])


def create_legacy_db(db_path: Path) -> None:
    with closing(sqlite3.connect(db_path)) as connection:
        for table_name in REQUIRED_RUNTIME_TABLES:
            if table_name == "server_invites":
                connection.execute(
                    """
                    CREATE TABLE server_invites (
                        code TEXT,
                        label TEXT,
                        status TEXT,
                        used_by_user_id INTEGER,
                        used_at TEXT,
                        created_at TEXT,
                        updated_at TEXT
                    )
                    """
                )
                connection.execute(
                    "INSERT INTO server_invites VALUES (?, ?, ?, ?, ?, ?, ?)",
                    ("SAMPLE-CODE", "friend", "active", None, None, "2026-05-24", "2026-05-24"),
                )
            elif table_name == "server_api_tokens":
                connection.execute(
                    """
                    CREATE TABLE server_api_tokens (
                        id INTEGER,
                        user_id INTEGER,
                        token_hash TEXT,
                        token_prefix TEXT,
                        clear_value TEXT,
                        last_used_at TEXT,
                        revoked_at TEXT,
                        created_at TEXT,
                        updated_at TEXT
                    )
                    """
                )
                connection.execute(
                    "INSERT INTO server_api_tokens VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (1, 1, "hash-only", "pref", "clear-value", None, None, "2026-05-24", "2026-05-24"),
                )
            elif table_name == "raw_snapshots":
                connection.execute(
                    """
                    CREATE TABLE raw_snapshots (
                        id INTEGER,
                        source_kind TEXT,
                        source_url TEXT,
                        local_path TEXT,
                        content_hash TEXT
                    )
                    """
                )
                connection.execute(
                    "INSERT INTO raw_snapshots VALUES (?, ?, ?, ?, ?)",
                    (1, "detail", "https://example.test/detail", "C:\\Users\\name\\raw.html", "content-hash"),
                )
            elif table_name == "shared_contribution_packages":
                connection.execute(
                    """
                    CREATE TABLE shared_contribution_packages (
                        package_id TEXT,
                        contributor_id TEXT,
                        target_version TEXT,
                        file_path TEXT,
                        status TEXT
                    )
                    """
                )
                connection.execute(
                    "INSERT INTO shared_contribution_packages VALUES (?, ?, ?, ?, ?)",
                    ("pkg", "alice", "Ver.test", "C:\\Users\\name\\package.jsonl", "completed"),
                )
            else:
                connection.execute(f'CREATE TABLE "{table_name}" (id INTEGER, value TEXT)')
                connection.execute(f'INSERT INTO "{table_name}" VALUES (?, ?)', (1, table_name))
        connection.commit()


def read_jsonl(path: Path) -> list[dict]:
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


if __name__ == "__main__":
    unittest.main()
