from __future__ import annotations

import unittest
import importlib.util
from pathlib import Path


SCRIPT_PATH = Path(__file__).with_name("install-fastapi-leaderboard-routes.py")
SPEC = importlib.util.spec_from_file_location("install_fastapi_leaderboard_routes", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class InstallFastApiLeaderboardRoutesTests(unittest.TestCase):
    def test_match_search_post_uses_request_annotation_and_registers_global(self) -> None:
        self.assertIn(MODULE.MARKER, MODULE.ROUTE_BLOCK)
        self.assertIn(MODULE.END_MARKER, MODULE.ROUTE_BLOCK)
        self.assertIn("@app.post(\"/api/match-search\")", MODULE.ROUTE_BLOCK)
        self.assertIn("@app.get(\"/api/tier-list-snapshot\")", MODULE.ROUTE_BLOCK)
        self.assertIn("@app.get(\"/api/tier-list-deck-config\")", MODULE.ROUTE_BLOCK)
        self.assertIn("@app.get(\"/admin-stats/\")", MODULE.ROUTE_BLOCK)
        self.assertIn("@app.get(\"/battle-festival/\")", MODULE.ROUTE_BLOCK)
        self.assertIn("@app.get(\"/api/battle-festival-snapshot\")", MODULE.ROUTE_BLOCK)
        self.assertIn("@app.get(\"/api/battle-festival-deck-config\")", MODULE.ROUTE_BLOCK)
        self.assertIn("@app.get(\"/api/version-options\")", MODULE.ROUTE_BLOCK)
        self.assertIn("@app.post(\"/api/site-analytics-event\")", MODULE.ROUTE_BLOCK)
        self.assertIn("@app.get(\"/api/site-analytics-summary\")", MODULE.ROUTE_BLOCK)
        self.assertIn("@app.middleware(\"http\")", MODULE.ROUTE_BLOCK)
        self.assertIn("_codex_default_battle_festival_config", MODULE.ROUTE_BLOCK)
        self.assertIn("payload.setdefault(\"include_battle_festival\", False)", MODULE.ROUTE_BLOCK)
        self.assertIn("_codex_proxy_leaderboard_node_api(\"/api/leaderboard-refresh-status\"", MODULE.ROUTE_BLOCK)
        self.assertIn("_codex_proxy_leaderboard_node_api(\"/api/version-options\"", MODULE.ROUTE_BLOCK)
        self.assertIn("_codex_path_with_query", MODULE.ROUTE_BLOCK)
        self.assertIn("_codex_path_with_query(request, \"/api/leaderboard-snapshot\")", MODULE.ROUTE_BLOCK)
        self.assertIn("_codex_path_with_query(request, \"/api/tier-list-snapshot\")", MODULE.ROUTE_BLOCK)
        self.assertIn("_codex_path_with_query(request, \"/api/match-search-options\")", MODULE.ROUTE_BLOCK)
        self.assertIn("_codex_proxy_leaderboard_node_api(\"/api/battle-festival-snapshot\"", MODULE.ROUTE_BLOCK)
        self.assertIn("_codex_path_with_query(request, \"/api/tier-list-deck-config\")", MODULE.ROUTE_BLOCK)
        self.assertIn("_codex_path_with_query(request, \"/api/battle-festival-deck-config\")", MODULE.ROUTE_BLOCK)
        self.assertIn("from fastapi import Request as _CodexRequest", MODULE.ROUTE_BLOCK)
        self.assertIn("globals()[\"_CodexRequest\"] = _CodexRequest", MODULE.ROUTE_BLOCK)
        self.assertIn("request: _CodexRequest", MODULE.ROUTE_BLOCK)
        self.assertIn("await request.body()", MODULE.ROUTE_BLOCK)
        self.assertIn("cache-control", MODULE.ROUTE_BLOCK)
        self.assertIn("etag", MODULE.ROUTE_BLOCK)
        self.assertIn("last-modified", MODULE.ROUTE_BLOCK)
        self.assertIn("content-encoding", MODULE.ROUTE_BLOCK)
        self.assertIn("(\"authorization\", \"Authorization\")", MODULE.ROUTE_BLOCK)
        self.assertIn("if-none-match", MODULE.ROUTE_BLOCK)
        self.assertIn("if-modified-since", MODULE.ROUTE_BLOCK)
        self.assertIn("forward_headers=request.headers", MODULE.ROUTE_BLOCK)
        self.assertNotIn("_CodexBody", MODULE.ROUTE_BLOCK)
        self.assertNotIn("status file not found", MODULE.ROUTE_BLOCK)
        self.assertNotIn("leaderboard-refresh-status.json", MODULE.ROUTE_BLOCK)

    def test_existing_snapshot_upstream_points_to_active_node_sidecar(self) -> None:
        source = (
            "LEADERBOARD_SNAPSHOT_NODE_URL = os.environ.get(\n"
            "    \"LEADERBOARD_SNAPSHOT_NODE_URL\",\n"
            "    \"http://eiketsu-leaderboard-snapshot:8001/api/leaderboard-snapshot\",\n"
            ")\n"
        )
        patched = MODULE.patch_existing_snapshot_upstream(source)
        self.assertIn("http://eiketsu-leaderboard-api:8001/api/leaderboard-snapshot", patched)
        self.assertNotIn("http://eiketsu-leaderboard-snapshot:8001/api/leaderboard-snapshot", patched)


if __name__ == "__main__":
    unittest.main()
