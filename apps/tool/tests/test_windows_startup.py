from __future__ import annotations

from dataclasses import dataclass

import pytest

from eiketsu_env.services import windows_startup


@dataclass
class _FakeKey:
    registry: "_FakeRegistry"
    path: str

    def __enter__(self) -> "_FakeKey":
        return self

    def __exit__(self, _exc_type, _exc, _traceback) -> None:
        return None


class _FakeRegistry:
    HKEY_CURRENT_USER = object()
    KEY_QUERY_VALUE = 1
    KEY_SET_VALUE = 2
    REG_SZ = 1

    def __init__(self) -> None:
        self.keys: set[str] = set()
        self.values: dict[tuple[str, str], str] = {}

    def CreateKeyEx(self, _root, path: str, _reserved: int, _access: int) -> _FakeKey:
        self.keys.add(path)
        return _FakeKey(self, path)

    def OpenKey(self, _root, path: str, _reserved: int, _access: int) -> _FakeKey:
        if path not in self.keys:
            raise FileNotFoundError(path)
        return _FakeKey(self, path)

    def SetValueEx(self, key: _FakeKey, name: str, _reserved: int, _kind: int, value: str) -> None:
        self.values[(key.path, name)] = value

    def QueryValueEx(self, key: _FakeKey, name: str) -> tuple[str, int]:
        try:
            return self.values[(key.path, name)], self.REG_SZ
        except KeyError as exc:
            raise FileNotFoundError(name) from exc

    def DeleteValue(self, key: _FakeKey, name: str) -> None:
        try:
            del self.values[(key.path, name)]
        except KeyError as exc:
            raise FileNotFoundError(name) from exc


def test_build_startup_argv_uses_packaged_background_entry() -> None:
    assert windows_startup.build_startup_argv(
        r"C:\Program Files\Eiketsu\EiketsuCollector_0.2.13.exe",
        frozen=True,
    ) == [
        r"C:\Program Files\Eiketsu\EiketsuCollector_0.2.13.exe",
        "--background",
    ]


def test_build_startup_argv_supports_source_development() -> None:
    assert windows_startup.build_startup_argv(r"C:\Python311\python.exe", frozen=False) == [
        r"C:\Python311\python.exe",
        "-m",
        "eiketsu_env.client_gui",
        "--background",
    ]


def test_build_startup_command_quotes_path_and_contains_no_config() -> None:
    command = windows_startup.build_startup_command(
        r"C:\Program Files\Eiketsu\EiketsuCollector.exe",
        frozen=True,
    )

    assert command == r'"C:\Program Files\Eiketsu\EiketsuCollector.exe" --background'
    assert "token" not in command.lower()
    assert "config" not in command.lower()


def test_set_read_and_remove_startup_value(monkeypatch: pytest.MonkeyPatch) -> None:
    registry = _FakeRegistry()
    monkeypatch.setattr(windows_startup, "_winreg", registry)
    executable = r"C:\Users\Alice\Apps\EiketsuCollector_0.2.13.exe"

    written = windows_startup.set_startup_enabled(True, executable, frozen=True)

    assert written == f"{executable} --background"
    assert windows_startup.read_startup_command() == written
    assert windows_startup.is_startup_enabled(executable, frozen=True)
    assert not windows_startup.is_startup_enabled(
        r"C:\Users\Alice\Apps\EiketsuCollector_0.2.12.exe",
        frozen=True,
    )

    assert windows_startup.set_startup_enabled(False) is None
    assert windows_startup.read_startup_command() is None


def test_disabling_missing_startup_value_is_idempotent(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(windows_startup, "_winreg", _FakeRegistry())

    assert windows_startup.set_startup_enabled(False) is None


def test_registry_access_reports_unsupported_platform(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(windows_startup, "_winreg", None)

    with pytest.raises(RuntimeError, match="只支持 Windows"):
        windows_startup.read_startup_command()
