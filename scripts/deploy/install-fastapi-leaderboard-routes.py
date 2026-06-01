from __future__ import annotations

import inspect
import sys
from pathlib import Path


MARKER = "# BEGIN CODEX LEADERBOARD STATUS ROUTES"

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

    @app.get("/leaderboard-status")
    @app.get("/leaderboard-status/")
    def leaderboard_status_page():
        path = _codex_leaderboard_frontend_root() / "leaderboard-status" / "index.html"
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
    # END CODEX LEADERBOARD STATUS ROUTES
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
    if MARKER in text:
        print("leaderboard status routes already installed")
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
