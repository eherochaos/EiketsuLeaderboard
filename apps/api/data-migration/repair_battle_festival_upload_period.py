from __future__ import annotations

import argparse
import json
import sqlite3
from contextlib import closing
from datetime import date
from pathlib import Path
from typing import Any


BATTLE_FESTIVAL_MODE = "\u6226\u796d\u308a"
OFFICIAL_SOURCE = "official"

UPLOAD_QUERY = """
SELECT id, package_id, status, target_version, mode_scope,
       festival_date_from, festival_date_to, festival_period_source,
       match_count, imported_match_count
FROM server_uploads
WHERE id = :upload_id
"""

PACKAGE_QUERY = """
SELECT package_id, status, target_version, mode_scope,
       festival_date_from, festival_date_to, festival_period_source,
       match_count, imported_match_count
FROM shared_contribution_packages
WHERE package_id = :package_id
"""

MATCH_QUERY = """
SELECT link.match_id AS linked_match_id,
       m.id AS match_id,
       m.mode,
       m.version,
       m.played_at
FROM shared_contribution_matches link
LEFT JOIN matches m ON m.id = link.match_id
WHERE link.package_id = :package_id
ORDER BY link.match_id
"""

UPDATE_UPLOAD_QUERY = """
UPDATE server_uploads
SET festival_date_from = :date_from,
    festival_date_to = :date_to,
    festival_period_source = :source
WHERE id = :upload_id
  AND (
    COALESCE(festival_date_from, '') <> :date_from
    OR COALESCE(festival_date_to, '') <> :date_to
    OR COALESCE(festival_period_source, '') <> :source
  )
"""

UPDATE_PACKAGE_QUERY = """
UPDATE shared_contribution_packages
SET festival_date_from = :date_from,
    festival_date_to = :date_to,
    festival_period_source = :source
WHERE package_id = :package_id
  AND (
    COALESCE(festival_date_from, '') <> :date_from
    OR COALESCE(festival_date_to, '') <> :date_to
    OR COALESCE(festival_period_source, '') <> :source
  )
"""


class RepairValidationError(RuntimeError):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


class _SqliteExecutor:
    def __init__(self, connection: sqlite3.Connection) -> None:
        self.connection = connection

    def fetch_one(self, query: str, params: dict[str, Any], lock: bool = False) -> dict[str, Any] | None:
        _ = lock
        row = self.connection.execute(query, params).fetchone()
        return dict(row) if row is not None else None

    def fetch_all(self, query: str, params: dict[str, Any]) -> list[dict[str, Any]]:
        return [dict(row) for row in self.connection.execute(query, params).fetchall()]

    def execute(self, query: str, params: dict[str, Any]) -> int:
        result = self.connection.execute(query, params)
        return int(result.rowcount or 0)


class _SqlAlchemyExecutor:
    def __init__(self, connection: Any) -> None:
        from sqlalchemy import text

        self.connection = connection
        self.text = text

    def fetch_one(self, query: str, params: dict[str, Any], lock: bool = False) -> dict[str, Any] | None:
        statement = f"{query.rstrip()}\nFOR UPDATE" if lock else query
        row = self.connection.execute(self.text(statement), params).mappings().first()
        return dict(row) if row is not None else None

    def fetch_all(self, query: str, params: dict[str, Any]) -> list[dict[str, Any]]:
        rows = self.connection.execute(self.text(query), params).mappings().all()
        return [dict(row) for row in rows]

    def execute(self, query: str, params: dict[str, Any]) -> int:
        result = self.connection.execute(self.text(query), params)
        return int(result.rowcount or 0)


def repair_battle_festival_upload_period_sqlite(
    db_path: Path,
    *,
    upload_id: int,
    target_version: str,
    date_from: str,
    date_to: str,
    source: str,
    apply: bool = False,
) -> dict[str, Any]:
    _validate_request(upload_id, target_version, date_from, date_to, source)
    with closing(sqlite3.connect(db_path)) as connection:
        connection.row_factory = sqlite3.Row
        try:
            connection.execute("BEGIN IMMEDIATE" if apply else "BEGIN")
            result = _repair(
                _SqliteExecutor(connection),
                upload_id=upload_id,
                target_version=target_version,
                date_from=date_from,
                date_to=date_to,
                source=source,
                apply=apply,
                lock=False,
            )
            if apply:
                connection.commit()
            else:
                connection.rollback()
            return result
        except Exception:
            connection.rollback()
            raise


def repair_battle_festival_upload_period_server(
    *,
    upload_id: int,
    target_version: str,
    date_from: str,
    date_to: str,
    source: str,
    apply: bool = False,
) -> dict[str, Any]:
    from eiketsu_env.config import load_settings
    from eiketsu_env.db.session import make_engine

    _validate_request(upload_id, target_version, date_from, date_to, source)
    engine = make_engine(load_settings())
    with engine.connect() as connection:
        transaction = connection.begin()
        try:
            result = _repair(
                _SqlAlchemyExecutor(connection),
                upload_id=upload_id,
                target_version=target_version,
                date_from=date_from,
                date_to=date_to,
                source=source,
                apply=apply,
                lock=True,
            )
            if apply:
                transaction.commit()
            else:
                transaction.rollback()
            return result
        except Exception:
            transaction.rollback()
            raise


def _repair(
    executor: Any,
    *,
    upload_id: int,
    target_version: str,
    date_from: str,
    date_to: str,
    source: str,
    apply: bool,
    lock: bool,
) -> dict[str, Any]:
    upload = executor.fetch_one(UPLOAD_QUERY, {"upload_id": upload_id}, lock=lock)
    if upload is None:
        raise RepairValidationError("upload_not_found")
    _validate_scope_row(upload, "upload")
    _validate_upload_target_version(upload, target_version)

    package_id = str(upload.get("package_id") or "").strip()
    if not package_id:
        raise RepairValidationError("package_not_linked")
    package = executor.fetch_one(PACKAGE_QUERY, {"package_id": package_id}, lock=lock)
    if package is None:
        raise RepairValidationError("package_not_found")
    _validate_scope_row(package, "package")
    _validate_versions(upload, package)
    expected_match_count = _validate_counts(upload, package)

    matches = executor.fetch_all(MATCH_QUERY, {"package_id": package_id})
    _validate_matches(
        matches,
        expected_match_count=expected_match_count,
        target_version=target_version,
        date_from=date_from,
        date_to=date_to,
    )

    upload_needs_update = _period_needs_update(upload, date_from, date_to, source)
    package_needs_update = _period_needs_update(package, date_from, date_to, source)
    updated_upload_count = 0
    updated_package_count = 0
    if apply:
        params = {
            "upload_id": upload_id,
            "package_id": package_id,
            "date_from": date_from,
            "date_to": date_to,
            "source": source,
        }
        updated_upload_count = executor.execute(UPDATE_UPLOAD_QUERY, params)
        updated_package_count = executor.execute(UPDATE_PACKAGE_QUERY, params)
        if updated_upload_count != int(upload_needs_update):
            raise RuntimeError("upload update count changed during repair")
        if updated_package_count != int(package_needs_update):
            raise RuntimeError("package update count changed during repair")

    if not apply:
        status = "dry_run"
    elif updated_upload_count or updated_package_count:
        status = "completed"
    else:
        status = "unchanged"
    return {
        "status": status,
        "uploadId": upload_id,
        "targetVersion": target_version,
        "dateFrom": date_from,
        "dateTo": date_to,
        "uploadCount": 1,
        "packageCount": 1,
        "linkedMatchCount": len(matches),
        "wouldUpdateUploadCount": int(upload_needs_update),
        "wouldUpdatePackageCount": int(package_needs_update),
        "updatedUploadCount": updated_upload_count,
        "updatedPackageCount": updated_package_count,
    }


def _validate_request(
    upload_id: int,
    target_version: str,
    date_from: str,
    date_to: str,
    source: str,
) -> None:
    if int(upload_id) <= 0:
        raise RepairValidationError("invalid_upload_id")
    raw_target_version = str(target_version or "")
    if not raw_target_version or raw_target_version != raw_target_version.strip():
        raise RepairValidationError("invalid_target_version")
    if source != OFFICIAL_SOURCE:
        raise RepairValidationError("source_must_be_official")
    start = _parse_iso_date(date_from, "invalid_date_from")
    end = _parse_iso_date(date_to, "invalid_date_to")
    if start >= end:
        raise RepairValidationError("invalid_official_period")


def _validate_scope_row(row: dict[str, Any], row_kind: str) -> None:
    if str(row.get("status") or "") != "completed":
        raise RepairValidationError(f"{row_kind}_not_completed")
    if str(row.get("mode_scope") or "") != "battle_festival":
        raise RepairValidationError(f"{row_kind}_not_battle_festival")


def _validate_upload_target_version(upload: dict[str, Any], target_version: str) -> None:
    if str(upload.get("target_version") or "") != target_version:
        raise RepairValidationError("upload_target_version_mismatch")


def _validate_versions(upload: dict[str, Any], package: dict[str, Any]) -> None:
    upload_version = str(upload.get("target_version") or "").strip()
    package_version = str(package.get("target_version") or "").strip()
    if not upload_version or package_version != upload_version:
        raise RepairValidationError("upload_package_version_mismatch")


def _validate_counts(upload: dict[str, Any], package: dict[str, Any]) -> int:
    counts = [
        _to_int(upload.get("match_count")),
        _to_int(upload.get("imported_match_count")),
        _to_int(package.get("match_count")),
        _to_int(package.get("imported_match_count")),
    ]
    if any(value <= 0 for value in counts) or len(set(counts)) != 1:
        raise RepairValidationError("upload_package_count_mismatch")
    return counts[0]


def _validate_matches(
    matches: list[dict[str, Any]],
    *,
    expected_match_count: int,
    target_version: str,
    date_from: str,
    date_to: str,
) -> None:
    if not matches:
        raise RepairValidationError("linked_matches_missing")
    if len(matches) != expected_match_count:
        raise RepairValidationError("linked_match_count_mismatch")

    start = _parse_iso_date(date_from, "invalid_date_from")
    end = _parse_iso_date(date_to, "invalid_date_to")
    for row in matches:
        if row.get("match_id") is None:
            raise RepairValidationError("linked_match_missing")
        if str(row.get("mode") or "").strip() != BATTLE_FESTIVAL_MODE:
            raise RepairValidationError("linked_match_mode_mismatch")
        if str(row.get("version") or "").strip() != target_version:
            raise RepairValidationError("linked_match_version_mismatch")
        played_date = _parse_played_date(row.get("played_at"))
        if played_date < start or played_date > end:
            raise RepairValidationError("linked_match_outside_period")


def _period_needs_update(row: dict[str, Any], date_from: str, date_to: str, source: str) -> bool:
    return (
        str(row.get("festival_date_from") or "") != date_from
        or str(row.get("festival_date_to") or "") != date_to
        or str(row.get("festival_period_source") or "") != source
    )


def _parse_iso_date(value: str, error_code: str) -> date:
    raw = str(value or "")
    text = raw.strip()
    if raw != text:
        raise RepairValidationError(error_code)
    try:
        parsed = date.fromisoformat(text)
    except ValueError as exc:
        raise RepairValidationError(error_code) from exc
    if parsed.isoformat() != text:
        raise RepairValidationError(error_code)
    return parsed


def _parse_played_date(value: Any) -> date:
    text = str(value or "").strip()
    if len(text) < 10:
        raise RepairValidationError("linked_match_date_invalid")
    return _parse_iso_date(text[:10], "linked_match_date_invalid")


def _to_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Repair one trusted official battle festival upload period.")
    parser.add_argument("--sqlite-file", type=Path, default=None)
    parser.add_argument("--upload-id", type=int, required=True)
    parser.add_argument("--target-version", required=True)
    parser.add_argument("--date-from", required=True)
    parser.add_argument("--date-to", required=True)
    parser.add_argument("--source", choices=[OFFICIAL_SOURCE], required=True)
    parser.add_argument("--apply", action="store_true")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        if args.sqlite_file is not None:
            result = repair_battle_festival_upload_period_sqlite(
                args.sqlite_file,
                upload_id=args.upload_id,
                target_version=args.target_version,
                date_from=args.date_from,
                date_to=args.date_to,
                source=args.source,
                apply=args.apply,
            )
        else:
            result = repair_battle_festival_upload_period_server(
                upload_id=args.upload_id,
                target_version=args.target_version,
                date_from=args.date_from,
                date_to=args.date_to,
                source=args.source,
                apply=args.apply,
            )
    except RepairValidationError as exc:
        print(
            json.dumps(
                {
                    "status": "failed",
                    "uploadId": args.upload_id,
                    "targetVersion": args.target_version,
                    "dateFrom": args.date_from,
                    "dateTo": args.date_to,
                    "error": exc.code,
                },
                ensure_ascii=False,
                sort_keys=True,
            )
        )
        return 2
    except Exception:
        print(
            json.dumps(
                {
                    "status": "failed",
                    "uploadId": args.upload_id,
                    "targetVersion": args.target_version,
                    "dateFrom": args.date_from,
                    "dateTo": args.date_to,
                    "error": "repair_failed",
                },
                ensure_ascii=False,
                sort_keys=True,
            )
        )
        return 1
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
