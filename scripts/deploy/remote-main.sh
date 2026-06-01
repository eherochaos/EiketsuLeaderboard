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

to_work_path() {
  local value="$1"
  case "$value" in
    "$DEPLOY_PATH")
      printf '/work'
      ;;
    "$DEPLOY_PATH"/*)
      printf '/work/%s' "${value#"$DEPLOY_PATH"/}"
      ;;
    *)
      printf '%s' "$value"
      ;;
  esac
}

run_node() {
  if command -v node >/dev/null 2>&1; then
    LEADERBOARD_LEGACY_ROOT="${LEADERBOARD_LEGACY_ROOT:-}" \
    LEADERBOARD_SNAPSHOT_FILE="${LEADERBOARD_SNAPSHOT_FILE:-}" \
    LEADERBOARD_REFRESH_STATUS_FILE="${LEADERBOARD_REFRESH_STATUS_FILE:-}" \
      node "$@"
    return
  fi
  if command -v docker >/dev/null 2>&1; then
    local docker_args=()
    local arg
    for arg in "$@"; do
      docker_args+=("$(to_work_path "$arg")")
    done
    local docker_legacy_root
    local docker_snapshot_file
    local docker_status_file
    docker_legacy_root="$(to_work_path "${LEADERBOARD_LEGACY_ROOT:-}")"
    docker_snapshot_file="$(to_work_path "${LEADERBOARD_SNAPSHOT_FILE:-}")"
    docker_status_file="$(to_work_path "${LEADERBOARD_REFRESH_STATUS_FILE:-}")"
    docker run --rm \
      --user "$(id -u):$(id -g)" \
      -v "$DEPLOY_PATH:/work" \
      -w /work \
      -e "LEADERBOARD_LEGACY_ROOT=$docker_legacy_root" \
      -e "LEADERBOARD_SNAPSHOT_FILE=$docker_snapshot_file" \
      -e "LEADERBOARD_REFRESH_STATUS_FILE=$docker_status_file" \
      node:22-alpine node "${docker_args[@]}"
    return
  fi
  fail 'node runtime is missing'
}

docker_container_running() {
  local container="$1"
  [ -n "$container" ] || return 1
  command -v docker >/dev/null 2>&1 || return 1
  docker ps --format '{{.Names}}' | grep -Fx "$container" >/dev/null 2>&1
}

require_fastapi_container() {
  command -v docker >/dev/null 2>&1 || fail 'docker runtime is missing'
  docker_container_running "$DEPLOY_FASTAPI_CONTAINER" || fail 'fastapi container is not running'
}

publish_live_frontend() {
  if [ -n "$DEPLOY_LIVE_FRONTEND_ROOT" ]; then
    local live_parent
    live_parent="$(dirname "$DEPLOY_LIVE_FRONTEND_ROOT")"
    ensure_writable_dir "$live_parent"
    rm -rf "$DEPLOY_LIVE_FRONTEND_ROOT.next"
    mkdir -p "$DEPLOY_LIVE_FRONTEND_ROOT.next"
    cp -a apps/web/dist/. "$DEPLOY_LIVE_FRONTEND_ROOT.next/"
    rm -rf "$DEPLOY_LIVE_FRONTEND_ROOT.prev"
    if [ -d "$DEPLOY_LIVE_FRONTEND_ROOT" ]; then
      mv "$DEPLOY_LIVE_FRONTEND_ROOT" "$DEPLOY_LIVE_FRONTEND_ROOT.prev"
    fi
    mv "$DEPLOY_LIVE_FRONTEND_ROOT.next" "$DEPLOY_LIVE_FRONTEND_ROOT"
    ensure_deploy_owner "$DEPLOY_LIVE_FRONTEND_ROOT"
  fi

  if [ -n "$DEPLOY_FASTAPI_CONTAINER" ]; then
    require_fastapi_container
    docker exec "$DEPLOY_FASTAPI_CONTAINER" sh -c "rm -rf '$DEPLOY_FASTAPI_FRONTEND_ROOT.next' '$DEPLOY_FASTAPI_FRONTEND_ROOT.prev' && mkdir -p '$DEPLOY_FASTAPI_FRONTEND_ROOT.next'"
    tar -C apps/web/dist -cf - . | docker exec -i "$DEPLOY_FASTAPI_CONTAINER" tar -C "$DEPLOY_FASTAPI_FRONTEND_ROOT.next" -xf -
    docker exec "$DEPLOY_FASTAPI_CONTAINER" sh -c "if [ -d '$DEPLOY_FASTAPI_FRONTEND_ROOT' ]; then mv '$DEPLOY_FASTAPI_FRONTEND_ROOT' '$DEPLOY_FASTAPI_FRONTEND_ROOT.prev'; fi && mv '$DEPLOY_FASTAPI_FRONTEND_ROOT.next' '$DEPLOY_FASTAPI_FRONTEND_ROOT'"
  fi
}

publish_live_snapshot() {
  [ -n "$DEPLOY_LIVE_SNAPSHOT_FILE" ] || return 0
  local source_file="$DATA_ROOT/leaderboard-snapshot.json"
  [ -f "$source_file" ] || fail 'leaderboard snapshot file is missing'
  local live_snapshot_parent
  live_snapshot_parent="$(dirname "$DEPLOY_LIVE_SNAPSHOT_FILE")"
  ensure_writable_dir "$live_snapshot_parent"
  cp "$source_file" "$DEPLOY_LIVE_SNAPSHOT_FILE.tmp.$$"
  mv "$DEPLOY_LIVE_SNAPSHOT_FILE.tmp.$$" "$DEPLOY_LIVE_SNAPSHOT_FILE"
  ensure_deploy_owner "$DEPLOY_LIVE_SNAPSHOT_FILE"
}

publish_live_status() {
  [ -n "$DEPLOY_LIVE_STATUS_FILE" ] || return 0
  local source_file="$DATA_ROOT/leaderboard-refresh-status.json"
  [ -f "$source_file" ] || fail 'leaderboard refresh status file is missing'
  local live_status_parent
  live_status_parent="$(dirname "$DEPLOY_LIVE_STATUS_FILE")"
  ensure_writable_dir "$live_status_parent"
  cp "$source_file" "$DEPLOY_LIVE_STATUS_FILE.tmp.$$"
  mv "$DEPLOY_LIVE_STATUS_FILE.tmp.$$" "$DEPLOY_LIVE_STATUS_FILE"
  ensure_deploy_owner "$DEPLOY_LIVE_STATUS_FILE"
}

publish_frontend_status_asset() {
  local source_file="$DATA_ROOT/leaderboard-refresh-status.json"
  [ -f "$source_file" ] || fail 'leaderboard refresh status file is missing'
  if [ -n "$DEPLOY_LIVE_FRONTEND_ROOT" ]; then
    ensure_writable_dir "$DEPLOY_LIVE_FRONTEND_ROOT/assets"
    cp "$source_file" "$DEPLOY_LIVE_FRONTEND_ROOT/assets/leaderboard-refresh-status.json"
    ensure_deploy_owner "$DEPLOY_LIVE_FRONTEND_ROOT/assets/leaderboard-refresh-status.json"
  fi
  if [ -n "$DEPLOY_FASTAPI_CONTAINER" ]; then
    require_fastapi_container
    docker exec "$DEPLOY_FASTAPI_CONTAINER" sh -c "mkdir -p '$DEPLOY_FASTAPI_FRONTEND_ROOT/assets'"
    docker cp "$source_file" "$DEPLOY_FASTAPI_CONTAINER:$DEPLOY_FASTAPI_FRONTEND_ROOT/assets/leaderboard-refresh-status.json"
  fi
}

install_fastapi_routes() {
  require_fastapi_container
  docker cp scripts/deploy/install-fastapi-leaderboard-routes.py "$DEPLOY_FASTAPI_CONTAINER:/tmp/install-fastapi-leaderboard-routes.py"
  docker exec "$DEPLOY_FASTAPI_CONTAINER" python /tmp/install-fastapi-leaderboard-routes.py
  docker exec "$DEPLOY_FASTAPI_CONTAINER" rm -f /tmp/install-fastapi-leaderboard-routes.py
}

restart_service() {
  if [ -n "$DEPLOY_RESTART_COMMAND" ]; then
    bash -lc "$DEPLOY_RESTART_COMMAND"
    return
  fi
  if [ -n "$DEPLOY_FASTAPI_CONTAINER" ] && docker_container_running "$DEPLOY_FASTAPI_CONTAINER"; then
    docker restart "$DEPLOY_FASTAPI_CONTAINER" >/dev/null
    return
  fi
  log 'skip restart'
}

smoke_check_live_routes() {
  [ -n "$DEPLOY_SMOKE_URL_BASE" ] || return 0
  command -v curl >/dev/null 2>&1 || return 0
  local base="${DEPLOY_SMOKE_URL_BASE%/}"
  local attempt
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS "$base/health" >/dev/null 2>&1; then
      break
    fi
    sleep 2
  done
  curl -fsS "$base/leaderboard-status/" >/dev/null || fail 'leaderboard status page is not live'
  curl -fsS "$base/api/leaderboard-refresh-status" >/dev/null || fail 'leaderboard refresh status api is not live'
}

refresh_public_run() {
  if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -Fx "$DEPLOY_EXPORT_CONTAINER" >/dev/null 2>&1; then
    docker cp apps/api/data-migration/refresh_public_leaderboard_run.py "$DEPLOY_EXPORT_CONTAINER:/tmp/refresh_public_leaderboard_run.py"
    docker exec "$DEPLOY_EXPORT_CONTAINER" python /tmp/refresh_public_leaderboard_run.py
    docker exec "$DEPLOY_EXPORT_CONTAINER" rm -f /tmp/refresh_public_leaderboard_run.py
  else
    python3 apps/api/data-migration/refresh_public_leaderboard_run.py
  fi
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
DEPLOY_FASTAPI_CONTAINER="$(decode_env "${DEPLOY_FASTAPI_CONTAINER_B64:-}")"
DEPLOY_FASTAPI_FRONTEND_ROOT="$(decode_env "${DEPLOY_FASTAPI_FRONTEND_ROOT_B64:-}")"
DEPLOY_LIVE_FRONTEND_ROOT="$(decode_env "${DEPLOY_LIVE_FRONTEND_ROOT_B64:-}")"
DEPLOY_LIVE_SNAPSHOT_FILE="$(decode_env "${DEPLOY_LIVE_SNAPSHOT_FILE_B64:-}")"
DEPLOY_LIVE_STATUS_FILE="$(decode_env "${DEPLOY_LIVE_STATUS_FILE_B64:-}")"
DEPLOY_RESTART_COMMAND="$(decode_env "${DEPLOY_RESTART_COMMAND_B64:-}")"
DEPLOY_SMOKE_URL_BASE="${DEPLOY_SMOKE_URL_BASE:-http://127.0.0.1:8000}"
DEPLOY_EXPORT_POSTGRES="${DEPLOY_EXPORT_POSTGRES:-1}"
DEPLOY_EXPORT_CONTAINER="${DEPLOY_EXPORT_CONTAINER:-eiketsu-env-db-api-1}"
DEPLOY_EXPORT_ASSET_ROOT="${DEPLOY_EXPORT_ASSET_ROOT:-/home/ubuntu/eiketsu-env-db/assets}"
DEPLOY_FASTAPI_CONTAINER="${DEPLOY_FASTAPI_CONTAINER:-eiketsu-env-db-api-1}"
DEPLOY_FASTAPI_FRONTEND_ROOT="${DEPLOY_FASTAPI_FRONTEND_ROOT:-/app/frontend/eiketsu-leaderboard}"
DEPLOY_LIVE_FRONTEND_ROOT="${DEPLOY_LIVE_FRONTEND_ROOT:-/home/ubuntu/eiketsu-env-db/frontend/eiketsu-leaderboard}"
DEPLOY_LIVE_SNAPSHOT_FILE="${DEPLOY_LIVE_SNAPSHOT_FILE:-/home/ubuntu/eiketsu-leaderboard-data/snapshots/leaderboard-snapshot.json}"
if [ -z "$DEPLOY_LIVE_STATUS_FILE" ] && [ -n "$DEPLOY_LIVE_SNAPSHOT_FILE" ]; then
  DEPLOY_LIVE_STATUS_FILE="$(dirname "$DEPLOY_LIVE_SNAPSHOT_FILE")/leaderboard-refresh-status.json"
fi

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
log 'publish live frontend'
publish_live_frontend

DATA_ROOT='apps/api/data'
LEGACY_ROOT="$DATA_ROOT/legacy-service"
STATUS_FILE="$DATA_ROOT/leaderboard-refresh-status.json"
if [ "$DEPLOY_EXPORT_POSTGRES" = '1' ]; then
  log 'refresh leaderboard run'
  refresh_public_run

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
LEADERBOARD_LEGACY_ROOT="$LEGACY_ROOT" \
  run_node apps/api/leaderboard-snapshot/refresh-official-card-data.mjs \
  "$LEGACY_ROOT/cards/datalist_api_base.json"
ensure_deploy_owner "$DATA_ROOT"

log 'refresh leaderboard snapshot'
LEADERBOARD_LEGACY_ROOT="$LEGACY_ROOT" \
LEADERBOARD_SNAPSHOT_FILE="$DATA_ROOT/leaderboard-snapshot.json" \
  run_node apps/api/leaderboard-snapshot/refresh-snapshot.mjs
ensure_deploy_owner "$DATA_ROOT"
log 'write refresh status'
python3 apps/api/data-migration/refresh_static_snapshot_after_upload.py \
  --repo-root "$DEPLOY_PATH" \
  --legacy-root "$LEGACY_ROOT" \
  --snapshot-file "$DATA_ROOT/leaderboard-snapshot.json" \
  --status-file "$STATUS_FILE" \
  --status-only \
  --refresh-status completed \
  --refresh-reason 'deploy refresh completed'
ensure_deploy_owner "$DATA_ROOT"
log 'publish live snapshot'
publish_live_snapshot
log 'publish live status'
publish_live_status
log 'publish frontend status asset'
publish_frontend_status_asset
log 'install fastapi routes'
install_fastapi_routes

log 'restart service'
restart_service
log 'smoke check live routes'
smoke_check_live_routes

log 'done'
