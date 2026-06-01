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

    def _codex_json_file_response(path):
        if not path.is_file():
            raise HTTPException(status_code=404, detail="status file not found")
        return FileResponse(path, media_type="application/json")

    def _codex_leaderboard_node_api_base():
        import os as _codex_os

        return (_codex_os.environ.get("EIKETSU_LEADERBOARD_NODE_API_BASE") or "http://eiketsu-leaderboard-api:8001").rstrip("/")

    def _codex_proxy_leaderboard_node_api(path, method="GET", body=None, content_type="application/json"):
        from urllib.error import HTTPError as _CodexHTTPError
        from urllib.error import URLError as _CodexURLError
        from urllib.request import Request as _CodexUrlRequest
        from urllib.request import urlopen as _codex_urlopen
        from fastapi.responses import Response as _CodexResponse

        target = f"{{_codex_leaderboard_node_api_base()}}{{path}}"
        headers = {{"Accept": "application/json"}}
        if body is not None:
            headers["Content-Type"] = content_type or "application/json"
        request = _CodexUrlRequest(target, data=body, headers=headers, method=method)
        try:
            with _codex_urlopen(request, timeout=20) as upstream:
                response_body = upstream.read()
                media_type = upstream.headers.get("content-type") or "application/json"
                return _CodexResponse(content=response_body, status_code=upstream.status, media_type=media_type)
        except _CodexHTTPError as exc:
            media_type = exc.headers.get("content-type") or "application/json"
            return _CodexResponse(content=exc.read(), status_code=exc.code, media_type=media_type)
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

    @app.get("/api/leaderboard-refresh-status")
    def api_leaderboard_refresh_status():
        import os as _codex_os
        from pathlib import Path as _CodexPath

        configured = (
            _codex_os.environ.get("EIKETSU_LEADERBOARD_REFRESH_STATUS_FILE")
            or _codex_os.environ.get("LEADERBOARD_REFRESH_STATUS_FILE")
        )
        candidates = []
        if configured:
            candidates.append(_CodexPath(configured))
        env_root = _CodexPath(_codex_os.environ.get("EIKETSU_ENV_ROOT") or "/app")
        candidates.extend(
            [
                env_root / "data" / "leaderboard-refresh-status.json",
                env_root / "data" / "snapshots" / "leaderboard-refresh-status.json",
                _codex_leaderboard_frontend_root() / "assets" / "leaderboard-refresh-status.json",
            ]
        )
        for candidate in candidates:
            if candidate.is_file():
                return _codex_json_file_response(candidate)
        raise HTTPException(status_code=404, detail="status file not found")

    @app.get("/api/match-search-options")
    def api_match_search_options():
        return _codex_proxy_leaderboard_node_api("/api/match-search-options")

    from fastapi import Request as _CodexRequest
    globals()["_CodexRequest"] = _CodexRequest

    @app.post("/api/match-search")
    async def api_match_search(request: _CodexRequest):
        body = await request.body()
        content_type = request.headers.get("content-type") or "application/json"
        return _codex_proxy_leaderboard_node_api("/api/match-search", method="POST", body=body, content_type=content_type)
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
