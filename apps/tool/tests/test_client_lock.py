from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

from eiketsu_env.config import Settings
from eiketsu_env.services.client_lock import (
    ClientSyncBusyError,
    clear_client_instance_signal,
    client_instance_lock,
    client_sync_lock,
    consume_client_instance_signal,
    request_client_instance_show,
)


_CHILD_LOCK_SCRIPT = """
import sys
from pathlib import Path

from eiketsu_env.config import Settings
from eiketsu_env.services.client_lock import ClientSyncBusyError, client_sync_lock

settings = Settings(root_dir=Path(sys.argv[1]), db_url="sqlite:///unused")
try:
    with client_sync_lock(settings):
        pass
except ClientSyncBusyError:
    raise SystemExit(23)
"""


def _settings(tmp_path: Path) -> Settings:
    return Settings(root_dir=tmp_path, db_url=f"sqlite:///{(tmp_path / 'data' / 'test.db').as_posix()}")


def _run_child_lock_attempt(root_dir: Path) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["PYTHONPATH"] = str(Path(__file__).resolve().parents[1] / "src")
    return subprocess.run(
        [sys.executable, "-c", _CHILD_LOCK_SCRIPT, str(root_dir)],
        capture_output=True,
        check=False,
        env=env,
        text=True,
        timeout=10,
    )


def test_client_sync_lock_rejects_another_process_and_releases(tmp_path):
    settings = _settings(tmp_path)

    with client_sync_lock(settings) as lock_path:
        assert lock_path == tmp_path / "client-sync.lock"
        assert lock_path.exists()
        blocked = _run_child_lock_attempt(tmp_path)

    acquired = _run_child_lock_attempt(tmp_path)

    assert blocked.returncode == 23, blocked.stderr
    assert acquired.returncode == 0, acquired.stderr


def test_client_sync_lock_releases_after_exception(tmp_path):
    settings = _settings(tmp_path)

    with pytest.raises(RuntimeError, match="boom"):
        with client_sync_lock(settings):
            raise RuntimeError("boom")

    with client_sync_lock(settings):
        pass


def test_client_sync_lock_rejects_nested_attempt(tmp_path):
    settings = _settings(tmp_path)

    with client_sync_lock(settings):
        with pytest.raises(ClientSyncBusyError):
            with client_sync_lock(settings):
                pass


def test_client_instance_lock_rejects_second_gui(tmp_path):
    settings = _settings(tmp_path)

    with client_instance_lock(settings):
        with pytest.raises(ClientSyncBusyError, match="已在运行"):
            with client_instance_lock(settings):
                pass


def test_client_instance_show_signal_round_trip_and_stale_cleanup(tmp_path):
    settings = _settings(tmp_path)

    signal_path = request_client_instance_show(settings)

    assert signal_path.exists()
    assert consume_client_instance_signal(settings) is True
    assert consume_client_instance_signal(settings) is False
    request_client_instance_show(settings)
    clear_client_instance_signal(settings)
    assert not signal_path.exists()
