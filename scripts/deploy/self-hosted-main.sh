#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '[self-hosted-deploy] %s\n' "$*"
}

fail() {
  printf '[self-hosted-deploy] %s\n' "$*" >&2
  exit 1
}

encode_env() {
  printf '%s' "${1:-}" | base64 -w 0
}

case "${DEPLOY_PATH:-}" in
  ''|'/')
    fail 'DEPLOY_PATH is invalid'
    ;;
esac

[ -d apps/web ] || fail 'apps/web is missing'
[ -d apps/api ] || fail 'apps/api is missing'
[ -d apps/web/dist ] || fail 'apps/web/dist is missing; run web build first'

SOURCE_ARCHIVE='/tmp/eiketsu-deploy-source.tgz'
DIST_ARCHIVE='/tmp/eiketsu-web-dist.tgz'

log 'pack deploy source'
tar \
  --exclude='.git' \
  --exclude='apps/api/data' \
  --exclude='apps/web/dist' \
  --exclude='apps/web/node_modules' \
  --exclude='apps/web/npm-cache' \
  --exclude='node_modules' \
  -czf "$SOURCE_ARCHIVE" .

log 'pack web dist'
tar -C apps/web/dist -czf "$DIST_ARCHIVE" .

export DEPLOY_PATH_B64
export DEPLOY_EXPORT_CONTAINER_B64
export DEPLOY_EXPORT_ASSET_ROOT_B64
export DEPLOY_FASTAPI_CONTAINER_B64
export DEPLOY_FASTAPI_FRONTEND_ROOT_B64
export DEPLOY_LIVE_FRONTEND_ROOT_B64
export DEPLOY_LIVE_SNAPSHOT_FILE_B64
export DEPLOY_LIVE_STATUS_FILE_B64
export DEPLOY_RESTART_COMMAND_B64
export SITE_ANALYTICS_ADMIN_TOKEN_B64

DEPLOY_PATH_B64="$(encode_env "$DEPLOY_PATH")"
DEPLOY_EXPORT_CONTAINER_B64="$(encode_env "${DEPLOY_EXPORT_CONTAINER:-}")"
DEPLOY_EXPORT_ASSET_ROOT_B64="$(encode_env "${DEPLOY_EXPORT_ASSET_ROOT:-}")"
DEPLOY_FASTAPI_CONTAINER_B64="$(encode_env "${DEPLOY_FASTAPI_CONTAINER:-}")"
DEPLOY_FASTAPI_FRONTEND_ROOT_B64="$(encode_env "${DEPLOY_FASTAPI_FRONTEND_ROOT:-}")"
DEPLOY_LIVE_FRONTEND_ROOT_B64="$(encode_env "${DEPLOY_LIVE_FRONTEND_ROOT:-}")"
DEPLOY_LIVE_SNAPSHOT_FILE_B64="$(encode_env "${DEPLOY_LIVE_SNAPSHOT_FILE:-}")"
DEPLOY_LIVE_STATUS_FILE_B64="$(encode_env "${DEPLOY_LIVE_STATUS_FILE:-}")"
DEPLOY_RESTART_COMMAND_B64="$(encode_env "${DEPLOY_RESTART_COMMAND:-}")"
SITE_ANALYTICS_ADMIN_TOKEN_B64="$(encode_env "${SITE_ANALYTICS_ADMIN_TOKEN:-}")"

export DEPLOY_SMOKE_URL_BASE="${DEPLOY_SMOKE_URL_BASE:-${DEPLOY_PUBLIC_URL_BASE:-http://127.0.0.1:8000}}"

log 'run deploy script on server'
bash scripts/deploy/remote-main.sh
