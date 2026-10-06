#!/usr/bin/env bash
# Copies data between the Django backend and the standby Express backend.
# Both use the same table layout (Django's migrations define it), so a plain
# pg_dump/pg_restore round-trip is a faithful copy. Media files are copied too.
#
#   bash scripts/express-sync-data.sh to-express   # Django -> Express (default)
#   bash scripts/express-sync-data.sh to-django    # Express -> Django (switching back)
#
# The SOURCE is only read (pg_dump takes a consistent snapshot). The TARGET
# database is overwritten completely — so this refuses to write into whichever
# backend is currently live (whichever nginx/nginx.conf proxies to), unless --force.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DIRECTION="${1:-to-express}"
FORCE="${2:-}"
# The live backend is whichever one nginx proxies to (scripts/switch-backend.sh).
if grep -q 'proxy_pass *http://express-api:8000' nginx/nginx.conf; then ACTIVE=express-api; else ACTIVE=backend; fi

case "$DIRECTION" in
  to-express)
    SRC_SVC=db;          SRC_USER=homekonet_app
    DST_SVC=express-db;  DST_USER=homekonet_express
    SRC_MEDIA=backend/media/; DST_MEDIA=express-backend/media/
    [[ "$ACTIVE" == "express-api" && "$FORCE" != "--force" ]] && {
      echo "Express is the LIVE backend — syncing Django -> Express would overwrite live data. Aborting." >&2; exit 1; }
    ;;
  to-django)
    SRC_SVC=express-db;  SRC_USER=homekonet_express
    DST_SVC=db;          DST_USER=homekonet_app
    SRC_MEDIA=express-backend/media/; DST_MEDIA=backend/media/
    [[ "$ACTIVE" == "backend" && "$FORCE" != "--force" ]] && {
      echo "Django is the LIVE backend — syncing Express -> Django would overwrite live data. Aborting." >&2; exit 1; }
    ;;
  *) echo "Usage: $0 [to-express|to-django] [--force]" >&2; exit 2 ;;
esac

DC=(docker compose --profile express)

echo "==> Ensuring $SRC_SVC and $DST_SVC are running"
"${DC[@]}" up -d --wait "$SRC_SVC" "$DST_SVC"

echo "==> Copying database $SRC_SVC -> $DST_SVC"
# --clean --if-exists: the dump contains CREATE SCHEMA public (see MIGRATION.md).
"${DC[@]}" exec -T "$SRC_SVC" pg_dump --format=custom --no-owner --no-acl --schema=public \
    -U "$SRC_USER" -d homekonet \
  | "${DC[@]}" exec -T "$DST_SVC" pg_restore --no-owner --no-acl --clean --if-exists \
    --exit-on-error -U "$DST_USER" -d homekonet

Q="select (select count(*) from users_user), (select count(*) from listings_listing), (select count(*) from bookings_booking)"
S="$("${DC[@]}" exec -T "$SRC_SVC" psql -U "$SRC_USER" -d homekonet -tAc "$Q")"
D="$("${DC[@]}" exec -T "$DST_SVC" psql -U "$DST_USER" -d homekonet -tAc "$Q")"
echo "    users|listings|bookings  source=$S  target=$D"
[[ "$S" == "$D" ]] || { echo "Row counts differ after restore — investigate before switching." >&2; exit 1; }

echo "==> Copying media $SRC_MEDIA -> $DST_MEDIA"
mkdir -p "$DST_MEDIA"
rsync -a --delete "$SRC_MEDIA" "$DST_MEDIA"

echo "==> Sync $DIRECTION complete"
