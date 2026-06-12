from __future__ import annotations

import argparse
import json
import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Any


CONFIG_COLUMN_SPECS = {
    "include_battle_festival": "INTEGER NOT NULL DEFAULT 0",
}
SCOPE_COLUMN_SPECS = {
    "mode_scope": "VARCHAR(32) NOT NULL DEFAULT 'tier_list'",
    "festival_date_from": "VARCHAR(10) NOT NULL DEFAULT ''",
    "festival_date_to": "VARCHAR(10) NOT NULL DEFAULT ''",
}
TABLE_COLUMN_SPECS = {
    "server_share_config": CONFIG_COLUMN_SPECS,
    "server_leaderboard_runs": CONFIG_COLUMN_SPECS,
    "shared_contribution_packages": SCOPE_COLUMN_SPECS,
    "server_uploads": SCOPE_COLUMN_SPECS,
}


def _sqlite_columns(connection: sqlite3.Connection, table: str) -> set[str]:
    return {str(row[1]) for row in connection.execute(f"PRAGMA table_info({table})")}


def _sqlite_table_exists(connection: sqlite3.Connection, table: str) -> bool:
    row = connection.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table,),
    ).fetchone()
    return row is not None


def enable_battle_festival_scope_sqlite(db_path: Path, target_version: str = "") -> dict[str, Any]:
    _ = target_version
    added_columns: list[str] = []
    with closing(sqlite3.connect(db_path)) as connection:
        with connection:
            for table, column_specs in TABLE_COLUMN_SPECS.items():
                if not _sqlite_table_exists(connection, table):
                    raise RuntimeError(f"{table} table is missing")
                columns = _sqlite_columns(connection, table)
                for column, definition in column_specs.items():
                    if column in columns:
                        continue
                    connection.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
                    added_columns.append(f"{table}.{column}")

    return {
        "status": "completed",
        "addedColumns": added_columns,
        "updatedConfigRows": 0,
    }


def enable_battle_festival_scope_server(target_version: str = "") -> dict[str, Any]:
    _ = target_version
    from sqlalchemy import inspect, text
    from eiketsu_env.config import load_settings
    from eiketsu_env.db.session import make_engine

    engine = make_engine(load_settings())
    added_columns: list[str] = []
    with engine.begin() as connection:
        inspector = inspect(connection)
        table_names = set(inspector.get_table_names())
        for table, column_specs in TABLE_COLUMN_SPECS.items():
            if table not in table_names:
                raise RuntimeError(f"{table} table is missing")
            columns = {column["name"] for column in inspector.get_columns(table)}
            for column, definition in column_specs.items():
                if column in columns:
                    continue
                connection.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {definition}"))
                added_columns.append(f"{table}.{column}")

    return {
        "status": "completed",
        "addedColumns": added_columns,
        "updatedConfigRows": 0,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Ensure battle festival scope columns on the upload server.")
    parser.add_argument("--sqlite-file", type=Path, default=None)
    parser.add_argument("--target-version", default="")
    args = parser.parse_args()

    if args.sqlite_file is not None:
        result = enable_battle_festival_scope_sqlite(args.sqlite_file, target_version=args.target_version)
    else:
        result = enable_battle_festival_scope_server(target_version=args.target_version)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
