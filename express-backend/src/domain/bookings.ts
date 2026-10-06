// bookings.services (and the Booking model helpers) — what other apps import.
//
//   import { markGuestPaid, markViewingFeePaid, releaseListingIfUnheld } from '../../domain/bookings.js';
//
// Each function takes Kysely rows and an optional executor (pass your
// transaction to join it, like a nested transaction.atomic).

export {
  // bookings.models constants
  HOST_CONFIRM_DAYS, PAYMENT_WINDOW_DAYS, RESERVATION_HOLD_MAX_DAYS, ACTIVE_STATUSES, STATUS_LABELS,
  // Booking.save()/create() with the booking_pre_save/post_save signal pair
  saveBooking, insertBooking,
  // bookings.services
  pullListing as _pullListing,
  relistListing as _relistListing,
  releaseListingIfUnheld,
  hostConfirmReservation,
  markViewingFeePaid,
  markGuestPaid,
  adminConfirmPayment,
  processBookingDecline,
  reservePropertyFromViewing,
  createPayoutForBooking,
  expireUnconfirmedReservations,
  expireUnpaidReservations,
  // Booking.mark_host_confirmed / extend_reservation / total_amount
  markHostConfirmed, extendReservation, ExtendError, bookingTotalAmount,
  atomic,
} from '../apps/bookings/services.js';
export type { BookingRow, ViewingRow, Executor } from '../apps/bookings/services.js';
export { serializeBooking } from '../apps/bookings/serializers.js';

import { db } from '../db/index.js';
import type { BookingRow, ViewingRow, Executor } from '../apps/bookings/services.js';

/** Booking.objects.filter(pk=id).first() */
export async function getBooking(id: number, ex: Executor = db): Promise<BookingRow | undefined> {
  return ex.selectFrom('bookings_booking').selectAll().where('id', '=', id).executeTakeFirst();
}
/** ViewingAppointment.objects.filter(pk=id).first() */
export async function getViewing(id: number, ex: Executor = db): Promise<ViewingRow | undefined> {
  return ex.selectFrom('bookings_viewingappointment').selectAll().where('id', '=', id).executeTakeFirst();
}
