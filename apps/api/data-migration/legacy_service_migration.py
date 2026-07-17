from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Any


MIGRATION_SCHEMA_VERSION = "legacy-service-migration-v1"

REQUIRED_RUNTIME_TABLES = [
    "matches",
    "match_aliases",
    "match_sides",
    "match_decks",
    "match_deck_units",
    "battle_summaries",
    "raw_snapshots",
    "replay_assets",
    "analysis_runs",
    "analysis_deck_stats",
    "analysis_card_stats",
    "shared_contribution_packages",
    "shared_contribution_matches",
    "server_share_config",
    "server_users",
    "server_invites",
    "server_api_tokens",
    "server_uploads",
    "server_leaderboard_snapshots",
    "server_leaderboard_runs",
    "server_leaderboard_rows",
]

AUDIT_REFERENCE_TABLES = [
    "collection_runs",
    "follow_players",
]

CARD_LOOKUP_FIELDS = [
    "hash_id",
    "card_code",
    "name",
    "faction",
    "cost",
    "unitType",
    "image_keys",
    "reuse_code",
    "gameplay_hash",
    "variant_base_card_code",
    "variant_kind",
]

SERVER_API_TOKEN_COLUMNS = {
    "id",
    "user_id",
    "token_hash",
    "token_prefix",
    "last_used_at",
    "revoked_at",
    "created_at",
    "updated_at",
}

JSON_COLUMN_NAMES = {
    "scope_json",
    "counts_json",
    "error_summary_json",
    "profile_json",
    "selected_json",
    "castle_breakdown_json",
    "timeline_labels_json",
    "timeline_data_json",
    "meta_json",
    "mode_scope_json",
    "thresholds_json",
    "report_formats_json",
    "reports_json",
    "payload_json",
    "row_json",
}


def connect_readonly(db_path: Path) -> sqlite3.Connection:
    uri = db_path.resolve().as_uri() + "?mode=ro"
    connection = sqlite3.connect(uri, uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def list_tables(connection: sqlite3.Connection) -> set[str]:
    rows = connection.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    ).fetchall()
    return {str(row[0]) for row in rows}


def table_columns(connection: sqlite3.Connection, table_name: str) -> list[str]:
    return [str(row[1]) for row in connection.execute(f'PRAGMA table_info("{table_name}")')]


def table_count(connection: sqlite3.Connection, table_name: str) -> int:
    row = connection.execute(f'SELECT COUNT(*) FROM "{table_name}"').fetchone()
    return int(row[0] if row else 0)


def database_inventory(db_path: Path) -> dict[str, Any]:
    with closing(connect_readonly(db_path)) as connection:
        existing_tables = list_tables(connection)
        required = {}
        audit = {}

        for table_name in REQUIRED_RUNTIME_TABLES:
            if table_name in existing_tables:
                required[table_name] = {
                    "row_count": table_count(connection, table_name),
                    "columns": table_columns(connection, table_name),
                }

        for table_name in AUDIT_REFERENCE_TABLES:
            if table_name in existing_tables:
                audit[table_name] = {
                    "row_count": table_count(connection, table_name),
                    "columns": table_columns(connection, table_name),
                }

    missing = [table_name for table_name in REQUIRED_RUNTIME_TABLES if table_name not in required]
    return {
        "schema_version": MIGRATION_SCHEMA_VERSION,
        "source_database": db_path.name,
        "required_table_count": len(REQUIRED_RUNTIME_TABLES),
        "required_tables": required,
        "audit_reference_tables": audit,
        "missing_required_tables": missing,
    }


def export_bundle(
    db_path: Path,
    output_dir: Path,
    card_catalog_path: Path | None = None,
    card_overlay_path: Path | None = None,
    include_invite_codes: bool = False,
) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    table_dir = output_dir / "tables"
    table_dir.mkdir(parents=True, exist_ok=True)

    manifest = database_inventory(db_path)
    if manifest["missing_required_tables"]:
        missing = ", ".join(manifest["missing_required_tables"])
        raise ValueError(f"missing required legacy tables: {missing}")

    exported_tables = {}
    with closing(connect_readonly(db_path)) as connection:
        for table_name in REQUIRED_RUNTIME_TABLES:
            exported_tables[table_name] = export_table(
                connection,
                table_name,
                table_dir / f"{table_name}.jsonl",
                include_invite_codes=include_invite_codes,
            )

    card_outputs = export_card_catalogs(output_dir, card_catalog_path, card_overlay_path)
    manifest.update(
        {
            "exported_tables": exported_tables,
            "card_outputs": card_outputs,
            "redactions": {
                "server_invites.code": not include_invite_codes,
                "raw_snapshots.local_path": True,
                "shared_contribution_packages.file_path": True,
            },
        }
    )
    write_json(output_dir / "manifest.json", manifest)
    return manifest


def export_table(
    connection: sqlite3.Connection,
    table_name: str,
    output_path: Path,
    include_invite_codes: bool = False,
) -> dict[str, Any]:
    count = 0
    with output_path.open("w", encoding="utf-8", newline="\n") as handle:
        for row in connection.execute(f'SELECT * FROM "{table_name}"'):
            payload = sanitize_row(table_name, dict(row), include_invite_codes=include_invite_codes)
            handle.write(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
            handle.write("\n")
            count += 1
    return {"row_count": count, "path": slash_path(output_path)}


def sanitize_row(table_name: str, row: dict[str, Any], include_invite_codes: bool = False) -> dict[str, Any]:
    normalized = {key: normalize_value(key, value) for key, value in row.items()}

    if table_name == "server_api_tokens":
        return {key: normalized.get(key) for key in row if key in SERVER_API_TOKEN_COLUMNS}

    if table_name == "server_invites" and not include_invite_codes:
        code = str(normalized.get("code") or "")
        normalized["code_hash"] = sha256_text(f"server-invite:{code}") if code else ""
        normalized["code_prefix"] = code[:4] if code else ""
        normalized["code"] = ""

    if table_name == "raw_snapshots":
        normalized.pop("local_path", None)
        normalized["legacy_local_path_redacted"] = True

    if table_name == "shared_contribution_packages":
        file_path = str(normalized.pop("file_path", "") or "")
        normalized["file_name"] = path_basename(file_path)
        normalized["legacy_file_path_redacted"] = bool(file_path)

    return normalized


def normalize_value(key: str, value: Any) -> Any:
    if isinstance(value, bytes):
        return value.hex()

    if key in JSON_COLUMN_NAMES and isinstance(value, str):
        text = value.strip()
        if text.startswith("{") or text.startswith("["):
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                return value

    return value


def export_card_catalogs(
    output_dir: Path,
    card_catalog_path: Path | None,
    card_overlay_path: Path | None,
) -> dict[str, Any]:
    card_dir = output_dir / "cards"
    outputs = {}

    if card_catalog_path:
        card_dir.mkdir(parents=True, exist_ok=True)
        outputs["card_catalog"] = export_card_catalog(
            card_catalog_path,
            card_dir / "card_catalog.json",
        )

    resolved_overlay = card_overlay_path
    if resolved_overlay is None and card_catalog_path is not None:
        candidate = card_catalog_path.with_name("card_catalog_overlay.json")
        if candidate.exists():
            resolved_overlay = candidate

    if resolved_overlay:
        card_dir.mkdir(parents=True, exist_ok=True)
        outputs["card_catalog_overlay"] = export_card_catalog(
            resolved_overlay,
            card_dir / "card_catalog_overlay.json",
        )

    return outputs


def export_card_catalog(source_path: Path, output_path: Path) -> dict[str, Any]:
    payload = json.loads(source_path.read_text(encoding="utf-8"))
    cards = payload.get("cards") if isinstance(payload, dict) else payload
    if not isinstance(cards, list):
        raise ValueError(f"card catalog has no cards list: {source_path}")

    sanitized_cards = [sanitize_card(card) for card in cards if isinstance(card, dict)]
    output_payload = {
        "cards": sanitized_cards,
    }
    if isinstance(payload, dict):
        for key in ("source", "generated_for"):
            if key in payload:
                output_payload[key] = payload[key]

    write_json(output_path, output_payload)
    return {
        "card_count": len(sanitized_cards),
        "path": slash_path(output_path),
    }


def sanitize_card(card: dict[str, Any]) -> dict[str, Any]:
    return {key: card[key] for key in CARD_LOOKUP_FIELDS if key in card}


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def path_basename(value: str) -> str:
    return value.replace("\\", "/").rstrip("/").rsplit("/", 1)[-1] if value else ""


def slash_path(path: Path) -> str:
    return path.as_posix()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Export sanitized legacy service data for apps/api.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    inspect_parser = subparsers.add_parser("inspect", help="Inspect required legacy tables.")
    inspect_parser.add_argument("--db", required=True, type=Path)

    export_parser = subparsers.add_parser("export", help="Export a sanitized migration bundle.")
    export_parser.add_argument("--db", required=True, type=Path)
    export_parser.add_argument("--output", required=True, type=Path)
    export_parser.add_argument("--card-catalog", type=Path, default=None)
    export_parser.add_argument("--card-overlay", type=Path, default=None)
    export_parser.add_argument("--include-invite-codes", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "inspect":
        print(json.dumps(database_inventory(args.db), ensure_ascii=False, indent=2, sort_keys=True))
        return 0

    if args.command == "export":
        manifest = export_bundle(
            args.db,
            args.output,
            card_catalog_path=args.card_catalog,
            card_overlay_path=args.card_overlay,
            include_invite_codes=args.include_invite_codes,
        )
        print(json.dumps({"manifest": slash_path(args.output / "manifest.json"), "tables": len(manifest["exported_tables"])}, ensure_ascii=False))
        return 0

    raise AssertionError(f"unhandled command: {args.command}")


if __name__ == "__main__":
    raise SystemExit(main())
