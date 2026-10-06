// bookings.serializers (read side) — BookingSerializer, ViewingAppointmentSerializer,
// SavedSearchSerializer, SearchAlertSerializer, PropertyComparisonSerializer.

import type { Request } from 'express';
import type { Selectable } from 'kysely';
import { db } from '../../db/index.js';
import type { BookingsPropertycomparison, BookingsSavedsearch } from '../../db/schema.js';
import { drf } from '../../lib/datetime.js';
import { buildAbsoluteUri, fileUrl } from '../../lib/drf.js';
import { mediaUrl } from '../../domain/users.js';
import { viewingTimeRange } from '../../domain/notifications.js';
import { serializeListing } from '../../domain/listings.js';
import { deltaDays, nowAware, pgToAware, pyRound } from './py.js';
import type { BookingRow, Executor, ViewingRow } from './services.js';

const date = (v: string | null) => (v === null ? null : String(v).slice(0, 10));

/** BookingSerializer */
export async function serializeBooking(b: BookingRow, ex: Executor = db) {
  const customer = await ex.selectFrom('users_user').select(['username', 'first_name', 'last_name']).where('id', '=', b.customer_id).executeTakeFirstOrThrow();
  const listing = await ex.selectFrom('listings_listing as l').innerJoin('users_user as o', 'o.id', 'l.owner_id')
    .select(['l.title', 'o.username']).where('l.id', '=', b.listing_id).executeTakeFirstOrThrow();
  let deadline: string | null = null;
  if (b.status === 'pending_host') deadline = b.host_confirm_deadline;
  else if (b.status === 'awaiting_payment') deadline = b.payment_due_at;
  const days = deadline ? Math.max(0, deltaDays(pgToAware(deadline).us, nowAware().us)) : 0;
  return {
    id: b.id, customer: b.customer_id, customer_username: customer.username, customer_first_name: customer.first_name,
    customer_last_name: customer.last_name, listing: b.listing_id, listing_title: listing.title, listing_owner: listing.username,
    hotel_room: b.hotel_room_id, start_date: date(b.start_date), end_date: date(b.end_date), status: b.status, notes: b.notes,
    requested_at: drf(b.requested_at), confirmed_at: drf(b.confirmed_at), declined_at: drf(b.declined_at), cancelled_at: drf(b.cancelled_at),
    owner_notes: b.owner_notes, decline_reason: b.decline_reason, total_price: b.total_price, service_fee: b.service_fee,
    stripe_payment_intent_id: b.stripe_payment_intent_id, days_until_expiry: days, requires_viewing: b.requires_viewing,
    host_confirm_deadline: drf(b.host_confirm_deadline), host_confirmed_at: drf(b.host_confirmed_at), payment_due_at: drf(b.payment_due_at),
    extended_until: drf(b.extended_until), extended_at: drf(b.extended_at), extension_reason: b.extension_reason,
  };
}

export async function serializeBookings(rows: BookingRow[], ex: Executor = db) {
  const out = [];
  for (const r of rows) out.push(await serializeBooking(r, ex));
  return out;
}

export const VIEWING_STATUS_LABELS: Record<string, string> = {
  requested: 'Requested', fee_paid: 'Fee Paid', scheduled: 'Scheduled', completed: 'Completed',
  reserved: 'Reserved', cancelled: 'Cancelled', expired: 'Expired',
};

/** DRF TimeField.to_representation: time.isoformat() */
function timeIso(t: string | null): string | null {
  if (t === null) return null;
  const m = /^(\d{2}:\d{2}:\d{2})(?:\.(\d+))?/.exec(t)!;
  const frac = (m[2] ?? '').padEnd(6, '0');
  return m[1]! + (frac && !/^0+$/.test(frac) ? '.' + frac : '');
}

/** ViewingAppointmentSerializer */
export async function serializeViewing(v: ViewingRow, ex: Executor = db) {
  const listing = await ex.selectFrom('listings_listing').select('title').where('id', '=', v.listing_id).executeTakeFirstOrThrow();
  const guest = await ex.selectFrom('users_user').select('username').where('id', '=', v.guest_id).executeTakeFirstOrThrow();
  return {
    id: v.id, listing: v.listing_id, listing_title: listing.title, guest: v.guest_id, guest_username: guest.username,
    viewing_date: date(v.viewing_date), viewing_time: timeIso(v.viewing_time), viewing_time_range: viewingTimeRange(v.viewing_time),
    status: v.status, status_display: VIEWING_STATUS_LABELS[v.status] ?? v.status, viewing_fee: v.viewing_fee,
    is_fee_paid: v.is_fee_paid, fee_paid_at: drf(v.fee_paid_at), scheduled_at: drf(v.scheduled_at), admin_notes: v.admin_notes,
    guest_notes: v.guest_notes, booking: v.booking_id, created_at: drf(v.created_at),
  };
}

const EMAIL_FREQUENCY_LABELS: Record<string, string> = { instantly: 'Instantly', daily: 'Daily', weekly: 'Weekly' };

/** SavedSearchSerializer */
export async function serializeSavedSearch(s: Selectable<BookingsSavedsearch>, ex: Executor = db) {
  const user = await ex.selectFrom('users_user').select('username').where('id', '=', s.user_id).executeTakeFirstOrThrow();
  const n = await ex.selectFrom('bookings_searchalert').select((eb) => eb.fn.countAll<number>().as('n')).where('saved_search_id', '=', s.id).executeTakeFirstOrThrow();
  return {
    id: s.id, name: s.name, user: s.user_id, user_username: user.username, min_price: s.min_price, max_price: s.max_price,
    property_type: s.property_type, min_bedrooms: s.min_bedrooms, max_bedrooms: s.max_bedrooms, min_square_footage: s.min_square_footage,
    max_square_footage: s.max_square_footage, address: s.address, keywords: s.keywords, is_available: s.is_available,
    email_frequency: s.email_frequency, email_frequency_display: EMAIL_FREQUENCY_LABELS[s.email_frequency] ?? s.email_frequency,
    is_active: s.is_active, created_at: drf(s.created_at), updated_at: drf(s.updated_at), listing_count: Number(n.n),
  };
}

/** SearchAlertSerializer */
export async function serializeSearchAlert(a: { id: number; saved_search_id: number; listing_id: number; sent_at: string }, req: Request, ex: Executor = db) {
  const l = await ex.selectFrom('listings_listing').select(['title', 'price', 'address', 'main_image']).where('id', '=', a.listing_id).executeTakeFirstOrThrow();
  const s = await ex.selectFrom('bookings_savedsearch').select('name').where('id', '=', a.saved_search_id).executeTakeFirstOrThrow();
  return {
    id: a.id, saved_search: a.saved_search_id, listing: a.listing_id, listing_title: l.title,
    listing_price: l.price, // CharField(source='listing.price') → str(Decimal)
    listing_address: l.address, listing_image: l.main_image ? fileUrl(req, l.main_image) : null,
    saved_search_name: s.name, sent_at: drf(a.sent_at),
  };
}

// ---- comparisons ---------------------------------------------------------------------------------

type ListingNums = { price: string; bedrooms: number; square_footage: number };

/** ComparisonItemSerializer.get_score */
function itemScore(l: ListingNums): number {
  let score = 0;
  if (Number(l.price) !== 0) {
    const priceScore = Math.max(0, 100 - (Number(l.price) / 1500) * 100);
    score += priceScore * 0.3;
  }
  if (l.bedrooms) score += Math.min(100, l.bedrooms * 20) * 0.3;
  if (l.square_footage) score += Math.min(100, l.square_footage / 10) * 0.4;
  return pyRound(score, 1);
}

function advantages(l: ListingNums): string[] {
  const out: string[] = [];
  if (l.bedrooms >= 3) out.push(`${l.bedrooms} bedrooms - great for families`);
  if (l.square_footage >= 1000) out.push(`Spacious ${l.square_footage} sq ft`);
  if (Number(l.price) <= 1500) out.push('Affordable pricing');
  return out;
}

function disadvantages(l: ListingNums): string[] {
  const out: string[] = [];
  if (l.bedrooms <= 1) out.push('Only 1 bedroom');
  if (l.square_footage <= 500) out.push(`Small ${l.square_footage} sq ft`);
  if (Number(l.price) >= 2500) out.push('Higher price point');
  return out;
}

/** Python 3.12 sum() over floats (Neumaier compensated summation). */
function pySumFloats(xs: number[]): number {
  let r = 0.0, c = 0.0;
  for (const x of xs) {
    const t = r + x;
    if (Math.abs(r) >= Math.abs(x)) c += (r - t) + x; else c += (x - t) + r;
    r = t;
  }
  if (c && Number.isFinite(c)) r += c;
  return r;
}

/** PropertyComparisonSerializer (context={'request': req}) */
export async function serializeComparison(c: Selectable<BookingsPropertycomparison>, req: Request, ex: Executor = db) {
  const user = await ex.selectFrom('users_user').select('username').where('id', '=', c.user_id).executeTakeFirstOrThrow();
  const items = await ex.selectFrom('bookings_comparisonitem').selectAll().where('comparison_id', '=', c.id).orderBy('order').execute();
  const outItems = [];
  const listings: ListingNums[] = [];
  for (const it of items) {
    const l = await ex.selectFrom('listings_listing').selectAll().where('id', '=', it.listing_id).executeTakeFirstOrThrow();
    listings.push(l);
    outItems.push({
      id: it.id, listing: await serializeListing(l, req, ex), listing_title: l.title, order: it.order, notes: it.notes,
      score: itemScore(l), advantages: advantages(l), disadvantages: disadvantages(l),
    });
  }
  const n = listings.length;
  let avgPrice: number = 0, avgBeds: number = 0, avgSqft: number = 0;
  if (n) {
    avgPrice = pyRound(pySumFloats(listings.map((l) => Number(l.price))) / n, 2);
    avgBeds = pyRound(listings.reduce((a, l) => a + l.bedrooms, 0) / n, 1);
    avgSqft = pyRound(listings.reduce((a, l) => a + l.square_footage, 0) / n, 0);
  }
  return {
    id: c.id, name: c.name, user: c.user_id, user_username: user.username, items: outItems, total_properties: n,
    share_url: c.is_public && c.share_token ? `${buildAbsoluteUri(req, '/')}comparisons/${c.share_token}/` : null,
    average_price: avgPrice, average_bedrooms: avgBeds, average_square_footage: avgSqft,
    is_public: c.is_public, share_token: c.share_token, created_at: drf(c.created_at), updated_at: drf(c.updated_at),
  };
}

export { mediaUrl };
