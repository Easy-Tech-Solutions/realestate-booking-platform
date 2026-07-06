#!/usr/bin/env bash
# Installs the Certbot renewal hooks that keep nginx/ssl/ in sync with
# Let's Encrypt and briefly stop/start the frontend container around
# renewal (the 'standalone' authenticator needs port 80 free).
#
# Run this once on each server after 'certbot certonly' has issued the
# initial certificate (see MIGRATION.md / docs/DEPLOYMENT.md §10). Requires
# sudo. Safe to re-run — it just overwrites the three hook files.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OWNER="$(id -un)"
GROUP="$(id -gn)"
DOMAIN="${1:-homekonet.com}"

if [[ $EUID -eq 0 ]]; then
  echo "Run this as the deploy user with sudo available, not as root directly." >&2
  exit 1
fi

sudo mkdir -p /etc/letsencrypt/renewal-hooks/{pre,deploy,post}

sudo tee /etc/letsencrypt/renewal-hooks/pre/stop-frontend.sh > /dev/null <<EOF
#!/bin/sh
docker compose -f ${ROOT_DIR}/docker-compose.yml stop frontend || true
EOF

sudo tee /etc/letsencrypt/renewal-hooks/deploy/sync-cert.sh > /dev/null <<EOF
#!/bin/sh
set -e
cp /etc/letsencrypt/live/${DOMAIN}/fullchain.pem ${ROOT_DIR}/nginx/ssl/fullchain.pem
cp /etc/letsencrypt/live/${DOMAIN}/privkey.pem ${ROOT_DIR}/nginx/ssl/privkey.pem
chown ${OWNER}:${GROUP} ${ROOT_DIR}/nginx/ssl/fullchain.pem ${ROOT_DIR}/nginx/ssl/privkey.pem
chmod 644 ${ROOT_DIR}/nginx/ssl/fullchain.pem
chmod 640 ${ROOT_DIR}/nginx/ssl/privkey.pem
EOF

sudo tee /etc/letsencrypt/renewal-hooks/post/start-frontend.sh > /dev/null <<EOF
#!/bin/sh
docker compose -f ${ROOT_DIR}/docker-compose.yml start frontend || true
EOF

sudo chmod +x /etc/letsencrypt/renewal-hooks/pre/stop-frontend.sh \
              /etc/letsencrypt/renewal-hooks/deploy/sync-cert.sh \
              /etc/letsencrypt/renewal-hooks/post/start-frontend.sh

echo "==> Installed renewal hooks for ${ROOT_DIR} (domain: ${DOMAIN})"
echo "==> Verify with: sudo certbot renew --dry-run --no-random-sleep-on-renew"
