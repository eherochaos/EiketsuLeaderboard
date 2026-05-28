#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '[deploy] %s\n' "$*"
}

fail() {
  printf '[deploy] %s\n' "$*" >&2
  exit 1
}

ensure_writable_dir() {
  local path="$1"
  mkdir -p "$path" 2>/dev/null || sudo -n mkdir -p "$path"
  if [ ! -w "$path" ] || [ -n "$(find "$path" -maxdepth 1 ! -user "$(id -u)" -print -quit 2>/dev/null)" ]; then
    sudo -n chown -R "$(id -u):$(id -g)" "$path"
  fi
}

ensure_deploy_owner() {
  local path="$1"
  [ -e "$path" ] || return 0
  sudo -n chown -R "$(id -u):$(id -g)" "$path" 2>/dev/null || chown -R "$(id -u):$(id -g)" "$path"
}

decode_env() {
  if [ -z "${1:-}" ]; then
    printf ''
    return
  fi
  printf '%s' "$1" | base64 --decode
}

DEPLOY_PATH="$(decode_env "${DEPLOY_PATH_B64:-}")"
DEPLOY_EXPORT_CONTAINER="$(decode_env "${DEPLOY_EXPORT_CONTAINER_B64:-}")"
DEPLOY_EXPORT_ASSET_ROOT="$(decode_env "${DEPLOY_EXPORT_ASSET_ROOT_B64:-}")"
DEPLOY_RESTART_COMMAND="$(decode_env "${DEPLOY_RESTART_COMMAND_B64:-}")"
DEPLOY_EXPORT_POSTGRES="${DEPLOY_EXPORT_POSTGRES:-1}"
DEPLOY_EXPORT_CONTAINER="${DEPLOY_EXPORT_CONTAINER:-eiketsu-env-db-api-1}"
DEPLOY_EXPORT_ASSET_ROOT="${DEPLOY_EXPORT_ASSET_ROOT:-/home/ubuntu/eiketsu-env-db/assets}"

case "$DEPLOY_EXPORT_POSTGRES" in
  '0'|'1')
    ;;
  *)
    fail 'DEPLOY_EXPORT_POSTGRES must be 0 or 1'
    ;;
esac

case "$DEPLOY_PATH" in
  ''|'/')
    fail 'DEPLOY_PATH is invalid'
    ;;
esac

cd "$DEPLOY_PATH" || fail 'DEPLOY_PATH is not accessible'

SOURCE_ARCHIVE='/tmp/eiketsu-deploy-source.tgz'
DIST_ARCHIVE='/tmp/eiketsu-web-dist.tgz'

[ -f "$SOURCE_ARCHIVE" ] || fail 'deploy source archive is missing'
[ -f "$DIST_ARCHIVE" ] || fail 'web dist archive is missing'

log 'publish source'
tar -xzf "$SOURCE_ARCHIVE" -C "$DEPLOY_PATH"
rm -f "$SOURCE_ARCHIVE"

[ -d apps/web ] || fail 'apps/web is missing'
[ -d apps/api ] || fail 'apps/api is missing'

log 'publish web dist'
rm -rf apps/web/dist.next
mkdir -p apps/web/dist.next
tar -xzf "$DIST_ARCHIVE" -C apps/web/dist.next
rm -f "$DIST_ARCHIVE"
rm -rf apps/web/dist.prev
if [ -d apps/web/dist ]; then
  mv apps/web/dist apps/web/dist.prev
fi
mv apps/web/dist.next apps/web/dist

DATA_ROOT='apps/api/data'
LEGACY_ROOT="$DATA_ROOT/legacy-service"
if [ "$DEPLOY_EXPORT_POSTGRES" = '1' ]; then
  log 'export postgres data'
  ensure_writable_dir "$DATA_ROOT"
  rm -rf "$DATA_ROOT/legacy-service.next"
  if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -Fx "$DEPLOY_EXPORT_CONTAINER" >/dev/null 2>&1; then
    container_export_root="/tmp/eiketsu-legacy-service-export-$$"
    container_settings_root="/tmp/eiketsu-export-settings-$$"
    docker exec "$DEPLOY_EXPORT_CONTAINER" rm -rf "$container_export_root" "$container_settings_root" /tmp/export_legacy_service_from_postgres.py
    docker cp apps/api/data-migration/export_legacy_service_from_postgres.py "$DEPLOY_EXPORT_CONTAINER:/tmp/export_legacy_service_from_postgres.py"
    if [ -d "$DEPLOY_EXPORT_ASSET_ROOT" ]; then
      docker exec "$DEPLOY_EXPORT_CONTAINER" mkdir -p "$container_settings_root/assets"
      docker cp "$DEPLOY_EXPORT_ASSET_ROOT/." "$DEPLOY_EXPORT_CONTAINER:$container_settings_root/assets"
      docker exec -e EIKETSU_ENV_ROOT="$container_settings_root" "$DEPLOY_EXPORT_CONTAINER" python /tmp/export_legacy_service_from_postgres.py --output "$container_export_root"
    else
      docker exec "$DEPLOY_EXPORT_CONTAINER" python /tmp/export_legacy_service_from_postgres.py --output "$container_export_root"
    fi
    docker cp "$DEPLOY_EXPORT_CONTAINER:$container_export_root" "$DATA_ROOT/legacy-service.next"
    docker exec "$DEPLOY_EXPORT_CONTAINER" rm -rf "$container_export_root" "$container_settings_root" /tmp/export_legacy_service_from_postgres.py
    ensure_deploy_owner "$DATA_ROOT/legacy-service.next"
  else
    python3 apps/api/data-migration/export_legacy_service_from_postgres.py --output "$DATA_ROOT/legacy-service.next"
    ensure_deploy_owner "$DATA_ROOT/legacy-service.next"
  fi
  rm -rf "$DATA_ROOT/legacy-service.prev"
  if [ -d "$LEGACY_ROOT" ]; then
    mv "$LEGACY_ROOT" "$DATA_ROOT/legacy-service.prev"
  fi
  mv "$DATA_ROOT/legacy-service.next" "$LEGACY_ROOT"
else
  log 'skip postgres export'
fi

log 'refresh official card data'
LEADERBOARD_LEGACY_ROOT="$DEPLOY_PATH/$LEGACY_ROOT" \
  node apps/api/leaderboard-snapshot/refresh-official-card-data.mjs \
  "$DEPLOY_PATH/$LEGACY_ROOT/cards/datalist_api_base.json"

log 'refresh leaderboard snapshot'
LEADERBOARD_LEGACY_ROOT="$DEPLOY_PATH/$LEGACY_ROOT" \
LEADERBOARD_SNAPSHOT_FILE="$DEPLOY_PATH/apps/api/data/leaderboard-snapshot.json" \
  node apps/api/leaderboard-snapshot/refresh-snapshot.mjs

if [ -n "$DEPLOY_RESTART_COMMAND" ]; then
  log 'restart service'
  bash -lc "$DEPLOY_RESTART_COMMAND"
else
  log 'skip restart'
fi

log 'done'
