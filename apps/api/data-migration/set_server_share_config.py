from __future__ import annotations

import argparse
import json
import sqlite3
import re
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_TARGET_VERSION = "Ver.3.5.0D"
DEFAULT_DATE_FROM = "2026-07-01"
DEFAULT_REPORT_FORMATS = ["md", "csv"]
DEFAULT_REPORTS = ["overview", "deck", "card", "deck-version", "card-version"]
TARGET_VERSION_RE = re.compile(r"^Ver\.(\d+)\.(\d+)\.(\d+)([A-Z])$")


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _date_value(value: str, fallback: str) -> str:
    text = str(value or "").strip()
    return text or fallback


def _sqlite_table_exists(connection: sqlite3.Connection, table: str) -> bool:
    row = connection.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table,),
    ).fetchone()
    return row is not None


def _sqlite_columns(connection: sqlite3.Connection, table: str) -> set[str]:
    return {str(row[1]) for row in connection.execute(f"PRAGMA table_info({table})")}


def _config_values(target_version: str, date_from: str, date_to: str) -> dict[str, Any]:
    now = _now()
    start_date = _date_value(date_from, DEFAULT_DATE_FROM)
    return {
        "schema_version": "share_v1",
        "target_version": str(target_version or DEFAULT_TARGET_VERSION).strip(),
        "date_from": start_date,
        "date_to": _date_value(date_to, start_date),
        "include_solo": 0,
        "include_battle_festival": 0,
        "high_ranker_rank": 100,
        "report_formats_json": _json(DEFAULT_REPORT_FORMATS),
        "reports_json": _json(DEFAULT_REPORTS),
        "created_at": now,
        "updated_at": now,
    }


def _version_sort_key(target_version: str) -> tuple[int, int, int, int] | None:
    match = TARGET_VERSION_RE.match(str(target_version or "").strip())
    if not match:
        return None
    major, minor, patch, suffix = match.groups()
    return (int(major), int(minor), int(patch), ord(suffix))


def _is_newer_target_version(left: str, right: str) -> bool:
    left_key = _version_sort_key(left)
    right_key = _version_sort_key(right)
    if left_key is None or right_key is None:
        return False
    return left_key > right_key


def _latest_sqlite_config_id(connection: sqlite3.Connection, columns: set[str]) -> int | None:
    if "updated_at" in columns:
        order_by = "COALESCE(updated_at, '') DESC, id DESC"
    else:
        order_by = "id DESC"
    row = connection.execute(f"SELECT id FROM server_share_config ORDER BY {order_by} LIMIT 1").fetchone()
    return int(row[0]) if row else None


def _latest_server_config_order_by(columns: set[str]) -> str:
    if "updated_at" in columns:
        return "updated_at DESC NULLS LAST, id DESC"
    return "id DESC"


def _read_sqlite_config(connection: sqlite3.Connection, config_id: int, columns: set[str]) -> dict[str, Any]:
    selected = sorted(columns)
    row = connection.execute(
        f"SELECT {', '.join(selected)} FROM server_share_config WHERE id = ?",
        (config_id,),
    ).fetchone()
    return dict(zip(selected, row)) if row else {}


def set_server_share_config_sqlite(
    db_path: Path,
    target_version: str = DEFAULT_TARGET_VERSION,
    date_from: str = DEFAULT_DATE_FROM,
    date_to: str = "",
    force: bool = False,
) -> dict[str, Any]:
    with closing(sqlite3.connect(db_path)) as connection:
        with connection:
            if not _sqlite_table_exists(connection, "server_share_config"):
                raise RuntimeError("server_share_config table is missing")
            columns = _sqlite_columns(connection, "server_share_config")
            values = _config_values(target_version, date_from, date_to)
            writable = {key: value for key, value in values.items() if key in columns}
            config_id = _latest_sqlite_config_id(connection, columns)
            previous = _read_sqlite_config(connection, config_id, columns) if config_id is not None else {}
            if (
                not force
                and previous.get("target_version")
                and _is_newer_target_version(str(previous.get("target_version") or ""), str(target_version or ""))
            ):
                return {
                    "status": "skipped",
                    "reason": "current target version is newer",
                    "configId": config_id,
                    "updatedRows": 0,
                    "previous": {
                        "targetVersion": previous.get("target_version", ""),
                        "dateFrom": previous.get("date_from", ""),
                        "dateTo": previous.get("date_to", ""),
                    },
                    "current": {
                        "targetVersion": previous.get("target_version", ""),
                        "dateFrom": previous.get("date_from", ""),
                        "dateTo": previous.get("date_to", ""),
                    },
                }

            if config_id is None:
                insert_columns = list(writable)
                placeholders = ", ".join("?" for _ in insert_columns)
                connection.execute(
                    f"INSERT INTO server_share_config ({', '.join(insert_columns)}) VALUES ({placeholders})",
                    [writable[column] for column in insert_columns],
                )
                config_id = int(connection.execute("SELECT last_insert_rowid()").fetchone()[0])
                changed_rows = 1
            else:
                assignments = ", ".join(f"{column} = ?" for column in writable)
                connection.execute(
                    f"UPDATE server_share_config SET {assignments} WHERE id = ?",
                    [writable[column] for column in writable] + [config_id],
                )
                changed_rows = 1

            current = _read_sqlite_config(connection, config_id, columns)

    return {
        "status": "completed",
        "configId": config_id,
        "updatedRows": changed_rows,
        "previous": {
            "targetVersion": previous.get("target_version", ""),
            "dateFrom": previous.get("date_from", ""),
            "dateTo": previous.get("date_to", ""),
        },
        "current": {
            "targetVersion": current.get("target_version", ""),
            "dateFrom": current.get("date_from", ""),
            "dateTo": current.get("date_to", ""),
        },
    }


def set_server_share_config_server(
    target_version: str = DEFAULT_TARGET_VERSION,
    date_from: str = DEFAULT_DATE_FROM,
    date_to: str = "",
    force: bool = False,
) -> dict[str, Any]:
    from sqlalchemy import inspect, text
    from eiketsu_env.config import load_settings
    from eiketsu_env.db.session import make_engine

    engine = make_engine(load_settings())
    values = _config_values(target_version, date_from, date_to)
    with engine.begin() as connection:
        inspector = inspect(connection)
        if "server_share_config" not in set(inspector.get_table_names()):
            raise RuntimeError("server_share_config table is missing")
        columns = {column["name"] for column in inspector.get_columns("server_share_config")}
        writable = {key: value for key, value in values.items() if key in columns}
        order_by = _latest_server_config_order_by(columns)
        row = connection.execute(text(f"SELECT id FROM server_share_config ORDER BY {order_by} LIMIT 1")).mappings().first()
        previous = {}
        if row is not None:
            config_id = row["id"]
            selected = sorted(columns)
            previous = dict(
                connection.execute(
                    text(f"SELECT {', '.join(selected)} FROM server_share_config WHERE id = :config_id"),
                    {"config_id": config_id},
                ).mappings().first()
                or {}
            )
            if (
                not force
                and previous.get("target_version")
                and _is_newer_target_version(str(previous.get("target_version") or ""), str(target_version or ""))
            ):
                return {
                    "status": "skipped",
                    "reason": "current target version is newer",
                    "configId": int(config_id),
                    "updatedRows": 0,
                    "current": {
                        "targetVersion": previous.get("target_version", ""),
                        "dateFrom": previous.get("date_from", ""),
                        "dateTo": previous.get("date_to", ""),
                    },
                }
        if row is None:
            insert_columns = list(writable)
            placeholders = ", ".join(f":{column}" for column in insert_columns)
            connection.execute(
                text(f"INSERT INTO server_share_config ({', '.join(insert_columns)}) VALUES ({placeholders})"),
                {column: writable[column] for column in insert_columns},
            )
            config_id = connection.execute(text("SELECT max(id) AS id FROM server_share_config")).mappings().first()["id"]
        else:
            assignments = ", ".join(f"{column} = :{column}" for column in writable)
            connection.execute(
                text(f"UPDATE server_share_config SET {assignments} WHERE id = :config_id"),
                {**writable, "config_id": config_id},
            )

    return {
        "status": "completed",
        "configId": int(config_id),
        "updatedRows": 1,
        "current": {
            "targetVersion": writable.get("target_version", ""),
            "dateFrom": writable.get("date_from", ""),
            "dateTo": writable.get("date_to", ""),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Set the active public server share config.")
    parser.add_argument("--sqlite-file", type=Path, default=None)
    parser.add_argument("--target-version", default=DEFAULT_TARGET_VERSION)
    parser.add_argument("--date-from", default=DEFAULT_DATE_FROM)
    parser.add_argument("--date-to", default="")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    if args.sqlite_file is not None:
        result = set_server_share_config_sqlite(
            args.sqlite_file,
            target_version=args.target_version,
            date_from=args.date_from,
            date_to=args.date_to,
            force=args.force,
        )
    else:
        result = set_server_share_config_server(
            target_version=args.target_version,
            date_from=args.date_from,
            date_to=args.date_to,
            force=args.force,
        )
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
