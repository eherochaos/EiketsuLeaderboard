from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path


def load_export_module():
    sys.modules.setdefault("sqlalchemy", types.SimpleNamespace(text=lambda value: value))
    sys.modules.setdefault("eiketsu_env", types.ModuleType("eiketsu_env"))
    sys.modules.setdefault("eiketsu_env.config", types.SimpleNamespace(load_settings=lambda: None))
    sys.modules.setdefault("eiketsu_env.db", types.ModuleType("eiketsu_env.db"))
    sys.modules.setdefault("eiketsu_env.db.session", types.SimpleNamespace(make_session_factory=lambda settings: None))

    module_path = Path(__file__).with_name("export_legacy_service_from_postgres.py")
    spec = importlib.util.spec_from_file_location("export_legacy_service_from_postgres_under_test", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load export module")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ExportLegacyServiceFromPostgresTests(unittest.TestCase):
    def test_runtime_tables_include_upload_users(self) -> None:
        module = load_export_module()

        self.assertIn("server_users", module.SNAPSHOT_RUNTIME_TABLES)
        self.assertIn("shared_contribution_packages", module.SNAPSHOT_RUNTIME_TABLES)
        self.assertLess(
            module.SNAPSHOT_RUNTIME_TABLES.index("server_users"),
            module.SNAPSHOT_RUNTIME_TABLES.index("server_uploads"),
        )
        self.assertLess(
            module.SNAPSHOT_RUNTIME_TABLES.index("server_uploads"),
            module.SNAPSHOT_RUNTIME_TABLES.index("shared_contribution_packages"),
        )

    def test_shared_contribution_packages_export_orders_by_package_id(self) -> None:
        module = load_export_module()

        class FakeRows:
            def mappings(self):
                return iter([{"package_id": "pkg-1", "mode_scope": "battle_festival"}])

        class FakeSession:
            statement = ""

            def execute(self, statement):
                self.statement = statement
                return FakeRows()

        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "shared_contribution_packages.jsonl"
            session = FakeSession()

            count = module.export_table(session, "shared_contribution_packages", output_path)

            self.assertEqual(count, 1)
            self.assertIn('ORDER BY "package_id"', session.statement)
            self.assertEqual(
                output_path.read_text(encoding="utf-8").strip(),
                '{"package_id":"pkg-1","mode_scope":"battle_festival"}',
            )

    def test_required_card_asset_missing_raises(self) -> None:
        module = load_export_module()
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)

            with self.assertRaisesRegex(FileNotFoundError, "card_strategy_types.json"):
                module.copy_card_file(
                    root / "assets",
                    root / "out",
                    "card_strategy_types.json",
                    required=True,
                )

            self.assertFalse((root / "out" / "cards" / "card_strategy_types.json").exists())

    def test_optional_card_asset_can_use_fallback(self) -> None:
        module = load_export_module()
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)

            copied = module.copy_card_file(
                root / "assets",
                root / "out",
                "card_catalog_overlay.json",
                fallback={"cards": []},
            )

            output = json.loads((root / "out" / "cards" / "card_catalog_overlay.json").read_text(encoding="utf-8"))
            self.assertFalse(copied)
            self.assertEqual(output, {"cards": []})


if __name__ == "__main__":
    unittest.main()
