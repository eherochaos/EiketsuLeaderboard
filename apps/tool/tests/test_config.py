from eiketsu_env.config import known_target_versions, latest_target_version, version_start_date


def test_version_start_dates_include_current_target_version():
    assert version_start_date("Ver.3.5.0C") == "2026-06-17"
    assert latest_target_version() == "Ver.3.5.0C"
    assert known_target_versions()[:2] == ["Ver.3.5.0C", "Ver.3.5.0B"]
