from __future__ import annotations

from datetime import date
from http.cookiejar import CookieJar
from pathlib import Path

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
            "https://eiketsu-taisen.net/members/festival/",
            "<html><body><p>戦祭り 開催期間 2026年6月11日 ～ 6月13日</p></body></html>",
        ),
    )
    monkeypatch.setattr("eiketsu_env.services.battle_festival.today_jst", lambda: date(2026, 6, 12))

    result = probe_battle_festival_period(_settings(tmp_path), auth_source="chrome", member_session=FakeMember())

    assert result.period == BattleFestivalPeriod("2026-06-11", "2026-06-13")
    assert result.status == "active"
    assert result.final_url == "https://eiketsu-taisen.net/members/festival/"
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
