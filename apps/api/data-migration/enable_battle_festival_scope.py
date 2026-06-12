from __future__ import annotations

import argparse
import json
import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Any


TARGET_COLUMN = "include_battle_festival"
TARGET_TABLES = ("server_share_config", "server_leaderboard_runs")


def _sqlite_columns(connection: sqlite3.Connection, table: str) -> set[str]:
    return {str(row[1]) for row in connection.execute(f"PRAGMA table_info({table})")}


def _sqlite_table_exists(connection: sqlite3.Connection, table: str) -> bool:
    row = connection.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table,),
    ).fetchone()
    return row is not None


def _update_sql(target_version: str) -> tuple[str, dict[str, Any]]:
    if target_version:
        return (
            f"UPDATE server_share_config SET {TARGET_COLUMN} = 1 WHERE target_version = :target_version",
            {"target_version": target_version},
        )
    return (
        f"""
        UPDATE server_share_config
        SET {TARGET_COLUMN} = 1
        WHERE id = (
          SELECT id
          FROM server_share_config
          ORDER BY updated_at DESC, id DESC
          LIMIT 1
        )
        """,
        {},
    )


def _sqlite_update_sql(target_version: str) -> tuple[str, tuple[str, ...]]:
    if target_version:
        return (
            f"UPDATE server_share_config SET {TARGET_COLUMN} = 1 WHERE target_version = ?",
            (target_version,),
        )
    return (
        f"""
        UPDATE server_share_config
        SET {TARGET_COLUMN} = 1
        WHERE id = (
          SELECT id
          FROM server_share_config
          ORDER BY updated_at DESC, id DESC
          LIMIT 1
        )
        """,
        (),
    )


def enable_battle_festival_scope_sqlite(db_path: Path, target_version: str = "") -> dict[str, Any]:
    added_columns: list[str] = []
    with closing(sqlite3.connect(db_path)) as connection:
        with connection:
            for table in TARGET_TABLES:
                if not _sqlite_table_exists(connection, table):
                    raise RuntimeError(f"{table} table is missing")
                if TARGET_COLUMN not in _sqlite_columns(connection, table):
                    connection.execute(f"ALTER TABLE {table} ADD COLUMN {TARGET_COLUMN} INTEGER NOT NULL DEFAULT 0")
                    added_columns.append(f"{table}.{TARGET_COLUMN}")

            sql, params = _sqlite_update_sql(target_version)
            cursor = connection.execute(sql, params)
            updated_rows = cursor.rowcount

    if updated_rows <= 0:
        raise RuntimeError("server_share_config battle festival config was not updated")

    return {
        "status": "completed",
        "addedColumns": added_columns,
        "updatedConfigRows": updated_rows,
    }


def enable_battle_festival_scope_server(target_version: str = "") -> dict[str, Any]:
    from sqlalchemy import inspect, text
    from eiketsu_env.config import load_settings
    from eiketsu_env.db.session import make_engine

    engine = make_engine(load_settings())
    added_columns: list[str] = []
    with engine.begin() as connection:
        inspector = inspect(connection)
        table_names = set(inspector.get_table_names())
        for table in TARGET_TABLES:
            if table not in table_names:
                raise RuntimeError(f"{table} table is missing")
            columns = {column["name"] for column in inspector.get_columns(table)}
            if TARGET_COLUMN not in columns:
                connection.execute(text(f"ALTER TABLE {table} ADD COLUMN {TARGET_COLUMN} INTEGER NOT NULL DEFAULT 0"))
                added_columns.append(f"{table}.{TARGET_COLUMN}")

        sql, params = _update_sql(target_version)
        result = connection.execute(text(sql), params)
        updated_rows = result.rowcount or 0

    if updated_rows <= 0:
        raise RuntimeError("server_share_config battle festival config was not updated")

    return {
        "status": "completed",
        "addedColumns": added_columns,
        "updatedConfigRows": updated_rows,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Enable battle festival collection scope on the upload server.")
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
