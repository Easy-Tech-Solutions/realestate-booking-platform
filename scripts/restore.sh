#!/usr/bin/env bash
# Restores a backup.sh archive onto a freshly cloned repo. Run this on the NEW
# server after 'git clone' but BEFORE 'docker compose up'. See MIGRATION.md.
#
# This extracts everything (including a database.dump and pgadmin_data.tar.gz,
# if the backup included them) but does NOT touch the database or pgAdmin's
# volume automatically — restoring a database is a decision only you should
# make explicitly (is this the SAME database as before, or a fresh one this
# archive should populate?), and this script has no way to know that safely.
# It extracts the dump and prints the exact commands to run once you've
# confirmed backend/.env points at the right (and, for a fresh DB, empty)
# database.
#
# RESTORE_PASSPHRASE=... bash scripts/restore.sh <archive>   # non-interactive
# (needed when running via 'ssh host command=...' or similar — gpg can't show
# an interactive passphrase prompt without a real TTY.)
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARCHIVE="${1:-}"
FORCE="${2:-}"

if [[ -z "$ARCHIVE" ]]; then
  echo "Usage: bash scripts/restore.sh <path-to-backup.tar.gz.gpg> [--force]" >&2
  exit 2
fi
if [[ ! -f "$ARCHIVE" ]]; then
  echo "Archive not found: $ARCHIVE" >&2
  exit 1
fi

cd "$ROOT_DIR"

if [[ -f backend/.env && "$FORCE" != "--force" ]]; then
  echo "backend/.env already exists — this looks like it's not a fresh clone." >&2
  echo "Refusing to overwrite. Re-run with --force if you're sure:" >&2
  echo "  bash scripts/restore.sh \"$ARCHIVE\" --force" >&2
  exit 1
fi

STAGE_DIR="$(mktemp -d)"
trap 'rm -rf "$STAGE_DIR"' EXIT

echo "==> Decrypting and extracting $ARCHIVE"
if [[ -n "${RESTORE_PASSPHRASE:-}" ]]; then
  gpg --batch --yes --passphrase "$RESTORE_PASSPHRASE" --decrypt "$ARCHIVE" 2>/dev/null | tar -xzf - -C "$STAGE_DIR"
else
  gpg --decrypt "$ARCHIVE" 2>/dev/null | tar -xzf - -C "$STAGE_DIR"
fi

# Plain files/directories go straight into the repo tree.
for path in .env backend/.env frontend/.env backend/media nginx/ssl; do
  if [[ -e "$STAGE_DIR/$path" ]]; then
    mkdir -p "$(dirname "$ROOT_DIR/$path")"
    rm -rf "${ROOT_DIR:?}/$path"
    mv "$STAGE_DIR/$path" "$ROOT_DIR/$path"
  fi
done

echo "==> Fixing permissions"
[[ -d backend/media ]] && chmod -R o+rX backend/media
[[ -f nginx/ssl/privkey.pem ]] && chmod 640 nginx/ssl/privkey.pem
[[ -f nginx/ssl/fullchain.pem ]] && chmod 644 nginx/ssl/fullchain.pem
for f in .env backend/.env frontend/.env; do
  [[ -f "$f" ]] && chmod 600 "$f"
done

# Database dump and pgAdmin volume stay in the stage dir until explicitly
# restored below — copy them into backups/ so they survive past this script's
# cleanup (the stage dir is deleted on exit).
mkdir -p backups
[[ -f "$STAGE_DIR/database.dump" ]] && cp "$STAGE_DIR/database.dump" backups/database.dump
[[ -f "$STAGE_DIR/pgadmin_data.tar.gz" ]] && cp "$STAGE_DIR/pgadmin_data.tar.gz" backups/pgadmin_data.tar.gz
[[ -f "$STAGE_DIR/ai_models.tar.gz" ]] && cp "$STAGE_DIR/ai_models.tar.gz" backups/ai_models.tar.gz
[[ -f "$STAGE_DIR/redis_data.tar.gz" ]] && cp "$STAGE_DIR/redis_data.tar.gz" backups/redis_data.tar.gz

echo
echo "==> Restored:"
[[ -f .env ]] && echo "  .env"
[[ -f backend/.env ]] && echo "  backend/.env"
[[ -f frontend/.env ]] && echo "  frontend/.env"
[[ -d backend/media ]] && echo "  backend/media/ ($(du -sh backend/media | cut -f1))"
[[ -d nginx/ssl ]] && echo "  nginx/ssl/ (bridge cert — still run certbot fresh on this server, see MIGRATION.md)"
[[ -f backups/database.dump ]] && echo "  backups/database.dump (NOT restored yet — see below)"
[[ -f backups/pgadmin_data.tar.gz ]] && echo "  backups/pgadmin_data.tar.gz (NOT restored yet — see below)"
[[ -f backups/ai_models.tar.gz ]] && echo "  backups/ai_models.tar.gz (NOT restored yet — see below)"
[[ -f backups/redis_data.tar.gz ]] && echo "  backups/redis_data.tar.gz (NOT restored yet — see below)"

echo
echo "Next: review backend/.env — update hostnames, and the DATABASE_URL/POSTGRES_*"
echo "values if this move is ALSO changing where the database lives (e.g. a fresh"
echo "Neon project, or the self-hosted Postgres VM in docs/gcp-postgres-migration.md)."
echo "Then, once backend/.env points at the database you actually want this data in:"
echo
if [[ -f backups/database.dump ]]; then
  echo "  # Restore the database (run this BEFORE 'docker compose up', against an"
  echo "  # empty/fresh database — pg_restore --clean will drop existing objects first):"
  echo "  pg_restore --no-owner --no-acl --clean --if-exists \\"
  echo "    --dbname=\"\$(grep -m1 ^DATABASE_URL= backend/.env | cut -d= -f2-)\" \\"
  echo "    backups/database.dump"
  echo "  # (self-hosted Postgres: use -h/-p/-U/-d flags with the POSTGRES_* values instead)"
  echo
fi
if [[ -f backups/pgadmin_data.tar.gz ]]; then
  echo "  # Restore pgAdmin's saved servers (after the FIRST 'docker compose up -d pgadmin',"
  echo "  # so the volume exists; stop pgadmin first so it isn't writing to the volume mid-restore):"
  echo "  docker compose stop pgadmin"
  echo "  docker run --rm -v homekonet_pgadmin_data:/data -v \"\$(pwd)/backups:/backup\" alpine \\"
  echo "    sh -c 'rm -rf /data/* && tar -xzf /backup/pgadmin_data.tar.gz -C / '"
  echo "  docker compose start pgadmin"
  echo
fi
echo "Then follow MIGRATION.md from 'Bring up the stack'."
