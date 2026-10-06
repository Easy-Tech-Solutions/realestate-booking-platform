#!/usr/bin/env bash
# Regenerates src/db/schema.ts from express-db's live schema (which is a copy of
# Django's, so this tracks Django migrations after each sync). Post-processing
# matches the runtime pg type parsers in src/db/index.ts: int8 -> number,
# timestamps -> the raw Postgres string (keeps DRF's microsecond precision).
set -euo pipefail
cd "$(dirname "$0")"
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp --network homekonet_express_internal \
  --env-file .env.db -v "$PWD:/app" -w /app node:22-bookworm-slim sh -c \
  'DATABASE_URL="postgres://$POSTGRES_USER:$POSTGRES_PASSWORD@express-db:5432/$POSTGRES_DB" npx kysely-codegen --dialect postgres --out-file src/db/schema.ts --camel-case=false' >/dev/null
sed -i \
  -e 's/^export type Int8 = ColumnType<string,/export type Int8 = ColumnType<number,/' \
  -e 's/^export type Timestamp = ColumnType<Date,/export type Timestamp = ColumnType<string,/' \
  src/db/schema.ts
echo "src/db/schema.ts: $(grep -c '^export interface' src/db/schema.ts) tables"
