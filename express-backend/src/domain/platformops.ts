// platformops — functions other apps call (platformops.utils.is_feature_enabled,
// platformops.models.TaskHeartbeat.record).

import { sql } from 'kysely';
import { db } from '../db/index.js';

/** platformops.utils.is_feature_enabled(key, default=False) */
export { isFeatureEnabled } from '../middleware/core.js';

/** TaskHeartbeat.record(task_name, success=True, error='') — get_or_create + run_count = F('run_count') + 1. */
export async function recordTaskHeartbeat(taskName: string, success = true, error = ''): Promise<void> {
  const existing = await db.selectFrom('platformops_taskheartbeat').select('id').where('task_name', '=', taskName).executeTakeFirst();
  if (!existing) {
    await db.insertInto('platformops_taskheartbeat')
      .values({ task_name: taskName, last_run_at: null, last_success: null, last_error: '', run_count: 0 })
      .onConflict((oc) => oc.column('task_name').doNothing())
      .execute();
  }
  await db.updateTable('platformops_taskheartbeat')
    .set({ last_run_at: new Date(), last_success: success, last_error: success ? '' : error, run_count: sql`run_count + 1` })
    .where('task_name', '=', taskName)
    .execute();
}
