#!/usr/bin/env bash
# Restores a backup.sh archive onto a freshly cloned repo. Run this on the NEW
# server after 'git clone' but BEFORE 'docker compose up'. See MIGRATION.md.
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

echo "==> Decrypting and extracting $ARCHIVE"
gpg --decrypt "$ARCHIVE" 2>/dev/null | tar -xzf - -C "$ROOT_DIR"

echo "==> Fixing permissions"
[[ -d backend/media ]] && chmod -R o+rX backend/media
[[ -f nginx/ssl/privkey.pem ]] && chmod 640 nginx/ssl/privkey.pem
[[ -f nginx/ssl/fullchain.pem ]] && chmod 644 nginx/ssl/fullchain.pem
for f in .env backend/.env frontend/.env; do
  [[ -f "$f" ]] && chmod 600 "$f"
done

echo
echo "==> Restored:"
[[ -f .env ]] && echo "  .env"
[[ -f backend/.env ]] && echo "  backend/.env"
[[ -f frontend/.env ]] && echo "  frontend/.env"
[[ -d backend/media ]] && echo "  backend/media/ ($(du -sh backend/media | cut -f1))"
[[ -d nginx/ssl ]] && echo "  nginx/ssl/ (bridge cert — still run certbot fresh on this server, see MIGRATION.md)"
echo
echo "Next: review backend/.env (update hostnames etc. if anything server-specific"
echo "changed), then follow MIGRATION.md from 'Bring up the stack'."
