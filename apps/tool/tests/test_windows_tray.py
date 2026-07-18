from __future__ import annotations

import pytest

from eiketsu_env.services import windows_tray


def test_router_emits_only_supported_command_strings() -> None:
    events: list[str] = []
    router = windows_tray._TrayMessageRouter(
        events.append,
        lambda: True,
        lambda: "run_now",
        taskbar_created_message=0xC123,
    )

    assert router.handle(
        windows_tray.TRAY_CALLBACK_MESSAGE,
        0,
        windows_tray.WM_LBUTTONDBLCLK,
    )
    assert router.handle(
        windows_tray.TRAY_CALLBACK_MESSAGE,
        0,
        windows_tray.WM_RBUTTONUP,
    )
    assert router.handle(
        windows_tray.INSTANCE_COMMAND_MESSAGE,
        windows_tray.COMMAND_IDS["pause_toggle"],
        0,
    )

    assert events == ["show", "run_now", "pause_toggle"]
    assert set(events) <= {"show", "run_now", "pause_toggle", "exit"}


def test_router_restores_icon_after_explorer_restart() -> None:
    restored: list[bool] = []
    router = windows_tray._TrayMessageRouter(
        lambda _command: None,
        lambda: restored.append(True) or True,
        lambda: None,
        taskbar_created_message=0xC123,
    )

    assert router.handle(0xC123, 0, 0)
    assert restored == [True]


def test_router_ignores_unrelated_messages_and_empty_menu() -> None:
    events: list[str] = []
    router = windows_tray._TrayMessageRouter(
        events.append,
        lambda: True,
        lambda: None,
        taskbar_created_message=0xC123,
    )

    assert not router.handle(0x1234, 0, 0)
    assert router.handle(
        windows_tray.TRAY_CALLBACK_MESSAGE,
        0,
        windows_tray.WM_CONTEXTMENU,
    )
    assert events == []


class _FakeUser32:
    def __init__(self, hwnd: int = 0, post_result: bool = True) -> None:
        self.hwnd = hwnd
        self.post_result = post_result
        self.find_calls: list[tuple[str, str]] = []
        self.post_calls: list[tuple[int, int, int, int]] = []

    def FindWindowW(self, class_name: str, title: str) -> int:
        self.find_calls.append((class_name, title))
        return self.hwnd

    def PostMessageW(self, hwnd: int, message: int, wparam: int, lparam: int) -> bool:
        self.post_calls.append((hwnd, message, wparam, lparam))
        return self.post_result


def test_notify_existing_instance_posts_requested_command() -> None:
    user32 = _FakeUser32(hwnd=314)

    assert windows_tray._notify_existing_instance(user32, "run_now")
    assert user32.find_calls == [
        (windows_tray.WINDOW_CLASS_NAME, windows_tray.WINDOW_TITLE)
    ]
    assert user32.post_calls == [
        (
            314,
            windows_tray.INSTANCE_COMMAND_MESSAGE,
            windows_tray.COMMAND_IDS["run_now"],
            0,
        )
    ]


def test_notify_existing_instance_returns_false_when_not_running() -> None:
    user32 = _FakeUser32()

    assert not windows_tray._notify_existing_instance(user32, "show")
    assert user32.post_calls == []


def test_public_notify_rejects_unknown_command_before_platform_check() -> None:
    with pytest.raises(ValueError, match="不支持的托盘命令"):
        windows_tray.notify_existing_instance("delete_everything")


def test_tray_start_reports_unsupported_platform(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(windows_tray, "_IS_WINDOWS", False)
    tray = windows_tray.WindowsTrayIcon(lambda _command: None)

    assert not tray.start()
    assert tray.last_error == "系统托盘只支持 Windows。"


def test_failed_icon_restore_marks_tray_not_ready() -> None:
    class _FakeShell32:
        @staticmethod
        def Shell_NotifyIconW(*_args) -> int:
            return 0

    tray = windows_tray.WindowsTrayIcon(lambda _command: None)
    tray._api = type("_Api", (), {"shell32": _FakeShell32()})()
    tray._notify_data = windows_tray._NOTIFYICONDATAW()
    tray._ready = True

    assert tray._add_icon() is False
    assert tray.ready is False
