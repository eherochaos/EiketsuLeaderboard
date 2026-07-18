"""Windows 当前用户登录自启。

注册表中只保存程序路径和 ``--background`` 参数。采集配置、登录态和
客户端令牌仍由程序从本地配置文件读取，不进入命令行。
"""

from __future__ import annotations

import subprocess
import sys

try:
    import winreg as _winreg
except ImportError:  # pragma: no cover - Windows 客户端之外只需保持模块可导入。
    _winreg = None  # type: ignore[assignment]


RUN_KEY_PATH = r"Software\Microsoft\Windows\CurrentVersion\Run"
RUN_VALUE_NAME = "EiketsuCollector"
BACKGROUND_ARGUMENT = "--background"


def build_startup_argv(
    executable: str | None = None,
    *,
    frozen: bool | None = None,
) -> list[str]:
    """生成登录自启参数，不包含任何用户配置或凭据。"""

    program = str(executable or sys.executable)
    packaged = bool(getattr(sys, "frozen", False)) if frozen is None else frozen
    if packaged:
        return [program, BACKGROUND_ARGUMENT]
    return [program, "-m", "eiketsu_env.client_gui", BACKGROUND_ARGUMENT]


def build_startup_command(
    executable: str | None = None,
    *,
    frozen: bool | None = None,
) -> str:
    """按 Windows 命令行规则引用可执行文件路径。"""

    return subprocess.list2cmdline(build_startup_argv(executable, frozen=frozen))


def read_startup_command() -> str | None:
    """读取本程序的 Run 项；未配置时返回 ``None``。"""

    registry = _require_registry()
    try:
        with registry.OpenKey(
            registry.HKEY_CURRENT_USER,
            RUN_KEY_PATH,
            0,
            registry.KEY_QUERY_VALUE,
        ) as key:
            value, _value_type = registry.QueryValueEx(key, RUN_VALUE_NAME)
    except FileNotFoundError:
        return None
    command = str(value or "").strip()
    return command or None


def is_startup_enabled(
    executable: str | None = None,
    *,
    frozen: bool | None = None,
) -> bool:
    """判断 Run 项是否指向当前程序及后台入口。"""

    stored = read_startup_command()
    if stored is None:
        return False
    return stored == build_startup_command(executable, frozen=frozen)


def set_startup_enabled(
    enabled: bool,
    executable: str | None = None,
    *,
    frozen: bool | None = None,
) -> str | None:
    """启用或关闭当前用户登录自启。

    启用时返回写入的命令，关闭时返回 ``None``。调用方可在每次保存设置
    或新版程序启动时再次启用，以修正带版本号的 EXE 路径。
    """

    registry = _require_registry()
    if not enabled:
        try:
            with registry.OpenKey(
                registry.HKEY_CURRENT_USER,
                RUN_KEY_PATH,
                0,
                registry.KEY_SET_VALUE,
            ) as key:
                registry.DeleteValue(key, RUN_VALUE_NAME)
        except FileNotFoundError:
            pass
        return None

    command = build_startup_command(executable, frozen=frozen)
    with registry.CreateKeyEx(
        registry.HKEY_CURRENT_USER,
        RUN_KEY_PATH,
        0,
        registry.KEY_SET_VALUE,
    ) as key:
        registry.SetValueEx(key, RUN_VALUE_NAME, 0, registry.REG_SZ, command)
    return command


def _require_registry():
    if _winreg is None:
        raise RuntimeError("登录自启只支持 Windows。")
    return _winreg
