import queue
import sqlite3
from contextlib import contextmanager
from datetime import date
from types import SimpleNamespace

import pytest

from eiketsu_env import client_gui
from eiketsu_env.client_gui import (
    CollectorApp,
    GuiProgressReporter,
    _browser_doctor_warning_title,
    _messagebox_title_for_error,
    browser_label_to_source,
    browser_source_to_label,
    configured_auto_tasks,
    default_sync_date_range,
    format_auto_task_state,
    format_browser_doctor_message,
    log_lines_to_trim,
    migrate_legacy_database_for_gui,
    parse_gui_args,
    resolve_close_action,
    should_start_hidden,
    update_install_instruction,
)
from eiketsu_env.config import Settings
from eiketsu_env.services.auto_tasks import AutoTaskConfig, AutoTaskState
from eiketsu_env.services.share import ShareConfig


def test_browser_choice_mapping_uses_friendly_labels():
    assert browser_label_to_source("自动检测（默认浏览器优先）") == "auto"
    assert browser_label_to_source("Google Chrome") == "chrome"
    assert browser_label_to_source("Microsoft Edge") == "edge"
    assert browser_label_to_source("Brave") == "brave"
    assert browser_source_to_label("brave") == "Brave"
    assert browser_source_to_label("firefox") == "Firefox"
    assert browser_source_to_label("default-browser") == "自动检测（默认浏览器优先）"
    assert browser_source_to_label("firefox-profile") == "Firefox"
    assert browser_label_to_source("看不懂的输入") == "auto"


def test_default_sync_date_range_prefers_yesterday():
    config = ShareConfig(target_version="Ver.Test", date_from="2026-05-01", date_to="2026-05-31")

    assert default_sync_date_range(config, today=date(2026, 5, 16)) == ("2026-05-15", "2026-05-15")


def test_default_sync_date_range_keeps_within_server_dates():
    capped = ShareConfig(target_version="Ver.Test", date_from="2026-05-01", date_to="2026-05-14")
    floored = ShareConfig(target_version="Ver.Test", date_from="2026-05-16", date_to="2026-05-31")

    assert default_sync_date_range(capped, today=date(2026, 5, 16)) == ("2026-05-14", "2026-05-14")
    assert default_sync_date_range(floored, today=date(2026, 5, 16)) == ("2026-05-16", "2026-05-16")


def test_background_args_and_close_policy_are_explicit():
    assert parse_gui_args(["--background"]).background is True
    assert parse_gui_args([]).background is False

    disabled = AutoTaskConfig()
    configured = AutoTaskConfig(daily_enabled=True)

    assert configured_auto_tasks(disabled) is False
    assert configured_auto_tasks(configured) is True
    assert resolve_close_action(configured, tray_ready=True) == "hide"
    assert resolve_close_action(configured, tray_ready=False) == "quit"
    assert resolve_close_action(disabled, tray_ready=True) == "quit"
    assert should_start_hidden(True, configured, tray_ready=True, browser_ready=True, auth_required=False) is True
    assert should_start_hidden(True, configured, tray_ready=True, browser_ready=True, auth_required=True) is False


def test_automation_runtime_prepares_background_browser_before_scheduler():
    calls: list[str] = []
    app = object.__new__(CollectorApp)
    app.auto_config = AutoTaskConfig(daily_enabled=True, auth_source="chrome")
    app.browser_runtime = SimpleNamespace(
        ensure_background=lambda source: calls.append(f"browser:{source}"),
    )
    app.scheduler = SimpleNamespace(start=lambda: calls.append("scheduler"))
    app._ensure_tray = lambda: calls.append("tray")
    app.background_browser_ready = False
    app.state_vars = SimpleNamespace(status=SimpleNamespace(set=lambda _value: None))

    app._configure_automation_runtime()

    assert calls == ["tray", "browser:chrome", "scheduler"]
    assert app.background_browser_ready is True


def test_close_to_tray_keeps_managed_browser_running():
    calls: list[str] = []
    app = object.__new__(CollectorApp)
    app.auto_config = AutoTaskConfig(daily_enabled=True)
    app.tray = SimpleNamespace(ready=True)
    app.tray_ready = True
    app.withdraw = lambda: calls.append("withdraw")
    app._log = lambda _message: calls.append("log")
    app.browser_runtime = SimpleNamespace(close=lambda: calls.append("browser-close"))
    app.quit_app = lambda: calls.append("quit")

    app._on_window_close()

    assert calls == ["withdraw", "log"]


def test_shutdown_services_stops_scheduler_then_browser_and_is_idempotent():
    calls: list[str] = []
    app = object.__new__(CollectorApp)
    app.services_shutdown = False
    app._cancel_login_poll = lambda: calls.append("cancel-poll")
    app.scheduler = SimpleNamespace(stop=lambda: calls.append("scheduler-stop"))
    app.browser_runtime = SimpleNamespace(close=lambda: calls.append("browser-close") or True)
    app._stop_tray = lambda: calls.append("tray-stop")

    app._shutdown_services()
    app._shutdown_services()

    assert calls == ["cancel-poll", "scheduler-stop", "browser-close", "tray-stop"]


def test_shutdown_services_retries_when_browser_did_not_close():
    calls: list[str] = []
    close_results = iter([False, True])
    app = object.__new__(CollectorApp)
    app.services_shutdown = False
    app._cancel_login_poll = lambda: calls.append("cancel-poll")
    app.scheduler = SimpleNamespace(stop=lambda: calls.append("scheduler-stop"))
    app.browser_runtime = SimpleNamespace(
        close=lambda: calls.append("browser-close") or next(close_results),
    )
    app._stop_tray = lambda: calls.append("tray-stop")

    assert app._shutdown_services() is False
    assert app.services_shutdown is False
    assert app._shutdown_services() is True
    assert app.services_shutdown is True
    assert calls.count("browser-close") == 2


def test_constructor_failure_closes_started_browser_runtime(tmp_path, monkeypatch):
    calls: list[str] = []

    class DummyVar:
        def __init__(self, value=None, **_kwargs):
            self.value = value

        def get(self):
            return self.value

        def set(self, value):
            self.value = value

    runtime = SimpleNamespace(
        close=lambda: calls.append("browser-close") or True,
        ensure_background=lambda _source: None,
    )
    scheduler = SimpleNamespace(stop=lambda: calls.append("scheduler-stop"))
    monkeypatch.setattr(client_gui.tk.Tk, "__init__", lambda self: None)
    monkeypatch.setattr(CollectorApp, "title", lambda self, _value: None)
    monkeypatch.setattr(CollectorApp, "geometry", lambda self, _value: None)
    monkeypatch.setattr(CollectorApp, "minsize", lambda self, *_args: None)
    monkeypatch.setattr(CollectorApp, "destroy", lambda self: calls.append("destroy"))
    monkeypatch.setattr(CollectorApp, "_build_shell", lambda self: (_ for _ in ()).throw(RuntimeError("shell failed")))
    monkeypatch.setattr(client_gui.tk, "StringVar", DummyVar)
    monkeypatch.setattr(client_gui.tk, "BooleanVar", DummyVar)
    monkeypatch.setattr(client_gui.tk, "DoubleVar", DummyVar)
    monkeypatch.setattr(client_gui, "load_auto_task_config", lambda _settings: AutoTaskConfig())
    monkeypatch.setattr(client_gui, "load_auto_task_state", lambda _settings: AutoTaskState())
    monkeypatch.setattr(client_gui, "AutoTaskScheduler", lambda *args, **kwargs: scheduler)

    with pytest.raises(RuntimeError, match="shell failed"):
        CollectorApp(
            settings=Settings(root_dir=tmp_path, db_url="sqlite:///:memory:"),
            browser_runtime_factory=lambda _settings: runtime,
        )

    assert calls == ["scheduler-stop", "browser-close", "destroy"]


def test_login_success_switches_to_background_before_waking_tasks(monkeypatch):
    calls: list[str] = []
    app = object.__new__(CollectorApp)
    app.login_poll_active = True
    app.login_poll_generation = 3
    app.login_poll_attempts = 1
    app.login_poll_inflight = True
    app.browser_ok = False
    app.auto_config = AutoTaskConfig(daily_enabled=True)
    app.browser_runtime = SimpleNamespace(
        switch_to_background=lambda source: calls.append(f"switch:{source}"),
    )
    app.scheduler = SimpleNamespace(executing=False, wake=lambda: calls.append("wake"))
    app._selected_auth_source = lambda: "chrome"
    app._selected_browser_label = lambda: "Google Chrome"
    app._cancel_login_poll = lambda: calls.append("cancel-poll")
    app._reload_auto_state = lambda: calls.append("reload-state")
    app._log = lambda _message: None
    app._go_to_step = lambda step: calls.append(f"step:{step}")
    app.state_vars = SimpleNamespace(status=SimpleNamespace(set=lambda _value: None))
    monkeypatch.setattr(
        client_gui,
        "clear_auto_task_auth_required",
        lambda _settings: calls.append("clear-auth"),
    )
    app.settings = Settings(root_dir=SimpleNamespace(), db_url="sqlite:///:memory:")

    app._handle_login_poll_result(
        {
            "generation": 3,
            "attempt": 1,
            "selected_label": "Google Chrome",
            "client": {"message": "ok"},
            "browser": {"ok": True, "auth_source": "chrome"},
        }
    )

    assert calls == [
        "switch:chrome",
        "cancel-poll",
        "clear-auth",
        "reload-state",
        "wake",
        "step:2",
    ]


def test_mainloop_exception_still_closes_runtime(monkeypatch):
    calls: list[str] = []
    settings = Settings(root_dir=SimpleNamespace(), db_url="sqlite:///:memory:")

    @contextmanager
    def fake_lock(_settings):
        yield

    class FakeApp:
        def __init__(self, **_kwargs):
            calls.append("app-created")

        def mainloop(self):
            calls.append("mainloop")
            raise RuntimeError("boom")

        def _shutdown_services(self):
            calls.append("shutdown")
            return True

    monkeypatch.setattr(client_gui, "load_client_settings", lambda: settings)
    monkeypatch.setattr(client_gui, "client_instance_lock", fake_lock)
    monkeypatch.setattr(client_gui, "clear_client_instance_signal", lambda _settings: None)
    monkeypatch.setattr(client_gui, "migrate_legacy_database_for_gui", lambda *args, **kwargs: (None, ""))
    monkeypatch.setattr(client_gui, "CollectorApp", FakeApp)

    with pytest.raises(RuntimeError, match="boom"):
        client_gui.main([])

    assert calls == ["app-created", "mainloop", "shutdown"]


def test_auto_task_state_message_prioritizes_auth_failure():
    state = AutoTaskState(
        auth_required=True,
        last_status="failed",
        last_error="sensitive low-level detail",
    )

    assert format_auto_task_state(state) == "需要重新登录后才能继续自动任务"


def test_auto_task_state_formats_job_and_jst_time_for_users():
    state = AutoTaskState(
        last_job_kind="festival",
        last_status="completed",
        finished_at="2026-07-18T21:30:00+09:00",
    )

    assert format_auto_task_state(state) == "最近一次战祭任务完成（2026-07-18 21:30 JST）"


def test_update_instruction_requires_full_exit_before_running_new_version():
    text = update_install_instruction("EiketsuCollector_0.2.14.exe")

    assert "彻底退出当前程序" in text
    assert "托盘菜单" in text
    assert "关闭当前窗口" not in text


def test_log_trim_helper_bounds_long_resident_session():
    assert log_lines_to_trim(1999) == 0
    assert log_lines_to_trim(2000) == 0
    assert log_lines_to_trim(2007) == 7


def test_legacy_migration_failure_is_non_fatal_for_gui(tmp_path, monkeypatch):
    settings = Settings(root_dir=tmp_path, db_url=f"sqlite:///{tmp_path / 'test.db'}")
    monkeypatch.setattr(
        client_gui,
        "migrate_legacy_client_database",
        lambda _settings: (_ for _ in ()).throw(sqlite3.DatabaseError("corrupt")),
    )

    migrated, warning = migrate_legacy_database_for_gui(settings, frozen=True)

    assert migrated is None
    assert "继续启动" in warning


def test_browser_doctor_message_explains_missing_cookie_without_jargon():
    message = format_browser_doctor_message(
        {
            "ok": False,
            "auth_source": "chrome",
            "candidates": [
                {
                    "browser": "chrome",
                    "profile": r"C:\Users\alice\AppData\Local\Google\Chrome\User Data\Default",
                    "cookie_db_exists": True,
                    "domain_cookie_count": 0,
                }
            ],
        },
        "Google Chrome",
    )

    assert "没有检测到英杰大战.NET 会员区登录状态" in message
    assert "1. 点击“打开登录页”" in message
    assert "回到这个窗口等待自动检测" in message
    assert "检查登录状态" not in message
    assert "当前选择：Google Chrome" in message
    assert "已检查：Google Chrome 1 个用户" in message
    assert "cookie" not in message.lower()
    assert "profile" not in message.lower()
    assert "winerror" not in message.lower()
    assert "moz_cookies" not in message.lower()
    assert r"C:\Users" not in message


def test_browser_doctor_message_uses_dedicated_login_window_when_locked():
    message = format_browser_doctor_message(
        {
            "ok": False,
            "auth_source": "chrome",
            "candidates": [
                {
                    "browser": "chrome",
                    "profile": r"C:\Users\alice\AppData\Local\Google\Chrome\User Data\Default",
                    "cookie_db_exists": True,
                    "domain_cookie_count": 0,
                    "error": "[WinError 32] 另一个程序正在使用此文件，进程无法访问。",
                }
            ],
        },
        "Google Chrome",
    )

    assert "专用的 Chrome/Edge/Brave 登录窗口" in message
    assert "不需要关闭网页" in message
    assert "专用登录窗口" in message
    assert "cookie" not in message.lower()
    assert "winerror" not in message.lower()
    assert r"C:\Users" not in message


def test_browser_doctor_message_explains_chromium_protected_login_data():
    browser = {
        "ok": False,
        "auth_source": "edge",
        "candidates": [
            {
                "browser": "edge",
                "profile": r"C:\Users\alice\AppData\Local\Microsoft\Edge\User Data\Default",
                "cookie_db_exists": True,
                "domain_cookie_count": 1,
                "error": "Chrome/Edge/Brave 新版登录数据受浏览器保护，当前无法直接读取",
            }
        ],
    }
    message = format_browser_doctor_message(
        browser,
        "Microsoft Edge",
    )

    assert "这不是没有登录，也不是没有关网页" in message
    assert "Chrome/Edge/Brave 新版保护了网页登录状态" in message
    assert "离线读取登录态方案" in message
    assert "专用 Chrome/Edge/Brave 窗口" in message
    assert "反复关闭 Chrome/Edge/Brave 通常不会解决" in message
    assert _browser_doctor_warning_title(browser) == "浏览器登录状态暂不可读取"
    assert _messagebox_title_for_error(message) == "浏览器登录状态暂不可读取"
    assert "cookie" not in message.lower()
    assert "profile" not in message.lower()
    assert "winerror" not in message.lower()
    assert r"C:\Users" not in message


def test_browser_doctor_message_explains_invalid_member_login_without_paths():
    browser = {
        "ok": False,
        "auth_source": "chrome",
        "message": (
            r"没有发现英杰大战登录态：firefox:C:\Users\alice\AppData\Roaming\Mozilla\Firefox\Profiles\default "
            "-> 还没有完成会员区登录，或当前登录态无效。"
        ),
        "candidates": [
            {
                "browser": "chrome",
                "profile": r"C:\Users\alice\AppData\Local\Google\Chrome\User Data\Default",
                "cookie_db_exists": True,
                "domain_cookie_count": 0,
                "error": "请先点击“打开登录页”",
            },
            {
                "browser": "firefox",
                "profile": r"C:\Users\alice\AppData\Roaming\Mozilla\Firefox\Profiles\default",
                "cookie_db_exists": True,
                "domain_cookie_count": 1,
            },
        ],
    }

    message = format_browser_doctor_message(browser, "自动检测（默认浏览器优先）")

    assert "会员区校验失败" in message
    assert "保持它打开直到同步完成" in message
    assert "旧登录记录已失效" in message
    assert "请关闭浏览器" not in message
    assert r"C:\Users" not in message
    assert _browser_doctor_warning_title(browser) == "请使用程序打开的登录页"


def test_browser_doctor_message_reports_success_profile():
    message = format_browser_doctor_message(
        {
            "ok": True,
            "auth_source": "edge",
            "loaded_cookie_count": 3,
            "selected_profile": r"C:\Users\alice\AppData\Local\Microsoft\Edge\User Data\Profile 1",
        },
        "Microsoft Edge",
    )

    assert "Microsoft Edge" in message
    assert "找到会员区登录状态" in message
    assert "可以继续同步" in message
    assert "Profile 1" in message


def test_gui_progress_reporter_emits_task_updates():
    events: queue.Queue = queue.Queue()
    progress = GuiProgressReporter(events)

    progress.message("采集范围：2026-05-10 至 2026-05-12")
    task = progress.task("daily 2026-05-10", 4)
    task.advance(2, suffix="ok=2 err=0")
    task.finish("ok=4 err=0")

    kinds = [events.get_nowait()[0] for _ in range(events.qsize())]
    assert "progress_message" in kinds
    assert kinds.count("progress") >= 2
