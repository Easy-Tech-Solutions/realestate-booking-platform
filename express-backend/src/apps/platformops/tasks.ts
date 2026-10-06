// platformops.tasks (Celery) + its CELERY_BEAT_SCHEDULE entry.

import { sql } from 'kysely';
import { db } from '../../db/index.js';
import { defineTask, schedule } from '../../lib/jobs.js';
import { collectMetrics } from './metrics.js';

/** collect_server_metrics: persist a snapshot, prune snapshots older than 7 days. */
export async function collectServerMetrics(): Promise<void> {
  const m = await collectMetrics();
  await db.insertInto('platformops_servermetricsnapshot').values({ ...m, recorded_at: new Date() }).execute();
  await db.deleteFrom('platformops_servermetricsnapshot').where('recorded_at', '<', sql<string>`now() - interval '7 days'`).execute();
}

defineTask('platformops.tasks.collect_server_metrics', collectServerMetrics);
schedule('collect-server-metrics', 'platformops.tasks.collect_server_metrics', '*/5 * * * *');
