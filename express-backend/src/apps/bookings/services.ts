// bookings.services — the reservation state machine (port of backend/bookings/services.py
// + Booking.mark_host_confirmed / extend_reservation from bookings/models.py).
//
// Every Booking save goes through saveBooking()/insertBooking(), which reproduce
// the booking_pre_save/booking_post_save signal pair (domain/notifications.bookingPostSave).
// Functions decorated @transaction.atomic in Django run in a transaction here
// unless the caller passes its own (then they join it, like nested atomic blocks).

import { randomUUID } from 'node:crypto';
import type { Insertable, Selectable, Transaction, Updateable } from 'kysely';
import { db, type DB } from '../../db/index.js';
import type { BookingsBooking, BookingsViewingappointment } from '../../db/schema.js';
import { nowPg } from '../../lib/datetime.js';
import { logger } from '../../lib/logger.js';
import { recordTaskHeartbeat } from '../../domain/platformops.js';
import {
  bookingPostSave, notifyHostPaymentReceived, notifyListingAvailable, notifyPaymentAwaitingAdmin, notifyPayoutPending,
  notifyReservationExpired, notifyReservationReadyToPay, notifyViewingFeePaid, notifyViewingRequested, type PaymentLike,
} from '../../domain/notifications.js';
import { Dec } from '../notifications/decimal.js';
import { getServiceFeeRateDec as getServiceFeeRate } from '../../domain/payments.js';
import { saveListing, type ListingRow } from '../../domain/listings.js';
import { awareToPg, DAY_US, daysBetween, nowAware, pgToAware } from './py.js';

export type Executor = typeof db | Transaction<DB>;
export type BookingRow = Selectable<BookingsBooking>;
export type ViewingRow = Selectable<BookingsViewingappointment>;

export const HOST_CONFIRM_DAYS = 7;
export const PAYMENT_WINDOW_DAYS = 10;
export const RESERVATION_HOLD_MAX_DAYS = 20;

export const STATUS_LABELS: Record<string, string> = {
  pending_host: 'Pending Host Confirmation', awaiting_payment: 'Awaiting Payment', payment_received: 'Payment Received',
  confirmed: 'Confirmed', declined: 'Declined', expired_unconfirmed: 'Expired (Host Did Not Confirm)',
  expired_unpaid: 'Expired (Payment Not Completed)', cancelled: 'Cancelled', completed: 'Completed',
  requested: 'Requested (legacy)', payment_requested: 'Payment Requested (legacy)', pending: 'Pending (legacy)',
};

export const ACTIVE_STATUSES = [
  'pending_host', 'awaiting_payment', 'payment_received', 'confirmed', 'requested', 'payment_requested', 'pending',
];

/** Run fn in a transaction — or in the caller's (nested atomic). */
export async function atomic<T>(ex: Executor, fn: (trx: Executor) => Promise<T>): Promise<T> {
  if (ex === db) return db.transaction().execute((trx) => fn(trx));
  return fn(ex);
}

/** now + n days, as Postgres text with microseconds. */
export function nowPlusDays(n: number): string {
  return awareToPg({ us: nowAware().us + BigInt(n) * DAY_US, offsetSec: 0 });
}

async function getListing(id: number, ex: Executor): Promise<ListingRow> {
  return ex.selectFrom('listings_listing').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
}

// ---- Booking save / create (+ signals) -----------------------------------------------------------

/** booking.save(update_fields=[...]): booking_pre_save reads the stored status, then booking_post_save. */
export async function saveBooking(booking: BookingRow, changes: Updateable<BookingsBooking>, ex: Executor = db): Promise<BookingRow> {
  const old = await ex.selectFrom('bookings_booking').select('status').where('id', '=', booking.id).executeTakeFirst();
  const saved = await ex.updateTable('bookings_booking').set(changes).where('id', '=', booking.id).returningAll().executeTakeFirstOrThrow();
  Object.assign(booking, saved);
  await bookingPostSave(saved, { created: false, oldStatus: old ? old.status : null }, ex);
  return saved;
}

/** Booking.objects.create(**fields) with model defaults, then booking_post_save(created=True). */
export async function insertBooking(
  fields: Partial<Insertable<BookingsBooking>> & { listing_id: number; customer_id: number; start_date: string; end_date: string },
  ex: Executor = db,
): Promise<BookingRow> {
  const defaults: Insertable<BookingsBooking> = {
    listing_id: fields.listing_id, customer_id: fields.customer_id, start_date: fields.start_date, end_date: fields.end_date,
    hotel_room_id: null, status: 'pending_host', notes: '', requested_at: nowPg(), confirmed_at: null, declined_at: null,
    cancelled_at: null, owner_notes: '', decline_reason: '', total_price: null, service_fee: null, stripe_payment_intent_id: null,
    requires_viewing: false, host_confirm_deadline: null, host_confirmed_at: null, payment_due_at: null,
    extended_until: null, extended_by_id: null, extended_at: null, extension_reason: '',
  };
  const row = await ex.insertInto('bookings_booking').values({ ...defaults, ...fields }).returningAll().executeTakeFirstOrThrow();
  await bookingPostSave(row, { created: true }, ex);
  return row;
}

// ---- listing pull / relist ---------------------------------------------------------------------

/** listing.is_available = value; listing.save(update_fields=['is_available']) (with the listing signals). */
async function saveListingAvailability(listing: ListingRow, value: boolean, ex: Executor): Promise<void> {
  await saveListing(listing.id, { is_available: value }, { updateFields: ['is_available'] }, ex);
  listing.is_available = value;
}

/** _pull_listing */
export async function pullListing(listing: ListingRow, ex: Executor = db): Promise<void> {
  if (listing.is_available) await saveListingAvailability(listing, false, ex);
}

/** _relist_listing: the listing_post_save signal AND the explicit call both notify (double notification, as in Django). */
export async function relistListing(listing: ListingRow, ex: Executor = db): Promise<void> {
  if (!listing.is_available) {
    await saveListingAvailability(listing, true, ex);
    try {
      await notifyListingAvailable(listing, ex);
    } catch (exc) {
      logger.warn({ err: exc }, `Could not send listing-available notifications: ${exc}`);
    }
  }
}

/** release_listing_if_unheld(listing, exclude_booking=None) */
export async function releaseListingIfUnheld(listing: ListingRow, excludeBookingId: number | null = null, ex: Executor = db): Promise<boolean> {
  let q = ex.selectFrom('bookings_booking').select('id').where('listing_id', '=', listing.id)
    .where('status', 'in', ['awaiting_payment', 'payment_received', 'confirmed']);
  if (excludeBookingId !== null) q = q.where('id', '!=', excludeBookingId);
  if (!(await q.executeTakeFirst())) {
    await relistListing(listing, ex);
    return true;
  }
  return false;
}

/** _decline_competing_reservations(winning_booking) */
async function declineCompetingReservations(winner: BookingRow, ex: Executor): Promise<void> {
  if (winner.hotel_room_id !== null) return;
  const competitors = await ex.selectFrom('bookings_booking').selectAll()
    .where('listing_id', '=', winner.listing_id).where('status', '=', 'pending_host')
    .where('start_date', '<', winner.end_date).where('end_date', '>', winner.start_date)
    .where('id', '!=', winner.id).orderBy('requested_at', 'desc').execute();
  for (const b of competitors) {
    await saveBooking(b, { status: 'declined', declined_at: nowPg(), decline_reason: 'The host confirmed another reservation for these dates.' }, ex);
  }
}

// ---- transitions -----------------------------------------------------------------------------------

/** Booking.mark_host_confirmed() */
export async function markHostConfirmed(booking: BookingRow, ex: Executor = db): Promise<BookingRow> {
  const now = nowAware();
  return saveBooking(booking, {
    status: 'awaiting_payment',
    host_confirmed_at: awareToPg(now),
    payment_due_at: awareToPg({ us: now.us + BigInt(PAYMENT_WINDOW_DAYS) * DAY_US, offsetSec: 0 }),
  }, ex);
}

/** host_confirm_reservation(booking) — @transaction.atomic. `listing` is the caller's (possibly stale) in-memory listing. */
export async function hostConfirmReservation(booking: BookingRow, listing: ListingRow | null = null, ex: Executor = db): Promise<BookingRow> {
  return atomic(ex, async (trx) => {
    const l = listing ?? (await getListing(booking.listing_id, trx));
    await markHostConfirmed(booking, trx);
    await declineCompetingReservations(booking, trx);
    if (booking.hotel_room_id === null) await pullListing(l, trx);
    try {
      await notifyReservationReadyToPay(booking, trx);
    } catch (exc) {
      logger.warn({ err: exc }, `Could not notify guest to pay for booking ${booking.id}: ${exc}`);
    }
    return booking;
  });
}

/** mark_viewing_fee_paid(viewing, payment=None) — idempotent. */
export async function markViewingFeePaid(viewing: ViewingRow | null, payment: PaymentLike | null = null, ex: Executor = db): Promise<ViewingRow | null> {
  if (viewing === null || viewing.is_fee_paid) return viewing;
  const saved = await ex.updateTable('bookings_viewingappointment')
    .set({ is_fee_paid: true, fee_paid_at: nowPg(), status: viewing.status === 'requested' ? 'fee_paid' : viewing.status })
    .where('id', '=', viewing.id).returningAll().executeTakeFirstOrThrow();
  Object.assign(viewing, saved);
  try {
    await notifyViewingRequested(viewing, ex);
    await notifyViewingFeePaid(viewing, payment, ex);
  } catch (exc) {
    logger.warn({ err: exc }, `Could not send notifications for paid viewing ${viewing.id}: ${exc}`);
  }
  return viewing;
}

/** mark_guest_paid(booking) — idempotent, non-downgrading. */
export async function markGuestPaid(booking: BookingRow, ex: Executor = db): Promise<BookingRow> {
  if (!['awaiting_payment', 'pending_host', 'requested', 'payment_requested'].includes(booking.status)) return booking;
  await saveBooking(booking, { status: 'payment_received' }, ex);
  try {
    await notifyPaymentAwaitingAdmin(booking, ex);
  } catch (exc) {
    logger.warn({ err: exc }, `Could not notify admins of payment for booking ${booking.id}: ${exc}`);
  }
  return booking;
}

/** admin_confirm_payment(booking, admin_user=None) — @transaction.atomic. */
export async function adminConfirmPayment(booking: BookingRow, _adminUser: { id: number } | null = null, ex: Executor = db): Promise<BookingRow> {
  return atomic(ex, async (trx) => {
    await saveBooking(booking, { status: 'confirmed', confirmed_at: nowPg() }, trx);
    const payout = await createPayoutForBooking(booking, trx);
    try {
      const { createAgentCommissionForBooking } = await import('../../domain/agents.js');
      await createAgentCommissionForBooking(booking, trx);
    } catch (exc) {
      logger.warn({ err: exc }, `Could not create agent commission for booking ${booking.id}: ${exc}`);
    }
    if (payout) {
      try {
        await notifyPayoutPending(payout, trx);
      } catch (exc) {
        logger.warn({ err: exc }, `Could not notify admins of payout for booking ${booking.id}: ${exc}`);
      }
    }
    try {
      await notifyHostPaymentReceived(booking, trx);
    } catch (exc) {
      logger.warn({ err: exc }, `Could not notify host of payment for booking ${booking.id}: ${exc}`);
    }
    return booking;
  });
}

/** process_booking_decline(booking, decline_reason='', owner_notes='') — @transaction.atomic. */
export async function processBookingDecline(booking: BookingRow, declineReason = '', ownerNotes = '', listing: ListingRow | null = null, ex: Executor = db): Promise<BookingRow> {
  return atomic(ex, async (trx) => {
    const changes: Updateable<BookingsBooking> = { status: 'declined', declined_at: nowPg() };
    // update_fields always writes decline_reason/owner_notes (unchanged values when blank)
    changes.decline_reason = declineReason ? declineReason : booking.decline_reason;
    changes.owner_notes = ownerNotes ? ownerNotes : booking.owner_notes;
    await saveBooking(booking, changes, trx);
    const l = listing ?? (await getListing(booking.listing_id, trx));
    await releaseListingIfUnheld(l, booking.id, trx);
    return booking;
  });
}

/** reserve_property_from_viewing(viewing, start, end, total_price, service_fee) — @transaction.atomic. */
export async function reservePropertyFromViewing(
  viewing: ViewingRow, startDate: string, endDate: string, totalPrice: string, serviceFee: string,
  listing: ListingRow | null = null, ex: Executor = db,
): Promise<BookingRow> {
  return atomic(ex, async (trx) => {
    const now = nowAware();
    const booking = await insertBooking({
      listing_id: viewing.listing_id, customer_id: viewing.guest_id, start_date: startDate, end_date: endDate,
      status: 'awaiting_payment', requires_viewing: true, total_price: totalPrice, service_fee: serviceFee,
      host_confirmed_at: awareToPg(now), payment_due_at: awareToPg({ us: now.us + BigInt(PAYMENT_WINDOW_DAYS) * DAY_US, offsetSec: 0 }),
    }, trx);
    // update_fields=['booking', 'status'] — updated_at (auto_now) is NOT touched
    const saved = await trx.updateTable('bookings_viewingappointment').set({ booking_id: booking.id, status: 'reserved' })
      .where('id', '=', viewing.id).returningAll().executeTakeFirstOrThrow();
    Object.assign(viewing, saved);
    await pullListing(listing ?? (await getListing(viewing.listing_id, trx)), trx);
    try {
      await notifyReservationReadyToPay(booking, trx);
    } catch (exc) {
      logger.warn({ err: exc }, `Could not notify guest to pay for viewing booking ${booking.id}: ${exc}`);
    }
    return booking;
  });
}

/** Booking.total_amount: listing.price × max(days, 1) */
export async function bookingTotalAmount(booking: BookingRow, ex: Executor = db): Promise<Dec> {
  const listing = await getListing(booking.listing_id, ex);
  const days = daysBetween(String(booking.start_date).slice(0, 10), String(booking.end_date).slice(0, 10));
  return Dec.from(listing.price).mul(String(Math.max(days, 1)));
}

/** create_payout_for_booking(booking) — idempotent. */
export async function createPayoutForBooking(booking: BookingRow, ex: Executor = db) {
  const existing = await ex.selectFrom('payments_payout').selectAll().where('booking_id', '=', booking.id).executeTakeFirst();
  if (existing) return existing;
  const gross = booking.total_price !== null
    ? Dec.from(booking.total_price).sub(Dec.from(booking.service_fee === null || Dec.from(booking.service_fee).isZero() ? '0' : booking.service_fee)).quantize(2)
    : (await bookingTotalAmount(booking, ex)).quantize(2);
  const fee = gross.mul(await getServiceFeeRate(ex)).quantize(2);
  const net = gross.sub(fee).quantize(2);
  const listing = await getListing(booking.listing_id, ex);
  const now = nowPg();
  let payout = await ex.insertInto('payments_payout').values({
    id: randomUUID(), booking_id: booking.id, host_id: listing.owner_id,
    gross_amount: gross.toString(), service_fee_amount: fee.toString(), net_amount: net.toString(), currency: 'USD',
    recipient_name: '', recipient_momo_number: '', recipient_network: '', status: 'pending', reference: '',
    paid_at: null, paid_by_id: null, cancelled_at: null, cancelled_by_id: null, cancellation_reason: '', notes: '',
    created_at: now, updated_at: now,
  }).returningAll().executeTakeFirstOrThrow();
  if (listing.sourced_by_agent_id) {
    payout = await ex.updateTable('payments_payout').set({
      recipient_name: listing.agent_owner_name, recipient_momo_number: listing.agent_owner_payout_number,
      recipient_network: listing.agent_owner_payout_network,
    }).where('id', '=', payout.id).returningAll().executeTakeFirstOrThrow();
  }
  return payout;
}

/** Booking.extend_reservation(requested_deadline, extended_by, reason) → applied deadline (µs UTC); throws ExtendError. */
export class ExtendError extends Error {}
export async function extendReservation(booking: BookingRow, requestedUs: bigint, extendedBy: { id: number }, reason: string, ex: Executor = db): Promise<bigint> {
  if (booking.status !== 'pending_host' && booking.status !== 'awaiting_payment') {
    throw new ExtendError('Only a pending_host or awaiting_payment reservation can be extended.');
  }
  const ceiling = pgToAware(booking.requested_at).us + BigInt(RESERVATION_HOLD_MAX_DAYS) * DAY_US;
  const applied = requestedUs <= ceiling ? requestedUs : ceiling;
  const deadline = awareToPg({ us: applied, offsetSec: 0 });
  const changes: Updateable<BookingsBooking> = {
    extended_until: deadline, extended_by_id: extendedBy.id, extended_at: nowPg(), extension_reason: reason,
  };
  if (booking.status === 'pending_host') changes.host_confirm_deadline = deadline;
  else changes.payment_due_at = deadline;
  await saveBooking(booking, changes, ex);
  return applied;
}

// ---- expiry (Celery beat) ------------------------------------------------------------------------

/** expire_unconfirmed_reservations() → count */
export async function expireUnconfirmedReservations(ex: Executor = db): Promise<number> {
  const stale = await ex.selectFrom('bookings_booking').selectAll()
    .where('status', '=', 'pending_host').where('host_confirm_deadline', 'is not', null).where('host_confirm_deadline', '<=', nowPg())
    .orderBy('requested_at', 'desc').execute();
  let count = 0;
  for (const b of stale) {
    await saveBooking(b, { status: 'expired_unconfirmed' }, ex);
    try {
      await notifyReservationExpired(b, 'unconfirmed', ex);
    } catch (exc) {
      logger.warn({ err: exc }, `expire_unconfirmed: notify failed for ${b.id}: ${exc}`);
    }
    count += 1;
  }
  logger.info(`expire_unconfirmed_reservations: expired ${count} reservation(s)`);
  return count;
}

/** expire_unpaid_reservations() → count (select_related('listing'): each booking carries the listing as read by the query). */
export async function expireUnpaidReservations(ex: Executor = db): Promise<number> {
  const stale = await ex.selectFrom('bookings_booking').selectAll()
    .where('status', '=', 'awaiting_payment').where('payment_due_at', 'is not', null).where('payment_due_at', '<=', nowPg())
    .orderBy('requested_at', 'desc').execute();
  const listings = new Map<number, ListingRow>();
  for (const l of stale.length ? await ex.selectFrom('listings_listing').selectAll().where('id', 'in', stale.map((b) => b.listing_id)).execute() : []) listings.set(l.id, l);
  let count = 0;
  for (const b of stale) {
    await saveBooking(b, { status: 'expired_unpaid' }, ex);
    await relistListing({ ...listings.get(b.listing_id)! }, ex);
    try {
      await notifyReservationExpired(b, 'unpaid', ex);
    } catch (exc) {
      logger.warn({ err: exc }, `expire_unpaid: notify failed for ${b.id}: ${exc}`);
    }
    count += 1;
  }
  logger.info(`expire_unpaid_reservations: expired ${count} reservation(s)`);
  return count;
}

/** bookings.tasks wrappers: TaskHeartbeat.record on success/failure. */
export async function runExpiryTask(name: 'expire_unconfirmed_reservations' | 'expire_unpaid_reservations'): Promise<number> {
  const task = `bookings.tasks.${name}`;
  try {
    const n = name === 'expire_unconfirmed_reservations' ? await expireUnconfirmedReservations() : await expireUnpaidReservations();
    await recordTaskHeartbeat(task, true);
    return n;
  } catch (exc) {
    await recordTaskHeartbeat(task, false, String((exc as Error)?.message ?? exc));
    throw exc;
  }
}
