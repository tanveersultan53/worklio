#!/usr/bin/env bash
# Back up Worklio: the Postgres database and (when self-hosted) the uploaded files.
#
#   scripts/backup.sh [BACKUP_DIR]
#
# Writes db-<UTC timestamp>.dump (pg_dump custom format, compressed) and, if the stack runs an
# `s3` service with a /data volume (SeaweedFS), uploads-<timestamp>.tar.gz. Keeps KEEP_DAYS days.
# With RCLONE_REMOTE set (e.g. "b2:my-bucket/worklio"), copies the new files off-site too.
#
# Environment:
#   BACKUP_DIR     where to write (default /var/backups/worklio)
#   KEEP_DAYS      how many days to keep locally (default 14)
#   COMPOSE        the compose command for your stack
#                  (default: docker compose -f docker-compose.prod.yml --env-file .env.production)
#   RCLONE_REMOTE  optional off-site destination for rclone
#
# Cron example (03:15 every night):
#   15 3 * * * cd /opt/worklio && scripts/backup.sh >> /var/log/worklio-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."

DIR="${1:-${BACKUP_DIR:-/var/backups/worklio}}"
KEEP_DAYS="${KEEP_DAYS:-14}"
COMPOSE="${COMPOSE:-docker compose -f docker-compose.prod.yml --env-file .env.production}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
log() { echo "[$(date -u +%FT%TZ)] $*"; }

umask 077
mkdir -p "$DIR"

# 1. Database: a consistent snapshot while Worklio keeps running.
DB="$DIR/db-$STAMP.dump"
log "Dumping Postgres to $DB"
$COMPOSE exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --compress=6' > "$DB.partial"
# A dump that pg_restore can't read is worse than none: check before keeping it.
$COMPOSE exec -T postgres pg_restore --list < "$DB.partial" > /dev/null
mv "$DB.partial" "$DB"
log "Database backup OK ($(du -h "$DB" | cut -f1))"

# 2. Uploads, when files live in the stack's own SeaweedFS volume.
FILES=""
if $COMPOSE ps --services --status running 2>/dev/null | grep -qx s3; then
  CID="$($COMPOSE ps -q s3)"
  FILES="$DIR/uploads-$STAMP.tar.gz"
  log "Archiving uploads to $FILES"
  docker run --rm --volumes-from "$CID" -v "$DIR":/backup alpine:3.20 \
    tar czf "/backup/$(basename "$FILES").partial" -C /data .
  mv "$FILES.partial" "$FILES"
  chmod 600 "$FILES"
  log "Uploads backup OK ($(du -h "$FILES" | cut -f1))"
else
  log "No s3 service in this stack: back up your bucket with your provider (versioning or replication)"
fi

# 3. Keep KEEP_DAYS days.
find "$DIR" -maxdepth 1 -type f \( -name 'db-*.dump' -o -name 'uploads-*.tar.gz' \) -mtime "+$KEEP_DAYS" -print -delete \
  | sed 's/^/Removed old backup: /'

# 4. Off-site copy (optional).
if [ -n "${RCLONE_REMOTE:-}" ]; then
  log "Copying to $RCLONE_REMOTE"
  rclone copy "$DIR" "$RCLONE_REMOTE" --include "*-$STAMP.*"
fi
log "Done"
