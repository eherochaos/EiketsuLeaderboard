"""Serialize desktop-client sync operations across threads and processes."""

from __future__ import annotations

import errno
import os
import time
from contextlib import contextmanager
from pathlib import Path
from typing import BinaryIO, Iterator

from eiketsu_env.config import Settings


LOCK_FILE_NAME = "client-sync.lock"
INSTANCE_LOCK_FILE_NAME = "client-instance.lock"
INSTANCE_SIGNAL_FILE_NAME = "client-instance-show.request"
_LOCK_RETRY_SECONDS = 0.1
_BUSY_ERRNOS = {errno.EACCES, errno.EAGAIN, errno.EDEADLK}


class ClientSyncBusyError(RuntimeError):
    """Raised when another client sync operation owns the process lock."""


@contextmanager
def client_sync_lock(settings: Settings, blocking: bool = False) -> Iterator[Path]:
    with _client_file_lock(settings.root_dir / LOCK_FILE_NAME, blocking=blocking) as lock_path:
        yield lock_path


@contextmanager
def client_instance_lock(settings: Settings) -> Iterator[Path]:
    """保证同一 Windows 用户只运行一个 GUI/托盘实例。"""

    try:
        with _client_file_lock(settings.root_dir / INSTANCE_LOCK_FILE_NAME, blocking=False) as lock_path:
            yield lock_path
    except ClientSyncBusyError as exc:
        raise ClientSyncBusyError("Eiketsu Collector 已在运行") from exc


def clear_client_instance_signal(settings: Settings) -> None:
    """主实例启动时清理上次异常退出留下的唤醒请求。"""

    try:
        _client_instance_signal_path(settings).unlink(missing_ok=True)
    except OSError:
        pass


def request_client_instance_show(settings: Settings) -> Path:
    """托盘窗口不可用时，通过固定目录文件请求主实例显示窗口。"""

    signal_path = _client_instance_signal_path(settings)
    signal_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = signal_path.with_name(
        f".{signal_path.name}.{os.getpid()}.{time.time_ns()}.tmp"
    )
    try:
        temporary.write_text(str(time.time_ns()), encoding="ascii")
        os.replace(temporary, signal_path)
    finally:
        temporary.unlink(missing_ok=True)
    return signal_path


def consume_client_instance_signal(settings: Settings) -> bool:
    signal_path = _client_instance_signal_path(settings)
    try:
        signal_path.unlink()
    except FileNotFoundError:
        return False
    except OSError:
        return False
    return True


def _client_instance_signal_path(settings: Settings) -> Path:
    return settings.root_dir / INSTANCE_SIGNAL_FILE_NAME


@contextmanager
def _client_file_lock(lock_path: Path, blocking: bool) -> Iterator[Path]:
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    handle = lock_path.open("a+b")
    acquired = False
    try:
        _ensure_lock_byte(handle)
        _acquire_lock(handle, blocking=blocking)
        acquired = True
        yield lock_path
    finally:
        if acquired:
            _release_lock(handle)
        handle.close()


def _ensure_lock_byte(handle: BinaryIO) -> None:
    handle.seek(0, os.SEEK_END)
    if handle.tell() == 0:
        handle.write(b"\0")
        handle.flush()
    handle.seek(0)


def _acquire_lock(handle: BinaryIO, blocking: bool) -> None:
    if os.name == "nt":
        _acquire_windows_lock(handle, blocking=blocking)
        return
    _acquire_posix_lock(handle, blocking=blocking)


def _acquire_windows_lock(handle: BinaryIO, blocking: bool) -> None:
    import msvcrt

    while True:
        handle.seek(0)
        try:
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            return
        except OSError as exc:
            if exc.errno not in _BUSY_ERRNOS:
                raise
            if not blocking:
                raise ClientSyncBusyError("已有同步任务正在运行") from exc
            time.sleep(_LOCK_RETRY_SECONDS)


def _acquire_posix_lock(handle: BinaryIO, blocking: bool) -> None:
    import fcntl

    operation = fcntl.LOCK_EX
    if not blocking:
        operation |= fcntl.LOCK_NB
    try:
        fcntl.flock(handle.fileno(), operation)
    except OSError as exc:
        if exc.errno in _BUSY_ERRNOS:
            raise ClientSyncBusyError("已有同步任务正在运行") from exc
        raise


def _release_lock(handle: BinaryIO) -> None:
    handle.seek(0)
    if os.name == "nt":
        import msvcrt

        msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        return

    import fcntl

    fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
