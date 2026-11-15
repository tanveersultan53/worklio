#!/usr/bin/env bash
# Restore Worklio from scripts/backup.sh output. REPLACES the current data.
#
#   scripts/restore.sh --yes db-<stamp>.dump [uploads-<stamp>.tar.gz]
#   scripts/restore.sh --check db-<stamp>.dump      # restore into a scratch database and report
#                                                     # row counts, without touching live data
#
# Uses the same COMPOSE variable as backup.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
COMPOSE="${COMPOSE:-docker compose -f docker-compose.prod.yml --env-file .env.production}"
MODE="${1:-}"
DB="${2:-}"
FILES="${3:-}"
if [ "$MODE" != "--yes" ] && [ "$MODE" != "--check" ] || [ -z "$DB" ] || [ ! -f "$DB" ]; then
  sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
fi
log() { echo "[$(date -u +%FT%TZ)] $*"; }
psql_q() { $COMPOSE exec -T postgres sh -c "psql -U \"\$POSTGRES_USER\" -d $1 -Atc \"$2\""; }

if [ "$MODE" = "--check" ]; then
  # A restore drill: load the dump into worklio_restore_check, count rows, drop it.
  SCRATCH=worklio_restore_check
  log "Restoring $DB into scratch database $SCRATCH"
  psql_q postgres "DROP DATABASE IF EXISTS $SCRATCH" > /dev/null
  psql_q postgres "CREATE DATABASE $SCRATCH" > /dev/null
  $COMPOSE exec -T postgres sh -c "pg_restore -U \"\$POSTGRES_USER\" -d $SCRATCH --no-owner --exit-on-error" < "$DB"
  for t in users workspaces channels messages attachments; do
    echo "  $t: $(psql_q $SCRATCH "SELECT count(*) FROM $t")"
  done
  psql_q postgres "DROP DATABASE $SCRATCH" > /dev/null
  log "Restore check passed"
  exit 0
fi

log "Stopping the app (database and storage stay up)"
$COMPOSE stop api worker beat web
log "Restoring the database from $DB"
$COMPOSE exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --exit-on-error' < "$DB"
if [ -n "$FILES" ]; then
  log "Restoring uploads from $FILES"
  CID="$($COMPOSE ps -q s3)"
  $COMPOSE stop s3
  docker run --rm --volumes-from "$CID" -v "$(cd "$(dirname "$FILES")" && pwd)":/backup alpine:3.20 \
    sh -c "rm -rf /data/* && tar xzf /backup/$(basename "$FILES") -C /data"
  $COMPOSE start s3
fi
log "Starting the app"
$COMPOSE start api worker beat web
log "Restore complete"
