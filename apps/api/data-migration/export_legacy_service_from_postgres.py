from __future__ import annotations

import argparse
import json
import shutil
from datetime import date, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import text

from eiketsu_env.config import load_settings
from eiketsu_env.db.session import make_session_factory


SNAPSHOT_RUNTIME_TABLES = [
    "server_share_config",
    "server_leaderboard_runs",
    "server_leaderboard_rows",
    "matches",
    "match_decks",
    "match_sides",
    "match_deck_units",
]


def json_default(value: Any) -> str:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return str(value)


def export_table(session, table_name: str, output_path: Path) -> int:
    count = 0
    with output_path.open("w", encoding="utf-8", newline="\n") as handle:
        rows = session.execute(text(f'SELECT * FROM "{table_name}" ORDER BY id')).mappings()
        for row in rows:
            handle.write(json.dumps(dict(row), ensure_ascii=False, default=json_default, separators=(",", ":")))
            handle.write("\n")
            count += 1
    return count


def copy_card_file(
    source_root: Path,
    output_root: Path,
    file_name: str,
    fallback: Any | None = None,
    required: bool = False,
) -> bool:
    output_path = output_root / "cards" / file_name
    output_path.parent.mkdir(parents=True, exist_ok=True)
    source_path = source_root / file_name
    if source_path.is_file():
        shutil.copyfile(source_path, output_path)
        return True
    if fallback is not None:
        output_path.write_text(json.dumps(fallback, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return False
    if required:
        raise FileNotFoundError(f"required card asset missing: {file_name}")
    return False


def export_legacy_service_from_postgres(output_dir: Path) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    table_dir = output_dir / "tables"
    table_dir.mkdir(parents=True, exist_ok=True)

    settings = load_settings()
    exported_tables = {}
    with make_session_factory(settings)() as session:
        for table_name in SNAPSHOT_RUNTIME_TABLES:
            exported_tables[table_name] = export_table(session, table_name, table_dir / f"{table_name}.jsonl")

    asset_root = settings.root_dir / "assets"
    card_outputs = {
        "card_catalog": copy_card_file(asset_root, output_dir, "card_catalog.json"),
        "card_catalog_overlay": copy_card_file(asset_root, output_dir, "card_catalog_overlay.json", {"cards": []}),
        "card_strategy_types": copy_card_file(asset_root, output_dir, "card_strategy_types.json", required=True),
    }
    manifest = {
        "tables": exported_tables,
        "cards": card_outputs,
    }
    (output_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return manifest


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Export server Postgres data for apps/api leaderboard snapshots.")
    parser.add_argument("--output", required=True, type=Path)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    manifest = export_legacy_service_from_postgres(args.output)
    print(json.dumps(manifest, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
