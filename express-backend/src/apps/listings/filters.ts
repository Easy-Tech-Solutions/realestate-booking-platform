// listings.filters.ListingFilter (django-filter) + the listings_collection GET query,
// built as the same SQL Django emits (_optimize_listings annotations, joins and
// GROUP BY) so Postgres returns unordered pages in the same order.

import type { Request } from 'express';
import { sql, type RawBuilder } from 'kysely';
import { db } from '../../db/index.js';
import { dateLookupValue, pyDecimal } from './drf.js';
import type { ListingRow } from './serializers.js';

const last = (v: unknown): string | undefined => {
  const x = Array.isArray(v) ? v[v.length - 1] : v;
  return typeof x === 'string' ? x : undefined;
};

/** Django prep_for_like_query + %…% */
export function likeContains(v: string): string {
  return `%${v.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
}
export const icontains = (col: RawBuilder<unknown>, v: string) => sql`UPPER(${col}::text) LIKE UPPER(${likeContains(v)})`;

/** forms.CharField(strip=True) → value or null (empty). */
function charValue(v: string | undefined): string | null {
  if (v === undefined) return null;
  const s = v.trim();
  return s === '' ? null : s;
}

/** forms.DecimalField → digits/exp or null (empty/invalid → filter dropped). */
function numberValue(v: string | undefined): { neg: boolean; digits: string; exp: number } | null {
  if (v === undefined || v === '') return null;
  const d = pyDecimal(v.trim());
  if (d === null || d === 'nan' || d === 'inf') return null;
  return d;
}

/** int(Decimal) — truncation toward zero. */
function decToBigInt(d: { neg: boolean; digits: string; exp: number }): bigint {
  let n: bigint;
  if (d.exp >= 0) n = BigInt(d.digits) * 10n ** BigInt(d.exp);
  else n = d.digits.length > -d.exp ? BigInt(d.digits.slice(0, d.digits.length + d.exp)) : 0n;
  return d.neg ? -n : n;
}
const decStr = (d: { neg: boolean; digits: string; exp: number }) => `${d.neg ? '-' : ''}${d.digits}e${d.exp}`;

type Cond = RawBuilder<unknown> | 'empty' | null;
const INT32 = [-2147483648n, 2147483647n] as const;
const INT64 = [-9223372036854775808n, 9223372036854775807n] as const;

/** IntegerField lookup with IntegerFieldOverflow semantics. */
function intLookup(col: RawBuilder<unknown>, op: '>=' | '<=' | '=', d: { neg: boolean; digits: string; exp: number }, range: readonly [bigint, bigint]): Cond {
  const n = decToBigInt(d);
  if (n > range[1]) return op === '<=' ? null : 'empty';
  if (n < range[0]) return op === '>=' ? null : 'empty';
  return sql`${col} ${sql.raw(op)} ${n.toString()}`;
}

const L = (c: string) => sql.ref(`listings_listing.${c}`);
// django_filters.rest_framework BooleanWidget
const NULL_BOOL: Record<string, boolean> = { '1': true, '0': false, true: true, false: false };
const DATE_FORMATS = [/^(\d{4})-(\d{1,2})-(\d{1,2})$/, /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/];

/** forms.DateField with the 'en' DATE_INPUT_FORMATS (numeric ones). */
function dateValue(v: string | undefined): string | null {
  if (v === undefined) return null;
  const s = v.trim();
  if (!s) return null;
  for (const [i, re] of DATE_FORMATS.entries()) {
    const m = re.exec(s);
    if (!m) continue;
    let y: number; let mo: number; let d: number;
    if (i === 0) { y = +m[1]!; mo = +m[2]!; d = +m[3]!; } else { mo = +m[1]!; d = +m[2]!; y = +m[3]!; if (i === 2) y += y < 69 ? 2000 : 1900; }
    if (mo < 1 || mo > 12 || d < 1 || d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) continue;
    return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return null;
}

const ORDER_FIELDS = ['price', 'created_at', 'bedrooms', 'square_footage', 'title'];

/** ListingFilter(request.GET).qs → WHERE conditions + ORDER BY. Invalid values are dropped like django-filter. */
export function listingFilter(q: Request['query']): { where: Cond[]; orderBy: RawBuilder<unknown> | null } {
  const where: Cond[] = [];
  const get = (k: string) => last(q[k]);
  // Meta.fields
  let v = charValue(get('title__icontains')); if (v !== null) where.push(icontains(L('title'), v));
  v = charValue(get('description__icontains')); if (v !== null) where.push(icontains(L('description'), v));
  v = charValue(get('property_type')); if (v !== null) where.push(sql`${L('property_type')} = ${v}`);
  v = charValue(get('property_type__icontains')); if (v !== null) where.push(icontains(L('property_type'), v));
  v = charValue(get('address__icontains')); if (v !== null) where.push(icontains(L('address'), v));
  // declared filters
  const inRaw = get('property_type_in');
  if (inRaw !== undefined && inRaw !== '') where.push(sql`${L('property_type')} IN (${sql.join(inRaw.split(','))})`);
  for (const [param, col, op] of [['min_price', 'price', '>='], ['max_price', 'price', '<=']] as const) {
    const d = numberValue(get(param)); if (d) where.push(sql`${L(col)} ${sql.raw(op)} ${decStr(d)}::numeric`);
  }
  for (const [param, col, op] of [['min_bedrooms', 'bedrooms', '>='], ['max_bedrooms', 'bedrooms', '<='],
    ['min_square_footage', 'square_footage', '>='], ['max_square_footage', 'square_footage', '<='], ['min_guests', 'max_guests', '>=']] as const) {
    const d = numberValue(get(param)); if (d) where.push(intLookup(L(col), op, d, INT32));
  }
  const owner = numberValue(get('owner_id')); if (owner) where.push(intLookup(L('owner_id'), '=', owner, INT64));
  const pte = charValue(get('property_type_exact')); if (pte !== null) where.push(sql`${L('property_type')} = ${pte}`);
  const avail = get('is_available');
  if (avail !== undefined && avail.toLowerCase() in NULL_BOOL) where.push(NULL_BOOL[avail.toLowerCase()] ? sql`${L('is_available')}` : sql`NOT ${L('is_available')}`);
  const ca = dateValue(get('created_after')); if (ca) where.push(sql`${L('created_at')} >= ${ca + ' 00:00:00+00'}::timestamptz`);
  const cb = dateValue(get('created_before')); if (cb) where.push(sql`${L('created_at')} <= ${cb + ' 00:00:00+00'}::timestamptz`);
  const loc = charValue(get('location'));
  if (loc !== null) {
    where.push(sql`(${icontains(L('address'), loc)} OR ${icontains(L('city'), loc)} OR ${icontains(L('state'), loc)} OR ${icontains(L('country'), loc)})`);
  }
  let orderBy: RawBuilder<unknown> | null = null;
  const ord = get('ordering');
  if (ord !== undefined && ord !== '') {
    const items = ord.split(',');
    const valid = items.every((it) => it === '' || ORDER_FIELDS.includes(it.replace(/^-/, '')));
    if (valid) {
      const kept = items.filter((it) => it !== '');
      if (kept.length) orderBy = sql.join(kept.map((it) => (it.startsWith('-') ? sql`${L(it.slice(1))} DESC` : sql`${L(it)} ASC`)));
    }
  }
  return { where, orderBy };
}

const USER_COLS = ['id', 'password', 'last_login', 'is_superuser', 'username', 'first_name', 'last_name', 'email', 'is_staff', 'is_active',
  'date_joined', 'date_of_birth', 'email_verified', 'email_verification_token', 'email_verification_token_expires_at', 'password_reset_token',
  'password_reset_token_expires_at', 'role', 'is_archived', 'archived_at', 'scheduled_deletion_at', 'deleted_at'];
const PROFILE_COLS = ['id', 'user_id', 'image', 'bio', 'is_superhost', 'last_seen', 'phone_number'];

/**
 * _optimize_listings(Listing.objects.filter(...)) → (count, page fetcher). `base` are the
 * view's own WHERE conditions (before the filterset's), `order` an ORDER BY or null.
 */
export function optimizedListingsQuery(base: Cond[], order: RawBuilder<unknown> | null) {
  if (base.includes('empty')) return { count: async () => 0, fetch: async () => [] as ListingRow[] };
  const conds = base.filter((c): c is RawBuilder<unknown> => c !== null && c !== 'empty');
  const whereSql = conds.length ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``;
  const cols = sql.raw([
    '"listings_listing".*',
    'AVG("listings_review"."rating") AS "avg_rating"',
    'COUNT(DISTINCT "listings_review"."id") AS "review_count_agg"',
    ...USER_COLS.map((c) => `"users_user"."${c}" AS "u_${c}"`),
    ...PROFILE_COLS.map((c) => `"users_profile"."${c}" AS "p_${c}"`),
  ].join(', '));
  const from = sql`FROM "listings_listing" LEFT OUTER JOIN "listings_review" ON ("listings_listing"."id" = "listings_review"."listing_id")
    INNER JOIN "users_user" ON ("listings_listing"."owner_id" = "users_user"."id")
    LEFT OUTER JOIN "users_profile" ON ("users_user"."id" = "users_profile"."user_id")
    ${whereSql} GROUP BY "listings_listing"."id", "users_user"."id", "users_profile"."id"`;
  const orderSql = order ? sql`ORDER BY ${order}` : sql``;
  return {
    count: async () => {
      const r = await sql<{ __count: number }>`SELECT COUNT(*) AS "__count" FROM (SELECT "listings_listing"."id" AS "col1", AVG("listings_review"."rating") AS "avg_rating", COUNT(DISTINCT "listings_review"."id") AS "review_count_agg" ${from}) subquery`.execute(db);
      return Number(r.rows[0]!.__count);
    },
    fetch: async (limit?: number, offset?: number) => {
      const lim = limit !== undefined ? sql`LIMIT ${limit}` : sql``;
      const off = offset ? sql`OFFSET ${offset}` : sql``;
      const r = await sql<ListingRow>`SELECT ${cols} ${from} ${orderSql} ${lim} ${off}`.execute(db);
      return r.rows;
    },
  };
}

/** Booking-overlap exclusion for ?check_in=&check_out= (DateField lookups: invalid dates → 500 like Django). */
export function bookingOverlapExclusion(checkIn: string, checkOut: string): RawBuilder<unknown> {
  const ci = dateLookupValue(checkIn);
  const co = dateLookupValue(checkOut);
  return sql`NOT ("listings_listing"."id" IN (SELECT U0."listing_id" FROM "bookings_booking" U0 WHERE (U0."end_date" > ${ci}::date AND U0."start_date" < ${co}::date AND U0."status" = 'confirmed')))`;
}

export { db };
