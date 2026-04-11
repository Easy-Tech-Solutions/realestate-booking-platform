#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
ALLOW_DEV="false"

for arg in "$@"; do
  case "$arg" in
    --allow-dev)
      ALLOW_DEV="true"
      ;;
    *)
      echo "Unknown argument: $arg"
      echo "Usage: ./scripts/release-check.sh [--allow-dev]"
      exit 2
      ;;
  esac
done

echo "==> Backend: Django system checks"
cd "$BACKEND_DIR"
python manage.py check

echo "==> Backend: Prelaunch checks"
if [[ "$ALLOW_DEV" == "true" ]]; then
  python scripts/prelaunch_check.py --allow-dev
else
  python scripts/prelaunch_check.py
fi

echo "==> Frontend: Lint"
cd "$FRONTEND_DIR"
npm run lint

echo "==> Frontend: Typecheck"
npm run typecheck

echo "==> Frontend: Build"
npm run build

echo "All release checks passed."
