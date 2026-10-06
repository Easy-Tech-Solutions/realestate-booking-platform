#!/usr/bin/env bash
# Sends the same request to Django (backend:8000) and Express (express-api:8000)
# over the Compose network and prints status + headers of interest + body for each.
#   bash express-backend/parity/compare.sh GET /api/health/ [extra curl args...]
set -uo pipefail
METHOD="$1"; PATHQ="$2"; shift 2
for host in backend express-api; do
  echo "--- $host"
  docker run --rm --network homekonet_default curlimages/curl:8.10.1 -s -i -X "$METHOD" \
    -H 'Host: homekonet.com' -H 'X-Forwarded-Proto: https' -H 'X-Forwarded-For: 203.0.113.9' "$@" \
    "http://$host:8000$PATHQ" | grep -iE '^(HTTP/|location|www-authenticate|allow:|retry-after|content-type)|^\{|^\[' | tr -d '\r' | cut -c1-300
done
