// suspensions.serializers + the DRF field validation they rely on.

import type { Selectable } from 'kysely';
import { sql } from 'kysely';
import { db } from '../../db/index.js';
import type { SuspensionsSuspension } from '../../db/schema.js';
import { drf } from '../../lib/datetime.js';
import { pkValue, pyStr, pyStrip, pyTypeName } from '../users/request.js';

export type Suspension = Selectable<SuspensionsSuspension>;

export const SUSPENSION_TYPE_LABELS: Record<string, string> = { temporary: 'Temporary', indefinite: 'Indefinite', permanent: 'Permanent Ban' };
export const SUSPENSION_STATUS_LABELS: Record<string, string> = { active: 'Active', expired: 'Expired', revoked: 'Revoked' };

/** Suspension.is_currently_active */
export function isCurrentlyActive(s: { status: string; ends_at: string | null | Date }): boolean {
  if (s.status !== 'active') return false;
  if (s.ends_at && Date.parse(drf(String(s.ends_at instanceof Date ? s.ends_at.toISOString() : s.ends_at))!) <= Date.now()) return false;
  return true;
}

/** SuspensionSerializer */
export async function serializeSuspension(s: Suspension) {
  const uname = async (id: number | null) => (id === null ? null
    : (await db.selectFrom('users_user').select('username').where('id', '=', id).executeTakeFirst())?.username ?? null);
  return {
    id: s.id,
    user: s.user_id, username: await uname(s.user_id),
    issued_by: s.issued_by_id, issued_by_username: await uname(s.issued_by_id),
    suspension_type: s.suspension_type, suspension_type_display: SUSPENSION_TYPE_LABELS[s.suspension_type] ?? s.suspension_type,
    reason: s.reason,
    started_at: drf(s.started_at as unknown as string), ends_at: drf(s.ends_at as unknown as string | null),
    status: s.status, status_display: SUSPENSION_STATUS_LABELS[s.status] ?? s.status,
    is_currently_active: isCurrentlyActive(s as never),
    revoked_by: s.revoked_by_id, revoked_by_username: await uname(s.revoked_by_id),
    revoked_at: drf(s.revoked_at as unknown as string | null), revocation_reason: s.revocation_reason,
    related_report_id: s.related_report_id,
    user_notified: s.user_notified,
    updated_at: drf(s.updated_at as unknown as string),
  };
}

// ---- DRF fields ------------------------------------------------------------------------------

export class FieldErr extends Error {}
const MISSING = Symbol('missing');
export { MISSING };

/** CharField (trim_whitespace, allow_blank, max/min length). */
export function charField(v: unknown, o: { allowBlank?: boolean; allowNull?: boolean; maxLength?: number; minLength?: number } = {}): string | null {
  if (v === null) { if (o.allowNull) return null; throw new FieldErr('This field may not be null.'); }
  if (v === '' || (typeof v === 'string' && pyStrip(v) === '')) {
    if (o.allowBlank) return '';
    throw new FieldErr('This field may not be blank.');
  }
  if (typeof v === 'boolean' || !(typeof v === 'string' || typeof v === 'number')) throw new FieldErr('Not a valid string.');
  const s = pyStrip(pyStr(v));
  const n = [...s].length;
  if (o.maxLength !== undefined && n > o.maxLength) throw new FieldErr(`Ensure this field has no more than ${o.maxLength} characters.`);
  if (o.minLength !== undefined && n < o.minLength) throw new FieldErr(`Ensure this field has at least ${o.minLength} characters.`);
  if (s.includes('\u0000')) throw new FieldErr('Null characters are not allowed.');
  return s;
}

/** ChoiceField */
export function choiceField(v: unknown, choices: string[], allowNull = false): string | null {
  if (v === null) { if (allowNull) return null; throw new FieldErr('This field may not be null.'); }
  const s = typeof v === 'object' ? null : pyStr(v);
  if (s === null || !choices.includes(s)) throw new FieldErr(`"${pyStr(v)}" is not a valid choice.`);
  return s;
}

/** PrimaryKeyRelatedField(queryset=<table>.objects.all()) — returns the row. */
export async function pkRelatedField(v: unknown, table: 'users_user' | 'reports_report' | 'listings_listing' | 'listings_review' | 'messaging_message', allowNull = false): Promise<Record<string, any> | null> {
  if (v === '') v = null; // RelatedField.run_validation: '' → None
  if (v === null) { if (allowNull) return null; throw new FieldErr('This field may not be null.'); }
  if (typeof v === 'boolean' || !(typeof v === 'string' || typeof v === 'number')) {
    throw new FieldErr(`Incorrect type. Expected pk value, received ${pyTypeName(v)}.`);
  }
  let pk: number | null;
  try { pk = pkValue(v); } catch { throw new FieldErr(`Incorrect type. Expected pk value, received ${pyTypeName(v)}.`); }
  const row = pk === null ? undefined : await db.selectFrom(table as never).selectAll().where(sql.ref('id'), '=', pk).executeTakeFirst();
  if (!row) throw new FieldErr(`Invalid pk "${pyStr(v)}" - object does not exist.`);
  return row as Record<string, any>;
}

const DT_MSG = 'Datetime has wrong format. Use one of these formats instead: YYYY-MM-DDThh:mm[:ss[.uuuuuu]][+HH:MM|-HH:MM|Z].';

function daysIn(y: number, m: number) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

/**
 * django.utils.dateparse.parse_datetime (datetime.fromisoformat first, then
 * Django's regex) + DRF enforce_timezone (naive → UTC). Returns a Postgres
 * timestamptz literal in UTC with microseconds, or throws FieldErr.
 */
export function dateTimeField(v: unknown): string {
  if (typeof v !== 'string') throw new FieldErr(DT_MSG);
  const re1 = /^(\d{4})-?(\d{2})-?(\d{2})(?:[\s\S](\d{2})(?::?(\d{2})(?::?(\d{2})(?:[.,](\d+))?)?)?)?(Z|[+-]\d{2}(?::?\d{2}(?::?\d{2}(?:\.\d+)?)?)?)?$/u;
  const re2 = /^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:[.,](\d{1,6})\d{0,6})?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/u;
  let m = re1.exec(v);
  if (m && /^\d{4}\d{2}\d{2}/.test(v) && m[4] !== undefined && !/^\d{8}T/.test(v)) m = null; // compact date needs a 'T'
  m ??= re2.exec(v);
  if (!m) throw new FieldErr(DT_MSG);
  const [y, mo, d, h = '0', mi = '0', s = '0', frac = '', tz] = m.slice(1) as string[];
  const Y = +y!; const M = +mo!; const D = +d!; const H = +h; const MI = +mi; const S = +s;
  if (M < 1 || M > 12 || D < 1 || D > daysIn(Y, M) || H > 23 || MI > 59 || S > 59 || Y < 1) throw new FieldErr(DT_MSG);
  const micros = Number((frac ?? '').slice(0, 6).padEnd(6, '0') || '0');
  let offsetMin = 0;
  if (tz && tz !== 'Z') {
    const t = /^([+-])(\d{2}):?(\d{2})?/.exec(tz)!;
    offsetMin = (t[1] === '-' ? -1 : 1) * (+t[2]! * 60 + +(t[3] ?? '0'));
    if (+t[2]! > 23) throw new FieldErr(DT_MSG);
  }
  const ms = Date.UTC(Y, M - 1, D, H, MI, S) - offsetMin * 60_000;
  const iso = new Date(ms).toISOString().slice(0, 19);
  return `${iso}.${String(micros).padStart(6, '0')}+00:00`;
}

/** Validation-time `now()` comparison helper. */
export const tsMs = (pgTs: string) => Date.parse(drf(pgTs)!);
