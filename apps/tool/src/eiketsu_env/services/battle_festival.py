"""战祭周期探测。"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any
from urllib.parse import urljoin, urlparse, urlunparse
from urllib.request import Request, urlopen

from bs4 import BeautifulSoup

from eiketsu_env.config import Settings
from eiketsu_env.services.browser_session import BrowserPageResult, create_member_session, fetch_live_browser_page
from eiketsu_env.utils import JST


_RELEVANT_WORDS = ("戦祭", "戦祭り", "開催", "期間", "日程")
_DATE_TOKEN_RE = re.compile(
    r"(?:(?P<year>\d{4})\s*[年/.-]\s*)?"
    r"(?P<month>\d{1,2})\s*(?:月|[/.-])\s*"
    r"(?P<day>\d{1,2})\s*日?"
)
_RANGE_RE = re.compile(r"[~〜～]|から|より|至|－|-")
_HTTP_URL_RE = re.compile(r"https?://[^\s<>\"']+")
_PUBLIC_EVENT_INDEX_URL = "https://info-eiketsu-taisen.sega.jp/archives/category/event"
_PUBLIC_ANNOUNCEMENT_SELECTOR = ".site-articles-list.news a"
_PUBLIC_SOURCE = "public_announcement"
_MEMBER_SOURCE = "member_page"
_MEMBER_BROWSER_SOURCE = "member_browser"

PublicPageFetcher = Callable[[str, int], tuple[str, str]]


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
    source: str = ""


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
    public_fetcher: PublicPageFetcher | None = None,
) -> BattleFestivalPeriod | None:
    """优先读取 SEGA 公开公告；不可用时回退会员战祭页。"""

    return probe_battle_festival_period(
        settings,
        auth_source=auth_source,
        interactive_auth=interactive_auth,
        member_session=member_session,
        public_fetcher=public_fetcher,
    ).period


def probe_battle_festival_period(
    settings: Settings,
    auth_source: str = "",
    interactive_auth: bool = False,
    member_session: Any | None = None,
    public_fetcher: PublicPageFetcher | None = None,
) -> BattleFestivalProbeResult:
    """Probe the public announcement first, then fall back to the member page."""

    public_result, public_status, public_message = _probe_public_battle_festival_period(
        public_fetcher or fetch_public_page
    )
    if public_result is not None:
        return public_result

    member_result = _probe_member_battle_festival_period(
        settings,
        auth_source=auth_source,
        interactive_auth=interactive_auth,
        member_session=member_session,
    )
    return BattleFestivalProbeResult(
        period=member_result.period,
        status=member_result.status,
        message=f"公开公告探测 {public_status}：{public_message}；{member_result.message}",
        final_url=member_result.final_url,
        source=member_result.source,
    )


def fetch_public_page(url: str, timeout: int = 20) -> tuple[str, str]:
    """读取无需登录的 SEGA 公告页；独立函数便于测试替换。"""

    request = Request(
        url,
        headers={
            "Accept": "text/html,application/xhtml+xml",
            "User-Agent": "EiketsuCollector (+https://info-eiketsu-taisen.sega.jp/)",
        },
    )
    with urlopen(request, timeout=timeout) as response:  # noqa: S310 - URL 仅来自固定 SEGA 域名。
        charset = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(charset, errors="replace"), str(response.geturl() or url)


def _probe_public_battle_festival_period(
    fetcher: PublicPageFetcher,
) -> tuple[BattleFestivalProbeResult | None, str, str]:
    try:
        index_html, _ = fetcher(_PUBLIC_EVENT_INDEX_URL, 20)
    except Exception as exc:  # noqa: BLE001 - 公开源失败必须回退会员页。
        return None, "public_fetch_failed", f"无法读取事件列表（{_safe_error_text(exc)}）"

    announcement_url = _latest_battle_festival_announcement_url(index_html)
    if not announcement_url:
        return None, "public_no_announcement", "事件列表未找到战祭り開催公告"

    try:
        article_html, final_url = fetcher(announcement_url, 20)
    except Exception as exc:  # noqa: BLE001 - 公开源失败必须回退会员页。
        return None, "public_article_fetch_failed", f"无法读取最新战祭公告（{_safe_error_text(exc)}）"

    safe_final_url = _safe_url(final_url or announcement_url)
    if not _is_official_info_url(safe_final_url):
        return None, "public_redirected", "最新战祭公告跳转到非 SEGA 公告页"

    result = _probe_battle_festival_html(article_html, safe_final_url, page_source="public")
    if result.period is None:
        return None, f"public_{result.status}", "最新战祭公告未能解析出開催期間"
    return result, result.status, result.message


def _latest_battle_festival_announcement_url(html: str) -> str:
    soup = BeautifulSoup(html or "", "html.parser")
    for link in soup.select(_PUBLIC_ANNOUNCEMENT_SELECTOR):
        title = link.get_text(" ", strip=True)
        if "戦祭り" not in title or "開催のお知らせ" not in title:
            continue
        candidate = _safe_url(urljoin(_PUBLIC_EVENT_INDEX_URL, str(link.get("href") or "")))
        if _is_official_info_url(candidate):
            return candidate
    return ""


def _probe_member_battle_festival_period(
    settings: Settings,
    auth_source: str,
    interactive_auth: bool,
    member_session: Any | None,
) -> BattleFestivalProbeResult:

    try:
        member = member_session or create_member_session(settings, auth_source or None, interactive=interactive_auth)
    except Exception as exc:  # noqa: BLE001
        return BattleFestivalProbeResult(
            period=None,
            status="auth_failed",
            message=f"战祭探测失败：无法读取会员登录态（{_safe_error_text(exc)}）",
            source=_MEMBER_SOURCE,
        )

    festival_url = f"{settings.base_url}/members/festival/"
    page_source = "http"
    try:
        html, final_url = member.fetch_text(festival_url, timeout=20)
    except Exception as exc:  # noqa: BLE001
        live_page, live_error = _try_live_browser_festival_page(settings, member, auth_source, festival_url)
        if live_page is None:
            suffix = f"；浏览器上下文读取也失败：{live_error}" if live_error else ""
            return BattleFestivalProbeResult(
                period=None,
                status="fetch_failed",
                message=f"战祭探测失败：无法读取战祭页面（{_safe_error_text(exc)}）{suffix}",
                source=_MEMBER_SOURCE,
            )
        html = live_page.html
        final_url = live_page.final_url
        page_source = "browser"

    final_url_text = _safe_url(final_url)
    final_path = urlparse(final_url_text).path.rstrip("/").lower()
    if final_path != "/members/festival":
        live_error = ""
        if page_source != "browser":
            live_page, live_error = _try_live_browser_festival_page(settings, member, auth_source, festival_url)
            if live_page is not None:
                html = live_page.html
                final_url_text = _safe_url(live_page.final_url)
                final_path = urlparse(final_url_text).path.rstrip("/").lower()
                page_source = "browser"
        if final_path == "/members/festival":
            return _probe_battle_festival_html(html, final_url_text, page_source)
        live_suffix = f" 浏览器上下文也失败：{live_error}" if live_error else ""
        return BattleFestivalProbeResult(
            period=None,
            status="redirected",
            message=(
                "战祭探测失败：会员战祭页跳转到首页或登录页，"
                "当前登录态无效或不是程序打开的登录窗口。"
                f"最终 URL：{final_url_text}。"
                f"{live_suffix}"
                "请点击“打开登录页”完成会员区登录，并保持该 Chrome/Edge/Brave 窗口打开直到同步完成。"
            ),
            final_url=final_url_text,
            source=_MEMBER_BROWSER_SOURCE if page_source == "browser" else _MEMBER_SOURCE,
        )

    return _probe_battle_festival_html(html, final_url_text, page_source)


def _probe_battle_festival_html(html: str, final_url_text: str, page_source: str = "http") -> BattleFestivalProbeResult:
    period = parse_battle_festival_period(html)
    source = {
        "public": _PUBLIC_SOURCE,
        "browser": _MEMBER_BROWSER_SOURCE,
    }.get(page_source, _MEMBER_SOURCE)
    page_label = "SEGA 公开公告" if page_source == "public" else "会员战祭页"
    if period is None:
        status = _classify_missing_period_status(html)
        if status == "parse_failed":
            return BattleFestivalProbeResult(
                period=None,
                status=status,
                message=f"战祭探测失败：{page_label}有日期文本，但无法解析開催期間，跳过战祭采集",
                final_url=final_url_text,
                source=source,
            )
        return BattleFestivalProbeResult(
            period=None,
            status=status,
            message=f"未在{page_label}检测到開催期間，跳过战祭采集",
            final_url=final_url_text,
            source=source,
        )
    if not is_battle_festival_active(period):
        return BattleFestivalProbeResult(
            period=period,
            status="inactive",
            message=f"战祭周期 {period.date_from} - {period.date_to} 当前未开启，跳过战祭采集",
            final_url=final_url_text,
            source=source,
        )
    return BattleFestivalProbeResult(
        period=period,
        status="active",
        message=(
            f"检测到战祭周期 {period.date_from} - {period.date_to}"
            + ("（SEGA 公开公告）" if page_source == "public" else "")
            + ("（浏览器上下文）" if page_source == "browser" else "")
        ),
        final_url=final_url_text,
        source=source,
    )


def _try_live_browser_festival_page(
    settings: Settings,
    member: Any,
    auth_source: str,
    festival_url: str,
) -> tuple[BrowserPageResult | None, str]:
    cookie_result = getattr(member, "cookie_result", None)
    if not bool(getattr(cookie_result, "is_live", False)):
        return None, ""
    source = str(getattr(cookie_result, "source", "") or auth_source or "")
    try:
        return fetch_live_browser_page(settings, source, festival_url), ""
    except Exception as exc:  # noqa: BLE001 - HTTP 路径失败后保留可读诊断。
        return None, _safe_error_text(exc)


def _is_official_info_url(value: str) -> bool:
    parsed = urlparse(value)
    try:
        safe_port = parsed.port in (None, 443)
    except ValueError:
        safe_port = False
    return (
        parsed.scheme == "https"
        and parsed.hostname == "info-eiketsu-taisen.sega.jp"
        and safe_port
        and re.fullmatch(r"/archives/\d+", parsed.path) is not None
    )


def _safe_url(value: str) -> str:
    parsed = urlparse(str(value or ""))
    if not parsed.scheme or not parsed.hostname:
        return parsed.path
    host = parsed.hostname
    try:
        if parsed.port is not None:
            host = f"{host}:{parsed.port}"
    except ValueError:
        pass
    return urlunparse((parsed.scheme, host, parsed.path, "", "", ""))


def _safe_error_text(exc: Exception) -> str:
    detail = str(exc).strip()
    if not detail:
        return type(exc).__name__
    sanitized = _HTTP_URL_RE.sub(lambda match: _safe_url(match.group(0)), detail)
    return f"{type(exc).__name__}: {sanitized}"


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
