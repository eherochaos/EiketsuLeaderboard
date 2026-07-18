import sqlite3

import pytest

from eiketsu_env.config import (
    client_app_data_dir,
    client_runtime_root,
    known_target_versions,
    latest_target_version,
    load_client_settings,
    load_settings,
    migrate_legacy_client_database,
    version_start_date,
)


def test_version_start_dates_include_current_target_version():
    assert version_start_date("Ver.3.5.0C") == "2026-06-17"
    assert latest_target_version() == "Ver.3.5.0C"
    assert known_target_versions()[:2] == ["Ver.3.5.0C", "Ver.3.5.0B"]


def test_client_app_data_dir_uses_appdata(tmp_path, monkeypatch):
    appdata = tmp_path / "roaming"
    monkeypatch.setenv("APPDATA", str(appdata))

    assert client_app_data_dir() == (appdata / "EiketsuCollector").resolve()


def test_client_runtime_root_supports_both_overrides(tmp_path, monkeypatch):
    global_root = tmp_path / "global-root"
    client_root = tmp_path / "client-root"
    monkeypatch.setenv("EIKETSU_CLIENT_RUNTIME_ROOT", str(client_root))
    monkeypatch.delenv("EIKETSU_ENV_ROOT", raising=False)

    assert client_runtime_root() == client_root.resolve()

    monkeypatch.setenv("EIKETSU_ENV_ROOT", str(global_root))

    assert client_runtime_root() == global_root.resolve()


def test_load_client_settings_is_independent_from_working_directory(tmp_path, monkeypatch):
    appdata = tmp_path / "roaming"
    working_dir = tmp_path / "working"
    working_dir.mkdir()
    monkeypatch.setenv("APPDATA", str(appdata))
    monkeypatch.delenv("EIKETSU_ENV_ROOT", raising=False)
    monkeypatch.delenv("EIKETSU_CLIENT_RUNTIME_ROOT", raising=False)
    monkeypatch.chdir(working_dir)

    settings = load_client_settings()

    expected_root = (appdata / "EiketsuCollector").resolve()
    assert settings.root_dir == expected_root
    assert settings.data_dir == expected_root / "data"


def test_load_settings_keeps_existing_working_directory_default(tmp_path, monkeypatch):
    working_dir = tmp_path / "working"
    working_dir.mkdir()
    monkeypatch.delenv("EIKETSU_ENV_ROOT", raising=False)
    monkeypatch.chdir(working_dir)

    assert load_settings().root_dir == working_dir.resolve()


def test_migrate_legacy_client_database_uses_sqlite_backup(tmp_path, monkeypatch):
    legacy_root = tmp_path / "legacy"
    source = legacy_root / "data" / "eiketsu_env.db"
    source.parent.mkdir(parents=True)
    with sqlite3.connect(source) as connection:
        connection.execute("CREATE TABLE sample (value TEXT NOT NULL)")
        connection.execute("INSERT INTO sample (value) VALUES ('kept')")
        connection.commit()

    target_root = tmp_path / "appdata" / "EiketsuCollector"
    monkeypatch.delenv("EIKETSU_ENV_ROOT", raising=False)
    monkeypatch.delenv("EIKETSU_CLIENT_RUNTIME_ROOT", raising=False)
    settings = load_settings(target_root)

    migrated = migrate_legacy_client_database(settings, legacy_root)

    assert migrated == target_root / "data" / "eiketsu_env.db"
    with sqlite3.connect(migrated) as connection:
        assert connection.execute("SELECT value FROM sample").fetchone() == ("kept",)
    assert migrate_legacy_client_database(settings, legacy_root) is None


def test_migrate_legacy_client_database_removes_partial_target_when_source_is_corrupt(tmp_path, monkeypatch):
    legacy_root = tmp_path / "legacy"
    source = legacy_root / "data" / "eiketsu_env.db"
    source.parent.mkdir(parents=True)
    source.write_bytes(b"not-a-sqlite-database")
    target_root = tmp_path / "appdata" / "EiketsuCollector"
    monkeypatch.delenv("EIKETSU_ENV_ROOT", raising=False)
    monkeypatch.delenv("EIKETSU_CLIENT_RUNTIME_ROOT", raising=False)
    settings = load_settings(target_root)

    with pytest.raises(sqlite3.DatabaseError):
        migrate_legacy_client_database(settings, legacy_root)

    target = target_root / "data" / "eiketsu_env.db"
    assert not target.exists()
    assert not target.with_suffix(".db.migrating").exists()
