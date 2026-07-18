import json
from datetime import datetime

import pytest

from eiketsu_env import config as app_config
from eiketsu_env.config import Settings
from eiketsu_env.services.auto_tasks import (
    AutoTaskConfig,
    AutoTaskState,
    auto_task_config_path,
    auto_task_state_path,
    load_auto_task_config,
    load_auto_task_state,
    plan_next_auto_task,
    save_auto_task_config,
    save_auto_task_state,
)
from eiketsu_env.utils import JST


def _settings(tmp_path) -> Settings:
    return Settings(root_dir=tmp_path, db_url=f"sqlite:///{tmp_path / 'test.db'}")


def _daily_config(**overrides) -> AutoTaskConfig:
    values = {
        "enabled": True,
        "daily_enabled": True,
        "daily_time_jst": "05:30",
    }
    values.update(overrides)
    return AutoTaskConfig(**values)


def _festival_config(**overrides) -> AutoTaskConfig:
    values = {
        "enabled": True,
        "festival_enabled": True,
        "festival_interval_minutes": 30,
    }
    values.update(overrides)
    return AutoTaskConfig(**values)


def _now(value: str) -> datetime:
    return datetime.fromisoformat(value).replace(tzinfo=JST)


def test_config_validates_times_interval_and_enabled_jobs():
    with pytest.raises(ValueError, match="HH:MM"):
        AutoTaskConfig(daily_time_jst="5:30").validate()
    with pytest.raises(ValueError, match="30 到 360"):
        AutoTaskConfig(festival_interval_minutes=29).validate()
    with pytest.raises(ValueError, match="30 到 360"):
        AutoTaskConfig(festival_interval_minutes=361).validate()
    with pytest.raises(ValueError, match="至少启用一个任务"):
        AutoTaskConfig(enabled=True).validate()
    with pytest.raises(ValueError, match="不能晚于"):
        AutoTaskConfig(
            festival_window_from_jst="20:00",
            festival_window_to_jst="10:00",
        ).validate()


def test_config_and_state_use_app_data_paths_and_round_trip_atomically(tmp_path, monkeypatch):
    app_data = tmp_path / "app-data"
    monkeypatch.setattr(app_config, "client_app_data_dir", lambda: app_data, raising=False)
    settings = _settings(tmp_path)
    replace_calls = []
    original_replace = __import__("os").replace

    def recording_replace(source, target):
        replace_calls.append((source, target))
        original_replace(source, target)

    monkeypatch.setattr("eiketsu_env.services.auto_tasks.os.replace", recording_replace)
    config = _festival_config(start_with_windows=True, auth_source="edge")
    state = AutoTaskState(
        festival_period_from="2026-07-18",
        festival_period_to="2026-07-20",
        festival_target_version="Ver.event",
        festival_checked_at="2026-07-18T09:00:00+09:00",
        last_status="success",
    )

    assert save_auto_task_config(settings, config) == auto_task_config_path(settings)
    assert save_auto_task_state(settings, state) == auto_task_state_path(settings)
    assert load_auto_task_config(settings) == config
    assert load_auto_task_state(settings) == state
    assert len(replace_calls) == 2
    assert list(app_data.glob("*.tmp")) == []
    assert json.loads(auto_task_config_path(settings).read_text(encoding="utf-8"))["auth_source"] == "edge"


def test_missing_files_load_disabled_defaults(tmp_path, monkeypatch):
    monkeypatch.setattr(app_config, "client_app_data_dir", lambda: tmp_path, raising=False)
    settings = _settings(tmp_path)

    assert load_auto_task_config(settings) == AutoTaskConfig()
    assert load_auto_task_state(settings) == AutoTaskState()


def test_daily_waits_until_configured_time_and_first_run_only_collects_yesterday():
    config = _daily_config()
    state = AutoTaskState()

    assert plan_next_auto_task(config, state, _now("2026-07-18T05:29:59")) is None

    run = plan_next_auto_task(config, state, _now("2026-07-18T05:30:00"))

    assert run is not None
    assert (run.kind, run.date_from, run.date_to) == ("daily", "2026-07-17", "2026-07-17")
    assert run.scheduled_for == "2026-07-18T05:30:00+09:00"


def test_daily_combines_missed_dates_and_stops_at_jst_yesterday():
    config = _daily_config()
    state = AutoTaskState(last_daily_completed_date="2026-07-14")

    run = plan_next_auto_task(config, state, _now("2026-07-18T08:00:00"))

    assert run is not None
    assert (run.kind, run.date_from, run.date_to) == ("daily", "2026-07-15", "2026-07-17")

    state.last_daily_completed_date = "2026-07-17"
    assert plan_next_auto_task(config, state, _now("2026-07-18T08:00:00")) is None


def test_auth_required_and_disabled_config_do_not_schedule():
    now = _now("2026-07-18T12:00:00")

    assert plan_next_auto_task(_daily_config(), AutoTaskState(auth_required=True), now) is None
    assert plan_next_auto_task(AutoTaskConfig(), AutoTaskState(), now) is None


def test_active_festival_uses_completion_time_plus_interval():
    config = _festival_config()
    state = AutoTaskState(
        festival_period_from="2026-07-18",
        festival_period_to="2026-07-20",
        festival_target_version="Ver.event",
        last_festival_success_at="2026-07-18T12:00:00+09:00",
        festival_checked_at="2026-07-18T12:00:00+09:00",
    )

    assert plan_next_auto_task(config, state, _now("2026-07-18T12:29:59")) is None

    run = plan_next_auto_task(config, state, _now("2026-07-18T12:30:00"))

    assert run is not None
    assert (run.kind, run.date_from, run.date_to) == ("festival", "2026-07-18", "2026-07-20")
    assert run.scheduled_for == "2026-07-18T12:30:00+09:00"
    assert run.target_version == "Ver.event"


def test_festival_only_runs_inside_configured_window():
    config = _festival_config()
    state = AutoTaskState(
        festival_period_from="2026-07-18",
        festival_period_to="2026-07-20",
        festival_checked_at="2026-07-18T09:00:00+09:00",
    )

    assert plan_next_auto_task(config, state, _now("2026-07-18T09:59:59")) is None
    assert plan_next_auto_task(config, state, _now("2026-07-18T10:00:00")).kind == "festival"
    assert plan_next_auto_task(config, state, _now("2026-07-18T23:59:30")).kind == "festival"
    assert plan_next_auto_task(config, state, _now("2026-07-19T00:00:00")).kind == "festival_probe"


def test_final_runs_once_on_day_after_period_at_daily_time():
    config = _festival_config(daily_time_jst="05:30")
    state = AutoTaskState(
        festival_period_from="2026-07-18",
        festival_period_to="2026-07-20",
        festival_target_version="Ver.event",
        festival_checked_at="2026-07-21T00:00:00+09:00",
    )

    assert plan_next_auto_task(config, state, _now("2026-07-21T05:29:59")) is None

    run = plan_next_auto_task(config, state, _now("2026-07-21T05:30:00"))

    assert run is not None
    assert (run.kind, run.date_from, run.date_to) == ("festival_final", "2026-07-18", "2026-07-20")
    assert run.target_version == "Ver.event"

    state.finalized_period_to = "2026-07-20"
    assert plan_next_auto_task(config, state, _now("2026-07-21T05:30:00")) is None


def test_probe_runs_initially_and_after_six_hours_without_repeating_early():
    config = _festival_config()

    first = plan_next_auto_task(config, AutoTaskState(), _now("2026-07-18T08:00:00"))
    assert first is not None
    assert first.kind == "festival_probe"

    state = AutoTaskState(festival_checked_at="2026-07-18T08:00:00+09:00")
    assert plan_next_auto_task(config, state, _now("2026-07-18T13:59:59")) is None
    assert plan_next_auto_task(config, state, _now("2026-07-18T14:00:00")).kind == "festival_probe"


def test_due_festival_has_priority_over_stale_probe():
    config = _festival_config()
    state = AutoTaskState(
        festival_period_from="2026-07-18",
        festival_period_to="2026-07-20",
        last_festival_success_at="2026-07-18T10:00:00+09:00",
        festival_checked_at="2026-07-18T01:00:00+09:00",
    )

    run = plan_next_auto_task(config, state, _now("2026-07-18T12:00:00"))

    assert run is not None
    assert run.kind == "festival"


def test_daily_has_priority_over_festival_final():
    config = AutoTaskConfig(
        enabled=True,
        daily_enabled=True,
        festival_enabled=True,
        daily_time_jst="05:30",
    )
    state = AutoTaskState(
        last_daily_completed_date="2026-07-19",
        festival_period_from="2026-07-18",
        festival_period_to="2026-07-20",
        festival_checked_at="2026-07-20T23:00:00+09:00",
    )

    run = plan_next_auto_task(config, state, _now("2026-07-21T06:00:00"))

    assert run is not None
    assert run.kind == "daily"
