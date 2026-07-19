"""Windows 图形客户端：给普通朋友使用的分步采集上传向导。"""

from __future__ import annotations

import argparse
import os
import queue
import sqlite3
import sys
import threading
import tkinter as tk
import time
import webbrowser
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from tkinter import messagebox, ttk
from typing import Any, Callable

from eiketsu_env import __version__
from eiketsu_env.config import Settings, load_client_settings, migrate_legacy_client_database
from eiketsu_env.services.auto_tasks import (
    AutoTaskConfig,
    AutoTaskState,
    load_auto_task_config,
    load_auto_task_state,
    save_auto_task_config,
)
from eiketsu_env.services.automation_runtime import (
    AutoTaskOutcome,
    AutoTaskScheduler,
    clear_auto_task_auth_required,
)
from eiketsu_env.services.browser_session import BrowserAuthError, ManagedChromiumRuntime, doctor_browser
from eiketsu_env.services.client_lock import (
    ClientSyncBusyError,
    clear_client_instance_signal,
    client_instance_lock,
    consume_client_instance_signal,
    request_client_instance_show,
)
from eiketsu_env.services.client_upload import (
    bind_client,
    check_client_update,
    client_config_path,
    cleanup_raw_snapshots,
    doctor_client,
    fetch_client_share_config_state,
    load_client_config,
    minimum_client_date_from,
    sync_client,
)
from eiketsu_env.services.share import ShareConfig
from eiketsu_env.services.windows_startup import set_startup_enabled
from eiketsu_env.services.windows_tray import WindowsTrayIcon, notify_existing_instance


DEFAULT_SERVER_URL = os.environ.get("EIKETSU_CLIENT_SERVER_URL", "http://43.128.141.76:8000")
STEP_TITLES = ["绑定", "登录", "同步", "自动", "查看"]
FESTIVAL_INTERVAL_CHOICES = ("30", "60", "120", "180", "360")
BROWSER_CHOICES = (
    ("自动检测（默认浏览器优先）", "auto"),
    ("Google Chrome", "chrome"),
    ("Microsoft Edge", "edge"),
    ("Brave", "brave"),
)
LOGIN_POLL_INITIAL_DELAY_MS = 1200
LOGIN_POLL_INTERVAL_MS = 2500
LOGIN_POLL_TIMEOUT_SECONDS = 300
MAX_LOG_LINES = 2000
BROWSER_LABEL_TO_SOURCE = dict(BROWSER_CHOICES)
BROWSER_SOURCE_TO_LABEL = {source: label for label, source in BROWSER_CHOICES}
BROWSER_SOURCE_TO_LABEL.update({"firefox": "Firefox", "firefox-profile": "Firefox"})
BROWSER_DISPLAY_NAMES = {
    "auto": "自动检测（默认浏览器优先）",
    "default-browser": "系统默认浏览器",
    "chrome": "Google Chrome",
    "edge": "Microsoft Edge",
    "brave": "Brave",
    "firefox": "Firefox",
    "firefox-profile": "Firefox",
}


def configured_auto_tasks(config: AutoTaskConfig) -> bool:
    return bool(config.daily_enabled or config.festival_enabled)


def resolve_close_action(config: AutoTaskConfig, tray_ready: bool) -> str:
    return "hide" if configured_auto_tasks(config) and tray_ready else "quit"


def should_start_hidden(
    requested: bool,
    config: AutoTaskConfig,
    *,
    tray_ready: bool,
    browser_ready: bool,
    auth_required: bool,
) -> bool:
    return bool(
        requested
        and configured_auto_tasks(config)
        and tray_ready
        and browser_ready
        and not auth_required
    )


def log_lines_to_trim(line_count: int, limit: int = MAX_LOG_LINES) -> int:
    return max(0, int(line_count) - max(1, int(limit)))


def update_install_instruction(download_name: str) -> str:
    return (
        "下载完成后，请彻底退出当前程序"
        "（如已启用托盘，请从托盘菜单选择“彻底退出”），"
        f"再运行新版 {download_name}。"
    )


def migrate_legacy_database_for_gui(
    settings: Settings,
    *,
    frozen: bool,
) -> tuple[object | None, str]:
    if not frozen:
        return None, ""
    try:
        return migrate_legacy_client_database(settings), ""
    except (OSError, sqlite3.Error):
        return None, "旧版本地数据库迁移失败。程序将继续启动；请保留旧版数据并联系维护者。"


def format_auto_task_state(state: AutoTaskState) -> str:
    if state.auth_required:
        return "需要重新登录后才能继续自动任务"
    if not state.last_status:
        return "尚未运行"
    labels = {
        "completed": "最近一次任务完成",
        "failed": "最近一次任务失败",
        "auth_required": "需要重新登录",
        "ready": "等待下次任务",
    }
    text = labels.get(state.last_status, state.last_status)
    job_labels = {
        "daily": "每日",
        "festival": "战祭",
        "festival_final": "战祭结束补采",
        "festival_probe": "战祭检查",
    }
    if state.last_job_kind in job_labels:
        text = text.replace("任务", f"{job_labels[state.last_job_kind]}任务", 1)
    if state.finished_at:
        try:
            finished = datetime.fromisoformat(state.finished_at)
            display_time = finished.strftime("%Y-%m-%d %H:%M")
        except ValueError:
            display_time = state.finished_at
        text += f"（{display_time} JST）"
    if state.last_error:
        text += f"：{state.last_error}"
    return text


def parse_gui_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--background", action="store_true")
    args, _unknown = parser.parse_known_args(argv)
    return args


def browser_label_to_source(label: str) -> str:
    """把给普通用户看的浏览器名称转成内部采集参数。"""

    return BROWSER_LABEL_TO_SOURCE.get(str(label or "").strip(), "auto")


def browser_source_to_label(source: str) -> str:
    normalized = str(source or "").strip()
    if normalized == "default-browser":
        return BROWSER_SOURCE_TO_LABEL["auto"]
    if normalized == "firefox-profile":
        return BROWSER_SOURCE_TO_LABEL["firefox"]
    return BROWSER_SOURCE_TO_LABEL.get(normalized, BROWSER_SOURCE_TO_LABEL["auto"])


def default_sync_date_range(config: ShareConfig, today: date | None = None) -> tuple[str, str]:
    # 默认只同步昨天一天，避免当天对局仍在变化时采到不完整样本。
    preferred_day = ((today or date.today()) - timedelta(days=1)).isoformat()
    floor = minimum_client_date_from(config)
    default_day = min(preferred_day, config.date_to) if config.date_to else preferred_day
    if floor and default_day < floor:
        default_day = floor
    return default_day, default_day


def format_browser_doctor_message(browser: dict[str, Any], selected_label: str) -> str:
    if browser.get("ok"):
        auth_source = str(browser.get("auth_source") or "")
        browser_name = BROWSER_DISPLAY_NAMES.get(auth_source, selected_label or "所选浏览器")
        profile_name = _profile_name(browser.get("selected_profile"))
        suffix = f"（浏览器用户：{profile_name}）" if profile_name else ""
        return f"已在 {browser_name}{suffix} 里找到会员区登录状态，可以继续同步。"

    source = str(browser.get("auth_source") or "")
    choice = selected_label or BROWSER_DISPLAY_NAMES.get(source, "所选浏览器")
    candidates = browser.get("candidates") or []
    invalid_login = _has_invalid_member_login_error(candidates) or "登录态无效" in str(browser.get("message") or "")
    checked = _format_candidate_summary_for_user(candidates, invalid_login=invalid_login)
    chromium_locked = _has_chromium_lock_error(candidates)
    chromium_protected = _has_chromium_protected_login_error(candidates)
    if chromium_locked:
        steps = [
            "请按下面做：",
            "1. 点击“打开登录页”。",
            "2. 程序会打开一个专用的 Chrome/Edge/Brave 登录窗口，请在这个窗口完成会员区登录。",
            "3. 不需要关闭网页；登录完成后回到这个窗口等待自动检测。",
            "4. 如果仍失败，请再次点击“打开登录页”，确认是在程序打开的窗口里登录。",
        ]
        retry_hint = "现在优先使用浏览器内登录态，不再要求用户关闭网页。"
    elif chromium_protected:
        steps = [
            "请按下面做：",
            "1. 这不是没有登录，也不是没有关网页，而是 Chrome/Edge/Brave 新版保护了网页登录状态。",
            "2. 当前程序用的是离线读取登录态方案，所以无法直接读取这类受保护记录。",
            "3. 点击“打开登录页”，在程序打开的专用 Chrome/Edge/Brave 窗口完成登录。",
            "4. 登录完成后不需要关闭网页，直接回到这个窗口等待自动检测。",
        ]
        retry_hint = "反复关闭 Chrome/Edge/Brave 通常不会解决这个提示；请改用“打开登录页”弹出的专用登录窗口。"
    elif invalid_login:
        steps = [
            "请按下面做：",
            "1. 点击“打开登录页”。",
            "2. 程序会打开一个专用的 Chrome/Edge/Brave 登录窗口，请在这个窗口完成会员区登录。",
            "3. 登录完成后不要关闭这个窗口，保持它打开直到同步完成。",
            "4. 如果之前是在其它浏览器窗口登录，请改到程序打开的窗口里重新登录。",
        ]
        retry_hint = "检测到旧登录记录已失效；请以程序打开的专用登录窗口为准。"
    else:
        steps = [
            "请按下面做：",
            "1. 点击“打开登录页”。",
            "2. 在弹出的浏览器里完成登录，并确认不是无痕/隐私窗口。",
            "3. 回到这个窗口等待自动检测。",
            "4. 如果浏览器有多个用户头像，请切到实际登录的那个头像后再检查。",
        ]
        retry_hint = (
            "仍失败时，可以先改选“自动检测（默认浏览器优先）”，或手动选择 Chrome/Edge/Brave 后重新打开登录页。"
            if source != "auto"
            else "仍失败时，可以在上方手动选择 Chrome、Edge 或 Brave，再点“打开登录页”登录。"
        )
    return "\n".join(
        [
            "没有检测到英杰大战.NET 会员区登录状态。",
            "",
            *steps,
            "",
            f"当前选择：{choice}",
            f"已检查：{checked}",
            retry_hint,
        ]
    )


def _format_candidate_summary_for_user(candidates: list[dict[str, Any]], invalid_login: bool = False) -> str:
    if not candidates:
        return "没有找到可检查的浏览器用户。"

    counts: dict[str, int] = {}
    readable_login_records = 0
    for item in candidates:
        browser_name = BROWSER_DISPLAY_NAMES.get(str(item.get("browser") or ""), str(item.get("browser") or "浏览器"))
        counts[browser_name] = counts.get(browser_name, 0) + 1
        readable_login_records += 1 if int(item.get("domain_cookie_count") or 0) > 0 else 0

    parts = [f"{name} {count} 个用户" for name, count in counts.items()]
    if _has_chromium_lock_error(candidates):
        status = "旧的离线读取方式遇到浏览器占用；请改用“打开登录页”打开的专用登录窗口。"
    elif _has_chromium_protected_login_error(candidates):
        status = "找到登录记录，但 Chrome/Edge/Brave 新版保护了网页登录状态，当前无法直接读取。"
    elif invalid_login:
        status = "找到旧登录记录，但会员区校验失败；请改用“打开登录页”打开的专用登录窗口。"
    else:
        status = "找到了疑似登录记录，但读取失败；请关闭浏览器后重试一次。" if readable_login_records else "没有找到会员区登录记录。"
    return "，".join(parts) + f"；{status}"


def _has_invalid_member_login_error(candidates: list[dict[str, Any]]) -> bool:
    return any("登录态无效" in str(item.get("error") or "") for item in candidates)


def _has_chromium_lock_error(candidates: list[dict[str, Any]]) -> bool:
    return any(
        str(item.get("browser") or "") in {"chrome", "edge"} and _is_file_lock_error(str(item.get("error") or ""))
        for item in candidates
    )


def _has_chromium_protected_login_error(candidates: list[dict[str, Any]]) -> bool:
    return any(
        str(item.get("browser") or "") in {"chrome", "edge"}
        and _is_chromium_protected_login_error(str(item.get("error") or ""))
        for item in candidates
    )


def _is_chromium_protected_login_error(error: str) -> bool:
    lowered = error.lower()
    return any(
        marker in lowered
        for marker in (
            "app-bound",
            "app bound",
            "v20",
            "新版登录数据受浏览器保护",
            "网页登录状态",
            "当前无法直接读取",
        )
    )


def _is_file_lock_error(error: str) -> bool:
    lowered = error.lower()
    return any(
        marker in lowered
        for marker in (
            "winerror 32",
            "being used by another process",
            "used by another process",
            "sharing violation",
            "另一个程序正在使用",
            "进程无法访问",
        )
    )


def _profile_name(value: object) -> str:
    text = str(value or "").replace("\\", "/").rstrip("/")
    return text.rsplit("/", 1)[-1] if text else ""


def _messagebox_title_for_error(message: str) -> str:
    # 登录态失败是最常见的用户操作问题，标题直接提示下一步，避免被理解成程序崩溃。
    if _is_chromium_protected_login_error(message):
        return "浏览器登录状态暂不可读取"
    if "会员区登录状态" in message:
        return "请先完成会员区登录"
    return "操作失败"


def _browser_doctor_warning_title(browser: dict[str, Any]) -> str:
    candidates = browser.get("candidates") or []
    if _has_invalid_member_login_error(candidates) or "登录态无效" in str(browser.get("message") or ""):
        return "请使用程序打开的登录页"
    if _has_chromium_protected_login_error(candidates):
        return "浏览器登录状态暂不可读取"
    if _has_chromium_lock_error(candidates):
        return "请使用程序打开的登录页"
    return "请先完成会员区登录"


def _parse_iso_date(value: str, label: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"{label} 必须是 YYYY-MM-DD，例如 2026-04-22。") from exc


class GuiProgressReporter:
    """把采集层的 daily/detail 进度转发到 Tk 主线程。"""

    def __init__(self, events: queue.Queue[tuple[str, object]]) -> None:
        self.events = events

    def message(self, text: str) -> None:
        self.events.put(("progress_message", text))

    def task(self, label: str, total: int) -> "GuiProgressTask":
        task = GuiProgressTask(self.events, label, max(0, total))
        task.render(force=True)
        return task


@dataclass(slots=True)
class GuiProgressTask:
    events: queue.Queue[tuple[str, object]]
    label: str
    total: int
    completed: int = 0
    suffix: str = ""
    last_render_at: float = 0.0

    def advance(self, step: int = 1, suffix: str = "") -> None:
        self.completed += step
        if suffix:
            self.suffix = suffix
        self.render()

    def finish(self, suffix: str = "done") -> None:
        if self.total > 0:
            self.completed = max(self.completed, self.total)
        self.suffix = suffix
        self.render(force=True)

    def render(self, force: bool = False) -> None:
        now = time.monotonic()
        if not force and now - self.last_render_at < 0.18 and self.completed < self.total:
            return
        self.last_render_at = now
        percent = 0 if self.total <= 0 else min(100, int(self.completed / self.total * 100))
        self.events.put(
            (
                "progress",
                {
                    "label": self.label,
                    "completed": self.completed,
                    "total": self.total,
                    "percent": percent,
                    "suffix": self.suffix,
                },
            )
        )


@dataclass(slots=True)
class GuiState:
    invite_code: tk.StringVar
    contributor: tk.StringVar
    browser_choice: tk.StringVar
    target_version: tk.StringVar
    date_floor: tk.StringVar
    date_ceiling: tk.StringVar
    sync_date_from: tk.StringVar
    sync_date_to: tk.StringVar
    progress_text: tk.StringVar
    status: tk.StringVar
    auto_enabled: tk.BooleanVar
    daily_enabled: tk.BooleanVar
    daily_time_jst: tk.StringVar
    festival_enabled: tk.BooleanVar
    festival_interval_minutes: tk.StringVar
    festival_window_from_jst: tk.StringVar
    festival_window_to_jst: tk.StringVar
    start_with_windows: tk.BooleanVar
    auto_status: tk.StringVar


class CollectorApp(tk.Tk):
    def __init__(
        self,
        *,
        settings: Settings | None = None,
        start_hidden: bool = False,
        tray_factory: Callable[..., WindowsTrayIcon] = WindowsTrayIcon,
        browser_runtime_factory: Callable[[Settings], ManagedChromiumRuntime] = ManagedChromiumRuntime,
    ) -> None:
        super().__init__()
        self.title("Eiketsu Collector")
        self.geometry("820x640")
        self.minsize(760, 580)
        self.settings = settings or load_client_settings()
        self.events: queue.Queue[tuple[str, object]] = queue.Queue()
        startup_messages: list[str] = []
        try:
            self.auto_config = load_auto_task_config(self.settings)
        except ValueError as exc:
            self.auto_config = AutoTaskConfig()
            startup_messages.append(f"自动任务配置无效，已暂停：{exc}")
        try:
            self.auto_state = load_auto_task_state(self.settings)
        except ValueError as exc:
            self.auto_state = AutoTaskState()
            startup_messages.append(f"自动任务状态无效：{exc}")
        self.state_vars = GuiState(
            invite_code=tk.StringVar(value=""),
            contributor=tk.StringVar(value=""),
            browser_choice=tk.StringVar(value=browser_source_to_label(self.settings.auth_source)),
            target_version=tk.StringVar(value="尚未读取"),
            date_floor=tk.StringVar(value="尚未读取"),
            date_ceiling=tk.StringVar(value="尚未读取"),
            sync_date_from=tk.StringVar(value=""),
            sync_date_to=tk.StringVar(value=""),
            progress_text=tk.StringVar(value="等待开始"),
            status=tk.StringVar(value="准备就绪"),
            auto_enabled=tk.BooleanVar(value=self.auto_config.enabled),
            daily_enabled=tk.BooleanVar(value=self.auto_config.daily_enabled),
            daily_time_jst=tk.StringVar(value=self.auto_config.daily_time_jst),
            festival_enabled=tk.BooleanVar(value=self.auto_config.festival_enabled),
            festival_interval_minutes=tk.StringVar(value=str(self.auto_config.festival_interval_minutes)),
            festival_window_from_jst=tk.StringVar(value=self.auto_config.festival_window_from_jst),
            festival_window_to_jst=tk.StringVar(value=self.auto_config.festival_window_to_jst),
            start_with_windows=tk.BooleanVar(value=self.auto_config.start_with_windows),
            auto_status=tk.StringVar(value=format_auto_task_state(self.auto_state)),
        )
        self.current_step = 0
        self.content_row = 0
        self.bound = False
        self.browser_ok = False
        self.share_config: ShareConfig | None = None
        self.available_target_versions: list[str] = []
        self.last_upload_summary = ""
        self.login_poll_active = False
        self.login_poll_inflight = False
        self.login_poll_started_at = 0.0
        self.login_poll_attempts = 0
        self.login_poll_generation = 0
        self.login_poll_after_id: str | None = None
        self.progress_value = tk.DoubleVar(value=0)
        self.action_buttons: list[ttk.Button] = []
        self.step_labels: list[tk.Label] = []
        self.operation_busy = False
        self.tray: WindowsTrayIcon | None = None
        self.tray_ready = False
        self.tray_factory = tray_factory
        self.browser_runtime = browser_runtime_factory(self.settings)
        self.background_browser_ready = True
        self.services_shutdown = False
        self.scheduler = AutoTaskScheduler(
            self.settings,
            progress_factory=lambda: GuiProgressReporter(self.events),
            outcome_callback=lambda outcome: self.events.put(("automation_outcome", outcome)),
            prepare_browser=self.browser_runtime.ensure_background,
        )
        try:
            self._build_shell()
            self._load_existing_config()
            self._render_step()
            self.protocol("WM_DELETE_WINDOW", self._on_window_close)
            for message in startup_messages:
                self._log(message)
            if self.auto_state.auth_required:
                self.state_vars.status.set("自动任务需要重新登录")
                self._log("自动任务仍在等待重新登录；本次启动不会隐藏主窗口。")
            self._configure_automation_runtime()
            if should_start_hidden(
                start_hidden,
                self.auto_config,
                tray_ready=self.tray_ready,
                browser_ready=self.background_browser_ready,
                auth_required=self.auto_state.auth_required,
            ):
                self.withdraw()
            self.after(120, self._drain_events)
            self.after(800, self._check_update_on_startup)
        except BaseException:
            try:
                if not self._shutdown_services():
                    self._shutdown_services()
            finally:
                try:
                    self.destroy()
                except tk.TclError:
                    pass
            raise

    def _build_shell(self) -> None:
        self.columnconfigure(0, weight=1)
        self.rowconfigure(1, weight=1)

        self.stepper = ttk.Frame(self, padding=(16, 16, 16, 8))
        self.stepper.grid(row=0, column=0, sticky="ew")
        for index in range(len(STEP_TITLES)):
            self.stepper.columnconfigure(index, weight=1)
            label = tk.Label(self.stepper, padx=12, pady=10, bd=1, relief="solid")
            label.grid(row=0, column=index, sticky="ew", padx=4)
            self.step_labels.append(label)

        self.content = ttk.Frame(self, padding=(24, 16, 24, 12))
        self.content.grid(row=1, column=0, sticky="nsew")
        self.content.columnconfigure(0, weight=1)

        log_box = ttk.LabelFrame(self, text="运行日志", padding=(12, 8, 12, 12))
        log_box.grid(row=2, column=0, sticky="nsew", padx=16, pady=(0, 8))
        log_box.columnconfigure(0, weight=1)
        self.log = tk.Text(log_box, wrap="word", height=7)
        self.log.grid(row=0, column=0, sticky="nsew")
        scroll = ttk.Scrollbar(log_box, orient="vertical", command=self.log.yview)
        scroll.grid(row=0, column=1, sticky="ns")
        self.log.configure(yscrollcommand=scroll.set)

        status = ttk.Label(self, textvariable=self.state_vars.status, padding=(16, 0, 16, 12))
        status.grid(row=3, column=0, sticky="ew")

    def _render_step(self) -> None:
        self.action_buttons = []
        self.content_row = 0
        for child in self.content.winfo_children():
            child.destroy()
        self._update_stepper()
        if self.current_step == 0:
            self._render_bind_step()
        elif self.current_step == 1:
            self._render_login_step()
        elif self.current_step == 2:
            self._render_sync_step()
        elif self.current_step == 3:
            self._render_auto_step()
        else:
            self._render_view_step()

    def _update_stepper(self) -> None:
        for index, label in enumerate(self.step_labels):
            state = "active" if index == self.current_step else "done" if index < self.current_step else "pending"
            colors = {
                "active": ("#1f6feb", "white"),
                "done": ("#e8f3ea", "#1a5f2a"),
                "pending": ("#f3f4f6", "#3f4650"),
            }[state]
            label.configure(
                text=f"{index + 1}. {STEP_TITLES[index]}",
                bg=colors[0],
                fg=colors[1],
                font=("Microsoft YaHei UI", 10, "bold" if state == "active" else "normal"),
            )

    def _render_bind_step(self) -> None:
        self._heading("第 1 步：绑定邀请码")
        self._paragraph("你只需要输入我发给你的邀请码和一个昵称。服务器地址已经内置在应用里，不需要填写。")
        self._button("检查软件更新", self.check_update)
        if self.bound:
            self._paragraph("当前电脑已经绑定过，可以直接进入下一步。")
            self._button("进入第 2 步：检查登录", lambda: self._go_to_step(1))
            return

        form = ttk.Frame(self.content)
        form.grid(row=self._next_content_row(), column=0, sticky="ew", pady=(8, 12))
        form.columnconfigure(1, weight=1)
        ttk.Label(form, text="邀请码").grid(row=0, column=0, sticky="w", pady=6)
        ttk.Entry(form, textvariable=self.state_vars.invite_code).grid(row=0, column=1, sticky="ew", pady=6)
        ttk.Label(form, text="昵称").grid(row=1, column=0, sticky="w", pady=6)
        ttk.Entry(form, textvariable=self.state_vars.contributor).grid(row=1, column=1, sticky="ew", pady=6)
        self._button("绑定并进入第 2 步", self.bind_invite)

    def _render_login_step(self) -> None:
        self._heading("第 2 步：确认会员区登录")
        self._paragraph(
            "选择你想用来登录英杰大战.NET 的浏览器。点击“打开登录页”后，在程序打开的浏览器窗口完成登录；"
            "程序会自动检测登录状态，成功后直接进入第 3 步。"
        )
        form = ttk.Frame(self.content)
        form.grid(row=self._next_content_row(), column=0, sticky="ew", pady=(8, 12))
        form.columnconfigure(1, weight=1)
        ttk.Label(form, text="浏览器选择").grid(row=0, column=0, sticky="w", pady=6)
        ttk.Combobox(
            form,
            textvariable=self.state_vars.browser_choice,
            values=[label for label, _source in BROWSER_CHOICES],
            state="readonly",
        ).grid(row=0, column=1, sticky="ew", pady=6)

        actions = ttk.Frame(self.content)
        actions.grid(row=self._next_content_row(), column=0, sticky="ew", pady=(0, 8))
        actions.columnconfigure(0, weight=1)
        actions.columnconfigure(1, weight=1)
        self._button("打开登录页", self.open_login_page, parent=actions, column=0)
        self._button("返回第 1 步", lambda: self._go_to_step(0), parent=actions, column=1, enabled=True)

    def _render_sync_step(self) -> None:
        self._heading("第 3 步：采集并上传")
        self._paragraph("这里只采集当前目标版本内的数据。起始日期不能早于版本开始日；同步完成前请保持窗口打开。")

        form = ttk.Frame(self.content)
        form.grid(row=self._next_content_row(), column=0, sticky="ew", pady=(8, 12))
        form.columnconfigure(1, weight=1)
        ttk.Label(form, text="目标版本").grid(row=0, column=0, sticky="w", pady=6)
        selected_version = self.state_vars.target_version.get()
        version_values = self.available_target_versions or ([selected_version] if selected_version != "尚未读取" else [])
        version_box = ttk.Combobox(
            form,
            textvariable=self.state_vars.target_version,
            values=version_values,
            state="readonly" if version_values else "disabled",
        )
        version_box.grid(row=0, column=1, sticky="ew", pady=6)
        version_box.bind("<<ComboboxSelected>>", lambda _event: self.refresh_sync_config())
        ttk.Label(form, text="最早日期").grid(row=1, column=0, sticky="w", pady=6)
        ttk.Label(form, textvariable=self.state_vars.date_floor).grid(row=1, column=1, sticky="w", pady=6)
        ttk.Label(form, text="最晚日期").grid(row=2, column=0, sticky="w", pady=6)
        ttk.Label(form, textvariable=self.state_vars.date_ceiling).grid(row=2, column=1, sticky="w", pady=6)
        ttk.Label(form, text="起始日期").grid(row=3, column=0, sticky="w", pady=6)
        ttk.Entry(form, textvariable=self.state_vars.sync_date_from).grid(row=3, column=1, sticky="ew", pady=6)
        ttk.Label(form, text="结束日期").grid(row=4, column=0, sticky="w", pady=6)
        ttk.Entry(form, textvariable=self.state_vars.sync_date_to).grid(row=4, column=1, sticky="ew", pady=6)

        self._paragraph("日期格式：YYYY-MM-DD。默认采集昨天一天；想补采时可以手动调整，但不要超出上面的最早/最晚日期。")

        progress_frame = ttk.Frame(self.content)
        progress_frame.grid(row=self._next_content_row(), column=0, sticky="ew", pady=(4, 10))
        progress_frame.columnconfigure(0, weight=1)
        ttk.Progressbar(progress_frame, maximum=100, variable=self.progress_value).grid(row=0, column=0, sticky="ew")
        ttk.Label(progress_frame, textvariable=self.state_vars.progress_text).grid(row=1, column=0, sticky="w", pady=(4, 0))

        actions = ttk.Frame(self.content)
        actions.grid(row=self._next_content_row(), column=0, sticky="ew", pady=(0, 8))
        actions.columnconfigure(0, weight=1)
        actions.columnconfigure(1, weight=1)
        self._button("刷新日期范围", self.refresh_sync_config, parent=actions, column=0)
        self._button("开始同步", self.sync, parent=actions, column=1, enabled=self.share_config is not None)
        self._button("清理旧原网页缓存", self.cleanup_raw_cache)
        self._button("设置自动任务", lambda: self._go_to_step(3))
        self._button("返回第 2 步", lambda: self._go_to_step(1))

    def _render_auto_step(self) -> None:
        self._heading("第 4 步：自动任务")
        self._paragraph(
            "配置任务后程序会留在系统托盘。暂停只停止执行，不退出托盘；每日任务按日本时间补采昨日。"
        )

        form = ttk.Frame(self.content)
        form.grid(row=self._next_content_row(), column=0, sticky="ew", pady=(4, 8))
        form.columnconfigure(1, weight=1)
        ttk.Checkbutton(
            form,
            text="运行后台调度（取消后暂停，仍保留托盘）",
            variable=self.state_vars.auto_enabled,
        ).grid(row=0, column=0, columnspan=2, sticky="w", pady=4)
        ttk.Checkbutton(
            form,
            text="每日完整更新",
            variable=self.state_vars.daily_enabled,
        ).grid(row=1, column=0, sticky="w", pady=4)
        daily_time = ttk.Frame(form)
        daily_time.grid(
            row=1,
            column=1,
            sticky="w",
            pady=4,
        )
        ttk.Entry(daily_time, textvariable=self.state_vars.daily_time_jst, width=12).grid(row=0, column=0)
        ttk.Label(daily_time, text="日本时间，格式 HH:MM").grid(row=0, column=1, sticky="w", padx=(8, 0))
        ttk.Checkbutton(
            form,
            text="战祭持续更新",
            variable=self.state_vars.festival_enabled,
        ).grid(row=2, column=0, sticky="w", pady=4)
        festival_interval = ttk.Frame(form)
        festival_interval.grid(row=2, column=1, sticky="w", pady=4)
        ttk.Combobox(
            festival_interval,
            textvariable=self.state_vars.festival_interval_minutes,
            values=FESTIVAL_INTERVAL_CHOICES,
            state="readonly",
            width=9,
        ).grid(row=0, column=0, sticky="w")
        ttk.Label(festival_interval, text="分钟一次").grid(row=0, column=1, sticky="w", padx=(8, 0))
        ttk.Label(form, text="战祭运行时段").grid(row=3, column=0, sticky="w", pady=4)
        window = ttk.Frame(form)
        window.grid(row=3, column=1, sticky="w", pady=4)
        ttk.Entry(window, textvariable=self.state_vars.festival_window_from_jst, width=8).grid(row=0, column=0)
        ttk.Label(window, text=" 至 ").grid(row=0, column=1)
        ttk.Entry(window, textvariable=self.state_vars.festival_window_to_jst, width=8).grid(row=0, column=2)
        ttk.Label(window, text="（日本时间）").grid(row=0, column=3, padx=(8, 0))
        ttk.Checkbutton(
            form,
            text="登录 Windows 后自动启动",
            variable=self.state_vars.start_with_windows,
        ).grid(row=4, column=0, columnspan=2, sticky="w", pady=4)

        ttk.Label(
            self.content,
            textvariable=self.state_vars.auto_status,
            wraplength=700,
            justify="left",
        ).grid(row=self._next_content_row(), column=0, sticky="w", pady=(0, 8))

        actions = ttk.Frame(self.content)
        actions.grid(row=self._next_content_row(), column=0, sticky="ew", pady=(0, 8))
        actions.columnconfigure(0, weight=1)
        actions.columnconfigure(1, weight=1)
        self._button("保存自动任务", self.save_auto_tasks, parent=actions, column=0)
        self._button("立即检查并运行", self.run_auto_tasks_now, parent=actions, column=1)
        self._button("返回手动同步", lambda: self._go_to_step(2))

    def _render_view_step(self) -> None:
        self._heading("第 5 步：查看结果")
        if self.last_upload_summary:
            self._paragraph(self.last_upload_summary)
        else:
            self._paragraph("同步完成后，可以查看自己的上传记录，也可以看公开匿名排行榜。")
        actions = ttk.Frame(self.content)
        actions.grid(row=self._next_content_row(), column=0, sticky="ew", pady=(8, 12))
        actions.columnconfigure(0, weight=1)
        actions.columnconfigure(1, weight=1)
        self._button("打开我的上传", self.open_me, parent=actions, column=0)
        self._button("打开排行榜", self.open_leaderboard, parent=actions, column=1)
        self._button("检查软件更新", self.check_update)
        self._button("自动任务设置", lambda: self._go_to_step(3))
        self._button("再同步一次", lambda: self._go_to_step(2))

    def _heading(self, text: str) -> None:
        ttk.Label(self.content, text=text, font=("Microsoft YaHei UI", 16, "bold")).grid(
            row=self._next_content_row(),
            column=0,
            sticky="w",
            pady=(0, 10),
        )

    def _paragraph(self, text: str) -> None:
        # 每一步只解释当前动作，避免朋友在表单和按钮里迷路。
        ttk.Label(self.content, text=text, wraplength=700, justify="left").grid(
            row=self._next_content_row(),
            column=0,
            sticky="w",
            pady=(0, 8),
        )

    def _next_content_row(self) -> int:
        row = self.content_row
        self.content_row += 1
        return row

    def _button(
        self,
        text: str,
        command: Callable,
        parent: ttk.Frame | None = None,
        column: int = 0,
        enabled: bool = True,
    ) -> ttk.Button:
        target = parent or self.content
        row = 0
        button = ttk.Button(target, text=text, command=command, state="normal" if enabled else "disabled")
        if target is self.content:
            row = self._next_content_row()
        button.grid(row=row, column=column, sticky="ew", padx=4, pady=5)
        self.action_buttons.append(button)
        return button

    def _load_existing_config(self) -> None:
        path = client_config_path(self.settings)
        if not path.exists():
            self._log("首次使用：填写邀请码和昵称，然后按步骤继续。")
            return
        try:
            config = load_client_config(self.settings)
        except Exception as exc:  # noqa: BLE001 - GUI 需要把坏配置用可读文本提示出来。
            self._log(f"读取本地配置失败：{exc}")
            return
        self.bound = True
        self.current_step = 1
        self.state_vars.contributor.set(config.contributor)
        self._log(f"已读取本地绑定配置：{path}")

    def bind_invite(self) -> None:
        invite = self.state_vars.invite_code.get().strip()
        contributor = self.state_vars.contributor.get().strip()
        if not invite or not contributor:
            messagebox.showwarning("信息不完整", "请填写邀请码和昵称。")
            return
        self._run_background(
            "绑定邀请码",
            lambda: bind_client(self.settings, DEFAULT_SERVER_URL, invite, contributor),
            self._after_bind_success,
        )

    def doctor(self) -> None:
        def task() -> dict:
            client = doctor_client(self.settings)
            browser = doctor_browser(self.settings, self._selected_auth_source())
            return {"client": client, "browser": browser}

        self._run_background("自动检测登录", task, self._after_doctor_success)

    def refresh_sync_config(self) -> None:
        self._run_background(
            "读取采集日期范围",
            lambda: fetch_client_share_config_state(self.settings, target_version=self._selected_target_version_for_config()),
            self._after_config_success,
        )

    def cleanup_raw_cache(self) -> None:
        if not messagebox.askyesno(
            "清理旧原网页缓存",
            "这会删除本机 data/raw 里过去保存的网页原文，只保留已解析出的对局数据。确定继续吗？",
        ):
            return
        self._run_background("清理旧原网页缓存", lambda: cleanup_raw_snapshots(self.settings), self._after_cleanup_success)

    def check_update(self) -> None:
        self._run_background(
            "检查软件更新",
            lambda: check_client_update(self.settings, DEFAULT_SERVER_URL, current_version=__version__),
            lambda result: self._after_update_check(result, quiet=False),
        )

    def sync(self) -> None:
        if self.scheduler.executing:
            messagebox.showinfo("自动任务正在运行", "请等待当前自动任务完成后再手动同步。")
            return
        try:
            date_from, date_to = self._validated_sync_dates()
        except ValueError as exc:
            messagebox.showwarning("日期需要调整", str(exc))
            return
        auth_source = self._selected_auth_source()
        browser_label = self._selected_browser_label()
        self.progress_value.set(0)
        self.state_vars.progress_text.set(f"准备同步：{date_from} 至 {date_to}")

        def task():
            browser = doctor_browser(self.settings, auth_source)
            if not browser.get("ok"):
                raise RuntimeError(format_browser_doctor_message(browser, browser_label))
            progress = GuiProgressReporter(self.events)
            progress.message(f"采集范围：{date_from} 至 {date_to}")
            return sync_client(
                self.settings,
                auth_source=auth_source,
                interactive_auth=False,
                date_from=date_from,
                date_to=date_to,
                target_version=self.share_config.target_version if self.share_config else "",
                progress=progress,
            )

        self._run_background("同步上传", task, self._after_sync_success)

    def save_auto_tasks(self) -> None:
        if self.scheduler.executing:
            messagebox.showinfo("自动任务正在运行", "请等待当前自动任务完成后再保存浏览器或调度设置。")
            return
        try:
            interval = int(self.state_vars.festival_interval_minutes.get().strip())
            config = AutoTaskConfig(
                enabled=bool(self.state_vars.auto_enabled.get()),
                daily_enabled=bool(self.state_vars.daily_enabled.get()),
                daily_time_jst=self.state_vars.daily_time_jst.get().strip(),
                festival_enabled=bool(self.state_vars.festival_enabled.get()),
                festival_interval_minutes=interval,
                festival_window_from_jst=self.state_vars.festival_window_from_jst.get().strip(),
                festival_window_to_jst=self.state_vars.festival_window_to_jst.get().strip(),
                start_with_windows=bool(self.state_vars.start_with_windows.get()),
                auth_source=self._selected_auth_source(),
            )
            config.validate()
            if config.start_with_windows and not configured_auto_tasks(config):
                raise ValueError("请先启用每日任务或战祭任务，再设置登录 Windows 后自动启动。")
            set_startup_enabled(config.start_with_windows and configured_auto_tasks(config))
            save_auto_task_config(self.settings, config)
        except (OSError, RuntimeError, ValueError) as exc:
            messagebox.showerror("自动任务未保存", str(exc))
            return

        self.auto_config = config
        self._reload_auto_state()
        self._configure_automation_runtime()
        self.scheduler.wake()
        self._log("自动任务已保存。启用后关闭窗口会继续留在系统托盘。")
        self.state_vars.status.set("自动任务已保存")
        self._render_step()

    def run_auto_tasks_now(self) -> None:
        if not configured_auto_tasks(self.auto_config):
            messagebox.showwarning("还没有自动任务", "请先启用每日任务或战祭任务并保存。")
            return
        if not self.auto_config.enabled:
            messagebox.showwarning("自动任务已暂停", "请先勾选“运行后台调度”并保存。")
            return
        self.scheduler.start()
        self.scheduler.run_now()
        self.state_vars.status.set("已请求立即运行")
        self._log("已请求立即检查并运行一项自动任务。")

    def open_login_page(self) -> None:
        if self.scheduler.executing:
            messagebox.showinfo("自动任务正在运行", "请等待当前自动任务完成后再打开登录页。")
            return
        auth_source = self._selected_auth_source()
        try:
            opened_source = self.browser_runtime.open_login(auth_source)
        except (BrowserAuthError, OSError) as exc:
            self._log(f"打开登录页失败：{exc}")
            self.state_vars.status.set("登录页打开失败")
            messagebox.showerror("无法打开登录页", str(exc))
            return
        selected = self._selected_browser_label()
        opened_label = BROWSER_DISPLAY_NAMES.get(opened_source, selected)
        if opened_source == "default-browser":
            self._log(f"已用系统默认浏览器打开登录页：{self.settings.login_url}")
        elif auth_source == "auto":
            self._log(f"已打开 {opened_label} 登录页。请在弹出的窗口完成会员区登录。")
        else:
            self._log(
                f"已打开会员区登录页。如果弹出的不是 {selected}，请手动在 {selected} 里打开："
                f"{self.settings.login_url}"
            )
        self._start_login_poll()

    def _configure_automation_runtime(self) -> None:
        if configured_auto_tasks(self.auto_config):
            self._ensure_tray()
            try:
                self.browser_runtime.ensure_background(self.auto_config.auth_source)
                self.background_browser_ready = True
            except (BrowserAuthError, OSError) as exc:
                self.background_browser_ready = False
                self._log(f"后台浏览器启动失败：{exc}")
                self.state_vars.status.set("后台浏览器需要处理")
            self.scheduler.start()
            if self.auto_config.start_with_windows:
                try:
                    set_startup_enabled(True)
                except (OSError, RuntimeError) as exc:
                    self._log(f"登录自启校正失败：{exc}")
            return
        self.background_browser_ready = True
        self.scheduler.stop()
        self._stop_tray()

    def _ensure_tray(self) -> bool:
        if self.tray is not None and self.tray.ready:
            self.tray_ready = True
            return True
        if self.tray is not None:
            self.tray.stop()
        tray = self.tray_factory(
            lambda command: self.events.put(("tray_command", command)),
            tooltip=f"Eiketsu Collector {__version__}",
        )
        if not tray.start():
            self.tray = tray
            self.tray_ready = False
            self._log(f"系统托盘启动失败：{tray.last_error}")
            return False
        self.tray = tray
        self.tray_ready = True
        self._log("系统托盘已启动；关闭窗口后自动任务会继续运行。")
        return True

    def _stop_tray(self) -> None:
        tray = self.tray
        self.tray = None
        self.tray_ready = False
        if tray is not None:
            tray.stop()

    def _toggle_auto_pause(self) -> None:
        if not configured_auto_tasks(self.auto_config):
            self.show_window()
            messagebox.showwarning("还没有自动任务", "请先在“自动”步骤中配置任务。")
            return
        previous = self.auto_config.enabled
        self.auto_config.enabled = not previous
        try:
            save_auto_task_config(self.settings, self.auto_config)
        except (OSError, ValueError) as exc:
            self.auto_config.enabled = previous
            self.state_vars.auto_enabled.set(previous)
            self.show_window()
            self._log(f"暂停状态保存失败：{exc}")
            messagebox.showerror("自动任务状态未保存", "无法保存暂停状态，请检查磁盘后重试。")
            return
        self.state_vars.auto_enabled.set(self.auto_config.enabled)
        self.scheduler.wake()
        status = "已继续自动任务" if self.auto_config.enabled else "已暂停自动任务"
        self.state_vars.status.set(status)
        self._log(status)
        if self.current_step == 3:
            self._render_step()

    def _handle_tray_command(self, command: str) -> None:
        if command == "show":
            self.show_window()
        elif command == "run_now":
            self.scheduler.run_now()
        elif command == "pause_toggle":
            self._toggle_auto_pause()
        elif command == "exit":
            self.quit_app()

    def _handle_automation_outcome(self, outcome: AutoTaskOutcome) -> None:
        self._reload_auto_state()
        job_name = outcome.job.kind if outcome.job else "任务"
        if outcome.status == "completed":
            self._log(f"自动任务完成：{job_name}；{outcome.message}")
            self.state_vars.status.set("自动任务完成")
        elif outcome.status == "busy":
            self._log("自动任务等待：已有同步任务正在运行。")
        elif outcome.status == "auth_required":
            self._log("自动任务暂停：需要重新登录英杰大战.NET。")
            self.state_vars.status.set("自动任务需要重新登录")
            self.show_window()
            self._go_to_step(1)
        elif outcome.status == "failed":
            self._log(f"自动任务失败：{outcome.message}")
            self.state_vars.status.set("自动任务失败")
        if self.current_step == 3:
            self._render_step()

    def _reload_auto_state(self) -> None:
        try:
            self.auto_state = load_auto_task_state(self.settings)
        except ValueError as exc:
            self.auto_state = AutoTaskState(last_status="failed", last_error=str(exc))
            self._log(f"自动任务状态读取失败：{exc}")
        self.state_vars.auto_status.set(format_auto_task_state(self.auto_state))

    def show_window(self) -> None:
        self.deiconify()
        self.lift()
        self.focus_force()

    def _on_window_close(self) -> None:
        self.tray_ready = bool(self.tray is not None and self.tray.ready)
        if resolve_close_action(self.auto_config, self.tray_ready) == "hide":
            self.withdraw()
            self._log("主窗口已隐藏，自动任务继续在系统托盘运行。")
            return
        self.quit_app()

    def quit_app(self) -> None:
        if (self.operation_busy or self.scheduler.executing) and not messagebox.askyesno(
            "任务仍在运行",
            "当前任务尚未完成。彻底退出会中断本次任务，确定退出吗？",
        ):
            return
        if not self._shutdown_services():
            messagebox.showerror(
                "专用浏览器仍在运行",
                "程序未能关闭自己启动的专用浏览器。请先手动关闭该浏览器，再次选择“彻底退出”。",
            )
            return
        self.destroy()

    def _shutdown_services(self) -> bool:
        if self.services_shutdown:
            return True
        self._cancel_login_poll()
        self.scheduler.stop()
        try:
            browser_closed = self.browser_runtime.close()
        finally:
            self._stop_tray()
        self.services_shutdown = browser_closed
        return browser_closed

    def open_me(self) -> None:
        try:
            config = load_client_config(self.settings)
        except Exception as exc:  # noqa: BLE001
            messagebox.showwarning("还未绑定", str(exc))
            return
        webbrowser.open(f"{config.server_url}/me?token={config.api_token}")

    def open_leaderboard(self) -> None:
        webbrowser.open(f"{DEFAULT_SERVER_URL.rstrip('/')}/leaderboard")

    def _after_bind_success(self, result) -> None:
        self.bound = True
        self._log(f"绑定成功：用户 {result.user_public_id}，token 前缀 {result.token_prefix}")
        self._go_to_step(1)

    def _after_doctor_success(self, result: dict) -> None:
        client = result["client"]
        browser = result["browser"]
        self.browser_ok = bool(browser.get("ok"))
        self._log(f"客户端：{client.get('message', '已检查')}")
        readable_message = format_browser_doctor_message(browser, self._selected_browser_label())
        self._log(f"浏览器登录：{readable_message}")
        if self.browser_ok:
            self._go_to_step(2)
        else:
            messagebox.showwarning(_browser_doctor_warning_title(browser), readable_message)
        self._render_step()

    def _start_login_poll(self) -> None:
        self._cancel_login_poll()
        self.browser_ok = False
        self.login_poll_active = True
        self.login_poll_inflight = False
        self.login_poll_started_at = time.monotonic()
        self.login_poll_attempts = 0
        self.login_poll_generation += 1
        self.state_vars.status.set("等待网页登录完成")
        self._log("登录完成后不用点其它按钮；程序会自动检测，成功后直接进入第 3 步。")
        self._schedule_login_poll(LOGIN_POLL_INITIAL_DELAY_MS)

    def _cancel_login_poll(self) -> None:
        self.login_poll_active = False
        self.login_poll_inflight = False
        if self.login_poll_after_id:
            try:
                self.after_cancel(self.login_poll_after_id)
            except tk.TclError:
                pass
            self.login_poll_after_id = None

    def _schedule_login_poll(self, delay_ms: int = LOGIN_POLL_INTERVAL_MS) -> None:
        if not self.login_poll_active:
            return
        self.login_poll_after_id = self.after(delay_ms, self._poll_login_status_once)

    def _poll_login_status_once(self) -> None:
        self.login_poll_after_id = None
        if not self.login_poll_active or self.login_poll_inflight:
            return
        if time.monotonic() - self.login_poll_started_at > LOGIN_POLL_TIMEOUT_SECONDS:
            self.login_poll_active = False
            self.state_vars.status.set("等待登录超时")
            self._log("超过 5 分钟仍未检测到会员区登录。请确认网页登录已完成，或重新点击“打开登录页”。")
            messagebox.showwarning(
                "还没有检测到登录",
                "暂时没有检测到会员区登录。\n\n请确认你已经在刚才打开的浏览器窗口里完成登录，然后再次点击“打开登录页”重试。",
            )
            return

        self.login_poll_attempts += 1
        self.login_poll_inflight = True
        generation = self.login_poll_generation
        attempt = self.login_poll_attempts
        auth_source = self._selected_auth_source()
        selected_label = self._selected_browser_label()
        self.state_vars.status.set(f"正在自动检测登录（第 {attempt} 次）")

        def worker() -> None:
            try:
                result = {
                    "generation": generation,
                    "attempt": attempt,
                    "selected_label": selected_label,
                    "client": doctor_client(self.settings),
                    "browser": doctor_browser(self.settings, auth_source),
                }
            except Exception as exc:  # noqa: BLE001 - 自动检测不能打断 GUI，只把原因写进日志后继续等。
                result = {
                    "generation": generation,
                    "attempt": attempt,
                    "selected_label": selected_label,
                    "error": str(exc),
                }
            self.events.put(("login_poll_result", result))

        threading.Thread(target=worker, daemon=True).start()

    def _handle_login_poll_result(self, payload: dict[str, Any]) -> None:
        self.login_poll_inflight = False
        if not self.login_poll_active or payload.get("generation") != self.login_poll_generation:
            return
        attempt = int(payload.get("attempt") or self.login_poll_attempts)
        if payload.get("error"):
            if attempt == 1 or attempt % 5 == 0:
                self._log(f"自动检测暂未成功：{payload['error']}")
            self.state_vars.status.set("等待网页登录完成")
            self._schedule_login_poll()
            return

        client = payload["client"]
        browser = payload["browser"]
        if bool(browser.get("ok")):
            self.browser_ok = True
            if configured_auto_tasks(self.auto_config):
                if self.scheduler.executing:
                    self.state_vars.status.set("登录成功，等待自动任务结束")
                    self._schedule_login_poll()
                    return
                try:
                    self.browser_runtime.switch_to_background(self._selected_auth_source())
                    self.background_browser_ready = True
                except (BrowserAuthError, OSError) as exc:
                    self.browser_ok = False
                    self.background_browser_ready = False
                    self._log(f"登录已确认，但后台浏览器启动失败：{exc}")
                    self.state_vars.status.set("后台浏览器启动失败")
                    messagebox.showerror(
                        "无法切换到后台运行",
                        f"登录已经成功，但浏览器无法转到后台运行。\n\n{exc}\n\n请重新点击“打开登录页”后再试。",
                    )
                    return
            self._cancel_login_poll()
            try:
                clear_auto_task_auth_required(self.settings)
            except ValueError as exc:
                self._log(f"自动任务登录状态未能恢复：{exc}")
            self._reload_auto_state()
            self.scheduler.wake()
            readable_message = format_browser_doctor_message(browser, str(payload.get("selected_label") or self._selected_browser_label()))
            self._log(f"客户端：{client.get('message', '已检查')}")
            self._log(f"浏览器登录：{readable_message}")
            self.state_vars.status.set("登录成功，进入同步步骤")
            self._go_to_step(2)
            return

        if attempt == 1 or attempt % 5 == 0:
            message = str(browser.get("message") or "还没有检测到登录")
            self._log(f"等待登录：第 {attempt} 次检测未成功，{message}")
        self.state_vars.status.set("等待网页登录完成")
        self._schedule_login_poll()

    def _after_config_success(self, result) -> None:
        config = result.config if hasattr(result, "config") else result
        available_versions = list(getattr(result, "available_target_versions", []) or [])
        if config.target_version and config.target_version not in available_versions:
            available_versions.insert(0, config.target_version)
        self.available_target_versions = available_versions
        self.share_config = config
        floor = minimum_client_date_from(config)
        default_date_from, default_date_to = default_sync_date_range(config)
        self.state_vars.target_version.set(config.target_version)
        self.state_vars.date_floor.set(floor)
        self.state_vars.date_ceiling.set(config.date_to)
        if not self.state_vars.sync_date_from.get().strip() or self.state_vars.sync_date_from.get().strip() < floor:
            self.state_vars.sync_date_from.set(default_date_from)
        if not self.state_vars.sync_date_to.get().strip() or self.state_vars.sync_date_to.get().strip() > config.date_to:
            self.state_vars.sync_date_to.set(default_date_to)
        self._log(f"采集配置：{config.target_version}，可采集日期 {floor} 至 {config.date_to}")
        self._render_step()

    def _selected_target_version_for_config(self) -> str:
        value = self.state_vars.target_version.get().strip()
        return "" if not value or value == "尚未读取" else value

    def _after_cleanup_success(self, result) -> None:
        size_mb = result.bytes_removed / 1024 / 1024
        self._log(
            f"已清理旧原网页缓存：删除 {result.files_removed} 个文件，约 {size_mb:.1f} MB，"
            f"移除 {result.rows_removed} 条 raw 索引。"
        )

    def _after_update_check(self, result, quiet: bool) -> None:
        if not result.configured:
            self._log(result.message or "服务端还没有发布客户端更新包。")
            if not quiet:
                messagebox.showinfo("暂无更新", "服务端还没有发布客户端更新包。")
            return
        if not result.update_available:
            self._log(f"当前已是最新版：{result.current_version or __version__}")
            if not quiet:
                messagebox.showinfo("暂无更新", f"当前已是最新版：{result.current_version or __version__}")
            return
        size_mb = result.size_bytes / 1024 / 1024 if result.size_bytes else 0
        notes = f"\n\n更新说明：{result.notes}" if result.notes else ""
        download_name = result.download_name or f"EiketsuCollector_{result.latest_version}.exe"
        message = (
            f"发现新版 {result.latest_version}。\n"
            f"当前版本：{result.current_version or __version__}\n"
            f"文件大小：{size_mb:.1f} MB\n\n"
            f"点击“是”会打开下载地址。{update_install_instruction(download_name)}"
            f"{notes}"
        )
        self._log(f"发现新版客户端：{result.latest_version}，下载地址 {result.download_url}")
        if messagebox.askyesno("发现新版客户端", message):
            webbrowser.open(result.download_url)

    def _after_sync_success(self, result) -> None:
        upload = result.upload
        self.last_upload_summary = (
            f"上传完成：{upload.get('match_count', 0)} 场对局，"
            f"导入 {upload.get('imported_match_count', 0)} 场，状态 {upload.get('status', '')}。"
        )
        self.progress_value.set(100)
        self.state_vars.progress_text.set("同步完成，可以关闭窗口或查看结果。")
        self._log(self.last_upload_summary)
        self._go_to_step(4)

    def _go_to_step(self, step: int) -> None:
        if step > 0 and not self.bound:
            messagebox.showwarning("还未绑定", "请先完成第 1 步。")
            return
        target_step = max(0, min(step, len(STEP_TITLES) - 1))
        if target_step != 1:
            self._cancel_login_poll()
        self.current_step = target_step
        self._render_step()
        if self.current_step == 2 and self.share_config is None:
            self.after(50, self.refresh_sync_config)

    def _selected_auth_source(self) -> str:
        return browser_label_to_source(self.state_vars.browser_choice.get())

    def _selected_browser_label(self) -> str:
        return self.state_vars.browser_choice.get() or browser_source_to_label("auto")

    def _validated_sync_dates(self) -> tuple[str, str]:
        if self.share_config is None:
            raise ValueError("还没有读取采集日期范围，请先点击“刷新日期范围”。")
        date_from = self.state_vars.sync_date_from.get().strip()
        date_to = self.state_vars.sync_date_to.get().strip()
        _parse_iso_date(date_from, "起始日期")
        _parse_iso_date(date_to, "结束日期")
        floor = minimum_client_date_from(self.share_config)
        if date_from < floor:
            self.state_vars.sync_date_from.set(floor)
            date_from = floor
            self._log(f"起始日期早于版本开始日，已自动调整为 {floor}")
        if date_to > self.share_config.date_to:
            self.state_vars.sync_date_to.set(self.share_config.date_to)
            date_to = self.share_config.date_to
            self._log(f"结束日期晚于服务端配置，已自动调整为 {self.share_config.date_to}")
        if date_to < date_from:
            raise ValueError(f"结束日期不能早于起始日期 {date_from}。")
        return date_from, date_to

    def _run_background(self, label: str, task: Callable, on_success: Callable | None = None) -> None:
        if self.operation_busy:
            messagebox.showinfo("任务正在运行", "请等待当前操作完成后再试。")
            return
        self.operation_busy = True
        self._set_busy(True, f"{label}中...")
        self._log(f"开始：{label}")

        def worker() -> None:
            try:
                result = task()
            except Exception as exc:  # noqa: BLE001 - 后台错误必须回到 GUI 显示，不能直接崩进控制台。
                self.events.put(("error", str(exc)))
                return
            self.events.put(("success", label))
            if on_success:
                self.events.put(("callback", (on_success, result)))

        threading.Thread(target=worker, daemon=True).start()

    def _drain_events(self) -> None:
        try:
            self._refresh_tray_health()
            if consume_client_instance_signal(self.settings):
                self.show_window()
            while True:
                kind, payload = self.events.get_nowait()
                try:
                    if kind == "error":
                        self.operation_busy = False
                        self._log(f"失败：{payload}")
                        self._set_busy(False, "失败")
                        message = str(payload)
                        messagebox.showerror(_messagebox_title_for_error(message), message)
                    elif kind == "success":
                        self.operation_busy = False
                        self._log(f"完成：{payload}")
                        self._set_busy(False, "准备就绪")
                    elif kind == "callback":
                        callback, result = payload  # type: ignore[misc]
                        callback(result)
                    elif kind == "progress_message":
                        self._log(str(payload))
                        self.state_vars.progress_text.set(str(payload))
                    elif kind == "progress":
                        self._update_progress(payload)  # type: ignore[arg-type]
                    elif kind == "login_poll_result":
                        self._handle_login_poll_result(payload)  # type: ignore[arg-type]
                    elif kind == "update_check":
                        self._after_update_check(payload, quiet=True)
                    elif kind == "tray_command":
                        self._handle_tray_command(str(payload))
                    elif kind == "automation_outcome":
                        self._handle_automation_outcome(payload)  # type: ignore[arg-type]
                except Exception as exc:  # noqa: BLE001 - 单个后台事件失败不能终止 GUI 事件泵。
                    self._log(f"后台事件处理失败：{exc}")
        except queue.Empty:
            pass
        except Exception as exc:  # noqa: BLE001 - 托盘健康检查失败也必须继续轮询。
            self._log(f"后台状态检查失败：{exc}")
        finally:
            try:
                self.after(120, self._drain_events)
            except tk.TclError:
                pass

    def _refresh_tray_health(self) -> None:
        ready = bool(self.tray is not None and self.tray.ready)
        if ready == self.tray_ready:
            return
        was_ready = self.tray_ready
        self.tray_ready = ready
        if was_ready and not ready:
            self._log("系统托盘已失效，主窗口已恢复；关闭窗口将彻底退出。")
            if self.state() == "withdrawn":
                self.show_window()
        elif ready:
            self._log("系统托盘已恢复。")

    def _set_busy(self, busy: bool, status: str) -> None:
        self.state_vars.status.set(status)
        state = "disabled" if busy else "normal"
        for button in self.action_buttons:
            button.configure(state=state)

    def _update_progress(self, payload: dict[str, Any]) -> None:
        percent = int(payload.get("percent") or 0)
        label = str(payload.get("label") or "同步中")
        completed = int(payload.get("completed") or 0)
        total = int(payload.get("total") or 0)
        suffix = str(payload.get("suffix") or "")
        self.progress_value.set(percent)
        if total > 0:
            text = f"{label}：{completed}/{total}（{percent}%）"
        else:
            text = f"{label}：准备中"
        if suffix:
            text += f" {suffix}"
        self.state_vars.progress_text.set(text)

    def _log(self, message: str) -> None:
        self.log.insert("end", message + "\n")
        line_count = int(self.log.index("end-1c").split(".", 1)[0])
        trim = log_lines_to_trim(line_count)
        if trim:
            self.log.delete("1.0", f"{trim + 1}.0")
        self.log.see("end")

    def _check_update_on_startup(self) -> None:
        def worker() -> None:
            try:
                result = check_client_update(self.settings, DEFAULT_SERVER_URL, current_version=__version__)
            except Exception:
                return
            self.events.put(("update_check", result))

        threading.Thread(target=worker, daemon=True).start()


def main(argv: list[str] | None = None) -> None:
    args = parse_gui_args(argv)
    settings = load_client_settings()
    if args.background:
        try:
            config = load_auto_task_config(settings)
        except ValueError:
            return
        if not config.start_with_windows or not configured_auto_tasks(config):
            return
    try:
        with client_instance_lock(settings):
            app: CollectorApp | None = None
            try:
                clear_client_instance_signal(settings)
                migrated, migration_warning = migrate_legacy_database_for_gui(
                    settings,
                    frozen=bool(getattr(sys, "frozen", False)),
                )
                app = CollectorApp(settings=settings, start_hidden=bool(args.background))
                if migrated is not None:
                    app._log("已将旧版本地对局数据库迁移到固定客户端目录。")
                if migration_warning:
                    app._log(migration_warning)
                    app.after(
                        0,
                        lambda: messagebox.showwarning("旧数据迁移失败", migration_warning),
                    )
                app.mainloop()
            finally:
                if app is not None:
                    if not app._shutdown_services():
                        app._shutdown_services()
    except ClientSyncBusyError:
        if not args.background:
            notified = False
            try:
                notified = notify_existing_instance("show")
            except (OSError, RuntimeError):
                pass
            if not notified:
                try:
                    request_client_instance_show(settings)
                except OSError:
                    pass


if __name__ == "__main__":
    main()
