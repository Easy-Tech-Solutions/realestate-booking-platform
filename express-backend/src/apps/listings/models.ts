// listings.models behaviour: Listing/HotelRoom/Review row creation with the
// model defaults Django fills in Python, Listing.save() + the notifications
// pre_save/post_save signal pair, Django's ORM cascade on delete, and
// listings.deletion.delete_listing.

import { db } from '../../db/index.js';
import { nowPg } from '../../lib/datetime.js';
import { saveUpload } from '../../lib/upload.js';
import { listingPostSave } from '../../domain/notifications.js';
import { isUpload, type Upload } from './drf.js';
import type { Executor, HotelRoomRow, ListingRow } from './serializers.js';

/** Model field defaults (Listing) — Django creates no DB defaults. */
export const LISTING_DEFAULTS = {
  title: '', description: '', price: '0', bedrooms: 0, beds: 0, bathrooms: 0, max_guests: 1,
  property_type: 'apartment', privacy_type: 'entire_place', booking_mode: 'instant',
  address: '', city: '', state: '', country: '', latitude: null, longitude: null,
  check_in_time: '15:00', check_out_time: '11:00', self_checkin: false, square_footage: 0,
  amenities: [] as unknown, highlights: [] as unknown, weekend_premium_percent: 0, new_listing_promo: false,
  last_minute_discount_enabled: false, last_minute_discount_percent: 0, weekly_discount_enabled: false,
  weekly_discount_percent: 0, monthly_discount_enabled: false, monthly_discount_percent: 0,
  exterior_camera: false, noise_monitor: false, weapons_on_property: false, pricing_type: 'nightly',
  payment_schedule: null, lease_term_months: null, cancellation_policy: 'flexible', is_available: true,
  status: 'published', deleted_at: null, main_image: '', sourced_by_agent_id: null,
  agent_owner_name: '', agent_owner_phone: '', agent_owner_email: '', agent_owner_payout_number: '',
  agent_owner_payout_network: '', claimed_by_user_id: null, suspended_by_id: null, suspended_at: null,
  suspension_reason: '', local_registration_number: '', occupancy_cap: null,
};

const JSON_COLS = new Set(['amenities', 'highlights']);

/** Convert validated values into column values (JSON → text, files → stored name, None file → ''). */
async function toColumns(values: Record<string, unknown>, uploadTo: Record<string, string> = {}): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (JSON_COLS.has(k) || k === 'amenities') out[k] = JSON.stringify(v);
    else if (isUpload(v)) out[k] = await saveUpload(uploadTo[k] ?? '', (v as Upload).name, (v as Upload).data);
    else if (v === null && uploadTo[k] !== undefined) out[k] = '';
    else out[k] = v;
  }
  return out;
}

const LISTING_UPLOADS = { main_image: 'listings/main/' };

/** serializer.save(**extra) for a new Listing (+ post_save(created=True)). */
export async function createListing(values: Record<string, unknown>, extra: Record<string, unknown>, ex: Executor = db): Promise<ListingRow> {
  const now = nowPg();
  const cols = await toColumns({ ...values, ...extra }, LISTING_UPLOADS);
  const row = await ex.insertInto('listings_listing').values({
    ...LISTING_DEFAULTS, amenities: JSON.stringify(LISTING_DEFAULTS.amenities), highlights: JSON.stringify(LISTING_DEFAULTS.highlights),
    ...cols, created_at: now, updated_at: now,
  } as never).returningAll().executeTakeFirstOrThrow();
  await listingPostSave(row as never, { created: true }, ex);
  return row;
}

/**
 * Listing.save() (all fields, or update_fields): the notifications pre_save
 * reads the stored price/is_available, post_save compares. updated_at is
 * auto_now — refreshed on a full save, or when listed in update_fields.
 */
export async function saveListing(id: number, changes: Record<string, unknown>, opts: { updateFields?: string[] } = {}, ex: Executor = db): Promise<ListingRow> {
  const old = await ex.selectFrom('listings_listing').select(['price', 'is_available']).where('id', '=', id).executeTakeFirst();
  const cols = await toColumns(changes, LISTING_UPLOADS);
  const touchUpdated = !opts.updateFields || opts.updateFields.includes('updated_at');
  if (touchUpdated) cols.updated_at = nowPg();
  const row = Object.keys(cols).length
    ? await ex.updateTable('listings_listing').set(cols as never).where('id', '=', id).returningAll().executeTakeFirstOrThrow()
    : await ex.selectFrom('listings_listing').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  await listingPostSave(row as never, { created: false, oldPrice: old?.price ?? null, oldIsAvailable: old?.is_available ?? null }, ex);
  return row;
}

/** HotelRoom defaults + create. `amenities` arrives already validated (any JSON value). */
export async function createHotelRoom(values: Record<string, unknown>, listingId: number, ex: Executor = db): Promise<HotelRoomRow> {
  const v = { ...values };
  delete v.listing;
  return ex.insertInto('listings_hotelroom').values({
    room_type: 'standard', description: '', max_occupancy: 2, beds: 1, bed_type: 'queen', bathrooms: 1,
    total_count: 1, is_active: true, ...v,
    amenities: JSON.stringify(v.amenities === undefined ? [] : v.amenities),
    listing_id: listingId, created_at: nowPg(),
  } as never).returningAll().executeTakeFirstOrThrow();
}

// ---- Django ORM cascades (FK constraints are not ON DELETE CASCADE in the DB) -------------------

const ids = <T>(rows: { id: T }[]) => rows.map((r) => r.id);

async function deletePayments(paymentIds: string[], ex: Executor) {
  if (!paymentIds.length) return;
  await ex.deleteFrom('payments_refund').where('payment_id', 'in', paymentIds).execute();
  await ex.deleteFrom('payments_payment').where('id', 'in', paymentIds).execute();
}

async function deleteBookings(bookingIds: number[], ex: Executor) {
  if (!bookingIds.length) return;
  await ex.updateTable('bookings_viewingappointment').set({ booking_id: null }).where('booking_id', 'in', bookingIds).execute();
  await deletePayments(ids(await ex.selectFrom('payments_payment').select('id').where('booking_id', 'in', bookingIds).execute()), ex);
  for (const t of ['bookings_paymentrequest', 'payments_payout', 'payments_escrowhold', 'payments_striperefund', 'support_aircoverclaim',
    'leaseagreements_leaseagreement', 'leaseagreements_leaseacceptance', 'agents_agentcommission'] as const) {
    await ex.deleteFrom(t as 'payments_payout').where('booking_id', 'in', bookingIds).execute();
  }
  await ex.deleteFrom('bookings_booking').where('id', 'in', bookingIds).execute();
}

/** Review.delete() */
export async function deleteReviews(reviewIds: number[], ex: Executor = db) {
  if (!reviewIds.length) return;
  await ex.updateTable('reports_report').set({ reported_review_id: null }).where('reported_review_id', 'in', reviewIds).execute();
  await ex.deleteFrom('listings_reviewimage').where('review_id', 'in', reviewIds).execute();
  await ex.deleteFrom('listings_review').where('id', 'in', reviewIds).execute();
}

/** HotelRoom.delete() */
export async function deleteHotelRooms(roomIds: number[], ex: Executor = db) {
  if (!roomIds.length) return;
  await ex.updateTable('bookings_booking').set({ hotel_room_id: null }).where('hotel_room_id', 'in', roomIds).execute();
  await ex.deleteFrom('listings_hotelroomimage').where('room_id', 'in', roomIds).execute();
  await ex.deleteFrom('listings_hotelroom').where('id', 'in', roomIds).execute();
}

/** Listing.delete() with every on_delete rule Django applies. */
export async function deleteListingRow(listingId: number) {
  await db.transaction().execute(async (t) => {
    const bookingIds = ids(await t.selectFrom('bookings_booking').select('id').where('listing_id', '=', listingId).execute());
    const viewingIds = ids(await t.selectFrom('bookings_viewingappointment').select('id').where('listing_id', '=', listingId).execute());
    await deleteBookings(bookingIds, t);
    if (viewingIds.length) {
      await deletePayments(ids(await t.selectFrom('payments_payment').select('id').where('viewing_id', 'in', viewingIds).execute()), t);
      await t.deleteFrom('bookings_viewingappointment').where('id', 'in', viewingIds).execute();
    }
    await deleteHotelRooms(ids(await t.selectFrom('listings_hotelroom').select('id').where('listing_id', '=', listingId).execute()), t);
    await deleteReviews(ids(await t.selectFrom('listings_review').select('id').where('listing_id', '=', listingId).execute()), t);
    for (const tb of ['listings_listingimage', 'listings_favorite', 'listings_propertyview', 'listings_propertystats', 'bookings_searchalert',
      'bookings_comparisonitem', 'propertyverifications_propertyverification', 'inventory_listingflag'] as const) {
      await t.deleteFrom(tb as 'listings_favorite').where('listing_id', '=', listingId).execute();
    }
    await t.updateTable('messaging_conversation').set({ listing_id: null }).where('listing_id', '=', listingId).execute();
    await t.updateTable('reports_report').set({ reported_listing_id: null }).where('reported_listing_id', '=', listingId).execute();
    await t.updateTable('agents_agentcommission').set({ listing_id: null }).where('listing_id', '=', listingId).execute();
    await t.deleteFrom('listings_listing').where('id', '=', listingId).execute();
  });
}

const RECORD_BOOKING_STATUSES = ['payment_received', 'confirmed', 'completed'];

/** listings.deletion.delete_listing → [ok, error]. */
export async function deleteListing(listing: ListingRow): Promise<[boolean, string | null]> {
  const hasBookingRecords = await db.selectFrom('bookings_booking').select('id').where('listing_id', '=', listing.id)
    .where('status', 'in', RECORD_BOOKING_STATUSES).executeTakeFirst();
  const hasPaymentRecords = await db.selectFrom('payments_payment as p')
    .leftJoin('bookings_booking as b', 'b.id', 'p.booking_id')
    .leftJoin('bookings_viewingappointment as v', 'v.id', 'p.viewing_id')
    .select('p.id')
    .where((eb) => eb.or([eb('b.listing_id', '=', listing.id), eb('v.listing_id', '=', listing.id)]))
    .where('p.status', '=', 'completed').executeTakeFirst();
  if (hasBookingRecords || hasPaymentRecords) {
    await saveListing(listing.id, { deleted_at: nowPg(), is_available: false }, { updateFields: ['deleted_at', 'is_available'] });
    return [true, null];
  }
  await deleteListingRow(listing.id);
  return [true, null];
}
