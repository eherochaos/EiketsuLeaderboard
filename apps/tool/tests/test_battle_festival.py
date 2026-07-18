from __future__ import annotations

from datetime import date
from http.cookiejar import CookieJar
from pathlib import Path

import pytest

from eiketsu_env.config import Settings
from eiketsu_env.services import battle_festival
from eiketsu_env.services.battle_festival import (
    BattleFestivalPeriod,
    detect_battle_festival_period,
    is_battle_festival_active,
    parse_battle_festival_period,
    probe_battle_festival_period,
)
from eiketsu_env.services.browser_session import BrowserCookieResult, BrowserPageResult


PUBLIC_EVENT_INDEX_URL = "https://info-eiketsu-taisen.sega.jp/archives/category/event"


@pytest.fixture(autouse=True)
def _disable_live_public_requests(monkeypatch):
    monkeypatch.setattr(
        battle_festival,
        "fetch_public_page",
        lambda url, timeout=20: ("<html><body><div class='site-articles-list news'></div></body></html>", url),
    )


def _settings(tmp_path: Path) -> Settings:
    return Settings(
        root_dir=tmp_path,
        db_url=f"sqlite:///{(tmp_path / 'data' / 'test.db').as_posix()}",
        firefox_profile=tmp_path / "ff",
        card_catalog_path=tmp_path / "cards.json",
    )


def test_parse_active_battle_festival_period():
    html = """
    <html><body>
      <h1>戦祭り</h1>
      <p>開催期間 2026年6月11日 ～ 6月13日</p>
    </body></html>
    """

    period = parse_battle_festival_period(html, today=date(2026, 6, 12))

    assert period == BattleFestivalPeriod("2026-06-11", "2026-06-13")
    assert is_battle_festival_active(period, today=date(2026, 6, 12)) is True
    assert is_battle_festival_active(period, today=date(2026, 6, 14)) is False


def test_parse_battle_festival_period_returns_none_without_dates():
    assert parse_battle_festival_period("<html><body>戦祭り 次回開催をお待ちください</body></html>") is None


def test_detect_battle_festival_period_skips_non_member_page(tmp_path):
    class FakeMember:
        def fetch_text(self, url, timeout=20):
            return "<html>login</html>", "https://eiketsu-taisen.net/login/"

    assert detect_battle_festival_period(_settings(tmp_path), member_session=FakeMember()) is None


def test_probe_battle_festival_period_reports_redirect(tmp_path):
    class FakeMember:
        def fetch_text(self, url, timeout=20):
            return "<html>login</html>", "https://eiketsu-taisen.net/"

    result = probe_battle_festival_period(_settings(tmp_path), member_session=FakeMember())

    assert result.period is None
    assert result.status == "redirected"
    assert result.final_url == "https://eiketsu-taisen.net/"
    assert "登录态无效" in result.message
    assert "保持" in result.message


def test_probe_battle_festival_period_reports_active(tmp_path, monkeypatch):
    class FakeMember:
        def fetch_text(self, url, timeout=20):
            return (
                "<html><body><p>戦祭り 開催期間 2026年6月11日 ～ 6月13日</p></body></html>",
                "https://eiketsu-taisen.net/members/festival/",
            )

    monkeypatch.setattr("eiketsu_env.services.battle_festival.today_jst", lambda: date(2026, 6, 12))

    result = probe_battle_festival_period(_settings(tmp_path), member_session=FakeMember())

    assert result.period == BattleFestivalPeriod("2026-06-11", "2026-06-13")
    assert result.status == "active"
    assert result.source == "member_page"


def test_parse_battle_festival_period_ignores_time_range_before_dates():
    html = """
    <html><body>
      <p>戦祭り 開催時間 10:20～11:30</p>
      <p>開催期間 2026年7月18日～7月20日</p>
    </body></html>
    """

    assert parse_battle_festival_period(html) == BattleFestivalPeriod(
        "2026-07-18",
        "2026-07-20",
    )


def test_probe_battle_festival_period_prefers_current_public_announcement(tmp_path, monkeypatch):
    calls: list[str] = []
    index_html = """
    <html><body><div class="site-articles-list news">
      <a href="/archives/7600">英傑大戦 公式生放送</a>
      <a href="https://info-eiketsu-taisen.sega.jp/news/7601">戦祭り「偽パス」開催のお知らせ</a>
      <a href="https://info-eiketsu-taisen.sega.jp.example/archives/7602">戦祭り「偽ホスト」開催のお知らせ</a>
      <a href="/archives/7592?tracking=private">戦祭り「樊城の戦い」開催のお知らせ</a>
      <a href="/archives/7487">戦祭り「牧野の戦い・封神」開催のお知らせ</a>
    </div></body></html>
    """
    article_html = """
    <html><body>
      <h1>戦祭り「樊城の戦い」開催のお知らせ</h1>
      <p>2026年7月18日（土）から7月20日（月）までの3日間、戦祭りを開催いたします。</p>
    </body></html>
    """

    def fake_public_fetch(url: str, timeout: int = 20):
        calls.append(url)
        if url == PUBLIC_EVENT_INDEX_URL:
            return index_html, url
        assert url == "https://info-eiketsu-taisen.sega.jp/archives/7592"
        return article_html, f"{url}?preview=private"

    def fail_member_session(*args, **kwargs):
        pytest.fail("公开公告命中时不应创建会员会话")

    monkeypatch.setattr(battle_festival, "fetch_public_page", fake_public_fetch)
    monkeypatch.setattr(battle_festival, "create_member_session", fail_member_session)
    monkeypatch.setattr(battle_festival, "today_jst", lambda: date(2026, 7, 18))

    result = probe_battle_festival_period(_settings(tmp_path))

    assert result.period == BattleFestivalPeriod("2026-07-18", "2026-07-20")
    assert result.status == "active"
    assert result.source == "public_announcement"
    assert result.final_url == "https://info-eiketsu-taisen.sega.jp/archives/7592"
    assert "private" not in result.message
    assert calls == [PUBLIC_EVENT_INDEX_URL, "https://info-eiketsu-taisen.sega.jp/archives/7592"]


def test_probe_battle_festival_period_falls_back_after_public_article_redirect(tmp_path, monkeypatch):
    index_html = """
    <html><body><div class="site-articles-list news">
      <a href="/archives/7592">戦祭り「樊城の戦い」開催のお知らせ</a>
    </div></body></html>
    """

    class FakeMember:
        def fetch_text(self, url, timeout=20):
            return (
                "<html><body><p>戦祭り 開催期間 2026年7月18日 ～ 7月20日</p></body></html>",
                "https://eiketsu-taisen.net/members/festival/",
            )

    def fake_public_fetch(url: str, timeout: int = 20):
        if url == PUBLIC_EVENT_INDEX_URL:
            return index_html, url
        return "<html><body>redirected</body></html>", "https://info-eiketsu-taisen.sega.jp/archives/category/event"

    monkeypatch.setattr(battle_festival, "fetch_public_page", fake_public_fetch)
    monkeypatch.setattr(battle_festival, "today_jst", lambda: date(2026, 7, 18))

    result = probe_battle_festival_period(_settings(tmp_path), member_session=FakeMember())

    assert result.period == BattleFestivalPeriod("2026-07-18", "2026-07-20")
    assert result.status == "active"
    assert result.source == "member_page"
    assert "public_redirected" in result.message


def test_probe_battle_festival_period_falls_back_when_public_has_no_announcement(tmp_path, monkeypatch):
    class FakeMember:
        def fetch_text(self, url, timeout=20):
            return (
                "<html><body><p>戦祭り 開催期間 2026年7月18日 ～ 7月20日</p></body></html>",
                "https://eiketsu-taisen.net/members/festival/",
            )

    monkeypatch.setattr(battle_festival, "today_jst", lambda: date(2026, 7, 18))

    result = probe_battle_festival_period(_settings(tmp_path), member_session=FakeMember())

    assert result.period == BattleFestivalPeriod("2026-07-18", "2026-07-20")
    assert result.status == "active"
    assert result.source == "member_page"
    assert "public_no_announcement" in result.message


def test_probe_battle_festival_period_falls_back_after_public_network_failure(tmp_path, monkeypatch):
    class FakeMember:
        def fetch_text(self, url, timeout=20):
            return (
                "<html><body><p>戦祭り 開催期間 2026年7月18日 ～ 7月20日</p></body></html>",
                "https://eiketsu-taisen.net/members/festival/",
            )

    def fail_public_fetch(url: str, timeout: int = 20):
        raise OSError("failed https://info-eiketsu-taisen.sega.jp/?token=private")

    monkeypatch.setattr(battle_festival, "fetch_public_page", fail_public_fetch)
    monkeypatch.setattr(battle_festival, "today_jst", lambda: date(2026, 7, 18))

    result = probe_battle_festival_period(_settings(tmp_path), member_session=FakeMember())

    assert result.period == BattleFestivalPeriod("2026-07-18", "2026-07-20")
    assert result.status == "active"
    assert result.source == "member_page"
    assert "public_fetch_failed" in result.message
    assert "token" not in result.message
    assert "private" not in result.message


def test_probe_battle_festival_period_returns_expired_latest_public_announcement(tmp_path, monkeypatch):
    calls: list[str] = []
    index_html = """
    <html><body><div class="site-articles-list news">
      <a href="/archives/7592">戦祭り「樊城の戦い」開催のお知らせ</a>
      <a href="/archives/7487">戦祭り「牧野の戦い・封神」開催のお知らせ</a>
    </div></body></html>
    """

    def fake_public_fetch(url: str, timeout: int = 20):
        calls.append(url)
        if url == PUBLIC_EVENT_INDEX_URL:
            return index_html, url
        return (
            "<html><body><p>戦祭り 開催期間 2026年7月18日 ～ 7月20日</p></body></html>",
            url,
        )

    def fail_member_session(*args, **kwargs):
        pytest.fail("公开公告可解析但已过期时不应回退会员页")

    monkeypatch.setattr(battle_festival, "fetch_public_page", fake_public_fetch)
    monkeypatch.setattr(battle_festival, "create_member_session", fail_member_session)
    monkeypatch.setattr(battle_festival, "today_jst", lambda: date(2026, 7, 21))

    result = probe_battle_festival_period(_settings(tmp_path))

    assert result.period == BattleFestivalPeriod("2026-07-18", "2026-07-20")
    assert result.status == "inactive"
    assert result.source == "public_announcement"
    assert calls == [PUBLIC_EVENT_INDEX_URL, "https://info-eiketsu-taisen.sega.jp/archives/7592"]


def test_probe_battle_festival_period_uses_live_browser_when_http_redirects(tmp_path, monkeypatch):
    class FakeMember:
        cookie_result = BrowserCookieResult("chrome", tmp_path / "profile", CookieJar(), 1, "ok", is_live=True)

        def fetch_text(self, url, timeout=20):
            return "<html>home</html>", "https://eiketsu-taisen.net/"

    monkeypatch.setattr(
        battle_festival,
        "fetch_live_browser_page",
        lambda _settings, _source, _url: BrowserPageResult(
            "chrome",
            "https://eiketsu-taisen.net/members/festival/?token=private",
            "<html><body><p>戦祭り 開催期間 2026年6月11日 ～ 6月13日</p></body></html>",
        ),
    )
    monkeypatch.setattr("eiketsu_env.services.battle_festival.today_jst", lambda: date(2026, 6, 12))

    result = probe_battle_festival_period(_settings(tmp_path), auth_source="chrome", member_session=FakeMember())

    assert result.period == BattleFestivalPeriod("2026-06-11", "2026-06-13")
    assert result.status == "active"
    assert result.final_url == "https://eiketsu-taisen.net/members/festival/"
    assert "private" not in result.message
    assert "浏览器上下文" in result.message


def test_probe_battle_festival_period_reports_live_browser_redirect(tmp_path, monkeypatch):
    class FakeMember:
        cookie_result = BrowserCookieResult("chrome", tmp_path / "profile", CookieJar(), 1, "ok", is_live=True)

        def fetch_text(self, url, timeout=20):
            return "<html>home</html>", "https://eiketsu-taisen.net/"

    monkeypatch.setattr(
        battle_festival,
        "fetch_live_browser_page",
        lambda _settings, _source, _url: BrowserPageResult("chrome", "https://eiketsu-taisen.net/", "<html>home</html>"),
    )

    result = probe_battle_festival_period(_settings(tmp_path), auth_source="chrome", member_session=FakeMember())

    assert result.period is None
    assert result.status == "redirected"
    assert result.final_url == "https://eiketsu-taisen.net/"
    assert "最终 URL：https://eiketsu-taisen.net/" in result.message


def test_probe_battle_festival_period_reports_no_period(tmp_path):
    class FakeMember:
        def fetch_text(self, url, timeout=20):
            return (
                "<html><body><p>\u6226\u796d\u308a \u6b21\u56de\u958b\u50ac\u3092\u304a\u5f85\u3061\u304f\u3060\u3055\u3044</p></body></html>",
                "https://eiketsu-taisen.net/members/festival/",
            )

    result = probe_battle_festival_period(_settings(tmp_path), member_session=FakeMember())

    assert result.period is None
    assert result.status == "no_period"


def test_probe_battle_festival_period_reports_parse_failed(tmp_path):
    class FakeMember:
        def fetch_text(self, url, timeout=20):
            return (
                "<html><body><p>\u6226\u796d\u308a \u958b\u50ac\u671f\u9593 2026\u5e746\u670811\u65e5</p></body></html>",
                "https://eiketsu-taisen.net/members/festival/",
            )

    result = probe_battle_festival_period(_settings(tmp_path), member_session=FakeMember())

    assert result.period is None
    assert result.status == "parse_failed"


def test_parse_battle_festival_period_handles_year_rollover():
    html = "<html><body><p>戦祭り 開催期間 12/30 - 1/2</p></body></html>"

    period = parse_battle_festival_period(html, today=date(2026, 12, 29))

    assert period == BattleFestivalPeriod("2026-12-30", "2027-01-02")
