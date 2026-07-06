#!/usr/bin/env bash
# Bundles everything this deployment needs that ISN'T in git — media uploads,
# secrets, and the TLS cert — into one encrypted archive for migrating to a
# new server. See MIGRATION.md for the full runbook.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/backups"
STAMP="$(date +%Y%m%d_%H%M%S 2>/dev/null || true)"
if [[ -z "$STAMP" ]]; then STAMP="manual"; fi
ARCHIVE="homekonet-backup-${STAMP}.tar.gz.gpg"

mkdir -p "$OUT_DIR"
cd "$ROOT_DIR"

INCLUDE=()
for path in .env backend/.env frontend/.env backend/media nginx/ssl; do
  if [[ -e "$path" ]]; then
    INCLUDE+=("$path")
  else
    echo "==> Skipping missing path: $path"
  fi
done

if [[ ${#INCLUDE[@]} -eq 0 ]]; then
  echo "Nothing found to back up. Are you running this from the repo root?" >&2
  exit 1
fi

echo "==> Archiving: ${INCLUDE[*]}"

PASSPHRASE="${BACKUP_PASSPHRASE:-}"
if [[ -z "$PASSPHRASE" ]]; then
  echo "==> No BACKUP_PASSPHRASE set — you'll be prompted for an encryption passphrase."
  echo "    Remember it; you'll need the same passphrase to restore on the new server."
  tar -czf - "${INCLUDE[@]}" | gpg --symmetric --cipher-algo AES256 -o "$OUT_DIR/$ARCHIVE"
else
  tar -czf - "${INCLUDE[@]}" | gpg --batch --yes --passphrase "$PASSPHRASE" --symmetric --cipher-algo AES256 -o "$OUT_DIR/$ARCHIVE"
fi

chmod 600 "$OUT_DIR/$ARCHIVE"
SIZE=$(du -h "$OUT_DIR/$ARCHIVE" | cut -f1)

echo
echo "==> Done: $OUT_DIR/$ARCHIVE ($SIZE)"
echo
echo "Copy it to the new server, e.g.:"
echo "  scp \"$OUT_DIR/$ARCHIVE\" youruser@new-server:/opt/homekonet/backups/"
echo
echo "Then on the new server (after 'git clone' but before 'docker compose up'), run:"
echo "  bash scripts/restore.sh backups/$ARCHIVE"
