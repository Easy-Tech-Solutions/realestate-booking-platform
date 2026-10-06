// Python / Django semantics the bookings, leaseagreements and agents ports
// depend on: int() coercion of lookup values, float round(), date/time
// fromisoformat, django.utils.dateparse.parse_datetime, Decimal() parsing,
// str.strip(), icontains patterns and timedelta arithmetic on Postgres text.

import { sql, type RawBuilder } from 'kysely';
import { inBigintRange, pyIntStr, pyRepr, pyStr, pyStrip, pyTruthy } from '../../lib/py.js';

export { inBigintRange, pyStr, pyRepr, pyStrip, pyTruthy };

// ---- int() -----------------------------------------------------------------------------

/**
 * Python int(value) as IntegerField.get_prep_value applies it to a lookup value.
 * Returns the integer (as a bigint), or throws a TypeError/ValueError-like Error
 * (→ 500, like Django's "Field 'id' expected a number but got ...").
 */
export function pyInt(v: unknown, field = 'id'): bigint {
  if (typeof v === 'boolean') return v ? 1n : 0n;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`Field '${field}' expected a number but got ${pyStr(v)}.`);
    return BigInt(Math.trunc(v));
  }
  if (typeof v === 'bigint') return v;
  if (typeof v === 'string') {
    const n = pyIntStr(v);
    if (n !== null) return n;
  }
  throw new Error(`Field '${field}' expected a number but got ${pyRepr(v)}.`);
}

/** int(x) for a lookup value: null when it can't match any row (out of range); throws like Django for garbage. */
export function lookupId(v: unknown, field = 'id'): number | null {
  const n = pyInt(v, field);
  if (!inBigintRange(n)) return null;
  return Number(n);
}

/** Python int(str) for query params; null on ValueError/TypeError. */
export function pyIntOrNull(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const n = pyIntStr(v);
  return n === null ? null : Number(n);
}

// ---- str ---------------------------------------------------------------------------------



/** Django icontains: UPPER(col) LIKE UPPER('%escaped%'). */
export function icontains(column: string, value: string): RawBuilder<boolean> {
  const escaped = value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  return sql<boolean>`UPPER(${sql.ref(column)}::text) LIKE UPPER(${`%${escaped}%`})`;
}

// ---- float round() ---------------------------------------------------------------------

/** Exact decimal expansion of a finite double: value = coef / 10^scale. */
function exactDecimal(x: number): { coef: bigint; scale: number } {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const sign = hi >>> 31 ? -1n : 1n;
  const expBits = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let exp: number;
  if (expBits === 0) exp = -1074;
  else { mant |= 1n << 52n; exp = expBits - 1075; }
  if (exp >= 0) return { coef: sign * (mant << BigInt(exp)), scale: 0 };
  const k = -exp;
  return { coef: sign * mant * 5n ** BigInt(k), scale: k };
}

/** Python round(float, ndigits): correctly rounded, ties to even on the exact binary value. */
export function pyRound(x: number, ndigits: number): number {
  if (!Number.isFinite(x) || x === 0) return x;
  const { coef, scale } = exactDecimal(x);
  if (scale <= ndigits) return x;
  const div = 10n ** BigInt(scale - ndigits);
  const neg = coef < 0n;
  const abs = neg ? -coef : coef;
  let q = abs / div;
  const r = abs % div;
  if (r * 2n > div || (r * 2n === div && q % 2n === 1n)) q += 1n;
  const out = Number(`${neg ? '-' : ''}${q}e-${ndigits}`);
  return out === 0 && neg ? -0 : out;
}

/** The DecimalField(decimal_places=2) value Django stores for a Python float (and DRF renders). */
export function floatToDec2(x: number): string {
  // create_decimal_from_float(prec=12) then numeric(12,2) — for already-rounded
  // amounts this is just the two-decimal representation.
  const r = x.toFixed(2);
  return r === '-0.00' ? '0.00' : r;
}

// ---- Decimal() -------------------------------------------------------------------------

export type PyDecimal = { kind: 'nan' } | { kind: 'inf'; neg: boolean } | { kind: 'num'; text: string; neg: boolean; zero: boolean };

/** decimal.Decimal(str) — null on InvalidOperation. `text` is a canonical literal Postgres accepts. */
export function pyDecimal(s: string): PyDecimal | null {
  const t = pyStrip(s).replace(/(?<=\d)_(?=\d)/g, '');
  if (/^[+-]?s?nan\d*$/i.test(t)) return { kind: 'nan' };
  const inf = /^([+-]?)(inf|infinity)$/i.exec(t);
  if (inf) return { kind: 'inf', neg: inf[1] === '-' };
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(t);
  if (!m || ((m[2] ?? '') === '' && (m[3] ?? '') === '')) return null;
  if (!/^[\x00-\x7f]*$/.test(t)) return null;
  const neg = m[1] === '-';
  const digits = (m[2] ?? '') + (m[3] ?? '');
  const zero = /^0*$/.test(digits);
  return { kind: 'num', text: `${neg ? '-' : ''}${m[2] || '0'}${m[3] !== undefined ? '.' + (m[3] || '0') : ''}${m[4] !== undefined ? 'e' + m[4] : ''}`, neg, zero };
}

// ---- dates ----------------------------------------------------------------------------

/** 'YYYY-MM-DD' from a Postgres date / timestamptz text or a Date. */
export function dateOnly(v: string | Date): string {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

function validYmd(y: number, m: number, d: number): boolean {
  if (y < 1 || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
export const ymd = (y: number, m: number, d: number) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;

/** ISO week date → calendar date (Python's _isoweek_to_gregorian). Throws on invalid week/day. */
function isoWeekToDate(year: number, week: number, day: number): string {
  if (week < 1 || week > 53 || day < 1 || day > 7) throw new RangeError('Invalid week');
  // Monday of week 1 = the Monday on/before Jan 4.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4wd = (jan4.getUTCDay() + 6) % 7;
  const week1Monday = Date.UTC(year, 0, 4 - jan4wd);
  if (week === 53) {
    // Only valid if the year has 53 ISO weeks (Jan 1 is Thursday, or leap year and Jan 1 is Wednesday).
    const jan1wd = (new Date(Date.UTC(year, 0, 1)).getUTCDay() + 6) % 7;
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    if (!(jan1wd === 3 || (jan1wd === 2 && leap))) throw new RangeError('Invalid week: 53');
  }
  return new Date(week1Monday + ((week - 1) * 7 + (day - 1)) * 86_400_000).toISOString().slice(0, 10);
}

/** date.fromisoformat(s) (Python 3.12). Returns 'YYYY-MM-DD'; throws Error (ValueError) on bad input, TypeError for non-str. */
export function fromIsoDate(s: unknown): string {
  if (typeof s !== 'string') throw new TypeError('fromisoformat: argument must be str');
  const r = parseIsoDatePart(s);
  if (!r || r.rest !== '') throw new Error(`Invalid isoformat string: '${s}'`);
  return r.date;
}

/** Parses the date portion at the start of s; returns the date and the remainder. */
function parseIsoDatePart(s: string): { date: string; rest: string } | null {
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m && !/^\d{4}-W/.test(s)) {
    const [y, mo, d] = [+m[1]!, +m[2]!, +m[3]!];
    if (!validYmd(y, mo, d)) return null;
    return { date: ymd(y, mo, d), rest: s.slice(10) };
  }
  m = /^(\d{4})-W(\d{2})(?:-(\d))?/.exec(s) ?? /^(\d{4})W(\d{2})(\d)?/.exec(s);
  if (m) {
    try {
      return { date: isoWeekToDate(+m[1]!, +m[2]!, m[3] ? +m[3] : 1), rest: s.slice(m[0].length) };
    } catch { return null; }
  }
  m = /^(\d{4})(\d{2})(\d{2})/.exec(s);
  if (m) {
    const [y, mo, d] = [+m[1]!, +m[2]!, +m[3]!];
    if (!validYmd(y, mo, d)) return null;
    return { date: ymd(y, mo, d), rest: s.slice(8) };
  }
  return null;
}

/** django.utils.dateparse.parse_date: fromisoformat, then the lenient regex (date(**kw) errors propagate as RangeError). */
export function parseDate(value: unknown): string | null {
  if (typeof value !== 'string') throw new TypeError('expected str');
  try { return fromIsoDate(value); } catch { /* fall through */ }
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})\n?$/.exec(value);
  if (!m) return null;
  if (!validYmd(+m[1]!, +m[2]!, +m[3]!)) throw new RangeError('day is out of range for month');
  return ymd(+m[1]!, +m[2]!, +m[3]!);
}

/** time.fromisoformat(s) for 'HH', 'HH:MM', 'HH:MM:SS[.ffffff]' → 'HH:MM:SS[.ffffff]'. */
export function fromIsoTime(s: string): string {
  const m = /^(\d{2})(?::?(\d{2})(?::?(\d{2})(?:[.,](\d+))?)?)?$/.exec(s);
  if (!m) throw new Error(`Invalid isoformat string: '${s}'`);
  const h = +m[1]!, mi = +(m[2] ?? 0), se = +(m[3] ?? 0);
  if (h > 23 || mi > 59 || se > 59) throw new Error(`Invalid isoformat string: '${s}'`);
  const frac = m[4] ? m[4].slice(0, 6).padEnd(6, '0') : '';
  return `${pad(h)}:${pad(mi)}:${pad(se)}${frac && !/^0+$/.test(frac) ? '.' + frac : ''}`;
}

/** Python date.weekday(): Monday=0 … Sunday=6. */
export function weekday(dateStr: string): number {
  return (new Date(dateStr + 'T00:00:00Z').getUTCDay() + 6) % 7;
}

export function addDays(dateStr: string, n: number): string {
  return new Date(Date.parse(dateStr + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
}

/** (end - start).days for two dates. */
export function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / 86_400_000);
}

/** timezone.now().date() (UTC) */
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---- aware datetimes (microsecond precision) -------------------------------------------------

/** An aware datetime: UTC epoch microseconds + the tz offset it was expressed in (minutes, seconds part ignored). */
export interface AwareDt { us: bigint; offsetSec: number }

const PG_TS = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(?:([+-])(\d{2})(?::?(\d{2}))?(?::?(\d{2}))?|Z)?$/;

/** Postgres timestamptz text (or Date) → AwareDt (UTC). */
export function pgToAware(v: string | Date): AwareDt {
  if (v instanceof Date) return { us: BigInt(v.getTime()) * 1000n, offsetSec: 0 };
  const m = PG_TS.exec(v.trim());
  if (!m) throw new Error(`Unrecognised timestamp: ${v}`);
  const base = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!);
  const frac = BigInt((m[7] ?? '').padEnd(6, '0') || '0');
  const off = m[8] ? (m[8] === '-' ? -1 : 1) * (+m[9]! * 3600 + +(m[10] ?? 0) * 60 + +(m[11] ?? 0)) : 0;
  return { us: BigInt(base) * 1000n + frac - BigInt(off) * 1_000_000n, offsetSec: 0 };
}

/** Postgres-compatible text for an AwareDt (UTC). */
export function awareToPg(d: AwareDt): string {
  const ms = Number(d.us / 1000n);
  const micros = ((d.us % 1_000_000n) + 1_000_000n) % 1_000_000n;
  const base = new Date(ms - (ms % 1000 + 1000) % 1000).toISOString().slice(0, 19).replace('T', ' ');
  return `${base}.${String(micros).padStart(6, '0')}+00`;
}

/** datetime.isoformat() in the datetime's own offset. */
export function awareIsoformat(d: AwareDt): string {
  const local = d.us + BigInt(d.offsetSec) * 1_000_000n;
  const ms = Number(local / 1000n);
  const micros = ((local % 1_000_000n) + 1_000_000n) % 1_000_000n;
  const base = new Date(ms - (ms % 1000 + 1000) % 1000).toISOString().slice(0, 19);
  const frac = micros === 0n ? '' : '.' + String(micros).padStart(6, '0');
  const sign = d.offsetSec < 0 ? '-' : '+';
  const a = Math.abs(d.offsetSec);
  const hh = pad(Math.floor(a / 3600)), mm = pad(Math.floor((a % 3600) / 60)), ss = a % 60;
  return `${base}${frac}${sign}${hh}:${mm}${ss ? ':' + pad(ss) : ''}`;
}

export function nowAware(): AwareDt {
  // performance.timeOrigin + now() gives sub-millisecond resolution.
  const us = BigInt(Math.round((performance.timeOrigin + performance.now()) * 1000));
  return { us, offsetSec: 0 };
}

export const DAY_US = 86_400_000_000n;

/** timedelta.days of (a - b): floor division by one day. */
export function deltaDays(aUs: bigint, bUs: bigint): number {
  const diff = aUs - bUs;
  let q = diff / DAY_US;
  if (diff % DAY_US !== 0n && diff < 0n) q -= 1n;
  return Number(q);
}

/** Python datetime(...) field validation for the dateparse regex path. */
function checkDatetimeFields(y: number, mo: number, d: number, h: number, mi: number, s: number): void {
  if (mo < 1 || mo > 12) throw new RangeError('month must be in 1..12');
  if (y < 1 || y > 9999) throw new RangeError(`year ${y} is out of range`);
  if (!validYmd(y, mo, d)) throw new RangeError('day is out of range for month');
  if (h > 23) throw new RangeError('hour must be in 0..23');
  if (mi > 59) throw new RangeError('minute must be in 0..59');
  if (s > 59) throw new RangeError('second must be in 0..59');
}

/**
 * django.utils.dateparse.parse_datetime(value): datetime.fromisoformat first,
 * then Django's regex. Returns null when nothing matches, the parsed value
 * (naive → offset null) otherwise; throws RangeError (→ 500) for a
 * well-formatted but invalid value and TypeError for non-strings.
 */
export function parseDatetime(value: unknown): { us: bigint; offsetSec: number | null } | null {
  if (typeof value !== 'string') throw new TypeError('fromisoformat: argument must be str');
  const iso = pyFromIsoDatetime(value);
  if (iso) return iso;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:[.,](\d{1,6})\d{0,6})?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?\n?$/.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!, +(m[6] ?? 0)];
  checkDatetimeFields(y, mo, d, h, mi, s);
  const micros = m[7] ? +m[7].padEnd(6, '0') : 0;
  let offset: number | null = null;
  const tz = m[8];
  if (tz === 'Z') offset = 0;
  else if (tz) {
    const offMins = tz.length > 3 ? +tz.slice(-2) : 0;
    offset = (60 * +tz.slice(1, 3) + offMins) * (tz[0] === '-' ? -1 : 1) * 60;
  }
  return { us: localToUs(y, mo, d, h, mi, s, micros, offset ?? 0), offsetSec: offset };
}

function localToUs(y: number, mo: number, d: number, h: number, mi: number, s: number, micros: number, offsetSec: number): bigint {
  const base = Date.UTC(y, mo - 1, d, h, mi, s);
  // Date.UTC maps years 0..99 to 1900+; fix up.
  const fixed = y < 100 ? new Date(base).setUTCFullYear(y) : base;
  return BigInt(fixed) * 1000n + BigInt(micros) - BigInt(offsetSec) * 1_000_000n;
}

/** datetime.fromisoformat (Python 3.12) — null on ValueError. */
function pyFromIsoDatetime(s: string): { us: bigint; offsetSec: number | null } | null {
  if (!/^[\x00-\x7f]*$/.test(s.slice(0, 10))) return null;
  const dp = parseIsoDatePart(s);
  if (!dp) return null;
  const [y, mo, d] = dp.date.split('-').map(Number) as [number, number, number];
  if (dp.rest === '') return { us: localToUs(y, mo, d, 0, 0, 0, 0, 0), offsetSec: null };
  // Any single separator character, then the time (+ optional tz).
  const rest = Array.from(dp.rest).slice(1).join('');
  const m = /^(\d{2})(?::?(\d{2})(?::?(\d{2})(?:[.,](\d+))?)?)?(Z|[+-]\d{2}(?::?\d{2}(?::?\d{2}(?:[.,]\d+)?)?)?)?$/.exec(rest);
  if (!m) return null;
  if (m[2] === undefined && rest.length > 2 && m[5] === undefined) return null;
  const h = +m[1]!, mi = +(m[2] ?? 0), se = +(m[3] ?? 0);
  if (h > 23 || mi > 59 || se > 59) return null;
  const micros = m[4] ? +m[4].slice(0, 6).padEnd(6, '0') : 0;
  let offset: number | null = null;
  const tz = m[5];
  if (tz === 'Z') offset = 0;
  else if (tz) {
    const t = /^([+-])(\d{2})(?::?(\d{2}))?(?::?(\d{2}))?/.exec(tz)!;
    const oh = +t[2]!, om = +(t[3] ?? 0), os = +(t[4] ?? 0);
    if (oh > 23 || om > 59 || os > 59) return null;
    offset = (t[1] === '-' ? -1 : 1) * (oh * 3600 + om * 60 + os);
  }
  return { us: localToUs(y, mo, d, h, mi, se, micros, offset ?? 0), offsetSec: offset };
}
