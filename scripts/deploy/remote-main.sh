#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '[deploy] %s\n' "$*"
}

fail() {
  printf '[deploy] %s\n' "$*" >&2
  exit 1
}

shell_quote() {
  printf '%q' "$1"
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
    NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}" \
    LEADERBOARD_LEGACY_ROOT="${LEADERBOARD_LEGACY_ROOT:-}" \
    LEADERBOARD_SNAPSHOT_FILE="${LEADERBOARD_SNAPSHOT_FILE:-}" \
    LEADERBOARD_REFRESH_STATUS_FILE="${LEADERBOARD_REFRESH_STATUS_FILE:-}" \
    LEADERBOARD_MATCH_SEARCH_INDEX_FILE="${LEADERBOARD_MATCH_SEARCH_INDEX_FILE:-}" \
    LEADERBOARD_TIER_LIST_SNAPSHOT_FILE="${LEADERBOARD_TIER_LIST_SNAPSHOT_FILE:-}" \
    LEADERBOARD_TIER_LIST_CONFIGS_FILE="${LEADERBOARD_TIER_LIST_CONFIGS_FILE:-}" \
    LEADERBOARD_BATTLE_FESTIVAL_SNAPSHOT_FILE="${LEADERBOARD_BATTLE_FESTIVAL_SNAPSHOT_FILE:-}" \
    LEADERBOARD_BATTLE_FESTIVAL_CONFIGS_FILE="${LEADERBOARD_BATTLE_FESTIVAL_CONFIGS_FILE:-}" \
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
    local docker_match_search_index_file
    local docker_tier_list_snapshot_file
    local docker_tier_list_configs_file
    local docker_battle_festival_snapshot_file
    local docker_battle_festival_configs_file
    docker_legacy_root="$(to_work_path "${LEADERBOARD_LEGACY_ROOT:-}")"
    docker_snapshot_file="$(to_work_path "${LEADERBOARD_SNAPSHOT_FILE:-}")"
    docker_status_file="$(to_work_path "${LEADERBOARD_REFRESH_STATUS_FILE:-}")"
    docker_match_search_index_file="$(to_work_path "${LEADERBOARD_MATCH_SEARCH_INDEX_FILE:-}")"
    docker_tier_list_snapshot_file="$(to_work_path "${LEADERBOARD_TIER_LIST_SNAPSHOT_FILE:-}")"
    docker_tier_list_configs_file="$(to_work_path "${LEADERBOARD_TIER_LIST_CONFIGS_FILE:-}")"
    docker_battle_festival_snapshot_file="$(to_work_path "${LEADERBOARD_BATTLE_FESTIVAL_SNAPSHOT_FILE:-}")"
    docker_battle_festival_configs_file="$(to_work_path "${LEADERBOARD_BATTLE_FESTIVAL_CONFIGS_FILE:-}")"
    docker run --rm \
      --user "$(id -u):$(id -g)" \
      -v "$DEPLOY_PATH:/work" \
      -w /work \
      -e "LEADERBOARD_LEGACY_ROOT=$docker_legacy_root" \
      -e "LEADERBOARD_SNAPSHOT_FILE=$docker_snapshot_file" \
      -e "LEADERBOARD_REFRESH_STATUS_FILE=$docker_status_file" \
      -e "LEADERBOARD_MATCH_SEARCH_INDEX_FILE=$docker_match_search_index_file" \
      -e "LEADERBOARD_TIER_LIST_SNAPSHOT_FILE=$docker_tier_list_snapshot_file" \
      -e "LEADERBOARD_TIER_LIST_CONFIGS_FILE=$docker_tier_list_configs_file" \
      -e "LEADERBOARD_BATTLE_FESTIVAL_SNAPSHOT_FILE=$docker_battle_festival_snapshot_file" \
      -e "LEADERBOARD_BATTLE_FESTIVAL_CONFIGS_FILE=$docker_battle_festival_configs_file" \
      -e "NODE_OPTIONS=${NODE_OPTIONS:---max-old-space-size=4096}" \
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

docker_container_exists() {
  local container="$1"
  [ -n "$container" ] || return 1
  command -v docker >/dev/null 2>&1 || return 1
  docker ps -a --format '{{.Names}}' | grep -Fx "$container" >/dev/null 2>&1
}

postgres_export_python_ready() {
  if command -v docker >/dev/null 2>&1 && docker_container_running "$DEPLOY_EXPORT_CONTAINER"; then
    docker exec "$DEPLOY_EXPORT_CONTAINER" python -c 'import sqlalchemy' >/dev/null 2>&1
    return
  fi
  python3 -c 'import sqlalchemy' >/dev/null 2>&1
}

log_postgres_export_diagnostics() {
  log 'postgres export diagnostics'
  free -h || true
  df -h || true
  if command -v docker >/dev/null 2>&1; then
    docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' || true
    if [ -n "${DEPLOY_EXPORT_CONTAINER:-}" ]; then
      docker inspect -f 'export_container={{.Name}} status={{.State.Status}} oomKilled={{.State.OOMKilled}} exitCode={{.State.ExitCode}}' "$DEPLOY_EXPORT_CONTAINER" || true
    fi
  fi
}

run_postgres_export_in_container() {
  local container_export_root="$1"
  local container_settings_root="$2"
  if [ -d "$DEPLOY_EXPORT_ASSET_ROOT" ]; then
    docker exec "$DEPLOY_EXPORT_CONTAINER" mkdir -p "$container_settings_root/assets"
    docker cp "$DEPLOY_EXPORT_ASSET_ROOT/." "$DEPLOY_EXPORT_CONTAINER:$container_settings_root/assets"
    if ! docker exec -e EIKETSU_ENV_ROOT="$container_settings_root" "$DEPLOY_EXPORT_CONTAINER" python /tmp/export_legacy_service_from_postgres.py --output "$container_export_root"; then
      log_postgres_export_diagnostics
      return 1
    fi
  else
    if ! docker exec "$DEPLOY_EXPORT_CONTAINER" python /tmp/export_legacy_service_from_postgres.py --output "$container_export_root"; then
      log_postgres_export_diagnostics
      return 1
    fi
  fi
}

require_fastapi_container() {
  command -v docker >/dev/null 2>&1 || fail 'docker runtime is missing'
  docker_container_running "$DEPLOY_FASTAPI_CONTAINER" || fail 'fastapi container is not running'
}

start_fastapi_container_if_needed() {
  [ -n "$DEPLOY_FASTAPI_CONTAINER" ] || return 1
  if docker_container_running "$DEPLOY_FASTAPI_CONTAINER"; then
    return 0
  fi
  if docker_container_exists "$DEPLOY_FASTAPI_CONTAINER"; then
    docker start "$DEPLOY_FASTAPI_CONTAINER" >/dev/null
    sleep 2
    docker_container_running "$DEPLOY_FASTAPI_CONTAINER"
    return
  fi
  return 1
}

log_fastapi_container_state() {
  [ -n "$DEPLOY_FASTAPI_CONTAINER" ] || return 0
  command -v docker >/dev/null 2>&1 || return 0
  docker_container_exists "$DEPLOY_FASTAPI_CONTAINER" || return 0
  docker inspect -f 'fastapi container state={{.State.Status}} exitCode={{.State.ExitCode}} oomKilled={{.State.OOMKilled}} error={{.State.Error}}' "$DEPLOY_FASTAPI_CONTAINER" 2>/dev/null || true
}

log_fastapi_container_errors() {
  [ -n "$DEPLOY_FASTAPI_CONTAINER" ] || return 0
  command -v docker >/dev/null 2>&1 || return 0
  docker_container_exists "$DEPLOY_FASTAPI_CONTAINER" || return 0
  docker logs --tail 80 "$DEPLOY_FASTAPI_CONTAINER" 2>&1 \
    | sed -E 's/([Tt]oken|[Cc]ookie|[Ss]ecret|[Pp]assword|[Aa]uthorization)([=:][^[:space:],;]+)/\1=[redacted]/g' \
    || true
}

related_database_container_name() {
  case "$DEPLOY_FASTAPI_CONTAINER" in
    *-api-1)
      printf '%s-db-1' "${DEPLOY_FASTAPI_CONTAINER%-api-1}"
      ;;
    *)
      printf ''
      ;;
  esac
}

start_related_database_container_if_needed() {
  command -v docker >/dev/null 2>&1 || return 0
  local container
  container="$(related_database_container_name)"
  [ -n "$container" ] || return 0
  docker_container_exists "$container" || return 0
  if docker_container_running "$container"; then
    return 0
  fi
  log "start related database container $container"
  docker start "$container" >/dev/null || true
  sleep 2
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
  start_fastapi_container_if_needed || fail 'fastapi container is not running'
  docker cp scripts/deploy/install-fastapi-leaderboard-routes.py "$DEPLOY_FASTAPI_CONTAINER:/tmp/install-fastapi-leaderboard-routes.py"
  if ! docker exec "$DEPLOY_FASTAPI_CONTAINER" python /tmp/install-fastapi-leaderboard-routes.py; then
    log 'fastapi route install failed; keeping existing route patch'
    start_fastapi_container_if_needed || true
    return 0
  fi
  docker exec "$DEPLOY_FASTAPI_CONTAINER" rm -f /tmp/install-fastapi-leaderboard-routes.py || true
}

start_leaderboard_node_api() {
  require_fastapi_container
  local network_name
  network_name="$(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$DEPLOY_FASTAPI_CONTAINER" | head -n 1)"
  [ -n "$network_name" ] || fail 'fastapi container network is missing'

  docker rm -f "$DEPLOY_NODE_API_CONTAINER" >/dev/null 2>&1 || true
  docker run -d \
    --restart unless-stopped \
    --name "$DEPLOY_NODE_API_CONTAINER" \
    --network "$network_name" \
    -v "$DEPLOY_PATH:/work:ro" \
    -v "$DEPLOY_PATH/$DATA_ROOT:/work/$DATA_ROOT:rw" \
    -w /work \
    -e HOST=0.0.0.0 \
    -e "PORT=$DEPLOY_NODE_API_PORT" \
    -e LEADERBOARD_SNAPSHOT_FILE=/work/apps/api/data/leaderboard-snapshot.json \
    -e LEADERBOARD_REFRESH_STATUS_FILE=/work/apps/api/data/leaderboard-refresh-status.json \
    -e LEADERBOARD_MATCH_SEARCH_INDEX_FILE=/work/apps/api/data/match-search-index.json \
    -e LEADERBOARD_TIER_LIST_SNAPSHOT_FILE=/work/apps/api/data/tier-list-snapshot.json \
    -e LEADERBOARD_TIER_LIST_CONFIGS_FILE=/work/apps/api/data/tier-list-configs.json \
    -e LEADERBOARD_BATTLE_FESTIVAL_SNAPSHOT_FILE=/work/apps/api/data/battle-festival-snapshot.json \
    -e LEADERBOARD_BATTLE_FESTIVAL_CONFIGS_FILE=/work/apps/api/data/battle-festival-configs.json \
    -e SITE_ANALYTICS_FILE=/work/apps/api/data/site-analytics-events.jsonl \
    -e "SITE_ANALYTICS_ADMIN_TOKEN=${SITE_ANALYTICS_ADMIN_TOKEN:-}" \
    node:22-alpine node apps/api/leaderboard-snapshot/server.mjs >/dev/null
}

stop_leaderboard_node_api() {
  command -v docker >/dev/null 2>&1 || return 0
  docker rm -f "$DEPLOY_NODE_API_CONTAINER" >/dev/null 2>&1 || true
}

install_upload_refresh_worker() {
  command -v systemctl >/dev/null 2>&1 || fail 'systemd runtime is missing'
  local worker_root="$DEPLOY_PATH/$DATA_ROOT"
  local worker_script="$worker_root/run-upload-refresh-worker.sh"
  ensure_writable_dir "$worker_root"
  {
    printf '#!/usr/bin/env bash\n'
    printf 'set -euo pipefail\n'
    printf 'cd %s\n' "$(shell_quote "$DEPLOY_PATH")"
    printf 'node_api_container=%s\n' "$(shell_quote "$DEPLOY_NODE_API_CONTAINER")"
    printf 'export_container=%s\n' "$(shell_quote "$DEPLOY_EXPORT_CONTAINER")"
    printf 'wait_for_container() {\n'
    printf '  local container="$1"\n'
    printf '  local wait_seconds="${UPLOAD_REFRESH_CONTAINER_WAIT_SECONDS:-120}"\n'
    printf '  local deadline=$((SECONDS + wait_seconds))\n'
    printf '  [ -n "$container" ] || return 0\n'
    printf '  while [ "$SECONDS" -lt "$deadline" ]; do\n'
    printf '    if [ "$(docker inspect -f "{{.State.Running}}" "$container" 2>/dev/null || true)" = "true" ]; then\n'
    printf '      return 0\n'
    printf '    fi\n'
    printf '    sleep 2\n'
    printf '  done\n'
    printf '  printf "container %%s is not running after %%ss\\n" "$container" "$wait_seconds" >&2\n'
    printf '  return 1\n'
    printf '}\n'
    printf 'args=(\n'
    printf '  --repo-root %s\n' "$(shell_quote "$DEPLOY_PATH")"
    printf '  --legacy-root %s\n' "$(shell_quote "$LEGACY_ROOT")"
    printf '  --snapshot-file %s\n' "$(shell_quote "$DATA_ROOT/leaderboard-snapshot.json")"
    printf '  --match-search-index-file %s\n' "$(shell_quote "$MATCH_SEARCH_INDEX_FILE")"
    printf '  --tier-list-snapshot-file %s\n' "$(shell_quote "$TIER_LIST_SNAPSHOT_FILE")"
    printf '  --tier-list-configs-file %s\n' "$(shell_quote "$TIER_LIST_CONFIGS_FILE")"
    printf '  --battle-festival-snapshot-file %s\n' "$(shell_quote "$BATTLE_FESTIVAL_SNAPSHOT_FILE")"
    printf '  --battle-festival-configs-file %s\n' "$(shell_quote "$BATTLE_FESTIVAL_CONFIGS_FILE")"
    printf '  --status-file %s\n' "$(shell_quote "$STATUS_FILE")"
    printf '  --node-bin node\n'
    printf '  --node-container %s\n' "$(shell_quote "$DEPLOY_NODE_API_CONTAINER")"
    printf '  --postgres-container %s\n' "$(shell_quote "$DEPLOY_EXPORT_CONTAINER")"
    printf '  --export-container %s\n' "$(shell_quote "$DEPLOY_EXPORT_CONTAINER")"
    printf '  --refresh-reason %s\n' "$(shell_quote 'upload refresh completed')"
    printf ')\n'
    if [ -n "$DEPLOY_EXPORT_ASSET_ROOT" ]; then
      printf 'args+=(--export-asset-root %s)\n' "$(shell_quote "$DEPLOY_EXPORT_ASSET_ROOT")"
    fi
    if [ -n "$DEPLOY_LIVE_SNAPSHOT_FILE" ]; then
      printf 'args+=(--live-snapshot-file %s)\n' "$(shell_quote "$DEPLOY_LIVE_SNAPSHOT_FILE")"
    fi
    if [ -n "$DEPLOY_LIVE_STATUS_FILE" ]; then
      printf 'args+=(--live-status-file %s)\n' "$(shell_quote "$DEPLOY_LIVE_STATUS_FILE")"
    fi
    printf 'wait_for_container "$node_api_container"\n'
    printf 'wait_for_container "$export_container"\n'
    printf 'python3 apps/api/data-migration/upload_refresh_worker.py "${args[@]}"\n'
  } > "$worker_script"
  chmod +x "$worker_script"
  ensure_deploy_owner "$worker_script"

  sudo -n tee /etc/systemd/system/eiketsu-upload-refresh.service >/dev/null <<EOF
[Unit]
Description=Eiketsu leaderboard upload refresh
After=docker.service

[Service]
Type=oneshot
WorkingDirectory=$DEPLOY_PATH
ExecStart=$worker_script
EOF

  sudo -n tee /etc/systemd/system/eiketsu-upload-refresh.timer >/dev/null <<EOF
[Unit]
Description=Eiketsu leaderboard upload refresh timer

[Timer]
OnBootSec=2min
OnActiveSec=30s
OnUnitActiveSec=60s
AccuracySec=10s
Persistent=true
Unit=eiketsu-upload-refresh.service

[Install]
WantedBy=timers.target
EOF

  sudo -n systemctl daemon-reload
  sudo -n systemctl enable --now eiketsu-upload-refresh.timer >/dev/null
  sudo -n systemctl start eiketsu-upload-refresh.service
}

cleanup_version_detect_worker() {
  local worker_script="$DEPLOY_PATH/$DATA_ROOT/run-version-detect-worker.sh"
  if command -v systemctl >/dev/null 2>&1; then
    sudo -n systemctl disable --now eiketsu-version-detect.timer eiketsu-version-detect.service >/dev/null 2>&1 || true
  fi
  sudo -n rm -f /etc/systemd/system/eiketsu-version-detect.timer /etc/systemd/system/eiketsu-version-detect.service || true
  rm -f "$worker_script"
  if command -v systemctl >/dev/null 2>&1; then
    sudo -n systemctl daemon-reload || true
  fi
}

restart_service() {
  if [ -n "$DEPLOY_RESTART_COMMAND" ]; then
    bash -lc "$DEPLOY_RESTART_COMMAND"
    return
  fi
  start_related_database_container_if_needed
  if [ -n "$DEPLOY_FASTAPI_CONTAINER" ] && docker_container_running "$DEPLOY_FASTAPI_CONTAINER"; then
    docker restart "$DEPLOY_FASTAPI_CONTAINER" >/dev/null
    return
  fi
  if start_fastapi_container_if_needed; then
    return
  fi
  log 'skip restart'
}

reload_fastapi_routes() {
  if docker_container_running "$DEPLOY_FASTAPI_CONTAINER"; then
    docker restart "$DEPLOY_FASTAPI_CONTAINER" >/dev/null
    return
  fi
  start_fastapi_container_if_needed || fail 'fastapi container is not running'
}

wait_for_live_health() {
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
  if ! curl -fsS "$base/health" >/dev/null 2>&1; then
    log_fastapi_container_state
    log_fastapi_container_errors
  fi
}

tier_list_smoke_deck_id() {
  python3 -c 'import json,sys,urllib.parse; data=json.load(open(sys.argv[1], encoding="utf-8")); rows=data.get("tierRows") or []; print(urllib.parse.quote(str(rows[0].get("deckId") or ""), safe="") if rows else "")' "$TIER_LIST_SNAPSHOT_FILE"
}

battle_festival_smoke_deck_id() {
  python3 -c 'import json,sys,urllib.parse; data=json.load(open(sys.argv[1], encoding="utf-8")); rows=data.get("tierRows") or []; print(urllib.parse.quote(str(rows[0].get("deckId") or ""), safe="") if rows else "")' "$BATTLE_FESTIVAL_SNAPSHOT_FILE"
}

api_source_run() {
  python3 - "$1" <<'PY'
import json
import sys
import urllib.request

with urllib.request.urlopen(sys.argv[1], timeout=30) as response:
    payload = json.load(response)

metadata = payload.get("metadata") if isinstance(payload, dict) else {}
snapshot = payload.get("snapshot") if isinstance(payload, dict) else {}
metadata = metadata if isinstance(metadata, dict) else {}
snapshot = snapshot if isinstance(snapshot, dict) else {}
value = metadata.get("sourceRunId", snapshot.get("sourceRunId"))
print("" if value is None else value)
PY
}

smoke_check_run_consistency() {
  local base="${DEPLOY_SMOKE_URL_BASE%/}"
  local leaderboard_run
  local tier_run
  local match_run
  local status_run
  leaderboard_run="$(api_source_run "$base/api/leaderboard-snapshot")"
  tier_run="$(api_source_run "$base/api/tier-list-snapshot")"
  match_run="$(api_source_run "$base/api/match-search-options")"
  status_run="$(api_source_run "$base/api/leaderboard-refresh-status")"
  [ -n "$leaderboard_run" ] || fail 'leaderboard snapshot sourceRunId is missing'
  [ "$leaderboard_run" = "$tier_run" ] || fail 'tier list snapshot run does not match leaderboard snapshot'
  [ "$leaderboard_run" = "$match_run" ] || fail 'match search index run does not match leaderboard snapshot'
  [ "$leaderboard_run" = "$status_run" ] || fail 'refresh status run does not match leaderboard snapshot'
}

smoke_check_client_config() {
  local base="${DEPLOY_SMOKE_URL_BASE%/}"
  CLIENT_CONFIG_URL="$base/api/v1/config" python3 - <<'PY' || fail 'battle festival client config field is missing'
import json
import os
import urllib.request

with urllib.request.urlopen(os.environ["CLIENT_CONFIG_URL"], timeout=30) as response:
    payload = json.load(response)

if "include_battle_festival" not in payload:
    raise SystemExit("include_battle_festival is missing")
PY
}

smoke_check_api_routes() {
  [ -n "$DEPLOY_SMOKE_URL_BASE" ] || return 0
  command -v curl >/dev/null 2>&1 || return 0
  local base="${DEPLOY_SMOKE_URL_BASE%/}"
  wait_for_live_health
  smoke_check_client_config
  curl -fsS "$base/api/version-options" >/dev/null || fail 'version options api is not live'
  curl -fsS "$base/api/tier-list-snapshot" >/dev/null || fail 'tier list snapshot api is not live'
  local tier_deck_id
  tier_deck_id="$(tier_list_smoke_deck_id)"
  [ -n "$tier_deck_id" ] || fail 'tier list smoke deck id is missing'
  curl -fsS "$base/api/tier-list-deck-config?scope=deck&deckId=$tier_deck_id" >/dev/null || fail 'tier list deck config api is not live'
  if [ -f "$BATTLE_FESTIVAL_SNAPSHOT_FILE" ]; then
    curl -fsS "$base/api/battle-festival-snapshot" >/dev/null || fail 'battle festival snapshot api is not live'
    local battle_festival_deck_id
    battle_festival_deck_id="$(battle_festival_smoke_deck_id)"
    if [ -n "$battle_festival_deck_id" ]; then
      curl -fsS "$base/api/battle-festival-deck-config?scope=deck&deckId=$battle_festival_deck_id" >/dev/null || fail 'battle festival deck config api is not live'
    fi
  fi
  curl -fsS "$base/api/leaderboard-refresh-status" >/dev/null || fail 'leaderboard refresh status api is not live'
  curl -fsS "$base/api/match-search-options" >/dev/null || fail 'match search options api is not live'
  curl -fsS -X POST "$base/api/match-search" \
    -H 'Content-Type: application/json' \
    -d '{"sideA":{"result":"win"},"pageSize":1}' >/dev/null || fail 'match search api is not live'
  curl -fsS -X POST "$base/api/site-analytics-event" \
    -H 'Content-Type: application/json' \
    -d '{"visitorId":"visitor_deploy_smoke","sessionId":"session_deploy_smoke","eventType":"page_view","page":"/deploy-smoke","target":"deploy","deviceType":"unknown","viewport":{"width":0,"height":0},"occurredAt":"2026-06-03T00:00:00.000Z"}' >/dev/null || fail 'site analytics event api is not live'
  local analytics_status
  analytics_status="$(curl -sS -o /dev/null -w '%{http_code}' "$base/api/site-analytics-summary")"
  case "$analytics_status" in
    401|503) ;;
    *) fail 'site analytics summary auth check failed' ;;
  esac
  if [ -n "${SITE_ANALYTICS_ADMIN_TOKEN:-}" ]; then
    SITE_ANALYTICS_SUMMARY_URL="$base/api/site-analytics-summary" SITE_ANALYTICS_ADMIN_TOKEN="$SITE_ANALYTICS_ADMIN_TOKEN" python3 - <<'PY' || fail 'site analytics summary api is not live'
import os
import urllib.request

request = urllib.request.Request(
    os.environ["SITE_ANALYTICS_SUMMARY_URL"],
    headers={"Authorization": "Bearer " + os.environ.get("SITE_ANALYTICS_ADMIN_TOKEN", "")},
)
with urllib.request.urlopen(request, timeout=30) as response:
    response.read()
PY
  fi
  smoke_check_run_consistency
}

smoke_check_live_routes() {
  [ -n "$DEPLOY_SMOKE_URL_BASE" ] || return 0
  command -v curl >/dev/null 2>&1 || return 0
  local base="${DEPLOY_SMOKE_URL_BASE%/}"
  wait_for_live_health
  curl -fsS "$base/leaderboard/" >/dev/null || fail 'leaderboard page is not live'
  curl -fsS "$base/leaderboard-status/" >/dev/null || fail 'leaderboard status page is not live'
  curl -fsS "$base/tier-list/" >/dev/null || fail 'tier list page is not live'
  curl -fsS "$base/battle-festival/" >/dev/null || fail 'battle festival page is not live'
  curl -fsS "$base/match-search/" >/dev/null || fail 'match search page is not live'
  curl -fsS "$base/admin-stats/" >/dev/null || fail 'admin stats page is not live'
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

set_server_share_config() {
  if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -Fx "$DEPLOY_EXPORT_CONTAINER" >/dev/null 2>&1; then
    docker cp apps/api/data-migration/set_server_share_config.py "$DEPLOY_EXPORT_CONTAINER:/tmp/set_server_share_config.py"
    docker exec "$DEPLOY_EXPORT_CONTAINER" python /tmp/set_server_share_config.py
    docker exec "$DEPLOY_EXPORT_CONTAINER" rm -f /tmp/set_server_share_config.py
  else
    python3 apps/api/data-migration/set_server_share_config.py
  fi
}

ensure_battle_festival_scope() {
  if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -Fx "$DEPLOY_EXPORT_CONTAINER" >/dev/null 2>&1; then
    docker cp apps/api/data-migration/enable_battle_festival_scope.py "$DEPLOY_EXPORT_CONTAINER:/tmp/enable_battle_festival_scope.py"
    docker exec "$DEPLOY_EXPORT_CONTAINER" python /tmp/enable_battle_festival_scope.py
    docker exec "$DEPLOY_EXPORT_CONTAINER" rm -f /tmp/enable_battle_festival_scope.py
  else
    python3 apps/api/data-migration/enable_battle_festival_scope.py
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
SITE_ANALYTICS_ADMIN_TOKEN="$(decode_env "${SITE_ANALYTICS_ADMIN_TOKEN_B64:-}")"
DEPLOY_SMOKE_URL_BASE="${DEPLOY_SMOKE_URL_BASE:-http://127.0.0.1:8000}"
DEPLOY_NODE_API_CONTAINER="${DEPLOY_NODE_API_CONTAINER:-eiketsu-leaderboard-api}"
DEPLOY_NODE_API_PORT="${DEPLOY_NODE_API_PORT:-8001}"
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

DATA_ROOT='apps/api/data'
LEGACY_ROOT="$DATA_ROOT/legacy-service"
STATUS_FILE="$DATA_ROOT/leaderboard-refresh-status.json"
MATCH_SEARCH_INDEX_FILE="$DATA_ROOT/match-search-index.json"
TIER_LIST_SNAPSHOT_FILE="$DATA_ROOT/tier-list-snapshot.json"
TIER_LIST_CONFIGS_FILE="$DATA_ROOT/tier-list-configs.json"
BATTLE_FESTIVAL_SNAPSHOT_FILE="$DATA_ROOT/battle-festival-snapshot.json"
BATTLE_FESTIVAL_CONFIGS_FILE="$DATA_ROOT/battle-festival-configs.json"
if [ "$DEPLOY_EXPORT_POSTGRES" = '1' ] && ! postgres_export_python_ready; then
  log 'postgres export python dependencies missing; reuse existing exported data'
  DEPLOY_EXPORT_POSTGRES=0
fi
if [ "$DEPLOY_EXPORT_POSTGRES" = '1' ]; then
  log 'ensure battle festival schema'
  ensure_battle_festival_scope

  log 'set server share config'
  set_server_share_config

  log 'refresh leaderboard run'
  refresh_public_run

  log 'export postgres data'
  ensure_writable_dir "$DATA_ROOT"
  rm -rf "$DATA_ROOT/legacy-service.next"
  if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -Fx "$DEPLOY_EXPORT_CONTAINER" >/dev/null 2>&1; then
    container_export_root="/tmp/eiketsu-legacy-service-export-$$"
    container_settings_root="/tmp/eiketsu-export-settings-$$"
    host_export_root="/tmp/eiketsu-legacy-service-export-host-$$"
    rm -rf "$host_export_root"
    mkdir -p "$host_export_root"
    docker exec "$DEPLOY_EXPORT_CONTAINER" rm -rf "$container_export_root" "$container_settings_root" /tmp/export_legacy_service_from_postgres.py
    docker cp apps/api/data-migration/export_legacy_service_from_postgres.py "$DEPLOY_EXPORT_CONTAINER:/tmp/export_legacy_service_from_postgres.py"
    run_postgres_export_in_container "$container_export_root" "$container_settings_root"
    docker cp "$DEPLOY_EXPORT_CONTAINER:$container_export_root/." "$host_export_root"
    docker exec "$DEPLOY_EXPORT_CONTAINER" rm -rf "$container_export_root" "$container_settings_root" /tmp/export_legacy_service_from_postgres.py
    ensure_deploy_owner "$host_export_root"
    mv "$host_export_root" "$DATA_ROOT/legacy-service.next"
    ensure_deploy_owner "$DATA_ROOT/legacy-service.next"
  else
    if ! python3 apps/api/data-migration/export_legacy_service_from_postgres.py --output "$DATA_ROOT/legacy-service.next"; then
      log_postgres_export_diagnostics
      exit 1
    fi
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

ensure_writable_dir "$DATA_ROOT"
log 'refresh official card data'
LEADERBOARD_LEGACY_ROOT="$LEGACY_ROOT" \
  run_node apps/api/leaderboard-snapshot/refresh-official-card-data.mjs \
  "$LEGACY_ROOT/cards/datalist_api_base.json"
ensure_deploy_owner "$DATA_ROOT"

log 'refresh leaderboard snapshot'
LEADERBOARD_LEGACY_ROOT="$LEGACY_ROOT" \
LEADERBOARD_SNAPSHOT_FILE="$DATA_ROOT/leaderboard-snapshot.json" \
LEADERBOARD_TIER_LIST_SNAPSHOT_FILE="$TIER_LIST_SNAPSHOT_FILE" \
LEADERBOARD_TIER_LIST_CONFIGS_FILE="$TIER_LIST_CONFIGS_FILE" \
LEADERBOARD_BATTLE_FESTIVAL_SNAPSHOT_FILE="$BATTLE_FESTIVAL_SNAPSHOT_FILE" \
LEADERBOARD_BATTLE_FESTIVAL_CONFIGS_FILE="$BATTLE_FESTIVAL_CONFIGS_FILE" \
  run_node apps/api/leaderboard-snapshot/refresh-snapshot.mjs
ensure_deploy_owner "$DATA_ROOT"
log 'refresh match search index'
LEADERBOARD_LEGACY_ROOT="$LEGACY_ROOT" \
LEADERBOARD_SNAPSHOT_FILE="$DATA_ROOT/leaderboard-snapshot.json" \
LEADERBOARD_MATCH_SEARCH_INDEX_FILE="$MATCH_SEARCH_INDEX_FILE" \
  run_node apps/api/leaderboard-snapshot/match-search-index.mjs
ensure_deploy_owner "$DATA_ROOT"
log 'write refresh status'
python3 apps/api/data-migration/refresh_static_snapshot_after_upload.py \
  --repo-root "$DEPLOY_PATH" \
  --legacy-root "$LEGACY_ROOT" \
  --snapshot-file "$DATA_ROOT/leaderboard-snapshot.json" \
  --match-search-index-file "$MATCH_SEARCH_INDEX_FILE" \
  --tier-list-snapshot-file "$TIER_LIST_SNAPSHOT_FILE" \
  --tier-list-configs-file "$TIER_LIST_CONFIGS_FILE" \
  --battle-festival-snapshot-file "$BATTLE_FESTIVAL_SNAPSHOT_FILE" \
  --battle-festival-configs-file "$BATTLE_FESTIVAL_CONFIGS_FILE" \
  --status-file "$STATUS_FILE" \
  --status-only \
  --refresh-status completed \
  --refresh-reason 'deploy refresh completed'
ensure_deploy_owner "$DATA_ROOT"
log 'publish live snapshot'
publish_live_snapshot
log 'publish live status'
publish_live_status
log 'stop leaderboard node api before restart'
stop_leaderboard_node_api
log 'restart service before route install'
restart_service
log 'install fastapi routes'
install_fastapi_routes
log 'reload fastapi routes'
reload_fastapi_routes
log 'start leaderboard node api'
start_leaderboard_node_api
log 'smoke check api routes'
smoke_check_api_routes
log 'install upload refresh worker'
install_upload_refresh_worker
log 'cleanup version detect worker'
cleanup_version_detect_worker
log 'publish live frontend'
publish_live_frontend
log 'publish frontend status asset'
publish_frontend_status_asset
log 'smoke check live routes'
smoke_check_live_routes

log 'done'
