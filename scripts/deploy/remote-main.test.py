from __future__ import annotations

import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).with_name("remote-main.sh")


class RemoteMainDeployScriptTests(unittest.TestCase):
    def setUp(self) -> None:
        self.text = SCRIPT_PATH.read_text(encoding="utf-8")

    def test_live_frontend_publish_waits_for_api_smoke(self) -> None:
        self.assert_order(
            "log 'publish web dist'",
            "log 'refresh leaderboard snapshot'",
            "log 'stop leaderboard node api before restart'",
            "log 'restart service before route install'",
            "log 'install fastapi routes'",
            "log 'reload fastapi routes'",
            "log 'start leaderboard node api'",
            "log 'smoke check api routes'",
            "log 'publish live frontend'",
            "log 'smoke check live routes'",
        )

    def test_api_smoke_checks_tier_list_before_page_smoke(self) -> None:
        api_smoke = self.function_body("smoke_check_api_routes")
        live_smoke = self.function_body("smoke_check_live_routes")
        self.assertIn("/api/tier-list-snapshot", api_smoke)
        self.assertIn("/api/tier-list-deck-config?scope=deck&deckId=", api_smoke)
        self.assertIn("/api/match-search-options", api_smoke)
        self.assertIn("-X POST \"$base/api/match-search\"", api_smoke)
        self.assertIn("-X POST \"$base/api/site-analytics-event\"", api_smoke)
        self.assertIn("$base/api/site-analytics-summary", api_smoke)
        self.assertIn("smoke_check_run_consistency", api_smoke)
        self.assertIn("/tier-list/", live_smoke)
        self.assertIn("/admin-stats/", live_smoke)
        self.assertNotIn("/api/tier-list-snapshot", live_smoke)

    def test_node_api_has_writable_analytics_data_mount(self) -> None:
        start_node = self.function_body("start_leaderboard_node_api")
        self.assertIn('-v "$DEPLOY_PATH:/work:ro"', start_node)
        self.assertIn('-v "$DEPLOY_PATH/$DATA_ROOT:/work/$DATA_ROOT:rw"', start_node)
        self.assertIn("SITE_ANALYTICS_FILE=/work/apps/api/data/site-analytics-events.jsonl", start_node)
        self.assertIn('SITE_ANALYTICS_ADMIN_TOKEN=${SITE_ANALYTICS_ADMIN_TOKEN:-}', start_node)

    def test_api_smoke_checks_public_run_consistency(self) -> None:
        consistency = self.function_body("smoke_check_run_consistency")
        self.assertIn("$base/api/leaderboard-snapshot", consistency)
        self.assertIn("$base/api/tier-list-snapshot", consistency)
        self.assertIn("$base/api/match-search-options", consistency)
        self.assertIn("$base/api/leaderboard-refresh-status", consistency)
        self.assertIn("refresh status run does not match leaderboard snapshot", consistency)

    def test_upload_worker_receives_tier_list_paths(self) -> None:
        worker_install = self.function_body("install_upload_refresh_worker")
        self.assertIn("--tier-list-snapshot-file", worker_install)
        self.assertIn("--tier-list-configs-file", worker_install)
        self.assertIn("TIER_LIST_SNAPSHOT_FILE", worker_install)
        self.assertIn("TIER_LIST_CONFIGS_FILE", worker_install)

    def test_upload_worker_systemd_execstart_uses_absolute_script(self) -> None:
        worker_install = self.function_body("install_upload_refresh_worker")
        self.assertIn('local worker_root="$DEPLOY_PATH/$DATA_ROOT"', worker_install)
        self.assertIn('local worker_script="$worker_root/run-upload-refresh-worker.sh"', worker_install)
        self.assertIn('ensure_writable_dir "$worker_root"', worker_install)
        self.assertIn("ExecStart=$worker_script", worker_install)
        self.assertNotIn('local worker_script="$DATA_ROOT/run-upload-refresh-worker.sh"', worker_install)
        self.assertNotIn('ensure_writable_dir "$DATA_ROOT"', worker_install)

    def test_route_reload_keeps_installed_container_patch(self) -> None:
        route_reload = self.function_body("reload_fastapi_routes")
        self.assertIn("require_fastapi_container", route_reload)
        self.assertIn("docker restart \"$DEPLOY_FASTAPI_CONTAINER\"", route_reload)
        self.assertNotIn("DEPLOY_RESTART_COMMAND", route_reload)

    def test_node_api_is_removed_before_service_restart(self) -> None:
        stop_node = self.function_body("stop_leaderboard_node_api")
        self.assertIn("docker rm -f \"$DEPLOY_NODE_API_CONTAINER\"", stop_node)
        self.assertIn("|| true", stop_node)

    def assert_order(self, *needles: str) -> None:
        positions = [self.text.index(needle) for needle in needles]
        self.assertEqual(positions, sorted(positions))

    def function_body(self, name: str) -> str:
        start = self.text.index(f"{name}() {{")
        end = self.text.index("\n}\n", start)
        return self.text[start:end]


if __name__ == "__main__":
    unittest.main()
