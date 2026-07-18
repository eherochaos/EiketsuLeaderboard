"""常驻客户端的自动任务执行器。"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Callable, Literal, Protocol

from eiketsu_env.config import Settings
from eiketsu_env.services.auto_tasks import (
    AutoTaskConfig,
    AutoTaskRun,
    AutoTaskState,
    load_auto_task_config,
    load_auto_task_state,
    plan_next_auto_task,
    save_auto_task_state,
)
from eiketsu_env.services.battle_festival import (
    BattleFestivalPeriod,
    BattleFestivalProbeResult,
    probe_battle_festival_period,
)
from eiketsu_env.services.browser_session import BrowserAuthError, doctor_browser
from eiketsu_env.services.client_lock import ClientSyncBusyError, client_sync_lock
from eiketsu_env.services.client_upload import (
    fetch_client_share_config,
    fetch_client_share_config_state,
    sync_battle_festival_client,
    sync_client,
)
from eiketsu_env.utils import JST


AUTO_TASK_POLL_SECONDS = 60.0
AUTO_TASK_FAILURE_BACKOFF = timedelta(minutes=30)
OutcomeStatus = Literal["idle", "completed", "failed", "auth_required", "busy"]


class ProgressReporterFactory(Protocol):
    def __call__(self): ...


@dataclass(frozen=True, slots=True)
class AutoTaskOutcome:
    status: OutcomeStatus
    job: AutoTaskRun | None = None
    message: str = ""


@dataclass(frozen=True, slots=True)
class _JobExecution:
    message: str
    daily_completed_date: str = ""
    probe: BattleFestivalProbeResult | None = None
    probe_updates_state: bool = False
    festival_target_version: str = ""
    festival_completed: bool = False
    finalized_period_to: str = ""


def run_auto_task_once(
    settings: Settings,
    *,
    now: datetime | None = None,
    force: bool = False,
    progress=None,
    clock: Callable[[], datetime] | None = None,
) -> AutoTaskOutcome:
    """检查并最多执行一项任务；失败时不推进完成游标。"""

    read_clock = clock or (lambda: datetime.now(JST))
    current = _as_jst(now if now is not None else read_clock())
    completion_clock = (lambda: current) if now is not None and clock is None else lambda: _as_jst(read_clock())
    config = load_auto_task_config(settings)
    state = load_auto_task_state(settings)
    if not config.enabled or state.auth_required:
        return AutoTaskOutcome("idle")
    if not force and _failure_backoff_active(state, current):
        return AutoTaskOutcome("idle")
    job = _plan_forced_task(config, state, current) if force else plan_next_auto_task(config, state, current)
    if job is None:
        return AutoTaskOutcome("idle")
    if job.kind == "daily" and not state.last_daily_completed_date and not state.daily_pending_from:
        state.daily_pending_from = job.date_from
        save_auto_task_state(settings, state)

    try:
        execution = _execute_job(settings, config, job, progress)
    except ClientSyncBusyError:
        return AutoTaskOutcome("busy", job, "已有同步任务正在运行，稍后重试")
    except BrowserAuthError:
        finished = completion_clock()
        state.auth_required = True
        _record_state(state, job, "auth_required", finished, "需要重新登录英杰大战.NET")
        save_auto_task_state(settings, state)
        return AutoTaskOutcome("auth_required", job, state.last_error)
    except Exception as exc:  # noqa: BLE001 - 后台任务必须记录失败并继续保持程序可用。
        finished = completion_clock()
        error = _safe_error(exc)
        _record_state(state, job, "failed", finished, error)
        save_auto_task_state(settings, state)
        return AutoTaskOutcome("failed", job, error)

    finished = completion_clock()
    _apply_success_state(state, execution, finished)
    state.auth_required = False
    _record_state(state, job, "completed", finished, "")
    save_auto_task_state(settings, state)
    return AutoTaskOutcome("completed", job, execution.message)


def clear_auto_task_auth_required(settings: Settings) -> None:
    state = load_auto_task_state(settings)
    if not state.auth_required:
        return
    state.auth_required = False
    state.last_error = ""
    state.last_status = "ready"
    save_auto_task_state(settings, state)


class AutoTaskScheduler:
    """在单一后台线程中轮询到期任务，休眠恢复后也只执行一次。"""

    def __init__(
        self,
        settings: Settings,
        *,
        progress_factory: ProgressReporterFactory | None = None,
        outcome_callback: Callable[[AutoTaskOutcome], None] | None = None,
        poll_seconds: float = AUTO_TASK_POLL_SECONDS,
    ) -> None:
        self.settings = settings
        self.progress_factory = progress_factory
        self.outcome_callback = outcome_callback
        self.poll_seconds = max(1.0, float(poll_seconds))
        self._thread: threading.Thread | None = None
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._executing = threading.Event()
        self._force_lock = threading.Lock()
        self._lifecycle_lock = threading.Lock()
        self._force_next = False
        self._restart_requested = False

    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    @property
    def executing(self) -> bool:
        return self._executing.is_set()

    def start(self) -> None:
        with self._lifecycle_lock:
            if self.running:
                if self._stop.is_set():
                    self._restart_requested = True
                self._wake.set()
                return
            self._start_thread_locked()

    def _start_thread_locked(self) -> None:
        self._stop.clear()
        self._wake.clear()
        self._thread = threading.Thread(
            target=self._run,
            name="eiketsu-auto-tasks",
            daemon=True,
        )
        self._thread.start()

    def wake(self) -> None:
        self._wake.set()

    def run_now(self) -> None:
        with self._force_lock:
            self._force_next = True
        self._wake.set()

    def stop(self, timeout: float = 5.0) -> None:
        with self._lifecycle_lock:
            self._restart_requested = False
            self._stop.set()
            self._wake.set()
            thread = self._thread
        if thread is not None and thread is not threading.current_thread():
            thread.join(max(0.0, timeout))

    def _consume_force(self) -> bool:
        with self._force_lock:
            force = self._force_next
            self._force_next = False
        return force

    def _run(self) -> None:
        try:
            while not self._stop.is_set():
                self._executing.set()
                try:
                    progress = self.progress_factory() if self.progress_factory else None
                    try:
                        outcome = run_auto_task_once(
                            self.settings,
                            force=self._consume_force(),
                            progress=progress,
                        )
                    except Exception as exc:  # noqa: BLE001 - 坏配置也不能让常驻线程静默死亡。
                        outcome = AutoTaskOutcome("failed", message=_safe_error(exc))
                finally:
                    self._executing.clear()
                if self.outcome_callback and outcome.status != "idle":
                    try:
                        self.outcome_callback(outcome)
                    except Exception:
                        pass
                self._wake.wait(self.poll_seconds)
                self._wake.clear()
        finally:
            with self._lifecycle_lock:
                if self._thread is threading.current_thread():
                    self._thread = None
                restart = self._restart_requested
                self._restart_requested = False
                if restart:
                    self._start_thread_locked()


def _execute_job(
    settings: Settings,
    config: AutoTaskConfig,
    job: AutoTaskRun,
    progress,
) -> _JobExecution:
    if job.kind == "festival_probe":
        with client_sync_lock(settings):
            probe = probe_battle_festival_period(
                settings,
                auth_source=config.auth_source,
                interactive_auth=False,
            )
        if probe.status in {"auth_failed", "redirected"}:
            raise BrowserAuthError("需要重新登录英杰大战.NET")
        if probe.status in {"fetch_failed", "parse_failed"}:
            raise RuntimeError(probe.message or f"战祭探测失败：{probe.status}")
        target_version = ""
        if probe.period is not None:
            target_version = _resolve_festival_target_version(settings, probe.period)
        return _JobExecution(
            probe.message or f"战祭探测完成：{probe.status}",
            probe=probe,
            probe_updates_state=True,
            festival_target_version=target_version,
        )

    if job.kind == "daily":
        browser = doctor_browser(settings, config.auth_source)
        if not browser.get("ok"):
            raise BrowserAuthError("需要重新登录英杰大战.NET")
        result = sync_client(
            settings,
            auth_source=config.auth_source,
            interactive_auth=False,
            date_from=job.date_from,
            date_to=job.date_to,
            progress=progress,
        )
        if not _collect_delivery_succeeded(result.collect_result):
            raise RuntimeError(f"每日同步未完整完成：{result.collect_result.status}")
        warning = _collect_warning(result.collect_result.status)
        return _JobExecution(
            f"每日同步完成：{result.effective_date_from or job.date_from} 至 "
            f"{result.effective_date_to or job.date_to}{warning}",
            daily_completed_date=result.effective_date_to or job.date_to,
        )

    browser = doctor_browser(settings, config.auth_source)
    if not browser.get("ok"):
        raise BrowserAuthError("需要重新登录英杰大战.NET")
    period = BattleFestivalPeriod(job.date_from, job.date_to)
    result = sync_battle_festival_client(
        settings,
        auth_source=config.auth_source,
        interactive_auth=False,
        progress=progress,
        target_version=job.target_version,
        active_only=job.kind != "festival_final",
        period_override=period,
    )
    if result.collect_result is None:
        raise RuntimeError(f"战祭同步未启动：{result.plan.reason}")
    if not _collect_delivery_succeeded(result.collect_result):
        raise RuntimeError(f"战祭同步未完整完成：{result.collect_result.status}")
    warning = _collect_warning(result.collect_result.status)
    if job.kind == "festival_final":
        return _JobExecution(
            f"战祭结束补采完成：{job.date_from} 至 {job.date_to}{warning}",
            finalized_period_to=job.date_to,
        )
    assert result.plan.config is not None
    return _JobExecution(
        f"战祭同步完成：{result.plan.config.date_from} 至 {result.plan.config.date_to}{warning}",
        festival_completed=True,
    )


def _apply_success_state(
    state: AutoTaskState,
    execution: _JobExecution,
    finished: datetime,
) -> None:
    if execution.daily_completed_date:
        state.last_daily_completed_date = execution.daily_completed_date
        state.daily_pending_from = ""
    if execution.probe is not None and execution.probe_updates_state:
        _update_probe_state(
            state,
            execution.probe,
            finished,
            target_version=execution.festival_target_version,
        )
    if execution.festival_completed:
        state.last_festival_success_at = finished.isoformat(timespec="seconds")
    if execution.finalized_period_to:
        state.finalized_period_to = execution.finalized_period_to


def _collect_delivery_succeeded(result) -> bool:
    if result.status == "completed":
        return True
    if result.status != "completed_with_errors":
        return False
    counts = result.counts if isinstance(getattr(result, "counts", None), dict) else {}
    required_counts = {
        "dates",
        "players",
        "daily_pages",
        "detail_candidates",
        "detail_pages",
        "existing_detail_skipped",
    }
    if not required_counts.issubset(counts):
        return False
    dates = max(0, int(counts.get("dates") or 0))
    players = max(0, int(counts.get("players") or 0))
    daily_pages = max(0, int(counts.get("daily_pages") or 0))
    detail_candidates = max(0, int(counts.get("detail_candidates") or 0))
    completed_details = max(0, int(counts.get("detail_pages") or 0)) + max(
        0,
        int(counts.get("existing_detail_skipped") or 0),
    )
    return daily_pages >= dates * players and completed_details >= detail_candidates


def _collect_warning(status: str) -> str:
    return "（有局部错误，已上传）" if status == "completed_with_errors" else ""


def _resolve_festival_target_version(
    settings: Settings,
    period: BattleFestivalPeriod,
) -> str:
    config_state = fetch_client_share_config_state(settings)
    configs = {config_state.config.target_version: config_state.config}
    versions = [
        version
        for version in dict.fromkeys(
            [config_state.config.target_version, *config_state.available_target_versions]
        )
        if version
    ]
    first_overlap = ""
    for version in versions:
        config = configs.get(version)
        if config is None:
            config = fetch_client_share_config(settings, target_version=version)
        if config.date_from <= period.date_from and config.date_to >= period.date_to:
            return config.target_version
        if not first_overlap and config.date_from <= period.date_to and config.date_to >= period.date_from:
            first_overlap = config.target_version
    if first_overlap:
        return first_overlap
    raise RuntimeError(
        f"服务端没有覆盖战祭周期 {period.date_from} 至 {period.date_to} 的版本配置"
    )


def _update_probe_state(
    state: AutoTaskState,
    probe: BattleFestivalProbeResult,
    current: datetime,
    *,
    target_version: str = "",
) -> None:
    state.festival_checked_at = current.isoformat(timespec="seconds")
    if probe.period is not None:
        state.festival_period_from = probe.period.date_from
        state.festival_period_to = probe.period.date_to
        state.festival_target_version = target_version


def _plan_forced_task(
    config: AutoTaskConfig,
    state: AutoTaskState,
    current: datetime,
) -> AutoTaskRun | None:
    if config.festival_enabled and state.festival_period_from and state.festival_period_to:
        period_from = date.fromisoformat(state.festival_period_from)
        period_to = date.fromisoformat(state.festival_period_to)
        if period_from <= current.date() <= period_to:
            return AutoTaskRun(
                "festival",
                period_from.isoformat(),
                period_to.isoformat(),
                current.isoformat(timespec="seconds"),
                state.festival_target_version,
            )
    if config.daily_enabled:
        target = current.date() - timedelta(days=1)
        date_from = target
        if state.last_daily_completed_date:
            candidate = date.fromisoformat(state.last_daily_completed_date) + timedelta(days=1)
            date_from = min(candidate, target)
        elif state.daily_pending_from:
            date_from = min(date.fromisoformat(state.daily_pending_from), target)
        return AutoTaskRun(
            "daily",
            date_from.isoformat(),
            target.isoformat(),
            current.isoformat(timespec="seconds"),
        )
    if config.festival_enabled:
        return AutoTaskRun("festival_probe", scheduled_for=current.isoformat(timespec="seconds"))
    return None


def _failure_backoff_active(state: AutoTaskState, current: datetime) -> bool:
    if state.last_status != "failed" or not state.finished_at:
        return False
    finished = datetime.fromisoformat(state.finished_at)
    if finished.tzinfo is None:
        finished = finished.replace(tzinfo=JST)
    return current < finished.astimezone(JST) + AUTO_TASK_FAILURE_BACKOFF


def _record_state(
    state: AutoTaskState,
    job: AutoTaskRun,
    status: str,
    current: datetime,
    error: str,
) -> None:
    state.last_job_kind = job.kind
    state.last_status = status
    state.last_error = error
    state.finished_at = current.isoformat(timespec="seconds")


def _safe_error(exc: Exception) -> str:
    text = " ".join(str(exc).split())
    return (text or exc.__class__.__name__)[:500]


def _as_jst(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        return value.replace(tzinfo=JST)
    return value.astimezone(JST)
