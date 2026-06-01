from __future__ import annotations

import json
import re


_SECRET_VALUE_RE = re.compile(r"(?i)\b(token|cookie|secret|password|authorization)\b\s*[:=]\s*[^\s,;]+")
_WINDOWS_PATH_RE = re.compile(r"[A-Za-z]:\\[^\s'\"<>]+")
_UNIX_PATH_RE = re.compile(r"(?<!\w)/(?:[^\s'\"<>:]+/)+[^\s'\"<>]*")


def _sanitize_text(value: object) -> str:
    text = str(value or "")
    text = _SECRET_VALUE_RE.sub(lambda match: f"{match.group(1)}=[redacted]", text)
    text = _WINDOWS_PATH_RE.sub("[path]", text)
    text = _UNIX_PATH_RE.sub("[path]", text)
    return text[:400]


def _sanitize_json(value):
    if isinstance(value, dict):
        return {
            str(key): _sanitize_json(item)
            for key, item in value.items()
            if not re.search(r"(?i)(token|cookie|secret|password|authorization|content_hash|user_id)", str(key))
        }
    if isinstance(value, list):
        return [_sanitize_json(item) for item in value[:20]]
    if isinstance(value, str):
        return _sanitize_text(value)
    return value


def refresh_public_leaderboard_run() -> dict:
    from eiketsu_env.config import load_settings
    from eiketsu_env.services.leaderboard import refresh_public_leaderboard_snapshots

    return _sanitize_json(refresh_public_leaderboard_snapshots(load_settings()))


def main() -> int:
    result = refresh_public_leaderboard_run()
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
