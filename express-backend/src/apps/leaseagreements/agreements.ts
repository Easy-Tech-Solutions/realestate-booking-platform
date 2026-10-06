// leaseagreements.agreements — version, long-term detection, generation & acceptance.

import type { Selectable } from 'kysely';
import { db } from '../../db/index.js';
import type { LeaseagreementsLeaseacceptance, LeaseagreementsLeaseagreement } from '../../db/schema.js';
import { nowPg } from '../../lib/datetime.js';
import { logger } from '../../lib/logger.js';
import { quantizeText } from '../bookings/drf.js';
import { atomic, type Executor } from '../bookings/services.js';
import { saveUpload } from '../../lib/upload.js';
import { renderLeasePdf } from './pdf.js';

export const CURRENT_LEASE_VERSION = '1.0';
export const LEASE_TITLE = 'Agreement of Lease';

export type LeaseRow = Selectable<LeaseagreementsLeaseagreement>;
export type AcceptanceRow = Selectable<LeaseagreementsLeaseacceptance>;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** is_long_term(listing): monthly-priced listing */
export function isLongTerm(listing: { pricing_type: string }): boolean {
  return listing.pricing_type === 'monthly';
}

/** Python strftime on a Postgres UTC timestamp / date text. */
function parts(v: string): { y: string; m: number; d: string; H: string; M: string } {
  const s = String(v);
  return { y: s.slice(0, 4), m: Number(s.slice(5, 7)), d: s.slice(8, 10), H: s.slice(11, 13), M: s.slice(14, 16) };
}
const monthDayYear = (v: string) => { const p = parts(v); return `${MONTHS[p.m - 1]} ${p.d}, ${p.y}`; };

/** f'{Decimal:,.2f}' */
function money(v: string): string {
  const q = quantizeText(v, 2);
  const neg = q.startsWith('-');
  const [i, f] = q.replace('-', '').split('.') as [string, string];
  return `${neg ? '-' : ''}${i.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${f}`;
}

const fullName = (u: { first_name: string; last_name: string; username: string }) =>
  `${u.first_name} ${u.last_name}`.trim() || u.username;

export interface BookingForLease {
  id: number; listing_id: number; customer_id: number; requested_at: string | null; start_date: string | null; end_date: string | null;
}

/** build_context(booking, acceptance=None) */
export async function buildContext(booking: BookingForLease, acceptance: AcceptanceRow | null = null, ex: Executor = db): Promise<Record<string, unknown>> {
  const listing = await ex.selectFrom('listings_listing').selectAll().where('id', '=', booking.listing_id).executeTakeFirstOrThrow();
  const owner = await ex.selectFrom('users_user').selectAll().where('id', '=', listing.owner_id).executeTakeFirstOrThrow();
  const tenant = await ex.selectFrom('users_user').selectAll().where('id', '=', booking.customer_id).executeTakeFirstOrThrow();
  const when = parts(booking.requested_at ?? nowPg().replace('T', ' '));
  const propertyAddress = [listing.address, listing.city, listing.state, listing.country].filter((p) => p).join(', ') || (listing.address || '');
  const ctx: Record<string, unknown> = {
    version: CURRENT_LEASE_VERSION,
    day: when.d,
    month: MONTHS[when.m - 1],
    year: when.y,
    landlord_name: fullName(owner),
    property_address: propertyAddress,
    tenant_name: fullName(tenant),
    rent_display: `US$${money(listing.price || '0')} per month`,
    lease_start: booking.start_date ? monthDayYear(booking.start_date) : '',
    lease_end: booking.end_date ? monthDayYear(booking.end_date) : '',
    accepted_by: null,
    accepted_at: null,
  };
  if (acceptance !== null) {
    const p = parts(acceptance.accepted_at);
    ctx.accepted_by = ctx.tenant_name;
    ctx.accepted_at = `${MONTHS[p.m - 1]} ${p.d}, ${p.y} ${p.H}:${p.M} UTC`;
  }
  return ctx;
}

async function bookingRow(id: number, ex: Executor): Promise<BookingForLease> {
  return ex.selectFrom('bookings_booking').select(['id', 'listing_id', 'customer_id', 'requested_at', 'start_date', 'end_date'])
    .where('id', '=', id).executeTakeFirstOrThrow();
}

/** _render_and_store(lease, booking, acceptance=None): new PDF file + snapshot fields, full lease.save(). */
async function renderAndStore(lease: LeaseRow, booking: BookingForLease, acceptance: AcceptanceRow | null, ex: Executor): Promise<LeaseRow> {
  const ctx = await buildContext(booking, acceptance, ex);
  const pdf = await renderLeasePdf(ctx);
  const name = await saveUpload('lease_agreements/', `lease_booking_${booking.id}_v${ctx.version}.pdf`, pdf);
  const saved = await ex.updateTable('leaseagreements_leaseagreement').set({
    document: name,
    version: ctx.version as string,
    landlord_name: ctx.landlord_name as string,
    tenant_name: ctx.tenant_name as string,
    property_address: ctx.property_address as string,
    rent_display: ctx.rent_display as string,
    lease_start: booking.start_date ? String(booking.start_date).slice(0, 10) : null,
    lease_end: booking.end_date ? String(booking.end_date).slice(0, 10) : null,
    updated_at: nowPg(),
  }).where('id', '=', lease.id).returningAll().executeTakeFirstOrThrow();
  Object.assign(lease, saved);
  return lease;
}

/** LeaseAgreement.objects.get_or_create(booking=booking, defaults={'version': CURRENT_LEASE_VERSION}) */
async function getOrCreateLease(bookingId: number, ex: Executor): Promise<{ lease: LeaseRow; created: boolean }> {
  const existing = await ex.selectFrom('leaseagreements_leaseagreement').selectAll().where('booking_id', '=', bookingId).executeTakeFirst();
  if (existing) return { lease: existing, created: false };
  const now = nowPg();
  const lease = await ex.insertInto('leaseagreements_leaseagreement').values({
    booking_id: bookingId, version: CURRENT_LEASE_VERSION, document: '', landlord_name: '', tenant_name: '', property_address: '',
    rent_display: '', lease_start: null, lease_end: null, generated_at: now, updated_at: now,
  }).returningAll().executeTakeFirstOrThrow();
  return { lease, created: true };
}

/** generate_lease_for_booking(booking): idempotent, never raises (returns null on failure). */
export async function generateLeaseForBooking(booking: { id: number }, ex: Executor = db): Promise<LeaseRow | null> {
  try {
    const { lease, created } = await getOrCreateLease(booking.id, ex);
    if (created || !lease.document) await renderAndStore(lease, await bookingRow(booking.id, ex), null, ex);
    return lease;
  } catch (e) {
    logger.error({ err: e }, `Failed to generate lease for booking #${booking.id}`);
    return null;
  }
}

/** record_acceptance(booking, user, ip_address=None): get_or_create the acceptance, re-stamp the PDF. */
export async function recordAcceptance(booking: { id: number }, user: { id: number }, ipAddress: string | null = null, ex: Executor = db): Promise<AcceptanceRow> {
  let acceptance = await ex.selectFrom('leaseagreements_leaseacceptance').selectAll()
    .where('user_id', '=', user.id).where('booking_id', '=', booking.id).where('version', '=', CURRENT_LEASE_VERSION).executeTakeFirst();
  if (!acceptance) {
    acceptance = await ex.insertInto('leaseagreements_leaseacceptance').values({
      user_id: user.id, booking_id: booking.id, version: CURRENT_LEASE_VERSION, accepted_at: nowPg(), ip_address: ipAddress,
    }).returningAll().executeTakeFirstOrThrow();
  }
  const { lease } = await getOrCreateLease(booking.id, ex);
  try {
    await renderAndStore(lease, await bookingRow(booking.id, ex), acceptance, ex);
  } catch (e) {
    logger.error({ err: e }, `Failed to re-stamp lease for booking #${booking.id}`);
  }
  return acceptance;
}

export { atomic };
