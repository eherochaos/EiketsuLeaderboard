from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy.orm import Session

from eiketsu_env.config import Settings
from eiketsu_env.db.base import Base
from eiketsu_env.db.models import CollectionRun, Match, RawSnapshot
from eiketsu_env.db.session import make_engine
from eiketsu_env.services import client_upload
from eiketsu_env.services import collector
from eiketsu_env.services.battle_festival import BattleFestivalPeriod, BattleFestivalProbeResult
from eiketsu_env.services.client_upload import (
    apply_client_date_override,
    bind_client,
    check_client_update,
    cleanup_raw_snapshots,
    fetch_client_share_config,
    fetch_client_share_config_state,
    minimum_client_date_from,
    save_client_config,
    sync_client,
)
from eiketsu_env.services.collector import CollectResult
from eiketsu_env.services.mode_filter import MODE_SCOPE_BATTLE_FESTIVAL, MODE_SCOPE_TIER_LIST
from eiketsu_env.services.repository import EnvRepository


def _settings(tmp_path: Path) -> Settings:
    return Settings(
        root_dir=tmp_path,
        db_url=f"sqlite:///{(tmp_path / 'data' / 'test.db').as_posix()}",
        firefox_profile=tmp_path / "ff",
        card_catalog_path=tmp_path / "cards.json",
    )


def _detail() -> dict:
    return {
        "detail_url": "https://eiketsu-taisen.net/members/history/detail?f=586",
        "url": "https://eiketsu-taisen.net/members/history/detail?f=586",
        "follow_id": "586",
        "played_at": "2026-05-11 12:34",
        "date": "2026-05-11 12:34",
        "mode": "全国対戦",
        "version": "Ver.client",
        "result": "win",
        "replay_id": "client-replay",
        "castle_breakdown": {"rows": [{"player": "20.00%", "enemy": "100.00%"}]},
        "timeline_labels": ["開幕", "終了"],
        "timeline_data": {"castle": {"player": [100, 80], "enemy": [100, 0]}},
        "players": [
            {
                "side_index": 1,
                "role": "player",
                "player_name": "A",
                "follow_id": "586",
                "result": "win",
                "castle_rate": "80.00%",
                "deck_ids": ["card-a", "card-b"],
                "profile": {},
            }
        ],
    }


def _detail_for(
    mode: str,
    version: str,
    detail_url: str,
    replay_id: str,
    played_at: str = "2026-05-11 12:34",
) -> dict:
    detail = json.loads(json.dumps(_detail()))
    detail["mode"] = mode
    detail["version"] = version
    detail["detail_url"] = detail_url
    detail["url"] = detail_url
    detail["replay_id"] = replay_id
    detail["played_at"] = played_at
    detail["date"] = played_at
    return detail


@pytest.fixture(autouse=True)
def _skip_battle_festival_probe(monkeypatch):
    monkeypatch.setattr(
        client_upload,
        "probe_battle_festival_period",
        lambda *args, **kwargs: BattleFestivalProbeResult(None, "no_period", "skip battle festival"),
    )


def test_bind_client_saves_local_config(tmp_path, monkeypatch):
    monkeypatch.setenv("EIKETSU_CLIENT_CONFIG_DIR", str(tmp_path / "client-config"))
    transport = _FakeTransport()
    settings = _settings(tmp_path)

    result = bind_client(settings, "http://127.0.0.1:8000/", "INVITE", "alice", transport=transport)

    payload = json.loads(result.config_path.read_text(encoding="utf-8"))
    assert result.server_url == "http://127.0.0.1:8000"
    assert payload["api_token"] == "token-secret"
    assert payload["contributor"] == "alice"
    assert transport.calls[0][0] == "POST"


def test_sync_client_collects_exports_safe_jsonl_and_uploads(tmp_path, monkeypatch):
    monkeypatch.setenv("EIKETSU_CLIENT_CONFIG_DIR", str(tmp_path / "client-config"))
    settings = _settings(tmp_path)
    save_client_config(
        settings,
        client_upload.ClientConfig(
            server_url="http://127.0.0.1:8000",
            api_token="token-secret",
            contributor="alice",
            user_public_id="u_test",
        ),
    )
    transport = _FakeTransport()

    def fake_collect(settings, date_from, date_to, **kwargs):
        assert kwargs["interactive_auth"] is False
        assert kwargs["save_raw_snapshots"] is False
        assert kwargs["skip_existing"] is True
        assert kwargs["skip_inactive"] is True
        assert kwargs["concurrency_profile"] == "aggressive"
        engine = make_engine(settings)
        Base.metadata.create_all(engine)
        with Session(engine) as session:
            repo = EnvRepository(session, settings)
            repo.upsert_match_detail(_detail())
            session.commit()
        return CollectResult(1, "completed", {"matches": 1}, [])

    monkeypatch.setattr(client_upload, "collect_follow", fake_collect)

    result = sync_client(settings, interactive_auth=False, transport=transport)

    upload_payload = transport.upload_payload
    assert result.upload["status"] == "completed"
    assert upload_payload is not None
    assert "package_text" in upload_payload
    serialized = upload_payload["package_text"]
    assert "cookies" not in serialized
    assert "local_path" not in serialized
    assert "raw_html" not in serialized
    assert (settings.raw_dir).exists() is False
    assert result.package_path.exists() is False


def test_sync_client_allows_user_date_override_and_clamps_to_server_start(tmp_path, monkeypatch):
    monkeypatch.setenv("EIKETSU_CLIENT_CONFIG_DIR", str(tmp_path / "client-config"))
    settings = _settings(tmp_path)
    save_client_config(
        settings,
        client_upload.ClientConfig(
            server_url="http://127.0.0.1:8000",
            api_token="token-secret",
            contributor="alice",
            user_public_id="u_test",
        ),
    )
    transport = _FakeTransport()
    seen_dates: list[tuple[str, str]] = []

    def fake_collect(settings, date_from, date_to, **kwargs):
        seen_dates.append((date_from, date_to))
        engine = make_engine(settings)
        Base.metadata.create_all(engine)
        return CollectResult(1, "completed", {"matches": 0}, [])

    monkeypatch.setattr(client_upload, "collect_follow", fake_collect)

    sync_client(settings, interactive_auth=False, transport=transport, date_from="2026-05-01", date_to="2026-05-11")

    assert seen_dates == [("2026-05-10", "2026-05-11")]


def test_sync_client_clamps_user_date_to_server_window(tmp_path, monkeypatch):
    monkeypatch.setenv("EIKETSU_CLIENT_CONFIG_DIR", str(tmp_path / "client-config"))
    settings = _settings(tmp_path)
    save_client_config(
        settings,
        client_upload.ClientConfig(
            server_url="http://127.0.0.1:8000",
            api_token="token-secret",
            contributor="alice",
            user_public_id="u_test",
        ),
    )
    transport = _FakeTransport()
    seen_dates: list[tuple[str, str]] = []

    def fake_collect(settings, date_from, date_to, **kwargs):
        seen_dates.append((date_from, date_to))
        engine = make_engine(settings)
        Base.metadata.create_all(engine)
        return CollectResult(1, "completed", {"matches": 0}, [])

    monkeypatch.setattr(client_upload, "collect_follow", fake_collect)

    sync_client(settings, interactive_auth=False, transport=transport, date_from="2026-05-11", date_to="2026-05-20")

    assert seen_dates == [("2026-05-11", "2026-05-12")]


def test_sync_client_keeps_tier_list_scope_when_server_has_legacy_battle_flag(tmp_path, monkeypatch):
    monkeypatch.setenv("EIKETSU_CLIENT_CONFIG_DIR", str(tmp_path / "client-config"))
    settings = _settings(tmp_path)
    save_client_config(
        settings,
        client_upload.ClientConfig(
            server_url="http://127.0.0.1:8000",
            api_token="token-secret",
            contributor="alice",
            user_public_id="u_test",
        ),
    )
    transport = _FakeTransport()
    seen_kwargs: dict[str, Any] = {}

    def fake_collect(settings, date_from, date_to, **kwargs):
        seen_kwargs.update(kwargs)
        engine = make_engine(settings)
        Base.metadata.create_all(engine)
        return CollectResult(1, "completed", {"matches": 0}, [])

    monkeypatch.setattr(client_upload, "collect_follow", fake_collect)

    sync_client(settings, interactive_auth=False, transport=transport, target_version="Ver.battle")

    assert seen_kwargs["include_solo"] is False
    assert seen_kwargs["include_battle_festival"] is False
    assert seen_kwargs["mode_scope"] == MODE_SCOPE_TIER_LIST


def test_sync_client_collects_and_uploads_active_battle_festival_scope(tmp_path, monkeypatch):
    monkeypatch.setenv("EIKETSU_CLIENT_CONFIG_DIR", str(tmp_path / "client-config"))
    settings = _settings(tmp_path)
    save_client_config(
        settings,
        client_upload.ClientConfig(
            server_url="http://127.0.0.1:8000",
            api_token="token-secret",
            contributor="alice",
            user_public_id="u_test",
        ),
    )
    transport = _FakeTransport()
    progress = _FakeProgress()
    seen_calls: list[tuple[str, str, dict[str, Any]]] = []

    def fake_collect(settings, date_from, date_to, **kwargs):
        seen_calls.append((date_from, date_to, dict(kwargs)))
        engine = make_engine(settings)
        Base.metadata.create_all(engine)
        counts = {"matches": 0}
        if kwargs.get("mode_scope") == MODE_SCOPE_BATTLE_FESTIVAL:
            counts.update(
                {
                    "detail_candidates": 2,
                    "detail_pages": 1,
                    "battle_festival_merit_samples": 1,
                    "battle_festival_player_merit_missing": 1,
                    "battle_festival_existing_merit_missing": 1,
                    "skipped_by_mode": 0,
                }
            )
        return CollectResult(1, "completed", counts, [])

    monkeypatch.setattr(client_upload, "collect_follow", fake_collect)
    monkeypatch.setattr(
        client_upload,
        "probe_battle_festival_period",
        lambda *args, **kwargs: BattleFestivalProbeResult(
            BattleFestivalPeriod("2026-06-11", "2026-06-13"),
            "active",
            "检测到战祭周期 2026-06-11 - 2026-06-13（浏览器上下文）",
        ),
    )
    monkeypatch.setattr(client_upload, "today_jst", lambda: date(2026, 6, 12))

    result = sync_client(settings, interactive_auth=False, transport=transport, target_version="Ver.battle", progress=progress)

    assert result.battle_festival_collect_result is not None
    assert result.battle_festival_upload is not None
    assert any("浏览器上下文" in message for message in progress.messages)
    assert any("绝对戦功样本 1" in message for message in progress.messages)
    assert any("player缺戦功 1" in message for message in progress.messages)
    assert any("缺戦功重抓 1" in message for message in progress.messages)
    assert not any("rendered" in message for message in progress.messages)
    assert [(date_from, date_to) for date_from, date_to, _ in seen_calls] == [
        ("2026-06-11", "2026-06-12"),
        ("2026-06-10", "2026-06-14"),
    ]
    assert seen_calls[0][2]["mode_scope"] == MODE_SCOPE_BATTLE_FESTIVAL
    assert seen_calls[0][2]["include_battle_festival"] is True
    assert seen_calls[1][2]["mode_scope"] == MODE_SCOPE_TIER_LIST
    assert seen_calls[1][2]["include_battle_festival"] is False
    assert len(transport.upload_payloads) == 2
    manifests = [
        json.loads(payload["package_text"].splitlines()[0])
        for payload in transport.upload_payloads
    ]
    assert manifests[0]["mode_scope"] == MODE_SCOPE_BATTLE_FESTIVAL
    assert manifests[0]["festival_date_from"] == "2026-06-11"
    assert manifests[0]["festival_date_to"] == "2026-06-13"
    assert manifests[0]["match_count"] == 0
    assert manifests[1]["mode_scope"] == MODE_SCOPE_TIER_LIST


def test_sync_client_warns_when_battle_festival_package_reuses_bad_local_data(tmp_path, monkeypatch):
    monkeypatch.setenv("EIKETSU_CLIENT_CONFIG_DIR", str(tmp_path / "client-config"))
    settings = _settings(tmp_path)
    save_client_config(
        settings,
        client_upload.ClientConfig(
            server_url="http://127.0.0.1:8000",
            api_token="token-secret",
            contributor="alice",
            user_public_id="u_test",
        ),
    )

    class AlreadyUploadedTransport(_FakeTransport):
        def request_json(self, method: str, url: str, payload: dict[str, Any] | None = None, token: str = "") -> dict[str, Any]:
            result = super().request_json(method, url, payload, token)
            if url.endswith("/api/v1/uploads"):
                result["already_uploaded"] = True
            return result

    def fake_collect(settings, date_from, date_to, **kwargs):
        engine = make_engine(settings)
        Base.metadata.create_all(engine)
        if kwargs.get("mode_scope") == MODE_SCOPE_BATTLE_FESTIVAL:
            with Session(engine) as session:
                repo = EnvRepository(session, settings)
                detail = _detail_for(
                    "\u6226\u796d\u308a",
                    "Ver.battle",
                    "https://eiketsu-taisen.net/members/history/detail?f=586&t=bad",
                    "battle-no-player-merit",
                    "2026-06-12 11:00",
                )
                detail["players"][0]["profile"] = {
                    "\u6226\u529f\u30aa\u30c3\u30ba": "\u00d71.1",
                    "\u6226\u796d\u308a\u30e9\u30f3\u30ad\u30f3\u30b0": "12 \u4f4d",
                }
                repo.upsert_match_detail(detail)
                session.commit()
            return CollectResult(1, "completed", {"matches": 1}, [])
        return CollectResult(2, "completed", {"matches": 0}, [])

    progress = _FakeProgress()
    monkeypatch.setattr(client_upload, "collect_follow", fake_collect)
    monkeypatch.setattr(
        client_upload,
        "probe_battle_festival_period",
        lambda *args, **kwargs: BattleFestivalProbeResult(
            BattleFestivalPeriod("2026-06-11", "2026-06-13"),
            "active",
            "festival active",
        ),
    )
    monkeypatch.setattr(client_upload, "today_jst", lambda: date(2026, 6, 12))

    result = sync_client(
        settings,
        interactive_auth=False,
        transport=AlreadyUploadedTransport(),
        target_version="Ver.battle",
        progress=progress,
    )

    assert result.battle_festival_upload is not None
    assert result.battle_festival_upload["already_uploaded"] is True
    assert any("battle_festival 包检查" in message for message in progress.messages)
    assert any("player側戦功样本 0" in message for message in progress.messages)
    assert any("player缺戦功 1" in message for message in progress.messages)
    assert any("本地 DB 仍可能是旧坏数据" in message for message in progress.messages)
    assert any("同内容重复上传" in message for message in progress.messages)


def test_battle_festival_plan_collects_past_official_period_when_range_intersects():
    config = client_upload.ShareConfig(target_version="Ver.3.5.0B", date_from="2026-06-13", date_to="2026-06-13")
    probe = BattleFestivalProbeResult(
        BattleFestivalPeriod("2026-06-11", "2026-06-13"),
        "inactive",
        "festival ended",
    )

    plan = client_upload.battle_festival_collect_plan(config, probe, current_day=date(2026, 6, 14))

    assert plan.config is not None
    assert plan.source == "official_period"
    assert plan.upload_when_empty is True
    assert plan.config.mode_scope == MODE_SCOPE_BATTLE_FESTIVAL
    assert plan.config.date_from == "2026-06-13"
    assert plan.config.date_to == "2026-06-13"
    assert plan.config.festival_date_from == "2026-06-11"
    assert plan.config.festival_date_to == "2026-06-13"


def test_battle_festival_plan_fallback_collects_recent_past_range_after_probe_failure():
    config = client_upload.ShareConfig(target_version="Ver.3.5.0B", date_from="2026-06-13", date_to="2026-06-13")
    probe = BattleFestivalProbeResult(None, "redirected", "festival probe redirected")

    plan = client_upload.battle_festival_collect_plan(config, probe, current_day=date(2026, 6, 14))

    assert plan.config is not None
    assert plan.source == "history_fallback"
    assert plan.upload_when_empty is False
    assert plan.config.mode_scope == MODE_SCOPE_BATTLE_FESTIVAL
    assert plan.config.date_from == "2026-06-13"
    assert plan.config.date_to == "2026-06-13"


def test_battle_festival_plan_fallback_skips_outside_recent_range_after_probe_failure():
    config = client_upload.ShareConfig(target_version="Ver.3.5.0B", date_from="2026-06-10", date_to="2026-06-11")
    probe = BattleFestivalProbeResult(None, "redirected", "festival probe redirected")

    plan = client_upload.battle_festival_collect_plan(config, probe, current_day=date(2026, 6, 14))

    assert plan.config is None
    assert plan.source == "outside_sync_window"


def test_sync_client_reports_battle_festival_probe_failure(tmp_path, monkeypatch):
    monkeypatch.setenv("EIKETSU_CLIENT_CONFIG_DIR", str(tmp_path / "client-config"))
    settings = _settings(tmp_path)
    save_client_config(
        settings,
        client_upload.ClientConfig(
            server_url="http://127.0.0.1:8000",
            api_token="token-secret",
            contributor="alice",
            user_public_id="u_test",
        ),
    )
    transport = _FakeTransport()
    progress = _FakeProgress()

    def fake_collect(settings, date_from, date_to, **kwargs):
        engine = make_engine(settings)
        Base.metadata.create_all(engine)
        return CollectResult(1, "completed", {"matches": 0}, [])

    monkeypatch.setattr(client_upload, "collect_follow", fake_collect)
    monkeypatch.setattr(
        client_upload,
        "probe_battle_festival_period",
        lambda *args, **kwargs: BattleFestivalProbeResult(
            None,
            "auth_failed",
            "战祭探测失败：当前登录态无效，请保持程序打开的登录窗口",
        ),
    )

    result = sync_client(settings, interactive_auth=False, transport=transport, progress=progress)

    assert result.battle_festival_upload is None
    assert any("登录态无效" in message for message in progress.messages)
    assert any("保持" in message for message in progress.messages)
    assert any("battle_festival 采集未启动" in message for message in progress.messages)
    assert len(transport.upload_payloads) == 1
    manifest = json.loads(transport.upload_payloads[0]["package_text"].splitlines()[0])
    assert manifest["mode_scope"] == MODE_SCOPE_TIER_LIST


def test_sync_client_fallback_uses_history_daily_when_festival_probe_redirects(tmp_path, monkeypatch):
    monkeypatch.setenv("EIKETSU_CLIENT_CONFIG_DIR", str(tmp_path / "client-config"))
    settings = _settings(tmp_path)
    save_client_config(
        settings,
        client_upload.ClientConfig(
            server_url="http://127.0.0.1:8000",
            api_token="token-secret",
            contributor="alice",
            user_public_id="u_test",
        ),
    )
    transport = _FakeTransport()
    progress = _FakeProgress()
    battle_mode = "\u6226\u796d\u308a"
    tier_mode = "\u5168\u56fd\u5bfe\u6226"

    class FakeMember:
        def fetch_text(self, url, referer=None):
            return f"<html>{url}</html>", url

    def fake_daily(html, url, base_url, iso_date, player):
        day_key = iso_date.replace("-", "")
        return [
            {
                "detail_url": f"https://eiketsu-taisen.net/members/history/detail?f=586&d={day_key}01",
                "follow_id": "586",
                "mode": tier_mode,
                "played_at": f"{iso_date} 10:00",
            },
            {
                "detail_url": f"https://eiketsu-taisen.net/members/history/detail?f=586&d={day_key}02",
                "follow_id": "586",
                "mode": battle_mode,
                "played_at": f"{iso_date} 11:00",
            },
        ]

    def fake_detail(html, url, base_url, seed):
        mode = str(seed["mode"])
        replay_prefix = "battle" if mode == battle_mode else "tier"
        return _detail_for(
            mode,
            "Ver.battle",
            str(seed["detail_url"]),
            f"{replay_prefix}-{seed['played_at']}",
            str(seed["played_at"]),
        )

    monkeypatch.setattr(
        client_upload,
        "probe_battle_festival_period",
        lambda *args, **kwargs: BattleFestivalProbeResult(None, "redirected", "festival probe redirected"),
    )
    monkeypatch.setattr(client_upload, "today_jst", lambda: date(2026, 6, 13))
    monkeypatch.setattr(collector, "create_member_session", lambda *args, **kwargs: FakeMember())
    monkeypatch.setattr(collector, "parse_follow_html", lambda html, url, base_url: [{"follow_id": "586", "name": "A"}])
    monkeypatch.setattr(collector, "parse_follow_api_json", lambda payload, base_url: [])
    monkeypatch.setattr(collector, "parse_daily_html", fake_daily)
    monkeypatch.setattr(collector, "parse_detail_html", fake_detail)

    result = sync_client(
        settings,
        interactive_auth=False,
        transport=transport,
        target_version="Ver.battle",
        progress=progress,
    )

    assert result.battle_festival_upload is not None
    assert len(transport.upload_payloads) == 2
    battle_lines = [json.loads(line) for line in transport.upload_payloads[0]["package_text"].splitlines()]
    tier_lines = [json.loads(line) for line in transport.upload_payloads[1]["package_text"].splitlines()]
    assert battle_lines[0]["mode_scope"] == MODE_SCOPE_BATTLE_FESTIVAL
    assert battle_lines[0]["festival_date_from"] == "2026-06-11"
    assert battle_lines[0]["festival_date_to"] == "2026-06-13"
    assert battle_lines[0]["match_count"] == 3
    assert all(record["mode"] == battle_mode for record in battle_lines[1:])
    assert tier_lines[0]["mode_scope"] == MODE_SCOPE_TIER_LIST
    assert all(record["mode"] == tier_mode for record in tier_lines[1:])
    assert any("history_fallback" in message for message in progress.messages)
    assert any("戦祭り seeds 3" in message for message in progress.messages)
    assert any("battle_festival 上传场数：3" in message for message in progress.messages)

    engine = make_engine(settings)
    with Session(engine) as session:
        runs = session.query(CollectionRun).order_by(CollectionRun.id).all()
        assert any(run.scope_json.get("mode_scope") == MODE_SCOPE_BATTLE_FESTIVAL for run in runs)
        assert session.query(Match).filter_by(mode=battle_mode).count() == 3


def test_sync_client_continues_tier_list_when_battle_festival_collect_fails(tmp_path, monkeypatch):
    monkeypatch.setenv("EIKETSU_CLIENT_CONFIG_DIR", str(tmp_path / "client-config"))
    settings = _settings(tmp_path)
    save_client_config(
        settings,
        client_upload.ClientConfig(
            server_url="http://127.0.0.1:8000",
            api_token="token-secret",
            contributor="alice",
            user_public_id="u_test",
        ),
    )
    transport = _FakeTransport()
    progress = _FakeProgress()
    tier_mode = "\u5168\u56fd\u5bfe\u6226"
    calls = 0

    def fake_collect(settings, date_from, date_to, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("battle collect failed")
        engine = make_engine(settings)
        Base.metadata.create_all(engine)
        with Session(engine) as session:
            repo = EnvRepository(session, settings)
            repo.upsert_match_detail(
                _detail_for(
                    tier_mode,
                    "Ver.battle",
                    "https://eiketsu-taisen.net/members/history/detail?f=586&d=tier",
                    "tier-after-battle-failure",
                    "2026-06-12 10:00",
                )
            )
            session.commit()
        return CollectResult(2, "completed", {"matches": 1}, [])

    monkeypatch.setattr(client_upload, "collect_follow", fake_collect)
    monkeypatch.setattr(
        client_upload,
        "probe_battle_festival_period",
        lambda *args, **kwargs: BattleFestivalProbeResult(
            BattleFestivalPeriod("2026-06-11", "2026-06-13"),
            "active",
            "festival active",
        ),
    )
    monkeypatch.setattr(client_upload, "today_jst", lambda: date(2026, 6, 12))

    result = sync_client(settings, interactive_auth=False, transport=transport, target_version="Ver.battle", progress=progress)

    assert result.battle_festival_upload is None
    assert result.upload["status"] == "completed"
    assert calls == 2
    assert any("battle_festival 采集失败" in message for message in progress.messages)
    assert len(transport.upload_payloads) == 1
    manifest = json.loads(transport.upload_payloads[0]["package_text"].splitlines()[0])
    assert manifest["mode_scope"] == MODE_SCOPE_TIER_LIST


def test_fetch_client_share_config_can_request_target_version(tmp_path, monkeypatch):
    monkeypatch.setenv("EIKETSU_CLIENT_CONFIG_DIR", str(tmp_path / "client-config"))
    settings = _settings(tmp_path)
    save_client_config(
        settings,
        client_upload.ClientConfig(
            server_url="http://127.0.0.1:8000",
            api_token="token-secret",
            contributor="alice",
            user_public_id="u_test",
        ),
    )
    transport = _FakeTransport()

    config = fetch_client_share_config(settings, transport=transport, target_version="Ver.old")
    state = fetch_client_share_config_state(settings, transport=transport, target_version="Ver.old")

    assert config.target_version == "Ver.old"
    assert config.date_from == "2026-04-22"
    assert config.date_to == "2026-05-19"
    assert config.include_battle_festival is False
    assert state.current_target_version == "Ver.client"
    assert state.available_target_versions == ["Ver.client", "Ver.old"]
    assert transport.calls[-2][1].endswith("/api/v1/config?target_version=Ver.old")


def test_client_date_override_rejects_date_before_effective_start():
    config = client_upload.ShareConfig(
        target_version="Ver.client",
        date_from="2026-05-10",
        date_to="2026-05-12",
        include_battle_festival=True,
    )

    assert minimum_client_date_from(config) == "2026-05-10"
    effective = apply_client_date_override(config, date_from="2026-05-11", date_to="2026-05-12")
    assert effective.date_from == "2026-05-11"
    assert effective.include_battle_festival is True
    clamped = apply_client_date_override(config, date_from="2026-05-11", date_to="2026-05-20")
    assert clamped.date_to == "2026-05-12"

    try:
        apply_client_date_override(config, date_from="2026-05-01", date_to="2026-05-09")
    except ValueError as exc:
        assert "结束日期不能早于起始日期 2026-05-10" in str(exc)
    else:
        raise AssertionError("date_to before version start should fail")


def test_client_date_window_prefers_server_config_for_known_version():
    config = client_upload.ShareConfig(target_version="Ver.3.5.0B", date_from="2026-05-27", date_to="2026-06-01")

    assert minimum_client_date_from(config) == "2026-05-27"
    effective = apply_client_date_override(config, date_from="", date_to="")

    assert effective.date_from == "2026-05-27"
    assert effective.date_to == "2026-06-01"


def test_cleanup_raw_snapshots_removes_files_and_rows(tmp_path):
    settings = _settings(tmp_path)
    raw_file = settings.raw_dir / "2026-05-10" / "detail" / "sample.html"
    raw_file.parent.mkdir(parents=True)
    raw_file.write_text("<html>raw</html>", encoding="utf-8")
    engine = make_engine(settings)
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(
            RawSnapshot(
                source_kind="detail",
                source_url="https://example.test/detail",
                local_path=str(raw_file),
                content_hash="abc",
                parser_version="test",
            )
        )
        session.commit()

    result = cleanup_raw_snapshots(settings)

    assert result.files_removed == 1
    assert result.bytes_removed > 0
    assert result.rows_removed == 1
    assert settings.raw_dir.exists() is False
    with Session(engine) as session:
        assert session.query(RawSnapshot).count() == 0


def test_check_client_update_uses_server_update_endpoint(tmp_path, monkeypatch):
    monkeypatch.setenv("EIKETSU_CLIENT_CONFIG_DIR", str(tmp_path / "client-config"))
    settings = _settings(tmp_path)
    save_client_config(
        settings,
        client_upload.ClientConfig(
            server_url="http://127.0.0.1:8000",
            api_token="token-secret",
            contributor="alice",
            user_public_id="u_test",
        ),
    )
    transport = _FakeTransport()

    result = check_client_update(settings, current_version="0.1.1", transport=transport)

    assert result.update_available is True
    assert result.latest_version == "0.1.2"
    assert transport.calls[-1][1].endswith("/api/v1/client/update?current_version=0.1.1")


class _FakeProgress:
    def __init__(self) -> None:
        self.messages: list[str] = []

    def message(self, text: str) -> None:
        self.messages.append(text)

    def task(self, label: str, total: int):
        return _FakeTask(label, total)


class _FakeTask:
    def __init__(self, label: str, total: int) -> None:
        self.label = label
        self.total = total
        self.advanced = 0

    def advance(self, suffix: str = "") -> None:
        self.advanced += 1

    def finish(self, suffix: str = "") -> None:
        return None


class _FakeTransport:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict[str, Any] | None, str]] = []
        self.upload_payload: dict[str, Any] | None = None
        self.upload_payloads: list[dict[str, Any]] = []

    def request_json(self, method: str, url: str, payload: dict[str, Any] | None = None, token: str = "") -> dict[str, Any]:
        self.calls.append((method, url, payload, token))
        if url.endswith("/api/v1/auth/bind-invite"):
            return {"api_token": "token-secret", "token_prefix": "token-se", "user_public_id": "u_test"}
        if url.endswith("/api/v1/config"):
            return {
                "configured": True,
                "schema_version": "share_v1",
                "target_version": "Ver.client",
                "date_from": "2026-05-10",
                "date_to": "2026-05-12",
                "current_target_version": "Ver.client",
                "available_target_versions": ["Ver.client", "Ver.old"],
                "include_solo": False,
                "high_ranker_rank": 100,
                "report_formats": ["md"],
                "reports": ["overview"],
            }
        if url.endswith("/api/v1/config?target_version=Ver.old"):
            return {
                "configured": True,
                "schema_version": "share_v1",
                "target_version": "Ver.old",
                "date_from": "2026-04-22",
                "date_to": "2026-05-19",
                "current_target_version": "Ver.client",
                "available_target_versions": ["Ver.client", "Ver.old"],
                "include_solo": False,
                "high_ranker_rank": 100,
                "report_formats": ["md"],
                "reports": ["overview"],
            }
        if url.endswith("/api/v1/config?target_version=Ver.battle"):
            return {
                "configured": True,
                "schema_version": "share_v1",
                "target_version": "Ver.battle",
                "date_from": "2026-06-10",
                "date_to": "2026-06-14",
                "current_target_version": "Ver.client",
                "available_target_versions": ["Ver.client", "Ver.battle"],
                "include_solo": False,
                "include_battle_festival": True,
                "high_ranker_rank": 100,
                "report_formats": ["md"],
                "reports": ["overview"],
            }
        if url.endswith("/api/v1/uploads"):
            self.upload_payload = payload
            if payload is not None:
                self.upload_payloads.append(payload)
            assert token == "token-secret"
            return {
                "upload_id": 1,
                "package_id": "pkg",
                "content_hash": payload["content_hash"] if payload else "",
                "status": "completed",
                "match_count": 1,
                "imported_match_count": 1,
                "already_uploaded": False,
                "errors": [],
            }
        if "/api/v1/client/update?" in url:
            return {
                "configured": True,
                "current_version": "0.1.1",
                "latest_version": "0.1.2",
                "update_available": True,
                "download_url": "http://127.0.0.1:8000/downloads/EiketsuCollector_0.1.2.exe",
                "download_name": "EiketsuCollector_0.1.2.exe",
                "size_bytes": 123,
                "sha256": "abc",
                "notes": "test update",
                "published_at": "2026-05-16T00:00:00+00:00",
            }
        raise AssertionError(url)
