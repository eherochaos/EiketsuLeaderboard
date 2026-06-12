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
BATTLE_FESTIVAL_MODE = "\u6226\u796d\u308a"


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
    backfilled_scope_rows = 0
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
            backfilled_scope_rows = _backfill_battle_festival_scope_sqlite(connection)

    return {
        "status": "completed",
        "addedColumns": added_columns,
        "backfilledScopeRows": backfilled_scope_rows,
        "updatedConfigRows": 0,
    }


def enable_battle_festival_scope_server(target_version: str = "") -> dict[str, Any]:
    _ = target_version
    from sqlalchemy import inspect, text
    from eiketsu_env.config import load_settings
    from eiketsu_env.db.session import make_engine

    engine = make_engine(load_settings())
    added_columns: list[str] = []
    backfilled_scope_rows = 0
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
        backfilled_scope_rows = _backfill_battle_festival_scope_server(connection)

    return {
        "status": "completed",
        "addedColumns": added_columns,
        "backfilledScopeRows": backfilled_scope_rows,
        "updatedConfigRows": 0,
    }


def _backfill_battle_festival_scope_sqlite(connection: sqlite3.Connection) -> int:
    required_tables = {"shared_contribution_packages", "shared_contribution_matches", "matches", "server_uploads"}
    if not all(_sqlite_table_exists(connection, table) for table in required_tables):
        return 0
    package_columns = _sqlite_columns(connection, "shared_contribution_packages")
    match_columns = _sqlite_columns(connection, "matches")
    if not {"package_id", "date_from", "date_to"}.issubset(package_columns) or not {"id", "mode"}.issubset(match_columns):
        return 0

    rows = connection.execute(
        """
        SELECT p.package_id, p.date_from, p.date_to
        FROM shared_contribution_packages p
        JOIN shared_contribution_matches link ON link.package_id = p.package_id
        JOIN matches m ON m.id = link.match_id
        GROUP BY p.package_id, p.date_from, p.date_to
        HAVING COUNT(*) > 0
           AND SUM(CASE WHEN COALESCE(m.mode, '') = ? THEN 1 ELSE 0 END) = COUNT(*)
        """,
        (BATTLE_FESTIVAL_MODE,),
    ).fetchall()
    return _apply_battle_festival_scope_sqlite(connection, rows)


def _apply_battle_festival_scope_sqlite(connection: sqlite3.Connection, rows: list[tuple[Any, Any, Any]]) -> int:
    changed = 0
    for package_id, date_from, date_to in rows:
        package_result = connection.execute(
            """
            UPDATE shared_contribution_packages
            SET mode_scope = 'battle_festival',
                festival_date_from = CASE WHEN COALESCE(festival_date_from, '') = '' THEN ? ELSE festival_date_from END,
                festival_date_to = CASE WHEN COALESCE(festival_date_to, '') = '' THEN ? ELSE festival_date_to END
            WHERE package_id = ?
              AND (
                COALESCE(mode_scope, '') <> 'battle_festival'
                OR COALESCE(festival_date_from, '') = ''
                OR COALESCE(festival_date_to, '') = ''
              )
            """,
            (str(date_from or ""), str(date_to or ""), package_id),
        )
        upload_result = connection.execute(
            """
            UPDATE server_uploads
            SET mode_scope = 'battle_festival',
                festival_date_from = CASE WHEN COALESCE(festival_date_from, '') = '' THEN ? ELSE festival_date_from END,
                festival_date_to = CASE WHEN COALESCE(festival_date_to, '') = '' THEN ? ELSE festival_date_to END
            WHERE package_id = ?
              AND (
                COALESCE(mode_scope, '') <> 'battle_festival'
                OR COALESCE(festival_date_from, '') = ''
                OR COALESCE(festival_date_to, '') = ''
              )
            """,
            (str(date_from or ""), str(date_to or ""), package_id),
        )
        changed += int(package_result.rowcount or 0) + int(upload_result.rowcount or 0)
    return changed


def _backfill_battle_festival_scope_server(connection: Any) -> int:
    from sqlalchemy import text

    rows = connection.execute(
        text(
            """
            SELECT p.package_id, p.date_from, p.date_to
            FROM shared_contribution_packages p
            JOIN shared_contribution_matches link ON link.package_id = p.package_id
            JOIN matches m ON m.id = link.match_id
            GROUP BY p.package_id, p.date_from, p.date_to
            HAVING COUNT(*) > 0
               AND SUM(CASE WHEN COALESCE(m.mode, '') = :mode THEN 1 ELSE 0 END) = COUNT(*)
            """
        ),
        {"mode": BATTLE_FESTIVAL_MODE},
    ).mappings().all()
    changed = 0
    for row in rows:
        params = {
            "package_id": row["package_id"],
            "date_from": str(row["date_from"] or ""),
            "date_to": str(row["date_to"] or ""),
        }
        package_result = connection.execute(
            text(
                """
                UPDATE shared_contribution_packages
                SET mode_scope = 'battle_festival',
                    festival_date_from = CASE WHEN COALESCE(festival_date_from, '') = '' THEN :date_from ELSE festival_date_from END,
                    festival_date_to = CASE WHEN COALESCE(festival_date_to, '') = '' THEN :date_to ELSE festival_date_to END
                WHERE package_id = :package_id
                  AND (
                    COALESCE(mode_scope, '') <> 'battle_festival'
                    OR COALESCE(festival_date_from, '') = ''
                    OR COALESCE(festival_date_to, '') = ''
                  )
                """
            ),
            params,
        )
        upload_result = connection.execute(
            text(
                """
                UPDATE server_uploads
                SET mode_scope = 'battle_festival',
                    festival_date_from = CASE WHEN COALESCE(festival_date_from, '') = '' THEN :date_from ELSE festival_date_from END,
                    festival_date_to = CASE WHEN COALESCE(festival_date_to, '') = '' THEN :date_to ELSE festival_date_to END
                WHERE package_id = :package_id
                  AND (
                    COALESCE(mode_scope, '') <> 'battle_festival'
                    OR COALESCE(festival_date_from, '') = ''
                    OR COALESCE(festival_date_to, '') = ''
                  )
                """
            ),
            params,
        )
        changed += int(package_result.rowcount or 0) + int(upload_result.rowcount or 0)
    return changed


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
