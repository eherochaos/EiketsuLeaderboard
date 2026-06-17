from __future__ import annotations

import argparse
import json
import re
import sqlite3
from contextlib import closing
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlencode

try:
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
except ImportError:  # pragma: no cover - Python 3.8 fallback.
    ZoneInfo = None  # type: ignore[assignment]
    ZoneInfoNotFoundError = Exception  # type: ignore[assignment]


TARGET_VERSION_RE = re.compile(r"^Ver\.(\d+)\.(\d+)\.(\d+)([A-Z])$")
try:
    JST = ZoneInfo("Asia/Tokyo") if ZoneInfo is not None else timezone(timedelta(hours=9))
except ZoneInfoNotFoundError:  # pragma: no cover - Windows local dev fallback.
    JST = timezone(timedelta(hours=9))
VersionSetter = Callable[[str, str, str], dict[str, Any]]


@dataclass(frozen=True)
class VersionEvidence:
    target_version: str
    played_date: str
    played_at: str
    mode: str = ""
    player_name: str = ""

    def public_dict(self) -> dict[str, str]:
        return {
            "targetVersion": self.target_version,
            "playedDate": self.played_date,
            "playedAt": self.played_at,
            "mode": self.mode,
            "playerName": self.player_name,
        }


def valid_target_version(value: str) -> bool:
    return TARGET_VERSION_RE.match(str(value or "").strip()) is not None


def version_sort_key(target_version: str) -> tuple[int, int, int, int] | None:
    match = TARGET_VERSION_RE.match(str(target_version or "").strip())
    if not match:
        return None
    major, minor, patch, suffix = match.groups()
    return (int(major), int(minor), int(patch), ord(suffix))


def is_newer_target_version(left: str, right: str) -> bool:
    left_key = version_sort_key(left)
    right_key = version_sort_key(right)
    if left_key is None or right_key is None:
        return False
    return left_key > right_key


def select_latest_version_evidence(details: list[dict[str, Any]], probe_date: str = "") -> VersionEvidence | None:
    evidence = [
        item
        for item in (_evidence_from_detail(detail, probe_date) for detail in details)
        if item is not None
    ]
    if not evidence:
        return None
    return sorted(evidence, key=_evidence_sort_key)[-1]


def apply_detected_version(
    details: list[dict[str, Any]],
    current_config: dict[str, Any],
    setter: VersionSetter,
    *,
    probe_date: str = "",
) -> dict[str, Any]:
    candidate = select_latest_version_evidence(details, probe_date=probe_date)
    if candidate is None:
        return {
            "status": "no_evidence",
            "reason": "no valid version evidence",
            "detailSampleCount": len(details),
        }

    current_version = str(
        current_config.get("target_version")
        or current_config.get("targetVersion")
        or current_config.get("currentTargetVersion")
        or ""
    ).strip()
    result = {
        "candidate": candidate.public_dict(),
        "currentTargetVersion": current_version,
        "detailSampleCount": len(details),
    }
    if candidate.target_version == current_version:
        return {
            **result,
            "status": "unchanged",
            "reason": "candidate matches current target version",
        }
    if current_version and is_newer_target_version(current_version, candidate.target_version):
        return {
            **result,
            "status": "older_candidate",
            "reason": "candidate is older than current target version",
        }

    config_result = setter(candidate.target_version, candidate.played_date, candidate.played_date)
    config_status = str(config_result.get("status") or "changed")
    return {
        **result,
        "status": "changed" if config_status == "completed" else config_status,
        "reason": "server share config updated" if config_status == "completed" else str(config_result.get("reason") or ""),
        "config": config_result,
    }


def apply_detected_version_sqlite(
    db_path: Path,
    details: list[dict[str, Any]],
    *,
    probe_date: str = "",
) -> dict[str, Any]:
    from set_server_share_config import set_server_share_config_sqlite

    current_config = read_current_share_config_sqlite(db_path)
    return apply_detected_version(
        details,
        current_config,
        lambda version, date_from, date_to: set_server_share_config_sqlite(
            db_path,
            target_version=version,
            date_from=date_from,
            date_to=date_to,
        ),
        probe_date=probe_date,
    )


def detect_and_apply_server(
    *,
    probe_date: str = "",
    max_players: int = 20,
    max_detail_pages: int = 12,
    auth_source: str = "",
) -> dict[str, Any]:
    from set_server_share_config import set_server_share_config_server

    details, collect_summary = collect_official_version_details(
        probe_date=probe_date or today_jst(),
        max_players=max_players,
        max_detail_pages=max_detail_pages,
        auth_source=auth_source,
    )
    result = apply_detected_version(
        details,
        read_current_share_config_server(),
        lambda version, date_from, date_to: set_server_share_config_server(
            target_version=version,
            date_from=date_from,
            date_to=date_to,
        ),
        probe_date=probe_date,
    )
    return {**result, "probe": collect_summary}


def collect_official_version_details(
    *,
    probe_date: str,
    max_players: int,
    max_detail_pages: int,
    auth_source: str = "",
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    from eiketsu_env.config import load_settings
    from eiketsu_env.services.browser_session import create_member_session
    from eiketsu_env.services.parsers import parse_daily_html, parse_detail_html, parse_follow_api_json, parse_follow_html

    settings = load_settings()
    member = create_member_session(settings, auth_source or None, interactive=False)
    follow_url = f"{settings.base_url}/members/follow/"
    follow_html, final_follow_url = member.fetch_text(follow_url)
    players = parse_follow_html(follow_html, final_follow_url, settings.base_url)
    errors: list[dict[str, str]] = []
    try:
        api_payload, final_api_url = member.fetch_text(
            f"{settings.base_url}/members/follow/api/followlist",
            referer=final_follow_url,
        )
        _ = final_api_url
        api_players = parse_follow_api_json(api_payload, settings.base_url)
        if api_players:
            players = api_players
    except Exception as exc:  # noqa: BLE001 - HTML follow page is a valid fallback.
        errors.append({"stage": "follow_api", "error": _sanitize_text(exc)})

    sampled_players = sorted(players, key=_player_sort_key, reverse=True)[: max(1, max_players)]
    details: list[dict[str, Any]] = []
    daily_pages = 0
    detail_pages = 0
    for player in sampled_players:
        if detail_pages >= max_detail_pages:
            break
        try:
            daily_url = _daily_url_for_date(settings.base_url, player, probe_date)
            daily_html, final_daily_url = member.fetch_text(daily_url, referer=final_follow_url)
            daily_pages += 1
            seeds = parse_daily_html(daily_html, final_daily_url, settings.base_url, probe_date, player)
        except Exception as exc:  # noqa: BLE001 - keep probing other active players.
            errors.append({"stage": "daily", "error": _sanitize_text(exc)})
            continue
        for seed in seeds:
            if detail_pages >= max_detail_pages:
                break
            try:
                detail_html, final_detail_url = member.fetch_text(seed["detail_url"], referer=final_daily_url)
                details.append(parse_detail_html(detail_html, final_detail_url, settings.base_url, seed))
                detail_pages += 1
            except Exception as exc:  # noqa: BLE001
                errors.append({"stage": "detail", "error": _sanitize_text(exc)})

    return details, {
        "probeDate": probe_date,
        "playersTotal": len(players),
        "playersSampled": len(sampled_players),
        "dailyPages": daily_pages,
        "detailPages": detail_pages,
        "errors": errors[:10],
    }


def read_current_share_config_sqlite(db_path: Path) -> dict[str, Any]:
    with closing(sqlite3.connect(db_path)) as connection:
        columns = _sqlite_columns(connection, "server_share_config")
        config_id = _latest_sqlite_config_id(connection, columns)
        if config_id is None:
            return {}
        selected = sorted(columns)
        row = connection.execute(
            f"SELECT {', '.join(selected)} FROM server_share_config WHERE id = ?",
            (config_id,),
        ).fetchone()
    return dict(zip(selected, row)) if row else {}


def read_current_share_config_server() -> dict[str, Any]:
    from sqlalchemy import inspect, text
    from eiketsu_env.config import load_settings
    from eiketsu_env.db.session import make_engine

    engine = make_engine(load_settings())
    with engine.begin() as connection:
        inspector = inspect(connection)
        if "server_share_config" not in set(inspector.get_table_names()):
            return {}
        columns = {column["name"] for column in inspector.get_columns("server_share_config")}
        order_by = "COALESCE(updated_at, '') DESC, id DESC" if "updated_at" in columns else "id DESC"
        row = connection.execute(text(f"SELECT id FROM server_share_config ORDER BY {order_by} LIMIT 1")).mappings().first()
        if row is None:
            return {}
        selected = sorted(columns)
        config = connection.execute(
            text(f"SELECT {', '.join(selected)} FROM server_share_config WHERE id = :config_id"),
            {"config_id": row["id"]},
        ).mappings().first()
    return dict(config or {})


def today_jst() -> str:
    return datetime.now(JST).date().isoformat()


def _evidence_from_detail(detail: dict[str, Any], probe_date: str = "") -> VersionEvidence | None:
    target_version = str(detail.get("version") or "").strip()
    if not valid_target_version(target_version):
        return None
    played_at = str(detail.get("played_at") or detail.get("date") or "").strip()
    played_date = _played_date(played_at, probe_date)
    return VersionEvidence(
        target_version=target_version,
        played_date=played_date,
        played_at=played_at or played_date,
        mode=str(detail.get("mode") or ""),
        player_name=str(detail.get("player_name") or ""),
    )


def _evidence_sort_key(evidence: VersionEvidence) -> tuple[datetime, tuple[int, int, int, int]]:
    return (_played_datetime(evidence.played_at, evidence.played_date), version_sort_key(evidence.target_version) or (0, 0, 0, 0))


def _played_date(played_at: str, fallback_date: str) -> str:
    match = re.search(r"\d{4}-\d{2}-\d{2}", played_at)
    if match:
        return match.group(0)
    return fallback_date or today_jst()


def _played_datetime(played_at: str, fallback_date: str) -> datetime:
    text = str(played_at or "").strip()
    candidates = [text.replace(" ", "T")]
    if fallback_date:
        candidates.append(f"{fallback_date}T00:00:00")
    for candidate in candidates:
        try:
            value = datetime.fromisoformat(candidate)
            return value.replace(tzinfo=None)
        except ValueError:
            continue
    return datetime.min


def _daily_url_for_date(base_url: str, player: dict[str, str], iso_date: str) -> str:
    target = date.fromisoformat(iso_date)
    query = urlencode({"y": target.year, "m": target.month, "d": target.day, "f": str(player.get("follow_id") or "")})
    return f"{base_url}/members/history/daily?{query}"


def _player_sort_key(player: dict[str, str]) -> tuple[int, str]:
    last_play = str(player.get("lastplaytime") or "")
    return (int(last_play) if last_play.isdigit() else 0, str(player.get("follow_id") or ""))


def _sqlite_columns(connection: sqlite3.Connection, table: str) -> set[str]:
    return {str(row[1]) for row in connection.execute(f"PRAGMA table_info({table})")}


def _latest_sqlite_config_id(connection: sqlite3.Connection, columns: set[str]) -> int | None:
    if not columns:
        return None
    order_by = "COALESCE(updated_at, '') DESC, id DESC" if "updated_at" in columns else "id DESC"
    row = connection.execute(f"SELECT id FROM server_share_config ORDER BY {order_by} LIMIT 1").fetchone()
    return int(row[0]) if row else None


def _sanitize_text(value: object) -> str:
    text = str(value or "")
    text = re.sub(r"(?i)\b(token|cookie|secret|password|authorization)\b\s*[:=]\s*[^\s,;]+", r"\1=[redacted]", text)
    text = re.sub(r"[A-Za-z]:\\[^\s'\"<>]+", "[path]", text)
    text = re.sub(r"(?<!\w)/(?:[^\s'\"<>:]+/)+[^\s'\"<>]*", "[path]", text)
    return text[:300]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Detect the active Eiketsu version from official battle detail pages.")
    parser.add_argument("--probe-date", default="")
    parser.add_argument("--max-players", type=int, default=20)
    parser.add_argument("--max-detail-pages", type=int, default=12)
    parser.add_argument("--auth-source", default="")
    parser.add_argument("--sqlite-file", type=Path, default=None)
    parser.add_argument("--details-file", type=Path, default=None)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        if args.details_file is not None:
            details = json.loads(args.details_file.read_text(encoding="utf-8"))
            if not isinstance(details, list):
                raise ValueError("details file must contain a JSON array")
            if args.sqlite_file is not None:
                result = apply_detected_version_sqlite(args.sqlite_file, details, probe_date=args.probe_date)
            else:
                result = apply_detected_version(
                    details,
                    read_current_share_config_server(),
                    lambda version, date_from, date_to: _server_setter(version, date_from, date_to),
                    probe_date=args.probe_date,
                )
        elif args.sqlite_file is not None:
            raise ValueError("--sqlite-file requires --details-file")
        else:
            result = detect_and_apply_server(
                probe_date=args.probe_date,
                max_players=args.max_players,
                max_detail_pages=args.max_detail_pages,
                auth_source=args.auth_source,
            )
    except Exception as exc:  # noqa: BLE001
        result = {"status": "failed", "reason": _sanitize_text(exc)}
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
        return 1

    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


def _server_setter(version: str, date_from: str, date_to: str) -> dict[str, Any]:
    from set_server_share_config import set_server_share_config_server

    return set_server_share_config_server(target_version=version, date_from=date_from, date_to=date_to)


if __name__ == "__main__":
    raise SystemExit(main())
