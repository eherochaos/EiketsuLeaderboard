"""战祭周期探测。"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any
from urllib.parse import urlparse

from bs4 import BeautifulSoup

from eiketsu_env.config import Settings
from eiketsu_env.services.browser_session import create_member_session
from eiketsu_env.utils import JST


_RELEVANT_WORDS = ("戦祭", "戦祭り", "開催", "期間", "日程")
_DATE_TOKEN_RE = re.compile(
    r"(?:(?P<year>\d{4})\s*[年/.-]\s*)?"
    r"(?P<month>\d{1,2})\s*(?:月|[/.:-])\s*"
    r"(?P<day>\d{1,2})\s*日?"
)
_RANGE_RE = re.compile(r"[~〜～]|から|より|至|－|-")


@dataclass(frozen=True, slots=True)
class BattleFestivalPeriod:
    date_from: str
    date_to: str


@dataclass(frozen=True, slots=True)
class BattleFestivalProbeResult:
    period: BattleFestivalPeriod | None
    status: str
    message: str
    final_url: str = ""


def today_jst() -> date:
    return datetime.now(JST).date()


def parse_battle_festival_period(html: str, today: date | None = None) -> BattleFestivalPeriod | None:
    """从会员战祭页文本里提取開催期間。"""

    soup = BeautifulSoup(html or "", "html.parser")
    lines = [line.strip() for line in soup.get_text("\n", strip=True).splitlines() if line.strip()]
    if not lines:
        return None

    scopes = _candidate_scopes(lines)
    context_year = (today or today_jst()).year
    for scope in scopes:
        period = _parse_scope_period(scope, context_year)
        if period is not None:
            return period
    return None


def _classify_missing_period_status(html: str) -> str:
    soup = BeautifulSoup(html or "", "html.parser")
    lines = [line.strip() for line in soup.get_text("\n", strip=True).splitlines() if line.strip()]
    if not lines:
        return "no_period"
    scopes = _candidate_scopes(lines)
    if any(_DATE_TOKEN_RE.search(scope) for scope in scopes):
        return "parse_failed"
    return "no_period"


def detect_battle_festival_period(
    settings: Settings,
    auth_source: str = "",
    interactive_auth: bool = False,
    member_session: Any | None = None,
) -> BattleFestivalPeriod | None:
    """读取官网会员战祭页；不可读或无日期时返回 None。"""

    return probe_battle_festival_period(
        settings,
        auth_source=auth_source,
        interactive_auth=interactive_auth,
        member_session=member_session,
    ).period


def probe_battle_festival_period(
    settings: Settings,
    auth_source: str = "",
    interactive_auth: bool = False,
    member_session: Any | None = None,
) -> BattleFestivalProbeResult:
    """Read the official member festival page and return a displayable probe result."""

    try:
        member = member_session or create_member_session(settings, auth_source or None, interactive=interactive_auth)
    except Exception as exc:  # noqa: BLE001
        return BattleFestivalProbeResult(
            period=None,
            status="auth_failed",
            message=f"战祭探测失败：无法读取会员登录态（{exc}）",
        )

    try:
        html, final_url = member.fetch_text(f"{settings.base_url}/members/festival/", timeout=20)
    except Exception as exc:  # noqa: BLE001
        return BattleFestivalProbeResult(
            period=None,
            status="fetch_failed",
            message=f"战祭探测失败：无法读取战祭页面（{exc}）",
        )

    final_url_text = str(final_url or "")
    final_path = urlparse(final_url_text).path.rstrip("/").lower()
    if final_path != "/members/festival":
        return BattleFestivalProbeResult(
            period=None,
            status="redirected",
            message=(
                "战祭探测失败：会员战祭页跳转到首页或登录页，"
                "当前登录态无效或不是程序打开的登录窗口。"
                "请点击“打开登录页”完成会员区登录，并保持该 Chrome/Edge/Brave 窗口打开直到同步完成。"
            ),
            final_url=final_url_text,
        )

    period = parse_battle_festival_period(html)
    if period is None:
        status = _classify_missing_period_status(html)
        if status == "parse_failed":
            return BattleFestivalProbeResult(
                period=None,
                status=status,
                message="战祭探测失败：会员战祭页有日期文本，但无法解析開催期間，跳过战祭采集",
                final_url=final_url_text,
            )
        return BattleFestivalProbeResult(
            period=None,
            status=status,
            message="未在会员战祭页检测到開催期間，跳过战祭采集",
            final_url=final_url_text,
        )
    if not is_battle_festival_active(period):
        return BattleFestivalProbeResult(
            period=period,
            status="inactive",
            message=f"战祭周期 {period.date_from} - {period.date_to} 当前未开启，跳过战祭采集",
            final_url=final_url_text,
        )
    return BattleFestivalProbeResult(
        period=period,
        status="active",
        message=f"检测到战祭周期 {period.date_from} - {period.date_to}",
        final_url=final_url_text,
    )


def is_battle_festival_active(period: BattleFestivalPeriod | None, today: date | None = None) -> bool:
    if period is None:
        return False
    current = (today or today_jst()).isoformat()
    return period.date_from <= current <= period.date_to


def _candidate_scopes(lines: list[str]) -> list[str]:
    scopes: list[str] = []
    for index, line in enumerate(lines):
        if not any(word in line for word in _RELEVANT_WORDS):
            continue
        joined = " ".join(lines[index : index + 4])
        scopes.append(joined)
    scopes.append(" ".join(lines))
    return scopes


def _parse_scope_period(scope: str, context_year: int) -> BattleFestivalPeriod | None:
    tokens = list(_DATE_TOKEN_RE.finditer(scope))
    for left_index, left in enumerate(tokens):
        for right in tokens[left_index + 1 :]:
            between = scope[left.end() : right.start()]
            if len(between) > 80 or not _RANGE_RE.search(between):
                continue
            date_from = _token_date(left, context_year)
            date_to = _token_date(right, date_from.year)
            if date_to < date_from:
                date_to = date(date_to.year + 1, date_to.month, date_to.day)
            return BattleFestivalPeriod(date_from.isoformat(), date_to.isoformat())
    return None


def _token_date(match: re.Match[str], default_year: int) -> date:
    year = int(match.group("year") or default_year)
    month = int(match.group("month"))
    day = int(match.group("day"))
    return date(year, month, day)
