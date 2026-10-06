// trustsafety.detection — rule-based fraud detectors.

import { sql } from 'kysely';
import { db } from '../../db/index.js';
import { nowPg } from '../../lib/datetime.js';
import { delayAiScoring } from '../../domain/aiscoring.js';
import { likeContains } from '../listings/filters.js';

const RAPID_SIGNUP_WINDOW_MINUTES = 60;
const RAPID_SIGNUP_THRESHOLD = 3;

async function openFlagExists(flagType: string, signal: string): Promise<boolean> {
  const r = await db.selectFrom('trustsafety_fraudflag').select('id').where('flag_type', '=', flagType).where('status', '=', 'open')
    .where(sql<boolean>`"details"::text LIKE ${likeContains(signal)}`).limit(1).executeTakeFirst();
  return !!r;
}

async function createFlag(values: { flag_type: string; severity: string; details: string; user_id?: number | null }) {
  const flag = await db.insertInto('trustsafety_fraudflag').values({
    user_id: values.user_id ?? null, flag_type: values.flag_type, severity: values.severity, status: 'open', details: values.details,
    ai_score: null, ai_rationale: '', reviewed_by_id: null, reviewed_at: null, review_notes: '', created_at: nowPg(),
  }).returningAll().executeTakeFirstOrThrow();
  await delayAiScoring('score_fraud_flag_task', flag.id);
  return flag;
}

export async function detectRapidSignups(windowMinutes = RAPID_SIGNUP_WINDOW_MINUTES, threshold = RAPID_SIGNUP_THRESHOLD) {
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const created = [];
  const rows = (await sql<{ ip_address: string; n: number }>`SELECT "trustsafety_accountsignupevent"."ip_address", COUNT("trustsafety_accountsignupevent"."id") AS "n"
    FROM "trustsafety_accountsignupevent" WHERE ("trustsafety_accountsignupevent"."created_at" >= ${since}::timestamptz AND "trustsafety_accountsignupevent"."ip_address" IS NOT NULL)
    GROUP BY "trustsafety_accountsignupevent"."ip_address" HAVING COUNT("trustsafety_accountsignupevent"."id") >= ${threshold}`.execute(db)).rows;
  for (const row of rows) {
    const ip = row.ip_address;
    const n = Number(row.n);
    if (await openFlagExists('rapid_signup', ip)) continue;
    const events = await db.selectFrom('trustsafety_accountsignupevent as e').innerJoin('users_user as u', 'u.id', 'e.user_id')
      .select('u.username').where('e.ip_address', '=', ip).where('e.created_at', '>=', since).orderBy('e.created_at').execute();
    created.push(await createFlag({
      flag_type: 'rapid_signup', severity: n >= threshold * 2 ? 'high' : 'medium',
      details: `${n} accounts created from IP ${ip} within ${windowMinutes} minutes: ${events.map((e) => e.username).join(', ')}`,
    }));
  }
  return created;
}

export async function detectSharedCards() {
  const created = [];
  const groups = (await sql<{ last4: string; expiry_month: string; expiry_year: string; card_type: string }>`SELECT "payments_savedcard"."last4", "payments_savedcard"."expiry_month",
    "payments_savedcard"."expiry_year", "payments_savedcard"."card_type", COUNT(DISTINCT "payments_savedcard"."user_id") AS "n_users"
    FROM "payments_savedcard" GROUP BY "payments_savedcard"."last4", "payments_savedcard"."expiry_month", "payments_savedcard"."expiry_year", "payments_savedcard"."card_type"
    HAVING COUNT(DISTINCT "payments_savedcard"."user_id") > 1`.execute(db)).rows;
  for (const g of groups) {
    const cards = await db.selectFrom('payments_savedcard as c').innerJoin('users_user as u', 'u.id', 'c.user_id').select('u.username')
      .where('c.last4', '=', g.last4).where('c.expiry_month', '=', g.expiry_month).where('c.expiry_year', '=', g.expiry_year)
      .where('c.card_type', '=', g.card_type).execute();
    const usernames = [...new Set(cards.map((c) => c.username))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const signature = `${g.card_type} ****${g.last4} ${g.expiry_month}/${g.expiry_year}`;
    if (await openFlagExists('shared_card', signature)) continue;
    created.push(await createFlag({
      flag_type: 'shared_card', severity: 'medium',
      details: `Card ${signature} is saved on ${usernames.length} accounts: ${usernames.join(', ')}`,
    }));
  }
  return created;
}

export async function runAllDetectors() {
  return { rapid_signup: await detectRapidSignups(), shared_card: await detectSharedCards() };
}

export { createFlag as createFraudFlag };
