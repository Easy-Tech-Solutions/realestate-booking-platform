#!/usr/bin/env bash
# Switches live traffic between the Django backend and the standby Express
# backend. Both serve the same API from their own database/Redis/media, so a
# switch is: freeze writes on the current one -> copy its data to the other ->
# start the other -> repoint nginx -> stop the old one.
#
#   bash scripts/switch-backend.sh status
#   bash scripts/switch-backend.sh express     # Django -> Express
#   bash scripts/switch-backend.sh django      # Express -> Django
#
# Expect ~1 minute of API downtime (writes are frozen while data copies).
# Static frontend pages keep loading throughout — only /api, /ws, /media and
# /admin are affected.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
NGINX_CONF=nginx/nginx.conf
DC=(docker compose --profile express)
DJANGO_APP=(backend celery celery-beat celery-ai)
EXPRESS_APP=(express-api express-worker express-worker-ai)

active() {
  if grep -q 'proxy_pass *http://express-api:8000' "$NGINX_CONF"; then echo express; else echo django; fi
}

set_env_flag() { # file key value
  if grep -q "^$2=" "$1"; then sed -i "s/^$2=.*/$2=$3/" "$1"; else echo "$2=$3" >> "$1"; fi
}

# Rewrite nginx.conf IN PLACE (same inode — it's a single-file bind mount, a
# replaced file would be invisible to the container), test, reload; restore on failure.
point_nginx_at() { # django|express
  local backup tmp
  backup="$(mktemp)"; tmp="$(mktemp)"
  cp "$NGINX_CONF" "$backup"
  if [[ "$1" == express ]]; then
    # proxy targets + serve /media/ from Express (its own copy of the files)
    sed -e 's#proxy_pass *http://backend:8000;#proxy_pass         http://express-api:8000;#' \
        -e '/location \/media\/ {/,/}/c\    location /media/ {\n        proxy_pass         http://express-api:8000;\n        expires 7d;\n    }' \
        "$NGINX_CONF" > "$tmp"
  else
    sed -e 's#proxy_pass *http://express-api:8000;#proxy_pass         http://backend:8000;#' \
        -e '/location \/media\/ {/,/}/c\    location /media/ {\n        alias /app/media/;\n        expires 7d;\n    }' \
        "$NGINX_CONF" > "$tmp"
  fi
  cat "$tmp" > "$NGINX_CONF"; rm -f "$tmp"
  if docker compose exec -T frontend nginx -t >/dev/null 2>&1 && docker compose exec -T frontend nginx -s reload; then
    rm -f "$backup"
  else
    echo "nginx rejected the new config — restoring the previous one." >&2
    cat "$backup" > "$NGINX_CONF"; rm -f "$backup"
    docker compose exec -T frontend nginx -s reload || true
    return 1
  fi
}

wait_healthy() { # service
  for _ in $(seq 1 60); do
    [[ "$(docker inspect -f '{{.State.Health.Status}}' "$("${DC[@]}" ps -q "$1")" 2>/dev/null)" == healthy ]] && return 0
    sleep 2
  done
  echo "$1 did not become healthy" >&2; return 1
}

smoke() {
  curl -fsS -o /dev/null --max-time 10 https://homekonet.com/api/health/ && echo "==> https://homekonet.com/api/health/ OK"
}

CURRENT="$(active)"
case "${1:-status}" in
  status)
    echo "Live backend: $CURRENT"
    "${DC[@]}" ps --format 'table {{.Service}}\t{{.Status}}'
    ;;

  express)
    [[ "$CURRENT" == express ]] && { echo "Express is already live."; exit 0; }
    echo "==> Building Express image"; "${DC[@]}" build express-api express-worker
    echo "==> Freezing writes: stopping Django app services"
    docker compose stop "${DJANGO_APP[@]}"
    if ! bash scripts/express-sync-data.sh to-express; then
      echo "Sync failed — restarting Django, nothing switched." >&2
      docker compose start "${DJANGO_APP[@]}"; exit 1
    fi
    set_env_flag express-backend/.env EXPRESS_JOBS_ENABLED true
    "${DC[@]}" up -d --force-recreate "${EXPRESS_APP[@]}"
    wait_healthy express-api
    point_nginx_at express || { docker compose start "${DJANGO_APP[@]}"; exit 1; }
    smoke || echo "WARNING: smoke test failed — check 'docker compose logs express-api'." >&2
    echo "==> Express is live. Django app services are stopped (its database is left as of the switch)."
    echo "    Don't run a bare 'docker compose up -d' now — it would restart Django's Celery jobs alongside Express's."
    ;;

  django)
    [[ "$CURRENT" == django ]] && { echo "Django is already live."; exit 0; }
    echo "==> Freezing writes: stopping Express app services"
    "${DC[@]}" stop "${EXPRESS_APP[@]}"
    if ! bash scripts/express-sync-data.sh to-django; then
      echo "Sync failed — restarting Express, nothing switched." >&2
      "${DC[@]}" start "${EXPRESS_APP[@]}"; exit 1
    fi
    set_env_flag express-backend/.env EXPRESS_JOBS_ENABLED false
    docker compose start "${DJANGO_APP[@]}"
    wait_healthy backend
    point_nginx_at django || { "${DC[@]}" start "${EXPRESS_APP[@]}"; exit 1; }
    smoke || echo "WARNING: smoke test failed — check 'docker compose logs backend'." >&2
    echo "==> Django is live. Express is stopped (cold standby)."
    "${DC[@]}" stop express-db express-redis
    ;;

  *) echo "Usage: $0 [status|express|django]" >&2; exit 2 ;;
esac
