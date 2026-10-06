#!/usr/bin/env bash
# Resets the parity environment: both copies (django_copy, express_copy) are
# restored from the same snapshot of express-db (itself a copy of production —
# production is never touched here), test accounts get a known password, Redis
# is flushed, and both app instances are (re)started.
set -euo pipefail
cd "$(dirname "$0")"
ROOT=../..
export PARITY_NAME="${PARITY_NAME:-main}" DIST="${DIST:-dist}"
P=(docker compose -p "homekonet-parity-$PARITY_NAME" -f docker-compose.parity.yml)
E=(docker compose -f "$ROOT/docker-compose.yml" --profile express)

bash mocks/gen-certs.sh   # throwaway test CA + cert for the mock providers (no-op when present)
"${P[@]}" up -d --wait parity-db parity-redis >/dev/null
"${P[@]}" stop parity-django parity-express >/dev/null 2>&1 || true

SNAP="$(mktemp)"; trap 'rm -f "$SNAP"' EXIT
"${E[@]}" exec -T express-db pg_dump --format=custom --no-owner --no-acl --schema=public -U homekonet_express -d homekonet > "$SNAP"

# Known password for one account per role, applied identically to both copies.
# PARITY_PASSWORD_HASH is a Django-format hash of PARITY_PASSWORD (see run.sh).
SET_PW="UPDATE users_user SET password = '${PARITY_PASSWORD_HASH:?run via run.sh}'
        WHERE id IN (SELECT DISTINCT ON (role) u.id FROM users_user u
                     WHERE u.is_active AND u.email_verified
                       AND NOT EXISTS (SELECT 1 FROM superadmin_mfadevice m WHERE m.user_id = u.id)
                     ORDER BY role, u.id);"

for dbname in django_copy express_copy; do
  "${P[@]}" exec -T parity-db psql -q -U parity -d parity -c "DROP DATABASE IF EXISTS $dbname WITH (FORCE);" -c "CREATE DATABASE $dbname;"
  "${P[@]}" exec -T parity-db pg_restore --no-owner --no-acl --clean --if-exists --exit-on-error -U parity -d "$dbname" < "$SNAP"
  "${P[@]}" exec -T parity-db psql -q -U parity -d "$dbname" -c "$SET_PW"
done
"${P[@]}" exec -T parity-redis redis-cli FLUSHALL >/dev/null

# PARITY_MOCK_PROVIDERS (set by run.sh per test file) decides whether the two
# backends get the mock providers' test credentials — see docker-compose.parity.yml.
"${P[@]}" up -d --force-recreate parity-mocks parity-django parity-express >/dev/null
for svc in parity-mocks:8080 parity-django:8000 parity-express:8000; do
  for i in $(seq 1 60); do
    if "${P[@]}" exec -T parity-redis sh -c "nc -z ${svc%:*} ${svc#*:}" 2>/dev/null; then break; fi
    [[ $i == 60 ]] && { echo "$svc did not start" >&2; "${P[@]}" logs --tail 30 "${svc%:*}" >&2; exit 1; }
    sleep 2
  done
done
echo "parity environment reset"
