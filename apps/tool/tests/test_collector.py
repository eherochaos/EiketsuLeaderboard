from __future__ import annotations

import copy
from datetime import datetime
from pathlib import Path

from sqlalchemy.orm import Session

from eiketsu_env.config import Settings
from eiketsu_env.db.base import Base
from eiketsu_env.db.models import CollectionRun, Match, RawSnapshot
from eiketsu_env.db.session import make_engine
from eiketsu_env.services.mode_filter import MODE_SCOPE_BATTLE_FESTIVAL
from eiketsu_env.services import browser_session, collector
from eiketsu_env.services.collector import _existing_detail_is_complete, _filter_active_players, collect_follow
from eiketsu_env.services.repository import EnvRepository
from eiketsu_env.utils import JST


def _settings(tmp_path: Path) -> Settings:
    return Settings(root_dir=tmp_path, db_url=f"sqlite:///{(tmp_path / 'data' / 'test.db').as_posix()}", firefox_profile=tmp_path / "ff")


def _detail() -> dict:
    return {
        "detail_url": "https://eiketsu-taisen.net/members/history/detail?t=1773932045&f=586",
        "url": "https://eiketsu-taisen.net/members/history/detail?t=1773932045&f=586",
        "follow_id": "586",
        "played_at": "2026-05-10 23:54",
        "date": "2026-05-10 23:54",
        "mode": "全国対戦",
        "version": "Ver.3.1.0H",
        "result": "win",
        "castle_breakdown": {"rows": [{"player": "82.00%", "label": "castle", "enemy": "0.00%"}]},
        "timeline_labels": [],
        "timeline_data": {},
        "players": [
            {
                "side_index": 1,
                "role": "player",
                "player_name": "A",
                "follow_id": "586",
                "result": "win",
                "castle_rate": "82.00%",
                "deck_ids": ["hash-a", "hash-b"],
                "profile": {"全国主君ランキング": "12 位"},
            },
            {
                "side_index": 2,
                "role": "enemy",
                "player_name": "B",
                "result": "loss",
                "castle_rate": "0.00%",
                "deck_ids": ["hash-c"],
                "profile": {"全国主君ランキング": "80 位"},
            },
        ],
    }


def test_filter_active_players_skips_players_inactive_before_range():
    old_timestamp = int(datetime(2026, 5, 4, 23, 59, tzinfo=JST).timestamp())
    fresh_timestamp = int(datetime(2026, 5, 5, 0, 1, tzinfo=JST).timestamp())

    players, skipped = _filter_active_players(
        [
            {"follow_id": "old", "lastplaytime": str(old_timestamp)},
            {"follow_id": "fresh", "lastplaytime": str(fresh_timestamp)},
            {"follow_id": "unknown"},
        ],
        "2026-05-05",
    )

    assert skipped == 1
    assert [player["follow_id"] for player in players] == ["fresh", "unknown"]


def test_existing_detail_is_complete_detects_reusable_follow_detail(tmp_path):
    settings = _settings(tmp_path)
    engine = make_engine(settings)
    Base.metadata.create_all(engine)
    seed = {
        "detail_url": "https://eiketsu-taisen.net/members/history/detail?t=1773932045&f=586",
        "follow_id": "586",
    }

    with Session(engine) as session:
        repo = EnvRepository(session, settings)
        repo.upsert_match_detail(_detail())
        session.commit()

        assert _existing_detail_is_complete(session, seed)


def test_battle_festival_existing_detail_without_player_merit_is_not_complete(tmp_path):
    settings = _settings(tmp_path)
    engine = make_engine(settings)
    Base.metadata.create_all(engine)
    seed = {
        "detail_url": "https://eiketsu-taisen.net/members/history/detail?t=1773932045&f=586",
        "follow_id": "586",
    }
    stale_detail = copy.deepcopy(_detail())
    stale_detail["mode"] = "戦祭り"
    stale_detail["players"][0]["profile"] = {"戦功オッズ": "×1.1", "戦祭りランキング": "12 位"}
    complete_detail = copy.deepcopy(stale_detail)
    complete_detail["players"][0]["profile"] = {"戦功": "250123", "戦祭りランキング": "12 位"}

    with Session(engine) as session:
        repo = EnvRepository(session, settings)
        repo.upsert_match_detail(stale_detail)
        session.commit()

        assert not _existing_detail_is_complete(session, seed, mode_scope=MODE_SCOPE_BATTLE_FESTIVAL)

        repo.upsert_match_detail(complete_detail)
        session.commit()

        assert _existing_detail_is_complete(session, seed, mode_scope=MODE_SCOPE_BATTLE_FESTIVAL)


def test_collect_follow_can_skip_raw_html_snapshots(tmp_path, monkeypatch):
    settings = _settings(tmp_path)
    engine = make_engine(settings)
    Base.metadata.create_all(engine)

    class FakeMember:
        def fetch_text(self, url, referer=None):
            return f"<html>{url}</html>", url

    monkeypatch.setattr(collector, "create_member_session", lambda *args, **kwargs: FakeMember())
    monkeypatch.setattr(collector, "parse_follow_html", lambda html, url, base_url: [{"follow_id": "586", "name": "A"}])
    monkeypatch.setattr(collector, "parse_follow_api_json", lambda payload, base_url: [])
    monkeypatch.setattr(
        collector,
        "parse_daily_html",
        lambda html, url, base_url, iso_date, player: [
            {
                "detail_url": "https://eiketsu-taisen.net/members/history/detail?t=1773932045&f=586",
                "follow_id": "586",
                "mode": "全国対戦",
            }
        ],
    )
    monkeypatch.setattr(collector, "parse_detail_html", lambda html, url, base_url, seed: _detail())

    result = collect_follow(settings, "2026-05-10", "2026-05-10", save_raw_snapshots=False)

    assert result.status == "completed"
    assert settings.raw_dir.exists() is False
    with Session(engine) as session:
        assert session.query(RawSnapshot).count() == 0


def test_collect_follow_can_include_battle_festival(tmp_path, monkeypatch):
    settings = _settings(tmp_path)
    engine = make_engine(settings)
    Base.metadata.create_all(engine)

    class FakeMember:
        def fetch_text(self, url, referer=None):
            return f"<html>{url}</html>", url

    battle_detail = {**_detail(), "mode": "戦祭り"}
    monkeypatch.setattr(collector, "create_member_session", lambda *args, **kwargs: FakeMember())
    monkeypatch.setattr(collector, "parse_follow_html", lambda html, url, base_url: [{"follow_id": "586", "name": "A"}])
    monkeypatch.setattr(collector, "parse_follow_api_json", lambda payload, base_url: [])
    monkeypatch.setattr(
        collector,
        "parse_daily_html",
        lambda html, url, base_url, iso_date, player: [
            {
                "detail_url": "https://eiketsu-taisen.net/members/history/detail?t=1773932045&f=586",
                "follow_id": "586",
                "mode": "戦祭り",
            }
        ],
    )
    monkeypatch.setattr(collector, "parse_detail_html", lambda html, url, base_url, seed: battle_detail)

    result = collect_follow(
        settings,
        "2026-05-10",
        "2026-05-10",
        include_battle_festival=True,
        mode_scope=MODE_SCOPE_BATTLE_FESTIVAL,
        save_raw_snapshots=False,
    )

    assert result.status == "completed"
    assert result.counts["matches"] == 1
    with Session(engine) as session:
        assert session.query(Match).filter_by(mode="戦祭り").count() == 1
        run = session.get(CollectionRun, result.run_id)
        assert run.scope_json["include_battle_festival"] is True
        assert run.scope_json["mode_scope"] == MODE_SCOPE_BATTLE_FESTIVAL


def test_collect_follow_refetches_battle_festival_detail_missing_player_merit(tmp_path, monkeypatch):
    settings = _settings(tmp_path)
    engine = make_engine(settings)
    Base.metadata.create_all(engine)
    stale_detail = copy.deepcopy(_detail())
    stale_detail["mode"] = "戦祭り"
    stale_detail["players"][0]["profile"] = {"戦功オッズ": "×1.1", "戦祭りランキング": "12 位"}
    refreshed_detail = copy.deepcopy(stale_detail)
    refreshed_detail["players"][0]["profile"] = {"戦功": "250123", "戦祭りランキング": "12 位"}

    with Session(engine) as session:
        repo = EnvRepository(session, settings)
        repo.upsert_match_detail(stale_detail)
        session.commit()

    class FakeMember:
        def fetch_text(self, url, referer=None):
            return f"<html>{url}</html>", url

    monkeypatch.setattr(collector, "create_member_session", lambda *args, **kwargs: FakeMember())
    monkeypatch.setattr(
        browser_session,
        "fetch_live_browser_page",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("collector must not render detail pages")),
    )
    monkeypatch.setattr(collector, "parse_follow_html", lambda html, url, base_url: [{"follow_id": "586", "name": "A"}])
    monkeypatch.setattr(collector, "parse_follow_api_json", lambda payload, base_url: [])
    monkeypatch.setattr(
        collector,
        "parse_daily_html",
        lambda html, url, base_url, iso_date, player: [
            {
                "detail_url": "https://eiketsu-taisen.net/members/history/detail?t=1773932045&f=586",
                "follow_id": "586",
                "mode": "戦祭り",
            }
        ],
    )
    monkeypatch.setattr(collector, "parse_detail_html", lambda html, url, base_url, seed: refreshed_detail)

    result = collect_follow(
        settings,
        "2026-05-10",
        "2026-05-10",
        include_battle_festival=True,
        mode_scope=MODE_SCOPE_BATTLE_FESTIVAL,
        skip_existing=True,
        save_raw_snapshots=False,
    )

    assert result.status == "completed"
    assert result.counts["existing_detail_skipped"] == 0
    assert result.counts["battle_festival_existing_merit_missing"] == 1
    assert result.counts["detail_pages"] == 1
    assert result.counts["battle_festival_merit_samples"] == 1
    assert result.counts["battle_festival_player_merit_missing"] == 0


def test_collect_follow_does_not_render_detail_when_http_detail_missing_player_merit(tmp_path, monkeypatch):
    settings = _settings(tmp_path)
    engine = make_engine(settings)
    Base.metadata.create_all(engine)
    stale_detail = copy.deepcopy(_detail())
    stale_detail["mode"] = "戦祭り"
    stale_detail["players"][0]["profile"] = {"戦功オッズ": "×1.1", "戦祭りランキング": "12 位"}

    class FakeMember:
        def fetch_text(self, url, referer=None):
            return "<html>http-detail</html>", url

    monkeypatch.setattr(collector, "create_member_session", lambda *args, **kwargs: FakeMember())
    monkeypatch.setattr(collector, "parse_follow_html", lambda html, url, base_url: [{"follow_id": "586", "name": "A"}])
    monkeypatch.setattr(collector, "parse_follow_api_json", lambda payload, base_url: [])
    monkeypatch.setattr(
        collector,
        "parse_daily_html",
        lambda html, url, base_url, iso_date, player: [
            {
                "detail_url": "https://eiketsu-taisen.net/members/history/detail?t=1773932045&f=586",
                "follow_id": "586",
                "mode": "戦祭り",
            }
        ],
    )
    monkeypatch.setattr(collector, "parse_detail_html", lambda html, url, base_url, seed: stale_detail)

    result = collect_follow(
        settings,
        "2026-05-10",
        "2026-05-10",
        include_battle_festival=True,
        mode_scope=MODE_SCOPE_BATTLE_FESTIVAL,
        auth_source="chrome",
        save_raw_snapshots=False,
    )

    assert result.status == "completed"
    assert "battle_festival_rendered_detail_pages" not in result.counts
    assert result.counts["battle_festival_merit_samples"] == 0
    assert result.counts["battle_festival_player_merit_missing"] == 1
