"""自动任务配置、运行状态与纯调度规则。"""

from __future__ import annotations

import json
import os
import re
import tempfile
from dataclasses import asdict, dataclass
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Any, Literal

from eiketsu_env import config as app_config
from eiketsu_env.config import Settings
from eiketsu_env.utils import JST


AUTO_TASK_CONFIG_FILE = "auto_task_config.json"
AUTO_TASK_STATE_FILE = "auto_task_state.json"
AUTO_TASK_SCHEMA_VERSION = 1
FESTIVAL_PROBE_INTERVAL = timedelta(hours=6)
AUTO_TASK_KINDS = ("daily", "festival", "festival_final", "festival_probe")

AutoTaskKind = Literal["daily", "festival", "festival_final", "festival_probe"]

_TIME_PATTERN = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")


@dataclass(slots=True)
class AutoTaskConfig:
    schema_version: int = AUTO_TASK_SCHEMA_VERSION
    enabled: bool = False
    daily_enabled: bool = False
    daily_time_jst: str = "05:30"
    festival_enabled: bool = False
    festival_interval_minutes: int = 30
    festival_window_from_jst: str = "10:00"
    festival_window_to_jst: str = "23:59"
    start_with_windows: bool = False
    auth_source: str = "auto"

    def validate(self) -> None:
        if self.schema_version != AUTO_TASK_SCHEMA_VERSION:
            raise ValueError(f"不支持的自动任务配置版本：{self.schema_version}")
        for field_name in ("enabled", "daily_enabled", "festival_enabled", "start_with_windows"):
            if not isinstance(getattr(self, field_name), bool):
                raise ValueError(f"{field_name} 必须是布尔值")
        _parse_clock(self.daily_time_jst, "daily_time_jst")
        window_from = _parse_clock(self.festival_window_from_jst, "festival_window_from_jst")
        window_to = _parse_clock(self.festival_window_to_jst, "festival_window_to_jst")
        if window_from > window_to:
            raise ValueError("festival_window_from_jst 不能晚于 festival_window_to_jst")
        if isinstance(self.festival_interval_minutes, bool) or not isinstance(self.festival_interval_minutes, int):
            raise ValueError("festival_interval_minutes 必须是整数")
        if not 30 <= self.festival_interval_minutes <= 360:
            raise ValueError("festival_interval_minutes 必须在 30 到 360 分钟之间")
        if self.enabled and not (self.daily_enabled or self.festival_enabled):
            raise ValueError("启用自动任务时必须至少启用一个任务")
        if not isinstance(self.auth_source, str) or not self.auth_source.strip():
            raise ValueError("auth_source 不能为空")


@dataclass(slots=True)
class AutoTaskState:
    schema_version: int = AUTO_TASK_SCHEMA_VERSION
    last_daily_completed_date: str = ""
    daily_pending_from: str = ""
    festival_period_from: str = ""
    festival_period_to: str = ""
    festival_target_version: str = ""
    last_festival_success_at: str = ""
    festival_checked_at: str = ""
    finalized_period_to: str = ""
    last_job_kind: str = ""
    last_status: str = ""
    last_error: str = ""
    finished_at: str = ""
    auth_required: bool = False

    def validate(self) -> None:
        if self.schema_version != AUTO_TASK_SCHEMA_VERSION:
            raise ValueError(f"不支持的自动任务状态版本：{self.schema_version}")
        if not isinstance(self.auth_required, bool):
            raise ValueError("auth_required 必须是布尔值")
        if not isinstance(self.festival_target_version, str):
            raise ValueError("festival_target_version 必须是字符串")

        for field_name in ("last_daily_completed_date", "daily_pending_from", "finalized_period_to"):
            value = getattr(self, field_name)
            if value:
                _parse_date(value, field_name)

        period_from = _parse_optional_date(self.festival_period_from, "festival_period_from")
        period_to = _parse_optional_date(self.festival_period_to, "festival_period_to")
        if (period_from is None) != (period_to is None):
            raise ValueError("festival_period_from 与 festival_period_to 必须同时存在")
        if period_from is not None and period_to is not None and period_from > period_to:
            raise ValueError("festival_period_from 不能晚于 festival_period_to")

        for field_name in ("last_festival_success_at", "festival_checked_at", "finished_at"):
            value = getattr(self, field_name)
            if value:
                _parse_datetime(value, field_name)
        if self.last_job_kind and self.last_job_kind not in AUTO_TASK_KINDS:
            raise ValueError(f"未知的自动任务类型：{self.last_job_kind}")


@dataclass(frozen=True, slots=True)
class AutoTaskRun:
    kind: AutoTaskKind
    date_from: str = ""
    date_to: str = ""
    scheduled_for: str = ""
    target_version: str = ""


def auto_task_config_path(settings: Settings) -> Path:
    return app_config.client_app_data_dir() / AUTO_TASK_CONFIG_FILE


def auto_task_state_path(settings: Settings) -> Path:
    return app_config.client_app_data_dir() / AUTO_TASK_STATE_FILE


def load_auto_task_config(settings: Settings) -> AutoTaskConfig:
    path = auto_task_config_path(settings)
    if not path.is_file():
        return AutoTaskConfig()
    config = AutoTaskConfig(**_read_json_object(path))
    config.validate()
    return config


def save_auto_task_config(settings: Settings, config: AutoTaskConfig) -> Path:
    config.validate()
    path = auto_task_config_path(settings)
    _atomic_write_json(path, asdict(config))
    return path


def load_auto_task_state(settings: Settings) -> AutoTaskState:
    path = auto_task_state_path(settings)
    if not path.is_file():
        return AutoTaskState()
    state = AutoTaskState(**_read_json_object(path))
    state.validate()
    return state


def save_auto_task_state(settings: Settings, state: AutoTaskState) -> Path:
    state.validate()
    path = auto_task_state_path(settings)
    _atomic_write_json(path, asdict(state))
    return path


def plan_next_auto_task(
    config: AutoTaskConfig,
    state: AutoTaskState,
    now_jst: datetime,
) -> AutoTaskRun | None:
    """返回当前已经到期的下一项任务，不返回尚未到期的计划。"""

    config.validate()
    state.validate()
    now = _as_jst(now_jst)
    if not config.enabled or state.auth_required:
        return None

    daily = _plan_daily(config, state, now)
    if daily is not None:
        return daily

    festival_final = _plan_festival_final(config, state, now)
    if festival_final is not None:
        return festival_final

    festival = _plan_festival(config, state, now)
    if festival is not None:
        return festival

    return _plan_festival_probe(config, state, now)


def _plan_daily(
    config: AutoTaskConfig,
    state: AutoTaskState,
    now: datetime,
) -> AutoTaskRun | None:
    if not config.daily_enabled:
        return None

    scheduled_for = datetime.combine(now.date(), _parse_clock(config.daily_time_jst, "daily_time_jst"), JST)
    if now < scheduled_for:
        return None

    target = now.date() - timedelta(days=1)
    if state.last_daily_completed_date:
        last_completed = _parse_date(state.last_daily_completed_date, "last_daily_completed_date")
        if last_completed >= target:
            return None
        date_from = last_completed + timedelta(days=1)
    elif state.daily_pending_from:
        date_from = _parse_date(state.daily_pending_from, "daily_pending_from")
    else:
        # 首次启用只同步昨日，避免在用户未确认时追溯全部历史。
        date_from = target

    return AutoTaskRun(
        kind="daily",
        date_from=date_from.isoformat(),
        date_to=target.isoformat(),
        scheduled_for=_format_datetime(scheduled_for),
    )


def _plan_festival_final(
    config: AutoTaskConfig,
    state: AutoTaskState,
    now: datetime,
) -> AutoTaskRun | None:
    if not config.festival_enabled:
        return None
    period = _festival_period(state)
    if period is None:
        return None
    period_from, period_to = period
    if state.finalized_period_to == period_to.isoformat():
        return None

    scheduled_date = period_to + timedelta(days=1)
    scheduled_for = datetime.combine(
        scheduled_date,
        _parse_clock(config.daily_time_jst, "daily_time_jst"),
        JST,
    )
    if now < scheduled_for:
        return None
    return AutoTaskRun(
        kind="festival_final",
        date_from=period_from.isoformat(),
        date_to=period_to.isoformat(),
        scheduled_for=_format_datetime(scheduled_for),
        target_version=state.festival_target_version,
    )


def _plan_festival(
    config: AutoTaskConfig,
    state: AutoTaskState,
    now: datetime,
) -> AutoTaskRun | None:
    if not config.festival_enabled:
        return None
    period = _festival_period(state)
    if period is None:
        return None
    period_from, period_to = period
    if not period_from <= now.date() <= period_to:
        return None

    window_start = datetime.combine(
        now.date(),
        _parse_clock(config.festival_window_from_jst, "festival_window_from_jst"),
        JST,
    )
    window_end_exclusive = datetime.combine(
        now.date(),
        _parse_clock(config.festival_window_to_jst, "festival_window_to_jst"),
        JST,
    ) + timedelta(minutes=1)
    if now < window_start or now >= window_end_exclusive:
        return None

    scheduled_for = window_start
    if state.last_festival_success_at:
        last_success = _parse_datetime(state.last_festival_success_at, "last_festival_success_at")
        interval_due = last_success + timedelta(minutes=config.festival_interval_minutes)
        scheduled_for = max(window_start, interval_due)
    if scheduled_for >= window_end_exclusive or now < scheduled_for:
        return None

    return AutoTaskRun(
        kind="festival",
        date_from=period_from.isoformat(),
        date_to=period_to.isoformat(),
        scheduled_for=_format_datetime(scheduled_for),
        target_version=state.festival_target_version,
    )


def _plan_festival_probe(
    config: AutoTaskConfig,
    state: AutoTaskState,
    now: datetime,
) -> AutoTaskRun | None:
    if not config.festival_enabled:
        return None
    if state.festival_checked_at:
        scheduled_for = _parse_datetime(state.festival_checked_at, "festival_checked_at") + FESTIVAL_PROBE_INTERVAL
        if now < scheduled_for:
            return None
    else:
        scheduled_for = now
    return AutoTaskRun(kind="festival_probe", scheduled_for=_format_datetime(scheduled_for))


def _festival_period(state: AutoTaskState) -> tuple[date, date] | None:
    if not state.festival_period_from or not state.festival_period_to:
        return None
    return (
        _parse_date(state.festival_period_from, "festival_period_from"),
        _parse_date(state.festival_period_to, "festival_period_to"),
    )


def _read_json_object(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"无法读取自动任务文件：{path.name}") from exc
    if not isinstance(payload, dict):
        raise ValueError(f"自动任务文件必须是 JSON 对象：{path.name}")
    return payload


def _atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temporary_path = Path(handle.name)
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, path)
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def _parse_clock(value: str, field_name: str) -> time:
    if not isinstance(value, str) or _TIME_PATTERN.fullmatch(value) is None:
        raise ValueError(f"{field_name} 必须是 HH:MM 格式")
    hour, minute = (int(part) for part in value.split(":"))
    return time(hour=hour, minute=minute)


def _parse_date(value: str, field_name: str) -> date:
    if not isinstance(value, str):
        raise ValueError(f"{field_name} 必须是 YYYY-MM-DD 格式")
    try:
        parsed = date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"{field_name} 必须是 YYYY-MM-DD 格式") from exc
    if parsed.isoformat() != value:
        raise ValueError(f"{field_name} 必须是 YYYY-MM-DD 格式")
    return parsed


def _parse_optional_date(value: str, field_name: str) -> date | None:
    return _parse_date(value, field_name) if value else None


def _parse_datetime(value: str, field_name: str) -> datetime:
    if not isinstance(value, str):
        raise ValueError(f"{field_name} 必须是 ISO 日期时间")
    normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise ValueError(f"{field_name} 必须是 ISO 日期时间") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        parsed = parsed.replace(tzinfo=JST)
    return parsed.astimezone(JST)


def _as_jst(value: datetime) -> datetime:
    if not isinstance(value, datetime):
        raise ValueError("now_jst 必须是 datetime")
    if value.tzinfo is None or value.utcoffset() is None:
        return value.replace(tzinfo=JST)
    return value.astimezone(JST)


def _format_datetime(value: datetime) -> str:
    return value.astimezone(JST).isoformat(timespec="seconds")
