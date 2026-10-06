// suspensions — model behaviour other apps call (Suspension.objects.create +
// suspensions.signals, revoke(), mark_expired(), active-suspension lookup).

import { sql, type Transaction } from 'kysely';
import { db, type DB } from '../db/index.js';
import { notifyAccountReinstated, notifyAccountSuspended } from './notifications.js';
import { logger } from '../lib/logger.js';

type Executor = typeof db | Transaction<DB>;

export async function getSuspension(id: number, ex: Executor = db) {
  return ex.selectFrom('suspensions_suspension').selectAll().where('id', '=', id).executeTakeFirst();
}

/** Active-and-unexpired suspension exists (status=active, ends_at null or in the future). */
export async function hasActiveSuspension(userId: number, ex: Executor = db): Promise<boolean> {
  const r = await ex.selectFrom('suspensions_suspension').select('id').where('user_id', '=', userId).where('status', '=', 'active')
    .where((eb) => eb.or([eb('ends_at', 'is', null), eb('ends_at', '>', sql<string>`now()`)])).executeTakeFirst();
  return !!r;
}

/**
 * Suspension.objects.create(...) followed by the post_save(created) signal:
 * notify_account_suspended + queryset update(user_notified=True). Errors in
 * the signal's notification are swallowed like Django. Returns the row as
 * the in-memory Django instance holds it (user_notified still False).
 */
export async function createSuspension(
  v: { user_id: number; issued_by_id: number | null; suspension_type: string; reason: string; ends_at: string | null; related_report_id: number | null },
  ex: Executor = db,
) {
  const now = new Date();
  const s = await ex.insertInto('suspensions_suspension').values({
    ...v, started_at: now, updated_at: now, status: 'active', revoked_by_id: null, revoked_at: null, revocation_reason: '', user_notified: false,
  }).returningAll().executeTakeFirstOrThrow();
  try {
    await notifyAccountSuspended(s as never, ex);
    await ex.updateTable('suspensions_suspension').set({ user_notified: true }).where('id', '=', s.id).execute();
  } catch (e) {
    logger.warn({ err: e }, 'suspension_post_save: notify failed');
  }
  return s;
}

/** suspension_post_save for a non-created save: status → revoked notifies the user. */
export async function suspensionPostSave(s: { id: number; user_id: number; suspension_type: string; reason: string; ends_at: unknown; status: string }, oldStatus: string | null, ex: Executor = db) {
  if (oldStatus !== s.status && s.status === 'revoked') {
    try { await notifyAccountReinstated(s as never, ex); } catch { /* swallowed */ }
  }
}

/** Suspension.revoke(admin, reason) (+ signal). Returns the updated row. */
export async function revokeSuspension(id: number, adminId: number, reason: string, ex: Executor = db) {
  const old = await getSuspension(id, ex);
  const s = await ex.updateTable('suspensions_suspension')
    .set({ status: 'revoked', revoked_by_id: adminId, revoked_at: new Date(), revocation_reason: reason, updated_at: new Date() })
    .where('id', '=', id).returningAll().executeTakeFirstOrThrow();
  await suspensionPostSave(s, old?.status ?? null, ex);
  return s;
}

/** Suspension.mark_expired() (+ signal, which does nothing for 'expired'). */
export async function markSuspensionExpired(id: number, ex: Executor = db) {
  return ex.updateTable('suspensions_suspension').set({ status: 'expired', updated_at: new Date() })
    .where('id', '=', id).returningAll().executeTakeFirstOrThrow();
}
