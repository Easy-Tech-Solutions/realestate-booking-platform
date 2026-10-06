#!/usr/bin/env bash
# Runs a command inside the Node 22 image (Node isn't installed on the host),
# as the current user, on express-db/express-redis' private network.
#   ./dev.sh npm run typecheck
#   ./dev.sh npx vitest run
set -euo pipefail
cd "$(dirname "$0")"
exec docker run --rm -i --user "$(id -u):$(id -g)" -e HOME=/tmp -e NPM_CONFIG_UPDATE_NOTIFIER=false \
  --network homekonet_express_internal --env-file .env -v "$PWD:/app" -w /app node:22-bookworm-slim "$@"
