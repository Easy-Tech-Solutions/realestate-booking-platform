#!/usr/bin/env bash
# Bundles EVERYTHING this deployment needs that isn't reproducible from a
# fresh 'git clone' + 'docker compose build' — the database, media uploads,
# secrets (.env files), the TLS cert, and pgAdmin's saved server list — into
# one encrypted archive for migrating to a new server (or just as a periodic
# off-box backup). See MIGRATION.md for the full runbook.
#
# Usage:
#   bash scripts/backup.sh                    # env files, media, ssl, DB dump, pgAdmin data
#   bash scripts/backup.sh --include-ai-models # + the ~3GB local LLM (else just re-download it)
#   bash scripts/backup.sh --include-redis     # + cache/session/broker state (usually skippable)
#   bash scripts/backup.sh --full              # everything above
#
# BACKUP_PASSPHRASE=... bash scripts/backup.sh   # non-interactive (e.g. cron)
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/backups"
STAMP="$(date +%Y%m%d_%H%M%S 2>/dev/null || true)"
if [[ -z "$STAMP" ]]; then STAMP="manual"; fi
ARCHIVE="homekonet-backup-${STAMP}.tar.gz.gpg"
STAGE_DIR="$(mktemp -d)"
trap 'rm -rf "$STAGE_DIR"' EXIT

INCLUDE_AI_MODELS=0
INCLUDE_REDIS=0
for arg in "$@"; do
  case "$arg" in
    --include-ai-models) INCLUDE_AI_MODELS=1 ;;
    --include-redis) INCLUDE_REDIS=1 ;;
    --full) INCLUDE_AI_MODELS=1; INCLUDE_REDIS=1 ;;
    *) echo "Unknown option: $arg" >&2; echo "Usage: bash scripts/backup.sh [--include-ai-models] [--include-redis] [--full]" >&2; exit 2 ;;
  esac
done

for bin in tar gpg docker; do
  command -v "$bin" >/dev/null || { echo "Required tool not found: $bin" >&2; exit 1; }
done
if ! command -v pg_dump >/dev/null; then
  echo "==> WARNING: pg_dump not found on this host (install the 'postgresql-client' package)."
  echo "    Continuing WITHOUT a database dump — everything else will still be backed up."
fi

# pg_dump's custom-format archive version is tied to its own major version,
# not the server's — a newer pg_dump (e.g. 17) produces a dump pg_restore
# from an older server (e.g. 16) can't read ("unsupported version in file
# header"), even though the dump itself succeeds silently. Debian's
# postgresql-client-common lets multiple client majors coexist at
# /usr/lib/postgresql/<major>/bin/ — prefer the one matching the actual
# server, falling back to whatever's on PATH if that's all there is.
pick_pg_dump() {
  # $1, if given, is a full connection URI; otherwise psql uses the PG* env
  # vars (PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE) already set by the caller.
  local server_major
  if [[ -n "${1:-}" ]]; then
    server_major="$(psql "$1" -tAc 'SHOW server_version_num;' 2>/dev/null | cut -c1-2)"
  else
    server_major="$(psql -tAc 'SHOW server_version_num;' 2>/dev/null | cut -c1-2)"
  fi
  if [[ -n "$server_major" && -x "/usr/lib/postgresql/$server_major/bin/pg_dump" ]]; then
    echo "/usr/lib/postgresql/$server_major/bin/pg_dump"
  else
    command -v pg_dump
  fi
}

mkdir -p "$OUT_DIR"
cd "$ROOT_DIR"

# ---- Plain files/directories, taken straight from the repo tree -----------
INCLUDE=()
for path in .env backend/.env frontend/.env backend/media nginx/ssl; do
  if [[ -e "$path" ]]; then
    INCLUDE+=("$path")
  else
    echo "==> Skipping missing path: $path"
  fi
done

# ---- Database dump ----------------------------------------------------------
# Reads connection info from the *running* backend container's actual
# environment (not by re-parsing backend/.env by hand), so this always
# matches what the app is really connected to — works unchanged whether
# that's external managed Postgres (Neon: DATABASE_URL) or a self-hosted
# instance (discrete POSTGRES_* vars, see docs/gcp-postgres-migration.md).
if command -v pg_dump >/dev/null; then
  BACKEND_ENV="$(docker compose exec -T backend env 2>/dev/null || true)"
  env_var() { printf '%s\n' "$BACKEND_ENV" | grep -m1 "^$1=" | cut -d= -f2- || true; }

  DB_URL="$(env_var DATABASE_URL)"
  if [[ -n "$DB_URL" ]]; then
    PG_DUMP_BIN="$(pick_pg_dump "$DB_URL")"
    echo "==> Dumping database (managed Postgres via DATABASE_URL) using $PG_DUMP_BIN"
    "$PG_DUMP_BIN" --format=custom --no-owner --no-acl --schema=public --dbname="$DB_URL" \
      --file="$STAGE_DIR/database.dump"
  else
    PGHOST_VAL="$(env_var POSTGRES_HOST)"
    if [[ -n "$PGHOST_VAL" ]]; then
      export PGHOST="$PGHOST_VAL"
      export PGPORT="$(env_var POSTGRES_PORT)"
      export PGUSER="$(env_var POSTGRES_USER)"
      export PGPASSWORD="$(env_var POSTGRES_PASSWORD)"
      export PGDATABASE="$(env_var POSTGRES_DB)"
      PG_DUMP_BIN="$(pick_pg_dump)"
      echo "==> Dumping database (self-hosted Postgres via POSTGRES_* vars) using $PG_DUMP_BIN"
      "$PG_DUMP_BIN" --format=custom --no-owner --no-acl --schema=public \
        --file="$STAGE_DIR/database.dump"
    else
      echo "==> No DATABASE_URL or POSTGRES_HOST found in the backend container's env"
      echo "    (SQLite dev fallback, or the backend container isn't running?) — skipping DB dump."
    fi
  fi
fi

# ---- pgAdmin's saved server list / preferences -----------------------------
# Small, but genuinely worth keeping — without it, whoever manages the DB
# has to re-enter every saved connection by hand on the new server.
PGADMIN_VOLUME="$(docker volume ls -q --filter name=pgadmin_data | head -1)"
if [[ -n "$PGADMIN_VOLUME" ]]; then
  echo "==> Exporting pgAdmin data (volume: $PGADMIN_VOLUME)"
  docker run --rm -v "${PGADMIN_VOLUME}:/data:ro" -v "$STAGE_DIR:/backup" alpine \
    tar -czf /backup/pgadmin_data.tar.gz -C / data
else
  echo "==> No pgadmin_data volume found — skipping"
fi

# ---- Optional, larger/regenerable volumes ----------------------------------
if [[ "$INCLUDE_AI_MODELS" == "1" ]]; then
  AI_VOLUME="$(docker volume ls -q --filter name=ai_models | head -1)"
  if [[ -n "$AI_VOLUME" ]]; then
    echo "==> Exporting ai_models volume (large — 'manage.py download_ai_model' on the new"
    echo "    server is usually simpler than transferring this; included because you asked)"
    docker run --rm -v "${AI_VOLUME}:/data:ro" -v "$STAGE_DIR:/backup" alpine \
      tar -czf /backup/ai_models.tar.gz -C / data
  fi
fi
if [[ "$INCLUDE_REDIS" == "1" ]]; then
  REDIS_VOLUME="$(docker volume ls -q --filter name=redis_data | head -1)"
  if [[ -n "$REDIS_VOLUME" ]]; then
    echo "==> Exporting redis_data volume (cache/session/broker state — disposable by design;"
    echo "    included because you asked)"
    docker run --rm -v "${REDIS_VOLUME}:/data:ro" -v "$STAGE_DIR:/backup" alpine \
      tar -czf /backup/redis_data.tar.gz -C / data
  fi
fi

STAGED_FILES=()
for f in database.dump pgadmin_data.tar.gz ai_models.tar.gz redis_data.tar.gz; do
  [[ -f "$STAGE_DIR/$f" ]] && STAGED_FILES+=("$f")
done

if [[ ${#INCLUDE[@]} -eq 0 && ${#STAGED_FILES[@]} -eq 0 ]]; then
  echo "Nothing found to back up. Are you running this from the repo root, with the stack up?" >&2
  exit 1
fi

echo "==> Archiving: ${INCLUDE[*]:-} ${STAGED_FILES[*]:-}"

TAR_ARGS=(-C "$ROOT_DIR" "${INCLUDE[@]}")
if [[ ${#STAGED_FILES[@]} -gt 0 ]]; then
  TAR_ARGS+=(-C "$STAGE_DIR" "${STAGED_FILES[@]}")
fi

PASSPHRASE="${BACKUP_PASSPHRASE:-}"
if [[ -z "$PASSPHRASE" ]]; then
  echo "==> No BACKUP_PASSPHRASE set — you'll be prompted for an encryption passphrase."
  echo "    Remember it; you'll need the same passphrase to restore on the new server."
  tar -czf - "${TAR_ARGS[@]}" | gpg --symmetric --cipher-algo AES256 -o "$OUT_DIR/$ARCHIVE"
else
  tar -czf - "${TAR_ARGS[@]}" | gpg --batch --yes --passphrase "$PASSPHRASE" --symmetric --cipher-algo AES256 -o "$OUT_DIR/$ARCHIVE"
fi

chmod 600 "$OUT_DIR/$ARCHIVE"
SIZE=$(du -h "$OUT_DIR/$ARCHIVE" | cut -f1)

echo
echo "==> Done: $OUT_DIR/$ARCHIVE ($SIZE)"
echo "==> Contents: ${INCLUDE[*]:-} ${STAGED_FILES[*]:-}"
echo
echo "Copy it to the new server, e.g.:"
echo "  scp \"$OUT_DIR/$ARCHIVE\" youruser@new-server:/opt/homekonet/backups/"
echo
echo "Then on the new server (after 'git clone' but before 'docker compose up'), run:"
echo "  bash scripts/restore.sh backups/$ARCHIVE"
echo
echo "NEVER 'git add' a database dump or a backup archive directly — that's exactly"
echo "what this script (and the encrypted backups/ directory, which is gitignored)"
echo "exists to avoid. See docs/developer-guide.html's Backup & Migration section."
