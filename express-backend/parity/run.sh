#!/usr/bin/env bash
# Runs the parity suite: reset both copies, then replay every scenario in
# parity/tests against Django and Express and compare responses.
#   bash express-backend/parity/run.sh [vitest filter...]
#   PARITY_NAME=bookings DIST=dist-bookings EXPRESS_APPS=bookings bash parity/run.sh tests/bookings
set -euo pipefail
cd "$(dirname "$0")"
export PARITY_NAME="${PARITY_NAME:-main}" DIST="${DIST:-dist}" EXPRESS_APPS="${EXPRESS_APPS:-}"
export PARITY_PASSWORD="parity-Test-pass-1"
# Hash produced by the Express hasher; Django accepting it at login is itself a check.
export PARITY_PASSWORD_HASH="$(docker run --rm -e DIST -e DJANGO_SECRET_KEY=unused -v "$PWD/..:/app" -w /app node:22-bookworm-slim \
  node --input-type=module -e "const {makePassword}=await import('./'+process.env.DIST+'/lib/hashers.js'); console.log(await makePassword(process.argv[1]))" "$PARITY_PASSWORD")"
run_vitest() {
  docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -e NPM_CONFIG_UPDATE_NOTIFIER=false \
    --network "homekonet-parity-${PARITY_NAME}_default" -e PARITY_PASSWORD -e DIST \
    --env-file .env.parity -e PARITY_DJANGO=http://parity-django:8000 -e PARITY_EXPRESS=http://parity-express:8000 \
    -v "$PWD/..:/app" -w /app node:22-bookworm-slim node_modules/.bin/vitest run --root parity "$@"
}

# Each test file gets freshly reset databases, so files can't leak state into
# each other. Positional args are file filters ("tests/auth"); anything from
# the first "-" onward is passed to vitest as-is (e.g. -t "pattern").
FILTERS=(); EXTRA=()
for a in "$@"; do
  if [[ ${#EXTRA[@]} -gt 0 || "$a" == -* ]]; then EXTRA+=("$a"); else FILTERS+=("$a"); fi
done
FILES=()
for f in tests/*.parity.ts; do
  if [[ ${#FILTERS[@]} -eq 0 ]]; then FILES+=("$f"); continue; fi
  for flt in "${FILTERS[@]}"; do [[ "$f" == *"${flt#./}"* ]] && { FILES+=("$f"); break; }; done
done
[[ ${#FILES[@]} -gt 0 ]] || { echo "No test files match: ${FILTERS[*]}" >&2; exit 2; }

status=0; failed=()
for f in "${FILES[@]}"; do
  echo "=== $f"
  # Files marked @parity-mock-providers run with the mock Stripe/MoMo credentials.
  if grep -q '@parity-mock-providers' "$f"; then export PARITY_MOCK_PROVIDERS=1; else unset PARITY_MOCK_PROVIDERS; fi
  bash reset.sh >/dev/null
  if ! run_vitest "$f" "${EXTRA[@]}"; then status=1; failed+=("$f"); fi
done
echo
if [[ $status -eq 0 ]]; then echo "PARITY: all ${#FILES[@]} files passed"; else echo "PARITY: FAILED files: ${failed[*]}"; fi
exit $status
