// trustsafety.models behaviour + serializers (FraudFlag, BlockedFingerprint, BlacklistedLocation).

import type { Selectable } from 'kysely';
import { db } from '../../db/index.js';
import type { TrustsafetyBlacklistedlocation, TrustsafetyBlockedfingerprint, TrustsafetyFraudflag } from '../../db/schema.js';
import { drf } from '../../lib/datetime.js';

export const FRAUD_FLAG_TYPES: Record<string, string> = {
  rapid_signup: 'Rapid account creation from one IP',
  shared_card: 'Same card used across multiple accounts',
  transaction_spike: 'Unusual transaction volume',
  manual: 'Manually flagged',
};

/** BlacklistedLocation.contains(lat, lng) — flat-earth approximation. */
export function contains(loc: { latitude: string; longitude: string; radius_km: string }, lat: string | number, lng: string | number): boolean {
  const lat1 = Number(loc.latitude); const lng1 = Number(loc.longitude);
  const kmPerDegLat = 111.0;
  const kmPerDegLng = 111.0 * Math.cos(lat1 * (Math.PI / 180));
  const dy = (Number(lat) - lat1) * kmPerDegLat;
  const dx = (Number(lng) - lng1) * kmPerDegLng;
  return Math.hypot(dx, dy) <= Number(loc.radius_km);
}

type Usernames = Map<number, { username: string; email: string }>;

async function users(ids: (number | null)[]): Promise<Usernames> {
  const want = [...new Set(ids.filter((x): x is number => x !== null))];
  if (!want.length) return new Map();
  const rows = await db.selectFrom('users_user').select(['id', 'username', 'email']).where('id', 'in', want).execute();
  return new Map(rows.map((r) => [r.id, r]));
}

export async function serializeFraudFlags(flags: Selectable<TrustsafetyFraudflag>[]) {
  const u = await users(flags.flatMap((f) => [f.user_id, f.reviewed_by_id]));
  return flags.map((f) => ({
    id: f.id, user: f.user_id,
    user_username: f.user_id !== null ? u.get(f.user_id)?.username ?? null : null,
    user_email: f.user_id !== null ? u.get(f.user_id)?.email ?? null : null,
    flag_type: f.flag_type, flag_type_display: FRAUD_FLAG_TYPES[f.flag_type] ?? f.flag_type,
    severity: f.severity, status: f.status, details: f.details, ai_score: f.ai_score, ai_rationale: f.ai_rationale,
    reviewed_by: f.reviewed_by_id,
    reviewed_by_username: f.reviewed_by_id !== null ? u.get(f.reviewed_by_id)?.username ?? null : null,
    reviewed_at: drf(f.reviewed_at), review_notes: f.review_notes, created_at: drf(f.created_at),
  }));
}

export async function serializeFingerprints(rows: Selectable<TrustsafetyBlockedfingerprint>[]) {
  const u = await users(rows.map((r) => r.blocked_by_id));
  return rows.map((r) => ({
    id: r.id, fingerprint: r.fingerprint, reason: r.reason, blocked_by: r.blocked_by_id,
    blocked_by_username: r.blocked_by_id !== null ? u.get(r.blocked_by_id)?.username ?? null : null, created_at: drf(r.created_at),
  }));
}

export async function serializeLocations(rows: Selectable<TrustsafetyBlacklistedlocation>[]) {
  const u = await users(rows.map((r) => r.created_by_id));
  return rows.map((r) => ({
    id: r.id, name: r.name, latitude: r.latitude, longitude: r.longitude, radius_km: r.radius_km, reason: r.reason,
    created_by: r.created_by_id, created_by_username: r.created_by_id !== null ? u.get(r.created_by_id)?.username ?? null : null,
    created_at: drf(r.created_at),
  }));
}

/** FraudFlag.__str__ */
export const fraudFlagStr = (f: { flag_type: string; status: string }) => `${FRAUD_FLAG_TYPES[f.flag_type] ?? f.flag_type} (${f.status})`;
