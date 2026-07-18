"""Eiketsu Collector 的 Windows 系统托盘入口。

托盘窗口和 Win32 消息泵运行在独立线程。事件回调只会收到固定字符串，
调用方应把事件放进 GUI 自己的线程安全队列，不要在回调里直接操作 Tk。
"""

from __future__ import annotations

import ctypes
import os
import threading
from ctypes import wintypes
from dataclasses import dataclass
from typing import Callable, Literal, cast


TrayCommand = Literal["show", "run_now", "pause_toggle", "exit"]
TrayEventCallback = Callable[[TrayCommand], None]

WINDOW_CLASS_NAME = "EiketsuCollectorTrayWindowV1"
WINDOW_TITLE = "Eiketsu Collector Background"
DEFAULT_TOOLTIP = "Eiketsu Collector"

WM_NULL = 0x0000
WM_DESTROY = 0x0002
WM_CLOSE = 0x0010
WM_CONTEXTMENU = 0x007B
WM_LBUTTONDBLCLK = 0x0203
WM_RBUTTONUP = 0x0205
WM_APP = 0x8000
TRAY_CALLBACK_MESSAGE = WM_APP + 1
INSTANCE_COMMAND_MESSAGE = WM_APP + 2

NIM_ADD = 0x00000000
NIM_DELETE = 0x00000002
NIF_MESSAGE = 0x00000001
NIF_ICON = 0x00000002
NIF_TIP = 0x00000004

MF_STRING = 0x00000000
MF_SEPARATOR = 0x00000800
TPM_RIGHTBUTTON = 0x0002
TPM_RETURNCMD = 0x0100
IDI_APPLICATION = 32512

COMMAND_IDS: dict[TrayCommand, int] = {
    "show": 1001,
    "run_now": 1002,
    "pause_toggle": 1003,
    "exit": 1004,
}
COMMANDS_BY_ID = {menu_id: command for command, menu_id in COMMAND_IDS.items()}
_IS_WINDOWS = os.name == "nt"

_LRESULT = ctypes.c_ssize_t
_WNDPROC_TYPE = getattr(ctypes, "WINFUNCTYPE", ctypes.CFUNCTYPE)(
    _LRESULT,
    wintypes.HWND,
    wintypes.UINT,
    wintypes.WPARAM,
    wintypes.LPARAM,
)


class _GUID(ctypes.Structure):
    _fields_ = [
        ("Data1", wintypes.DWORD),
        ("Data2", wintypes.WORD),
        ("Data3", wintypes.WORD),
        ("Data4", wintypes.BYTE * 8),
    ]


class _NotifyVersion(ctypes.Union):
    _fields_ = [
        ("uTimeout", wintypes.UINT),
        ("uVersion", wintypes.UINT),
    ]


class _NOTIFYICONDATAW(ctypes.Structure):
    _anonymous_ = ("version",)
    _fields_ = [
        ("cbSize", wintypes.DWORD),
        ("hWnd", wintypes.HWND),
        ("uID", wintypes.UINT),
        ("uFlags", wintypes.UINT),
        ("uCallbackMessage", wintypes.UINT),
        ("hIcon", wintypes.HICON),
        ("szTip", wintypes.WCHAR * 128),
        ("dwState", wintypes.DWORD),
        ("dwStateMask", wintypes.DWORD),
        ("szInfo", wintypes.WCHAR * 256),
        ("version", _NotifyVersion),
        ("szInfoTitle", wintypes.WCHAR * 64),
        ("dwInfoFlags", wintypes.DWORD),
        ("guidItem", _GUID),
        ("hBalloonIcon", wintypes.HICON),
    ]


class _WNDCLASSW(ctypes.Structure):
    _fields_ = [
        ("style", wintypes.UINT),
        ("lpfnWndProc", _WNDPROC_TYPE),
        ("cbClsExtra", ctypes.c_int),
        ("cbWndExtra", ctypes.c_int),
        ("hInstance", wintypes.HINSTANCE),
        ("hIcon", wintypes.HICON),
        ("hCursor", wintypes.HANDLE),
        ("hbrBackground", wintypes.HBRUSH),
        ("lpszMenuName", wintypes.LPCWSTR),
        ("lpszClassName", wintypes.LPCWSTR),
    ]


@dataclass(slots=True)
class _WindowsApi:
    user32: object
    shell32: object
    kernel32: object


_api_lock = threading.Lock()
_cached_api: _WindowsApi | None = None


def _validate_command(command: str) -> TrayCommand:
    if command not in COMMAND_IDS:
        allowed = ", ".join(COMMAND_IDS)
        raise ValueError(f"不支持的托盘命令：{command!r}；只允许 {allowed}")
    return cast(TrayCommand, command)


class _TrayMessageRouter:
    """把 Win32 消息收敛成固定的托盘命令，便于脱离桌面环境测试。"""

    def __init__(
        self,
        event_callback: TrayEventCallback,
        restore_icon: Callable[[], bool],
        show_menu: Callable[[], TrayCommand | None],
        taskbar_created_message: int,
    ) -> None:
        self._event_callback = event_callback
        self._restore_icon = restore_icon
        self._show_menu = show_menu
        self._taskbar_created_message = taskbar_created_message

    def handle(self, message: int, wparam: int, lparam: int) -> bool:
        if self._taskbar_created_message and message == self._taskbar_created_message:
            self._restore_icon()
            return True
        if message == INSTANCE_COMMAND_MESSAGE:
            command = COMMANDS_BY_ID.get(int(wparam))
            if command is not None:
                self._event_callback(command)
            return True
        if message != TRAY_CALLBACK_MESSAGE:
            return False
        if int(lparam) == WM_LBUTTONDBLCLK:
            self._event_callback("show")
            return True
        if int(lparam) in {WM_RBUTTONUP, WM_CONTEXTMENU}:
            command = self._show_menu()
            if command is not None:
                self._event_callback(_validate_command(command))
            return True
        return False


class WindowsTrayIcon:
    """使用系统默认图标创建 Windows 通知区域图标。"""

    def __init__(
        self,
        event_callback: TrayEventCallback,
        *,
        tooltip: str = DEFAULT_TOOLTIP,
    ) -> None:
        self._event_callback = event_callback
        self._tooltip = str(tooltip or DEFAULT_TOOLTIP)[:127]
        self._thread: threading.Thread | None = None
        self._started = threading.Event()
        self._stop_requested = threading.Event()
        self._ready = False
        self._last_error = ""
        self._api: _WindowsApi | None = None
        self._hwnd: int | None = None
        self._hinstance: int | None = None
        self._class_registered = False
        self._icon_added = False
        self._notify_data: _NOTIFYICONDATAW | None = None
        self._wnd_proc = None
        self._router: _TrayMessageRouter | None = None

    @property
    def ready(self) -> bool:
        return self._ready

    @property
    def last_error(self) -> str:
        return self._last_error

    def start(self, timeout: float = 5.0) -> bool:
        """启动托盘线程；只有返回 ``True`` 后调用方才可隐藏主窗口。"""

        if not _IS_WINDOWS:
            self._last_error = "系统托盘只支持 Windows。"
            return False
        if self._thread is not None and self._thread.is_alive():
            return self._ready

        self._started.clear()
        self._stop_requested.clear()
        self._ready = False
        self._last_error = ""
        self._thread = threading.Thread(
            target=self._run_message_loop,
            name="eiketsu-windows-tray",
            daemon=True,
        )
        self._thread.start()
        if not self._started.wait(max(0.0, timeout)):
            self._last_error = "系统托盘启动超时。"
            self.stop()
            return False
        return self._ready

    def stop(self, timeout: float = 3.0) -> None:
        """删除托盘图标并结束消息线程。"""

        thread = self._thread
        api = self._api
        hwnd = self._hwnd
        self._stop_requested.set()
        if api is not None and hwnd:
            api.user32.PostMessageW(hwnd, WM_CLOSE, 0, 0)
        if thread is not None and thread is not threading.current_thread():
            thread.join(max(0.0, timeout))
            if thread.is_alive() and not self._last_error:
                self._last_error = "系统托盘未能及时退出。"

    def _run_message_loop(self) -> None:
        try:
            self._setup_window()
            if not self._add_icon():
                raise RuntimeError(self._last_error or "Windows 未能创建系统托盘图标。")
            if self._stop_requested.is_set():
                self._started.set()
                self._cleanup()
                return
            self._ready = True
        except Exception as exc:  # noqa: BLE001 - 托盘失败不能带崩 GUI。
            self._last_error = str(exc)
            self._started.set()
            self._cleanup()
            return

        self._started.set()
        assert self._api is not None
        message = wintypes.MSG()
        try:
            while True:
                result = int(self._api.user32.GetMessageW(ctypes.byref(message), None, 0, 0))
                if result == 0:
                    break
                if result == -1:
                    raise _last_windows_error("读取托盘消息失败")
                self._api.user32.TranslateMessage(ctypes.byref(message))
                self._api.user32.DispatchMessageW(ctypes.byref(message))
        except Exception as exc:  # noqa: BLE001 - 保留错误供 GUI 展示，退出时仍须删图标。
            self._last_error = str(exc)
        finally:
            self._cleanup()

    def _setup_window(self) -> None:
        api = _load_windows_api()
        self._api = api
        hinstance = api.kernel32.GetModuleHandleW(None)
        if not hinstance:
            raise _last_windows_error("读取程序句柄失败")
        self._hinstance = int(hinstance)
        self._wnd_proc = _WNDPROC_TYPE(self._window_proc)

        default_icon = api.user32.LoadIconW(
            None,
            ctypes.cast(ctypes.c_void_p(IDI_APPLICATION), wintypes.LPCWSTR),
        )
        if not default_icon:
            raise _last_windows_error("读取系统默认图标失败")

        window_class = _WNDCLASSW()
        window_class.lpfnWndProc = self._wnd_proc
        window_class.hInstance = hinstance
        window_class.hIcon = default_icon
        window_class.lpszClassName = WINDOW_CLASS_NAME
        atom = api.user32.RegisterClassW(ctypes.byref(window_class))
        if not atom:
            raise _last_windows_error("注册托盘窗口失败")
        self._class_registered = True

        hwnd = api.user32.CreateWindowExW(
            0,
            WINDOW_CLASS_NAME,
            WINDOW_TITLE,
            0,
            0,
            0,
            0,
            0,
            None,
            None,
            hinstance,
            None,
        )
        if not hwnd:
            raise _last_windows_error("创建托盘窗口失败")
        self._hwnd = int(hwnd)

        taskbar_created_message = int(api.user32.RegisterWindowMessageW("TaskbarCreated"))
        self._router = _TrayMessageRouter(
            self._emit,
            self._add_icon,
            self._show_context_menu,
            taskbar_created_message,
        )

        notify_data = _NOTIFYICONDATAW()
        notify_data.cbSize = ctypes.sizeof(_NOTIFYICONDATAW)
        notify_data.hWnd = hwnd
        notify_data.uID = 1
        notify_data.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP
        notify_data.uCallbackMessage = TRAY_CALLBACK_MESSAGE
        notify_data.hIcon = default_icon
        notify_data.szTip = self._tooltip
        self._notify_data = notify_data

    def _window_proc(self, hwnd, message, wparam, lparam):
        try:
            if message == WM_CLOSE:
                assert self._api is not None
                self._api.user32.DestroyWindow(hwnd)
                return 0
            if message == WM_DESTROY:
                self._delete_icon()
                assert self._api is not None
                self._api.user32.PostQuitMessage(0)
                return 0
            if self._router is not None and self._router.handle(
                int(message),
                int(wparam),
                int(lparam),
            ):
                return 0
        except Exception as exc:  # noqa: BLE001 - ctypes 回调禁止把异常传播给 Windows。
            self._last_error = str(exc)
        assert self._api is not None
        return self._api.user32.DefWindowProcW(hwnd, message, wparam, lparam)

    def _add_icon(self) -> bool:
        api = self._api
        notify_data = self._notify_data
        if api is None or notify_data is None:
            return False
        added = bool(api.shell32.Shell_NotifyIconW(NIM_ADD, ctypes.byref(notify_data)))
        self._icon_added = added
        self._ready = added
        if not added:
            self._last_error = str(_last_windows_error("Windows 未能创建或恢复系统托盘图标"))
        return added

    def _delete_icon(self) -> None:
        if not self._icon_added or self._api is None or self._notify_data is None:
            return
        self._api.shell32.Shell_NotifyIconW(NIM_DELETE, ctypes.byref(self._notify_data))
        self._icon_added = False

    def _show_context_menu(self) -> TrayCommand | None:
        api = self._api
        hwnd = self._hwnd
        if api is None or not hwnd:
            return None
        menu = api.user32.CreatePopupMenu()
        if not menu:
            self._last_error = "Windows 未能创建托盘菜单。"
            return None
        try:
            api.user32.AppendMenuW(menu, MF_STRING, COMMAND_IDS["show"], "打开主窗口")
            api.user32.AppendMenuW(menu, MF_STRING, COMMAND_IDS["run_now"], "立即运行")
            api.user32.AppendMenuW(menu, MF_STRING, COMMAND_IDS["pause_toggle"], "暂停/继续自动任务")
            api.user32.AppendMenuW(menu, MF_SEPARATOR, 0, None)
            api.user32.AppendMenuW(menu, MF_STRING, COMMAND_IDS["exit"], "彻底退出")
            point = wintypes.POINT()
            if not api.user32.GetCursorPos(ctypes.byref(point)):
                return None
            api.user32.SetForegroundWindow(hwnd)
            selected = int(
                api.user32.TrackPopupMenu(
                    menu,
                    TPM_RIGHTBUTTON | TPM_RETURNCMD,
                    point.x,
                    point.y,
                    0,
                    hwnd,
                    None,
                )
            )
            api.user32.PostMessageW(hwnd, WM_NULL, 0, 0)
            return COMMANDS_BY_ID.get(selected)
        finally:
            api.user32.DestroyMenu(menu)

    def _emit(self, command: TrayCommand) -> None:
        try:
            self._event_callback(_validate_command(command))
        except Exception as exc:  # noqa: BLE001 - GUI 回调失败不应结束 Win32 消息泵。
            self._last_error = str(exc)

    def _cleanup(self) -> None:
        api = self._api
        self._delete_icon()
        if api is not None and self._hwnd and api.user32.IsWindow(self._hwnd):
            api.user32.DestroyWindow(self._hwnd)
        self._hwnd = None
        if api is not None and self._class_registered and self._hinstance:
            api.user32.UnregisterClassW(WINDOW_CLASS_NAME, self._hinstance)
        self._class_registered = False
        self._hinstance = None
        self._notify_data = None
        self._router = None
        self._wnd_proc = None
        self._ready = False


def notify_existing_instance(command: str = "show") -> bool:
    """向已运行的托盘实例发送命令，找到并投递成功时返回 ``True``。"""

    validated = _validate_command(command)
    if not _IS_WINDOWS:
        return False
    return _notify_existing_instance(_load_windows_api().user32, validated)


def _notify_existing_instance(user32, command: TrayCommand) -> bool:
    hwnd = user32.FindWindowW(WINDOW_CLASS_NAME, WINDOW_TITLE)
    if not hwnd:
        return False
    return bool(
        user32.PostMessageW(
            hwnd,
            INSTANCE_COMMAND_MESSAGE,
            COMMAND_IDS[command],
            0,
        )
    )


def _load_windows_api() -> _WindowsApi:
    global _cached_api
    if not _IS_WINDOWS:
        raise RuntimeError("系统托盘只支持 Windows。")
    with _api_lock:
        if _cached_api is not None:
            return _cached_api

        user32 = ctypes.WinDLL("user32", use_last_error=True)
        shell32 = ctypes.WinDLL("shell32", use_last_error=True)
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

        user32.RegisterClassW.argtypes = [ctypes.POINTER(_WNDCLASSW)]
        user32.RegisterClassW.restype = wintypes.ATOM
        user32.UnregisterClassW.argtypes = [wintypes.LPCWSTR, wintypes.HINSTANCE]
        user32.UnregisterClassW.restype = wintypes.BOOL
        user32.CreateWindowExW.argtypes = [
            wintypes.DWORD,
            wintypes.LPCWSTR,
            wintypes.LPCWSTR,
            wintypes.DWORD,
            ctypes.c_int,
            ctypes.c_int,
            ctypes.c_int,
            ctypes.c_int,
            wintypes.HWND,
            wintypes.HMENU,
            wintypes.HINSTANCE,
            wintypes.LPVOID,
        ]
        user32.CreateWindowExW.restype = wintypes.HWND
        user32.DefWindowProcW.argtypes = [
            wintypes.HWND,
            wintypes.UINT,
            wintypes.WPARAM,
            wintypes.LPARAM,
        ]
        user32.DefWindowProcW.restype = _LRESULT
        user32.DestroyWindow.argtypes = [wintypes.HWND]
        user32.DestroyWindow.restype = wintypes.BOOL
        user32.IsWindow.argtypes = [wintypes.HWND]
        user32.IsWindow.restype = wintypes.BOOL
        user32.PostQuitMessage.argtypes = [ctypes.c_int]
        user32.GetMessageW.argtypes = [
            ctypes.POINTER(wintypes.MSG),
            wintypes.HWND,
            wintypes.UINT,
            wintypes.UINT,
        ]
        user32.GetMessageW.restype = wintypes.BOOL
        user32.TranslateMessage.argtypes = [ctypes.POINTER(wintypes.MSG)]
        user32.DispatchMessageW.argtypes = [ctypes.POINTER(wintypes.MSG)]
        user32.DispatchMessageW.restype = _LRESULT
        user32.PostMessageW.argtypes = [
            wintypes.HWND,
            wintypes.UINT,
            wintypes.WPARAM,
            wintypes.LPARAM,
        ]
        user32.PostMessageW.restype = wintypes.BOOL
        user32.FindWindowW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR]
        user32.FindWindowW.restype = wintypes.HWND
        user32.RegisterWindowMessageW.argtypes = [wintypes.LPCWSTR]
        user32.RegisterWindowMessageW.restype = wintypes.UINT
        user32.LoadIconW.argtypes = [wintypes.HINSTANCE, wintypes.LPCWSTR]
        user32.LoadIconW.restype = wintypes.HICON
        user32.CreatePopupMenu.restype = wintypes.HMENU
        user32.AppendMenuW.argtypes = [
            wintypes.HMENU,
            wintypes.UINT,
            wintypes.WPARAM,
            wintypes.LPCWSTR,
        ]
        user32.AppendMenuW.restype = wintypes.BOOL
        user32.GetCursorPos.argtypes = [ctypes.POINTER(wintypes.POINT)]
        user32.GetCursorPos.restype = wintypes.BOOL
        user32.SetForegroundWindow.argtypes = [wintypes.HWND]
        user32.SetForegroundWindow.restype = wintypes.BOOL
        user32.TrackPopupMenu.argtypes = [
            wintypes.HMENU,
            wintypes.UINT,
            ctypes.c_int,
            ctypes.c_int,
            ctypes.c_int,
            wintypes.HWND,
            wintypes.LPVOID,
        ]
        user32.TrackPopupMenu.restype = wintypes.UINT
        user32.DestroyMenu.argtypes = [wintypes.HMENU]
        user32.DestroyMenu.restype = wintypes.BOOL

        shell32.Shell_NotifyIconW.argtypes = [
            wintypes.DWORD,
            ctypes.POINTER(_NOTIFYICONDATAW),
        ]
        shell32.Shell_NotifyIconW.restype = wintypes.BOOL

        kernel32.GetModuleHandleW.argtypes = [wintypes.LPCWSTR]
        kernel32.GetModuleHandleW.restype = wintypes.HINSTANCE

        _cached_api = _WindowsApi(user32=user32, shell32=shell32, kernel32=kernel32)
        return _cached_api


def _last_windows_error(label: str) -> OSError:
    code = ctypes.get_last_error()
    detail = ctypes.FormatError(code).strip() if code else "未知 Windows 错误"
    return OSError(code, f"{label}：{detail}")
