from __future__ import annotations

from datetime import date
from pathlib import Path

from eiketsu_env.config import Settings
from eiketsu_env.services.battle_festival import (
    BattleFestivalPeriod,
    detect_battle_festival_period,
    is_battle_festival_active,
    parse_battle_festival_period,
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


def test_parse_battle_festival_period_handles_year_rollover():
    html = "<html><body><p>戦祭り 開催期間 12/30 - 1/2</p></body></html>"

    period = parse_battle_festival_period(html, today=date(2026, 12, 29))

    assert period == BattleFestivalPeriod("2026-12-30", "2027-01-02")
