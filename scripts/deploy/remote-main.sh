#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '[deploy] %s\n' "$*"
}

fail() {
  printf '[deploy] %s\n' "$*" >&2
  exit 1
}

decode_env() {
  if [ -z "${1:-}" ]; then
    printf ''
    return
  fi
  printf '%s' "$1" | base64 --decode
}

DEPLOY_PATH="$(decode_env "${DEPLOY_PATH_B64:-}")"
DEPLOY_RESTART_COMMAND="$(decode_env "${DEPLOY_RESTART_COMMAND_B64:-}")"
DEPLOY_EXPORT_POSTGRES="${DEPLOY_EXPORT_POSTGRES:-1}"

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
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || fail 'DEPLOY_PATH is not a git worktree'
cd "$REPO_ROOT"

[ -d apps/web ] || fail 'apps/web is missing'
[ -d apps/api ] || fail 'apps/api is missing'

CURRENT_BRANCH="$(git branch --show-current)"
if [ "$CURRENT_BRANCH" != 'main' ]; then
  log 'switch main'
  git switch main
fi

log 'pull main'
git fetch origin main
git pull --ff-only origin main

log 'publish web dist'
DIST_ARCHIVE='/tmp/eiketsu-web-dist.tgz'
[ -f "$DIST_ARCHIVE" ] || fail 'web dist archive is missing'
rm -rf apps/web/dist.next
mkdir -p apps/web/dist.next
tar -xzf "$DIST_ARCHIVE" -C apps/web/dist.next
rm -f "$DIST_ARCHIVE"
rm -rf apps/web/dist.prev
if [ -d apps/web/dist ]; then
  mv apps/web/dist apps/web/dist.prev
fi
mv apps/web/dist.next apps/web/dist

LEGACY_ROOT='apps/api/data/legacy-service'
if [ "$DEPLOY_EXPORT_POSTGRES" = '1' ]; then
  log 'export postgres data'
  rm -rf apps/api/data/legacy-service.next
  python3 apps/api/data-migration/export_legacy_service_from_postgres.py --output apps/api/data/legacy-service.next
  rm -rf apps/api/data/legacy-service.prev
  if [ -d "$LEGACY_ROOT" ]; then
    mv "$LEGACY_ROOT" apps/api/data/legacy-service.prev
  fi
  mv apps/api/data/legacy-service.next "$LEGACY_ROOT"
else
  log 'skip postgres export'
fi

log 'refresh official card data'
LEADERBOARD_LEGACY_ROOT="$REPO_ROOT/$LEGACY_ROOT" \
  node apps/api/leaderboard-snapshot/refresh-official-card-data.mjs \
  "$REPO_ROOT/$LEGACY_ROOT/cards/datalist_api_base.json"

log 'refresh leaderboard snapshot'
LEADERBOARD_LEGACY_ROOT="$REPO_ROOT/$LEGACY_ROOT" \
LEADERBOARD_SNAPSHOT_FILE="$REPO_ROOT/apps/api/data/leaderboard-snapshot.json" \
  node apps/api/leaderboard-snapshot/refresh-snapshot.mjs

if [ -n "$DEPLOY_RESTART_COMMAND" ]; then
  log 'restart service'
  bash -lc "$DEPLOY_RESTART_COMMAND"
else
  log 'skip restart'
fi

log 'done'
