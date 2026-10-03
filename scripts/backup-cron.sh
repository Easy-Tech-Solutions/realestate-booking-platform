#!/usr/bin/env bash
# Unattended wrapper around scripts/backup.sh for the nightly cron job
# (/etc/cron.d/homekonet-backup — see MIGRATION.md "Backing up without a
# full server migration"). Adds what an interactive run doesn't need:
#   - a lock, so a slow run can't overlap the next one
#   - the passphrase read from a file, never from the command line
#   - BACKUP_REQUIRE_DB=1, so a run without a DB dump fails instead of "succeeding"
#   - pruning of local archives older than BACKUP_RETENTION_DAYS
#   - an optional off-box copy via rclone, if BACKUP_RCLONE_REMOTE is set
#
# Settings (env vars, all optional):
#   BACKUP_PASSPHRASE_FILE  default: ~/.homekonet-backup-passphrase (mode 600)
#   BACKUP_RETENTION_DAYS   default: 14
#   BACKUP_RCLONE_REMOTE    e.g. "b2:homekonet-backups" — unset = local only
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/backups"
PASSPHRASE_FILE="${BACKUP_PASSPHRASE_FILE:-$HOME/.homekonet-backup-passphrase}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

exec 9>"$OUT_DIR/.backup.lock"
if ! flock -n 9; then
  log "Another backup is still running — skipping this run."
  exit 1
fi

if [[ ! -r "$PASSPHRASE_FILE" ]]; then
  log "ERROR: passphrase file not readable: $PASSPHRASE_FILE"
  exit 1
fi

log "Starting backup"
cd "$ROOT_DIR"
BACKUP_PASSPHRASE="$(cat "$PASSPHRASE_FILE")" BACKUP_REQUIRE_DB=1 bash scripts/backup.sh

LATEST="$(ls -1t "$OUT_DIR"/homekonet-backup-*.tar.gz.gpg | head -1)"
log "Created $LATEST ($(du -h "$LATEST" | cut -f1))"

if [[ -n "${BACKUP_RCLONE_REMOTE:-}" ]]; then
  log "Copying to off-box remote $BACKUP_RCLONE_REMOTE"
  rclone copy "$LATEST" "$BACKUP_RCLONE_REMOTE"
else
  log "WARNING: BACKUP_RCLONE_REMOTE not set — this backup exists only on this server."
fi

log "Pruning local archives older than $RETENTION_DAYS days"
find "$OUT_DIR" -maxdepth 1 -name 'homekonet-backup-*.tar.gz.gpg' -mtime +"$RETENTION_DAYS" -print -delete

log "Backup finished OK"
