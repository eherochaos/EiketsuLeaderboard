from __future__ import annotations

import inspect
import sys
from pathlib import Path


MARKER = "# BEGIN CODEX LEADERBOARD STATUS ROUTES"
END_MARKER = "# END CODEX LEADERBOARD STATUS ROUTES"

ROUTE_BLOCK = f"""
    {MARKER}
    def _codex_leaderboard_frontend_root():
        import os as _codex_os
        from pathlib import Path as _CodexPath

        env_root = _CodexPath(_codex_os.environ.get("EIKETSU_ENV_ROOT") or "/app")
        candidates = [
            env_root / "frontend" / "eiketsu-leaderboard",
            env_root / "frontend" / "leaderboard",
        ]
        for candidate in candidates:
            if candidate.is_dir():
                return candidate
        return candidates[0]

    def _codex_leaderboard_node_api_base():
        import os as _codex_os

        return (_codex_os.environ.get("EIKETSU_LEADERBOARD_NODE_API_BASE") or "http://eiketsu-leaderboard-api:8001").rstrip("/")

    from fastapi import Request as _CodexRequest
    globals()["_CodexRequest"] = _CodexRequest

    @app.middleware("http")
    async def _codex_include_battle_festival_config(request: _CodexRequest, call_next):
        response = await call_next(request)
        if request.method != "GET" or request.url.path != "/api/v1/config" or response.status_code != 200:
            return response
        content_type = response.headers.get("content-type") or ""
        if "application/json" not in content_type:
            return response

        import json as _codex_json
        from fastapi.responses import Response as _CodexResponse

        body = b""
        async for chunk in response.body_iterator:
            body += chunk
        try:
            payload = _codex_json.loads(body)
        except Exception:
            return _CodexResponse(content=body, status_code=response.status_code, media_type=content_type)

        if isinstance(payload, dict) and payload.get("configured", True):
            payload["include_battle_festival"] = True
        headers = {{
            key: value
            for key, value in response.headers.items()
            if key.lower() not in ("content-length", "content-type")
        }}
        return _CodexResponse(
            content=_codex_json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            status_code=response.status_code,
            media_type="application/json",
            headers=headers,
        )

    def _codex_proxy_headers(upstream_headers):
        headers = {{}}
        for name in ("cache-control", "etag", "last-modified", "vary", "content-encoding"):
            value = upstream_headers.get(name)
            if value:
                headers[name] = value
        return headers

    def _codex_proxy_leaderboard_node_api(path, method="GET", body=None, content_type="application/json", forward_headers=None):
        from urllib.error import HTTPError as _CodexHTTPError
        from urllib.error import URLError as _CodexURLError
        from urllib.request import Request as _CodexUrlRequest
        from urllib.request import urlopen as _codex_urlopen
        from fastapi.responses import Response as _CodexResponse

        target = f"{{_codex_leaderboard_node_api_base()}}{{path}}"
        headers = {{"Accept": "application/json"}}
        if forward_headers:
            for source_name, target_name in (
                ("accept-encoding", "Accept-Encoding"),
                ("if-none-match", "If-None-Match"),
                ("if-modified-since", "If-Modified-Since"),
                ("authorization", "Authorization"),
            ):
                value = forward_headers.get(source_name)
                if value:
                    headers[target_name] = value
        if body is not None:
            headers["Content-Type"] = content_type or "application/json"
        request = _CodexUrlRequest(target, data=body, headers=headers, method=method)
        try:
            with _codex_urlopen(request, timeout=20) as upstream:
                response_body = upstream.read()
                media_type = upstream.headers.get("content-type") or "application/json"
                return _CodexResponse(content=response_body, status_code=upstream.status, media_type=media_type, headers=_codex_proxy_headers(upstream.headers))
        except _CodexHTTPError as exc:
            media_type = exc.headers.get("content-type") or "application/json"
            return _CodexResponse(content=exc.read(), status_code=exc.code, media_type=media_type, headers=_codex_proxy_headers(exc.headers))
        except _CodexURLError:
            raise HTTPException(status_code=502, detail="leaderboard api unavailable")

    @app.get("/leaderboard-status")
    @app.get("/leaderboard-status/")
    def leaderboard_status_page():
        path = _codex_leaderboard_frontend_root() / "leaderboard-status" / "index.html"
        if not path.is_file():
            raise HTTPException(status_code=404, detail="static file not found")
        return FileResponse(path, media_type="text/html; charset=utf-8")

    @app.get("/match-search")
    @app.get("/match-search/")
    def match_search_page():
        path = _codex_leaderboard_frontend_root() / "match-search" / "index.html"
        if not path.is_file():
            raise HTTPException(status_code=404, detail="static file not found")
        return FileResponse(path, media_type="text/html; charset=utf-8")

    @app.get("/admin-stats")
    @app.get("/admin-stats/")
    def admin_stats_page():
        path = _codex_leaderboard_frontend_root() / "admin-stats" / "index.html"
        if not path.is_file():
            raise HTTPException(status_code=404, detail="static file not found")
        return FileResponse(path, media_type="text/html; charset=utf-8")

    @app.get("/battle-festival")
    @app.get("/battle-festival/")
    def battle_festival_page():
        path = _codex_leaderboard_frontend_root() / "battle-festival" / "index.html"
        if not path.is_file():
            raise HTTPException(status_code=404, detail="static file not found")
        return FileResponse(path, media_type="text/html; charset=utf-8")

    @app.get("/api/leaderboard-refresh-status")
    def api_leaderboard_refresh_status(request: _CodexRequest):
        return _codex_proxy_leaderboard_node_api("/api/leaderboard-refresh-status", forward_headers=request.headers)

    @app.get("/api/leaderboard-snapshot")
    def api_leaderboard_snapshot(request: _CodexRequest):
        return _codex_proxy_leaderboard_node_api("/api/leaderboard-snapshot", forward_headers=request.headers)

    @app.get("/api/tier-list-snapshot")
    def api_tier_list_snapshot(request: _CodexRequest):
        return _codex_proxy_leaderboard_node_api("/api/tier-list-snapshot", forward_headers=request.headers)

    @app.get("/api/tier-list-deck-config")
    def api_tier_list_deck_config(request: _CodexRequest):
        query = request.url.query
        path = "/api/tier-list-deck-config"
        if query:
            path = f"{{path}}?{{query}}"
        return _codex_proxy_leaderboard_node_api(path, forward_headers=request.headers)

    @app.get("/api/battle-festival-snapshot")
    def api_battle_festival_snapshot(request: _CodexRequest):
        return _codex_proxy_leaderboard_node_api("/api/battle-festival-snapshot", forward_headers=request.headers)

    @app.get("/api/battle-festival-deck-config")
    def api_battle_festival_deck_config(request: _CodexRequest):
        query = request.url.query
        path = "/api/battle-festival-deck-config"
        if query:
            path = f"{{path}}?{{query}}"
        return _codex_proxy_leaderboard_node_api(path, forward_headers=request.headers)

    @app.get("/api/match-search-options")
    def api_match_search_options():
        return _codex_proxy_leaderboard_node_api("/api/match-search-options")

    @app.post("/api/match-search")
    async def api_match_search(request: _CodexRequest):
        body = await request.body()
        content_type = request.headers.get("content-type") or "application/json"
        return _codex_proxy_leaderboard_node_api("/api/match-search", method="POST", body=body, content_type=content_type)

    @app.post("/api/site-analytics-event")
    async def api_site_analytics_event(request: _CodexRequest):
        body = await request.body()
        content_type = request.headers.get("content-type") or "application/json"
        return _codex_proxy_leaderboard_node_api("/api/site-analytics-event", method="POST", body=body, content_type=content_type)

    @app.get("/api/site-analytics-summary")
    def api_site_analytics_summary(request: _CodexRequest):
        query = request.url.query
        path = "/api/site-analytics-summary"
        if query:
            path = f"{{path}}?{{query}}"
        return _codex_proxy_leaderboard_node_api(path, forward_headers=request.headers)
    {END_MARKER}
"""


def main() -> int:
    try:
        import eiketsu_env.server_app as server_app
    except Exception as exc:  # pragma: no cover - deploy environment only
        print(f"cannot import eiketsu_env.server_app: {exc}", file=sys.stderr)
        return 1

    source = inspect.getsourcefile(server_app)
    if not source:
        print("cannot locate eiketsu_env.server_app source", file=sys.stderr)
        return 1

    source_path = Path(source)
    text = source_path.read_text(encoding="utf-8")
    marker_start = text.find(f"    {MARKER}")
    if marker_start >= 0:
        marker_end = text.find(f"    {END_MARKER}", marker_start)
        if marker_end < 0:
            print("cannot locate leaderboard routes end marker", file=sys.stderr)
            return 1
        block_end = text.find("\n", marker_end)
        if block_end < 0:
            block_end = len(text)
        else:
            block_end += 1
        source_path.write_text(text[:marker_start] + ROUTE_BLOCK + text[block_end:], encoding="utf-8")
        print("leaderboard routes updated")
        return 0

    needle = "\n    return app\n"
    insert_at = text.rfind(needle)
    if insert_at < 0:
        print("cannot locate create_app return marker", file=sys.stderr)
        return 1

    backup_path = source_path.with_suffix(source_path.suffix + ".codex-leaderboard-routes.bak")
    if not backup_path.exists():
        backup_path.write_text(text, encoding="utf-8")

    source_path.write_text(text[:insert_at] + ROUTE_BLOCK + text[insert_at:], encoding="utf-8")
    print("leaderboard status routes installed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
