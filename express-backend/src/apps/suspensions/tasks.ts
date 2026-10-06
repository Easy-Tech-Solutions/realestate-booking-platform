// suspensions.tasks (Celery) + its CELERY_BEAT_SCHEDULE entry.

import { sql } from 'kysely';
import { db } from '../../db/index.js';
import { notifyAccountReinstated } from '../../domain/notifications.js';
import { recordTaskHeartbeat } from '../../domain/platformops.js';
import { markSuspensionExpired } from '../../domain/suspensions.js';
import { defineTask, schedule } from '../../lib/jobs.js';
import { logger } from '../../lib/logger.js';

const NAME = 'suspensions.tasks.expire_suspensions';

/** expire_suspensions: mark naturally-expired ACTIVE suspensions EXPIRED and notify each user. */
export async function expireSuspensions(): Promise<number> {
  try {
    // Suspension.Meta.ordering = ['-started_at']
    const rows = await db.selectFrom('suspensions_suspension').selectAll()
      .where('status', '=', 'active').where('ends_at', '<=', sql<string>`now()`).orderBy('started_at', 'desc').execute();
    let count = 0;
    for (const s of rows) {
      const updated = await markSuspensionExpired(s.id);
      try {
        await notifyAccountReinstated(updated as never);
      } catch (exc) {
        logger.warn(`expire_suspensions: could not notify user ${s.user_id} for suspension ${s.id}: ${String(exc)}`);
      }
      count++;
    }
    logger.info(`expire_suspensions: marked ${count} suspension(s) as expired`);
    await recordTaskHeartbeat(NAME, true);
    return count;
  } catch (exc) {
    await recordTaskHeartbeat(NAME, false, String(exc));
    throw exc;
  }
}

defineTask(NAME, expireSuspensions);
schedule('expire-suspensions', NAME, '10 * * * *');
