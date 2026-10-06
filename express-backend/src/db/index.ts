import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { config } from '../config.js';
import type { DB } from './schema.js';

// Type parsers chosen to reproduce what Django/DRF hand back:
//  - int8 (BigAutoField ids, counts): number — ids here are far below 2^53.
//  - numeric (DecimalField): left as the exact string; DRF serializes
//    decimals as strings too (COERCE_DECIMAL_TO_STRING), so no float drift.
//  - timestamp/timestamptz/date: the raw Postgres text, formatted for output
//    by lib/datetime.ts — a JS Date would drop Postgres' microseconds.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, (v) => v);
pg.types.setTypeParser(pg.types.builtins.TIMESTAMP, (v) => v);
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

export const pool = new pg.Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,
  max: 10,
  // Django runs with TIME_ZONE='UTC'/USE_TZ=True; pin the session so raw
  // timestamptz text always comes back as +00.
  options: '-c TimeZone=UTC',
});

export const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });

export type { DB } from './schema.js';
