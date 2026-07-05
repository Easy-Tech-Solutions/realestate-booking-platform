#!/bin/sh
set -e

echo "==> Applying database migrations..."
python manage.py migrate --no-input

echo "==> Collecting static files..."
python manage.py collectstatic --no-input

echo "==> Starting: $*"
exec "$@"
