// users.deletion (soft delete / anonymisation) + the Django Collector
// cascade used by User.delete() (hard delete).

import { sql, type Transaction } from 'kysely';
import { db, type DB } from '../../db/index.js';
import { makeUnusablePassword } from '../../lib/hashers.js';
import { blacklistUserTokens } from '../../domain/users.js';
import type { User } from '../../lib/view.js';
import { DELETE_GRAPH } from './delete_graph.js';

type Executor = typeof db | Transaction<DB>;

const ACTIVE_BOOKING_STATUSES = ['requested', 'pending', 'confirmed'];
const todayUtc = () => new Date().toISOString().slice(0, 10);

/** _has_blocking_bookings */
async function blockingBookings(userId: number, ex: Executor): Promise<string | null> {
  const today = todayUtc();
  const g = await ex.selectFrom('bookings_booking').select((eb) => eb.fn.countAll<string>().as('n'))
    .where('customer_id', '=', userId).where('status', 'in', ACTIVE_BOOKING_STATUSES).where('end_date', '>=', today).executeTakeFirstOrThrow();
  const h = await ex.selectFrom('bookings_booking as b').innerJoin('listings_listing as l', 'l.id', 'b.listing_id')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('l.owner_id', '=', userId).where('b.status', 'in', ACTIVE_BOOKING_STATUSES).where('b.end_date', '>=', today).executeTakeFirstOrThrow();
  const asGuest = Number(g.n); const asHost = Number(h.n);
  if (asGuest && asHost) {
    return `You have ${asGuest} upcoming booking(s) as a guest and ${asHost} on your listings. Resolve them before deleting your account.`;
  }
  if (asGuest) return `You have ${asGuest} upcoming booking(s). Cancel them or wait for them to complete before deleting your account.`;
  if (asHost) return `You have ${asHost} upcoming booking(s) on your listings. Cancel or wait for them to complete before deleting your account.`;
  return null;
}

/** delete_account(user) → [ok, error]. Mutates `user` in place like the Django instance. */
export async function deleteAccount(user: User): Promise<[boolean, string | null]> {
  const block = await blockingBookings(user.id, db);
  if (block) return [false, block];
  const now = new Date();
  await db.transaction().execute(async (trx) => {
    await trx.updateTable('listings_listing').set({ deleted_at: now }).where('owner_id', '=', user.id).where('deleted_at', 'is', null).execute();
    Object.assign(user, {
      username: `deleted-user-${user.id}`,
      email: `deleted-${user.id}@homekonet.invalid`,
      first_name: 'Deleted', last_name: 'User', email_verified: false,
      password: makeUnusablePassword(), is_active: false, deleted_at: now.toISOString(),
    });
    // user.save(): full save of every column from the in-memory instance.
    const { id, ...cols } = user;
    await trx.updateTable('users_user').set({ ...cols, deleted_at: now } as never).where('id', '=', id).execute();
    // FieldFile(None) is stored as '' (str(FieldFile) of an empty file).
    await trx.updateTable('users_profile').set({ bio: '', image: '', phone_number: '' }).where('user_id', '=', user.id).execute();
    await trx.updateTable('hostapplications_hostapplication').set({ momo_number: '' }).where('applicant_id', '=', user.id).execute();
    await blacklistUserTokens(user.id, trx);
  });
  return [true, null];
}

const PROTECTED: [string, string, string, string?][] = [
  ['bookings_as_guest', 'bookings_booking', 'customer_id'],
  ['bookings_as_host', 'bookings_booking', 'listing_owner'],
  ['listings', 'listings_listing', 'owner_id'],
  ['reviews', 'listings_review', 'reviewer_id'],
  ['payments', 'payments_payment', 'user_id'],
  ['payouts', 'payments_payout', 'host_id'],
  ['messages_sent', 'messaging_message', 'sender_id'],
  ['reports_filed', 'reports_report', 'reporter_id'],
  ['suspensions', 'suspensions_suspension', 'user_id'],
  ['host_applications', 'hostapplications_hostapplication', 'applicant_id'],
  ['agreement_acceptances', 'hostapplications_agreementacceptance', 'user_id'],
  ['property_verifications', 'propertyverifications_propertyverification', 'applicant_id'],
  ['aircover_claims', 'support_aircoverclaim', 'claimant_id'],
  ['support_tickets', 'support_supportticket', 'user_id'],
];

/** _protected_record_counts(user): non-zero counts only, in declaration order. */
export async function protectedRecordCounts(userId: number): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const [key, table, col] of PROTECTED) {
    let n: number;
    if (col === 'listing_owner') {
      const r = await sql<{ n: string }>`SELECT count(*) AS n FROM bookings_booking b JOIN listings_listing l ON l.id = b.listing_id WHERE l.owner_id = ${userId}`.execute(db);
      n = Number(r.rows[0]!.n);
    } else {
      const r = await sql<{ n: string }>`SELECT count(*) AS n FROM ${sql.table(table)} WHERE ${sql.ref(col)} = ${userId}`.execute(db);
      n = Number(r.rows[0]!.n);
    }
    if (n > 0) out[key] = n;
  }
  return out;
}

/**
 * Model.delete() for users_user rows: Django's Collector — CASCADE relations
 * are collected recursively, SET_NULL relations are nulled, then every
 * collected row is deleted (FK constraints are DEFERRABLE INITIALLY DEFERRED).
 */
export async function collectAndDelete(table: string, ids: number[], ex: Transaction<DB>) {
  const collected = new Map<string, Set<number>>();
  const queue: [string, number[]][] = [[table, ids]];
  const nulls: [string, string, number[], string][] = [];
  while (queue.length) {
    const [t, pks] = queue.shift()!;
    const set = collected.get(t) ?? new Set<number>();
    const fresh = pks.filter((p) => !set.has(p));
    if (!fresh.length) continue;
    fresh.forEach((p) => set.add(p));
    collected.set(t, set);
    const node = DELETE_GRAPH[t];
    if (!node) continue;
    for (const [rt, col, onDelete] of node.rels) {
      if (onDelete === 'CASCADE') {
        const rpk = DELETE_GRAPH[rt]?.pk ?? 'id';
        const r = await sql<{ pk: number }>`SELECT ${sql.ref(rpk)} AS pk FROM ${sql.table(rt)} WHERE ${sql.ref(col)} IN (${sql.join(fresh)})`.execute(ex);
        if (r.rows.length) queue.push([rt, r.rows.map((x) => x.pk)]);
      } else if (onDelete === 'SET_NULL') {
        nulls.push([rt, col, fresh, t]);
      } else if (onDelete === 'PROTECT' || onDelete === 'RESTRICT') {
        const r = await sql`SELECT 1 FROM ${sql.table(rt)} WHERE ${sql.ref(col)} IN (${sql.join(fresh)}) LIMIT 1`.execute(ex);
        if (r.rows.length) throw new Error(`Cannot delete some instances of model because they are referenced through protected foreign keys: '${rt}.${col}'.`);
      }
    }
  }
  for (const [rt, col, pks] of nulls) {
    await sql`UPDATE ${sql.table(rt)} SET ${sql.ref(col)} = NULL WHERE ${sql.ref(col)} IN (${sql.join(pks)})`.execute(ex);
  }
  for (const [t, pks] of collected) {
    const pk = DELETE_GRAPH[t]?.pk ?? 'id';
    await sql`DELETE FROM ${sql.table(t)} WHERE ${sql.ref(pk)} IN (${sql.join([...pks])})`.execute(ex);
  }
}

/** user.delete() */
export async function deleteUserRow(userId: number) {
  await db.transaction().execute(async (trx) => collectAndDelete('users_user', [userId], trx));
}
