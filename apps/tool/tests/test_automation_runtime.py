from __future__ import annotations

import threading
import time
from datetime import datetime
from types import SimpleNamespace

from eiketsu_env.config import Settings
from eiketsu_env.services import automation_runtime
from eiketsu_env.services.auto_tasks import (
    AutoTaskConfig,
    AutoTaskState,
    load_auto_task_state,
    save_auto_task_config,
    save_auto_task_state,
)
from eiketsu_env.services.battle_festival import BattleFestivalPeriod, BattleFestivalProbeResult
from eiketsu_env.services.client_lock import ClientSyncBusyError
from eiketsu_env.utils import JST


def _settings(tmp_path) -> Settings:
    return Settings(root_dir=tmp_path, db_url=f"sqlite:///{tmp_path / 'test.db'}")


def _now(value: str) -> datetime:
    return datetime.fromisoformat(value).replace(tzinfo=JST)


def _configure_paths(tmp_path, monkeypatch) -> Settings:
    monkeypatch.setenv("APPDATA", str(tmp_path / "appdata"))
    monkeypatch.delenv("EIKETSU_ENV_ROOT", raising=False)
    monkeypatch.delenv("EIKETSU_CLIENT_RUNTIME_ROOT", raising=False)
    return _settings(tmp_path)


def test_daily_job_updates_only_effective_completed_date(tmp_path, monkeypatch):
    settings = _configure_paths(tmp_path, monkeypatch)
    save_auto_task_config(
        settings,
        AutoTaskConfig(enabled=True, daily_enabled=True, daily_time_jst="05:30"),
    )
    seen = {}
    monkeypatch.setattr(automation_runtime, "doctor_browser", lambda *args, **kwargs: {"ok": True})

    def fake_sync(*args, **kwargs):
        seen.update(kwargs)
        return SimpleNamespace(
            effective_date_from="2026-07-17",
            effective_date_to="2026-07-17",
            collect_result=SimpleNamespace(status="completed"),
        )

    monkeypatch.setattr(automation_runtime, "sync_client", fake_sync)

    outcome = automation_runtime.run_auto_task_once(
        settings,
        now=_now("2026-07-18T05:30:00"),
    )

    assert outcome.status == "completed"
    assert outcome.job is not None and outcome.job.kind == "daily"
    assert seen["date_from"] == "2026-07-17"
    assert seen["date_to"] == "2026-07-17"
    state = load_auto_task_state(settings)
    assert state.last_daily_completed_date == "2026-07-17"
    assert state.last_status == "completed"


def test_auth_failure_pauses_future_jobs(tmp_path, monkeypatch):
    settings = _configure_paths(tmp_path, monkeypatch)
    save_auto_task_config(
        settings,
        AutoTaskConfig(enabled=True, daily_enabled=True, daily_time_jst="05:30"),
    )
    monkeypatch.setattr(automation_runtime, "doctor_browser", lambda *args, **kwargs: {"ok": False})

    outcome = automation_runtime.run_auto_task_once(
        settings,
        now=_now("2026-07-18T06:00:00"),
    )

    assert outcome.status == "auth_required"
    state = load_auto_task_state(settings)
    assert state.auth_required is True
    assert state.last_error == "需要重新登录英杰大战.NET"
    assert automation_runtime.run_auto_task_once(
        settings,
        now=_now("2026-07-18T07:00:00"),
    ).status == "idle"


def test_festival_job_uses_festival_only_entry(tmp_path, monkeypatch):
    settings = _configure_paths(tmp_path, monkeypatch)
    save_auto_task_config(
        settings,
        AutoTaskConfig(enabled=True, festival_enabled=True),
    )
    save_auto_task_state(
        settings,
        AutoTaskState(
            festival_period_from="2026-07-18",
            festival_period_to="2026-07-20",
            festival_target_version="Ver.event",
            festival_checked_at="2026-07-18T09:00:00+09:00",
        ),
    )
    probe = BattleFestivalProbeResult(
        BattleFestivalPeriod("2026-07-18", "2026-07-20"),
        "active",
        "festival active",
    )
    seen = {}
    monkeypatch.setattr(automation_runtime, "doctor_browser", lambda *args, **kwargs: {"ok": True})

    def fake_battle(*args, **kwargs):
        seen.update(kwargs)
        return SimpleNamespace(
            probe=probe,
            collect_result=SimpleNamespace(status="completed"),
            plan=SimpleNamespace(config=SimpleNamespace(date_from="2026-07-18", date_to="2026-07-18")),
        )

    monkeypatch.setattr(automation_runtime, "sync_battle_festival_client", fake_battle)
    monkeypatch.setattr(
        automation_runtime,
        "sync_client",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("festival 不应运行 TierList")),
    )

    outcome = automation_runtime.run_auto_task_once(
        settings,
        now=_now("2026-07-18T10:00:00"),
    )

    assert outcome.status == "completed"
    assert outcome.job is not None and outcome.job.kind == "festival"
    assert seen["active_only"] is True
    assert seen["period_override"] == BattleFestivalPeriod("2026-07-18", "2026-07-20")
    assert seen["target_version"] == "Ver.event"
    state = load_auto_task_state(settings)
    assert state.last_festival_success_at == "2026-07-18T10:00:00+09:00"
    assert state.festival_checked_at == "2026-07-18T09:00:00+09:00"


def test_probe_updates_cached_official_period(tmp_path, monkeypatch):
    settings = _configure_paths(tmp_path, monkeypatch)
    save_auto_task_config(
        settings,
        AutoTaskConfig(enabled=True, festival_enabled=True),
    )
    probe = BattleFestivalProbeResult(
        BattleFestivalPeriod("2026-07-18", "2026-07-20"),
        "active",
        "festival active",
    )
    monkeypatch.setattr(automation_runtime, "probe_battle_festival_period", lambda *args, **kwargs: probe)
    monkeypatch.setattr(
        automation_runtime,
        "fetch_client_share_config_state",
        lambda *args, **kwargs: SimpleNamespace(
            config=SimpleNamespace(
                target_version="Ver.event",
                date_from="2026-07-01",
                date_to="2026-07-31",
            ),
            available_target_versions=["Ver.event"],
        ),
    )

    outcome = automation_runtime.run_auto_task_once(
        settings,
        now=_now("2026-07-18T08:00:00"),
    )

    assert outcome.status == "completed"
    assert outcome.job is not None and outcome.job.kind == "festival_probe"
    state = load_auto_task_state(settings)
    assert state.festival_period_from == "2026-07-18"
    assert state.festival_period_to == "2026-07-20"
    assert state.festival_target_version == "Ver.event"
    assert state.festival_checked_at == "2026-07-18T08:00:00+09:00"


def test_probe_resolves_previous_version_that_covers_detected_period(tmp_path, monkeypatch):
    settings = _configure_paths(tmp_path, monkeypatch)
    save_auto_task_config(settings, AutoTaskConfig(enabled=True, festival_enabled=True))
    probe = BattleFestivalProbeResult(
        BattleFestivalPeriod("2026-06-28", "2026-06-30"),
        "inactive",
        "previous festival",
    )
    requested: list[str] = []
    monkeypatch.setattr(automation_runtime, "probe_battle_festival_period", lambda *args, **kwargs: probe)
    monkeypatch.setattr(
        automation_runtime,
        "fetch_client_share_config_state",
        lambda *args, **kwargs: SimpleNamespace(
            config=SimpleNamespace(
                target_version="Ver.new",
                date_from="2026-07-01",
                date_to="2026-07-31",
            ),
            available_target_versions=["Ver.new", "Ver.old"],
        ),
    )

    def fake_config(*args, **kwargs):
        requested.append(kwargs["target_version"])
        return SimpleNamespace(
            target_version="Ver.old",
            date_from="2026-06-01",
            date_to="2026-06-30",
        )

    monkeypatch.setattr(automation_runtime, "fetch_client_share_config", fake_config)

    outcome = automation_runtime.run_auto_task_once(
        settings,
        now=_now("2026-07-02T08:00:00"),
    )

    assert outcome.status == "completed"
    assert requested == ["Ver.old"]
    state = load_auto_task_state(settings)
    assert state.festival_period_from == "2026-06-28"
    assert state.festival_period_to == "2026-06-30"
    assert state.festival_target_version == "Ver.old"


def test_busy_job_does_not_record_failure(tmp_path, monkeypatch):
    settings = _configure_paths(tmp_path, monkeypatch)
    save_auto_task_config(
        settings,
        AutoTaskConfig(enabled=True, daily_enabled=True),
    )
    monkeypatch.setattr(automation_runtime, "doctor_browser", lambda *args, **kwargs: {"ok": True})
    monkeypatch.setattr(
        automation_runtime,
        "sync_client",
        lambda *args, **kwargs: (_ for _ in ()).throw(ClientSyncBusyError("busy")),
    )

    outcome = automation_runtime.run_auto_task_once(
        settings,
        now=_now("2026-07-18T06:00:00"),
    )

    assert outcome.status == "busy"
    assert load_auto_task_state(settings).last_status == ""


def test_daily_completed_with_errors_advances_cursor_once(tmp_path, monkeypatch):
    settings = _configure_paths(tmp_path, monkeypatch)
    save_auto_task_config(settings, AutoTaskConfig(enabled=True, daily_enabled=True))
    monkeypatch.setattr(automation_runtime, "doctor_browser", lambda *args, **kwargs: {"ok": True})
    monkeypatch.setattr(
        automation_runtime,
        "sync_client",
        lambda *args, **kwargs: SimpleNamespace(
            effective_date_from="2026-07-17",
            effective_date_to="2026-07-17",
            collect_result=SimpleNamespace(
                status="completed_with_errors",
                counts={
                    "dates": 1,
                    "players": 1,
                    "daily_pages": 1,
                    "detail_candidates": 0,
                    "detail_pages": 0,
                    "existing_detail_skipped": 0,
                },
            ),
        ),
    )

    outcome = automation_runtime.run_auto_task_once(settings, now=_now("2026-07-18T06:00:00"))

    assert outcome.status == "completed"
    assert "有局部错误" in outcome.message
    assert load_auto_task_state(settings).last_daily_completed_date == "2026-07-17"
    assert automation_runtime.run_auto_task_once(
        settings,
        now=_now("2026-07-18T07:00:00"),
    ).status == "idle"


def test_daily_completed_with_errors_without_daily_evidence_keeps_pending_cursor(tmp_path, monkeypatch):
    settings = _configure_paths(tmp_path, monkeypatch)
    save_auto_task_config(settings, AutoTaskConfig(enabled=True, daily_enabled=True))
    monkeypatch.setattr(automation_runtime, "doctor_browser", lambda *args, **kwargs: {"ok": True})
    monkeypatch.setattr(
        automation_runtime,
        "sync_client",
        lambda *args, **kwargs: SimpleNamespace(
            effective_date_from="2026-07-17",
            effective_date_to="2026-07-17",
            collect_result=SimpleNamespace(
                status="completed_with_errors",
                counts={
                    "dates": 1,
                    "players": 2,
                    "daily_pages": 0,
                    "detail_candidates": 0,
                    "detail_pages": 0,
                    "existing_detail_skipped": 0,
                },
            ),
        ),
    )

    outcome = automation_runtime.run_auto_task_once(settings, now=_now("2026-07-18T06:00:00"))

    assert outcome.status == "failed"
    state = load_auto_task_state(settings)
    assert state.last_daily_completed_date == ""
    assert state.daily_pending_from == "2026-07-17"


def test_first_daily_failure_keeps_pending_start_across_days(tmp_path, monkeypatch):
    settings = _configure_paths(tmp_path, monkeypatch)
    save_auto_task_config(settings, AutoTaskConfig(enabled=True, daily_enabled=True))
    monkeypatch.setattr(automation_runtime, "doctor_browser", lambda *args, **kwargs: {"ok": True})
    monkeypatch.setattr(
        automation_runtime,
        "sync_client",
        lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("temporary")),
    )

    failed = automation_runtime.run_auto_task_once(settings, now=_now("2026-07-18T06:00:00"))

    assert failed.status == "failed"
    assert load_auto_task_state(settings).daily_pending_from == "2026-07-17"
    seen = {}

    def fake_sync(*args, **kwargs):
        seen.update(kwargs)
        return SimpleNamespace(
            effective_date_from=kwargs["date_from"],
            effective_date_to=kwargs["date_to"],
            collect_result=SimpleNamespace(status="completed"),
        )

    monkeypatch.setattr(automation_runtime, "sync_client", fake_sync)
    completed = automation_runtime.run_auto_task_once(settings, now=_now("2026-07-20T06:00:00"))

    assert completed.status == "completed"
    assert seen["date_from"] == "2026-07-17"
    assert seen["date_to"] == "2026-07-19"
    state = load_auto_task_state(settings)
    assert state.daily_pending_from == ""
    assert state.last_daily_completed_date == "2026-07-19"


def test_festival_final_uses_planned_historical_period(tmp_path, monkeypatch):
    settings = _configure_paths(tmp_path, monkeypatch)
    save_auto_task_config(settings, AutoTaskConfig(enabled=True, festival_enabled=True))
    save_auto_task_state(
        settings,
        AutoTaskState(
            festival_period_from="2026-07-15",
            festival_period_to="2026-07-17",
            festival_target_version="Ver.legacy",
            festival_checked_at="2026-07-17T20:00:00+09:00",
        ),
    )
    seen = {}
    monkeypatch.setattr(automation_runtime, "doctor_browser", lambda *args, **kwargs: {"ok": True})

    def fake_battle(*args, **kwargs):
        seen.update(kwargs)
        period = kwargs["period_override"]
        return SimpleNamespace(
            probe=BattleFestivalProbeResult(period, "cached_period", "cached"),
            collect_result=SimpleNamespace(status="completed"),
            plan=SimpleNamespace(config=SimpleNamespace(date_from=period.date_from, date_to=period.date_to)),
        )

    monkeypatch.setattr(automation_runtime, "sync_battle_festival_client", fake_battle)

    outcome = automation_runtime.run_auto_task_once(settings, now=_now("2026-07-18T05:30:00"))

    assert outcome.status == "completed"
    assert outcome.job is not None and outcome.job.kind == "festival_final"
    assert seen["active_only"] is False
    assert seen["period_override"] == BattleFestivalPeriod("2026-07-15", "2026-07-17")
    assert seen["target_version"] == "Ver.legacy"
    assert load_auto_task_state(settings).finalized_period_to == "2026-07-17"


def test_task_records_real_completion_time(tmp_path, monkeypatch):
    settings = _configure_paths(tmp_path, monkeypatch)
    save_auto_task_config(settings, AutoTaskConfig(enabled=True, daily_enabled=True))
    monkeypatch.setattr(automation_runtime, "doctor_browser", lambda *args, **kwargs: {"ok": True})
    monkeypatch.setattr(
        automation_runtime,
        "sync_client",
        lambda *args, **kwargs: SimpleNamespace(
            effective_date_from="2026-07-17",
            effective_date_to="2026-07-17",
            collect_result=SimpleNamespace(status="completed"),
        ),
    )

    automation_runtime.run_auto_task_once(
        settings,
        now=_now("2026-07-18T05:30:00"),
        clock=lambda: _now("2026-07-18T06:45:00"),
    )

    assert load_auto_task_state(settings).finished_at == "2026-07-18T06:45:00+09:00"


def test_failed_task_backoff_starts_when_task_finishes(tmp_path, monkeypatch):
    settings = _configure_paths(tmp_path, monkeypatch)
    save_auto_task_config(settings, AutoTaskConfig(enabled=True, daily_enabled=True))
    monkeypatch.setattr(automation_runtime, "doctor_browser", lambda *args, **kwargs: {"ok": True})
    monkeypatch.setattr(
        automation_runtime,
        "sync_client",
        lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("temporary")),
    )

    automation_runtime.run_auto_task_once(
        settings,
        now=_now("2026-07-18T05:30:00"),
        clock=lambda: _now("2026-07-18T06:45:00"),
    )

    state = load_auto_task_state(settings)
    assert state.finished_at == "2026-07-18T06:45:00+09:00"
    assert automation_runtime.run_auto_task_once(
        settings,
        now=_now("2026-07-18T07:14:00"),
    ).status == "idle"


def test_probe_auth_failure_pauses_scheduler(tmp_path, monkeypatch):
    settings = _configure_paths(tmp_path, monkeypatch)
    save_auto_task_config(settings, AutoTaskConfig(enabled=True, festival_enabled=True))
    monkeypatch.setattr(
        automation_runtime,
        "probe_battle_festival_period",
        lambda *args, **kwargs: BattleFestivalProbeResult(None, "auth_failed", "login expired"),
    )

    outcome = automation_runtime.run_auto_task_once(settings, now=_now("2026-07-18T08:00:00"))

    assert outcome.status == "auth_required"
    assert load_auto_task_state(settings).auth_required is True


def test_due_task_prepares_selected_browser_before_collection(tmp_path, monkeypatch):
    settings = _configure_paths(tmp_path, monkeypatch)
    save_auto_task_config(
        settings,
        AutoTaskConfig(enabled=True, daily_enabled=True, daily_time_jst="05:30", auth_source="chrome"),
    )
    calls: list[str] = []
    monkeypatch.setattr(
        automation_runtime,
        "doctor_browser",
        lambda *args, **kwargs: calls.append("doctor") or {"ok": True},
    )
    monkeypatch.setattr(
        automation_runtime,
        "sync_client",
        lambda *args, **kwargs: calls.append("sync")
        or SimpleNamespace(
            effective_date_from="2026-07-17",
            effective_date_to="2026-07-17",
            collect_result=SimpleNamespace(status="completed"),
        ),
    )

    outcome = automation_runtime.run_auto_task_once(
        settings,
        now=_now("2026-07-18T05:30:00"),
        prepare_browser=lambda source: calls.append(f"prepare:{source}"),
    )

    assert outcome.status == "completed"
    assert calls == ["prepare:chrome", "doctor", "sync"]


def test_idle_or_auth_paused_task_does_not_prepare_browser(tmp_path, monkeypatch):
    settings = _configure_paths(tmp_path, monkeypatch)
    save_auto_task_config(settings, AutoTaskConfig(enabled=False, daily_enabled=True))
    calls: list[str] = []

    assert automation_runtime.run_auto_task_once(
        settings,
        now=_now("2026-07-18T05:30:00"),
        prepare_browser=lambda source: calls.append(source),
    ).status == "idle"

    save_auto_task_config(settings, AutoTaskConfig(enabled=True, daily_enabled=True))
    save_auto_task_state(settings, AutoTaskState(auth_required=True))
    assert automation_runtime.run_auto_task_once(
        settings,
        now=_now("2026-07-18T05:30:00"),
        prepare_browser=lambda source: calls.append(source),
    ).status == "idle"
    assert calls == []


def test_browser_prepare_failure_pauses_due_task(tmp_path, monkeypatch):
    settings = _configure_paths(tmp_path, monkeypatch)
    save_auto_task_config(settings, AutoTaskConfig(enabled=True, daily_enabled=True, daily_time_jst="05:30"))

    outcome = automation_runtime.run_auto_task_once(
        settings,
        now=_now("2026-07-18T05:30:00"),
        prepare_browser=lambda _source: (_ for _ in ()).throw(
            automation_runtime.BrowserAuthError("browser unavailable")
        ),
    )

    assert outcome.status == "auth_required"
    assert load_auto_task_state(settings).auth_required is True


def test_scheduler_restarts_after_stop_times_out_during_long_task(tmp_path, monkeypatch):
    settings = _settings(tmp_path)
    first_started = threading.Event()
    release_first = threading.Event()
    second_started = threading.Event()
    calls = 0

    def fake_run(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            first_started.set()
            release_first.wait(2)
        else:
            second_started.set()
        return automation_runtime.AutoTaskOutcome("idle")

    monkeypatch.setattr(automation_runtime, "run_auto_task_once", fake_run)
    scheduler = automation_runtime.AutoTaskScheduler(settings, poll_seconds=1)

    scheduler.start()
    assert first_started.wait(1)
    scheduler.stop(timeout=0.01)
    assert scheduler.running is True
    scheduler.start()
    release_first.set()

    assert second_started.wait(1)
    deadline = time.monotonic() + 1
    while not scheduler.running and time.monotonic() < deadline:
        time.sleep(0.01)
    assert scheduler.running is True
    scheduler.stop()
