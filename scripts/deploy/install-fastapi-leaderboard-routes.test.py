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
        self.assertIn("from fastapi import Request as _CodexRequest", MODULE.ROUTE_BLOCK)
        self.assertIn("globals()[\"_CodexRequest\"] = _CodexRequest", MODULE.ROUTE_BLOCK)
        self.assertIn("request: _CodexRequest", MODULE.ROUTE_BLOCK)
        self.assertIn("await request.body()", MODULE.ROUTE_BLOCK)
        self.assertNotIn("_CodexBody", MODULE.ROUTE_BLOCK)


if __name__ == "__main__":
    unittest.main()
