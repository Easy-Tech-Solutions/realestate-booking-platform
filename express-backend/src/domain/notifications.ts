// notifications.services (+ the notifications.signals receivers) — the single
// place where Notification rows are created. Port of
// backend/notifications/services.py and signals.py.
//
// Flow for every notification (create_notification):
//   1. get_or_create the user's NotificationPreference row
//   2. insert the Notification row (always)
//   3. if prefs.in_app_enabled: push to the user's WebSocket group
//      ("notifications_<id>", message type "notification_message") and queue
//      notifications.tasks.send_push_notification_task
//   4. if send_email and user.email and the per-type email pref is on (types
//      without a pref field default to on): queue
//      notifications.tasks.send_notification_email
//
// Every function takes the model row(s) Django passes (Kysely rows from the
// caller are fine — only the listed fields are read; related objects are
// loaded by FK) and an optional executor as the last argument: pass the
// caller's transaction to get Django's behaviour inside transaction.atomic.
// Decimal fields must be the raw Postgres strings (str(Decimal) is reproduced
// from them); datetimes may be raw Postgres strings or Dates.

import type { Transaction } from 'kysely';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, type DB } from '../db/index.js';
import { isoformat, nowPg } from '../lib/datetime.js';
import { delay } from '../lib/jobs.js';
import { logger } from '../lib/logger.js';
import { channelLayer } from '../apps/notifications/channels.js';
import { Dec } from '../apps/notifications/decimal.js';
import { getServiceFeeRateDec as getServiceFeeRate, PAYMENT_METHOD_LABELS } from './payments.js';
// Registers the task definitions (retry policy) in this process so delay()
// enqueues them with Celery's max_retries/default_retry_delay.
import '../apps/notifications/tasks.js';

export { channelLayer, AsyncWebsocketConsumer, ConsumerCrash, asConsumer, installOriginValidator, closeChannelLayer } from '../apps/notifications/channels.js';
export { pyJsonDumps, pyJsonLoads, pyStr, pyRepr, PyNum } from '../lib/py.js';
export type { LayerMessage } from '../apps/notifications/channels.js';

export type Executor = typeof db | Transaction<DB>;
type Ts = string | Date;
type Num = string | number;

// ---- models.NotificationType / NotificationPreference ------------------------

export const NOTIFICATION_TYPES = [
  'booking_requested', 'booking_submitted', 'booking_confirmed', 'booking_declined', 'booking_cancelled', 'booking_completed',
  'reservation_pending_admin', 'booking_ready_to_pay', 'payment_awaiting_admin', 'reservation_expired',
  'viewing_requested', 'viewing_fee_paid', 'viewing_scheduled', 'viewing_cancelled',
  'payment_received', 'payment_received_host', 'payment_failed', 'payment_refunded', 'payout_pending', 'payout_paid',
  'new_message', 'message_violation_sender', 'message_violation_recipient',
  'price_changed', 'listing_available', 'search_alert', 'new_review', 'report_submitted', 'report_updated',
  'account_suspended', 'account_reinstated', 'phone_number_changed',
  'host_application_submitted', 'host_application_received', 'host_application_advanced', 'host_application_progress',
  'host_application_declined', 'host_application_approved',
  'agent_application_submitted', 'agent_application_advanced', 'agent_application_received', 'agent_application_progress',
  'agent_application_declined', 'agent_application_approved', 'agent_commission_earned', 'agent_commission_paid',
  'property_verification_submitted', 'property_verification_advanced', 'property_verification_received',
  'property_verification_progress', 'property_verification_correction', 'property_verification_rejected',
  'property_verification_published',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Every <type>_email boolean column on NotificationPreference. */
export const EMAIL_PREFERENCE_FIELDS = [
  'booking_requested_email', 'booking_confirmed_email', 'booking_declined_email', 'booking_cancelled_email', 'booking_completed_email',
  'payment_received_email', 'payment_failed_email', 'payment_refunded_email', 'new_message_email',
  'price_changed_email', 'listing_available_email', 'search_alert_email', 'new_review_email',
  'report_submitted_email', 'report_updated_email', 'account_suspended_email', 'account_reinstated_email',
  'phone_number_changed_email',
] as const;

export type Preferences = Awaited<ReturnType<typeof getOrCreatePreferences>>;

/** NotificationPreference.objects.get_or_create(user=user) — every field defaults to True. */
export async function getOrCreatePreferences(userId: number, ex: Executor = db) {
  const existing = await ex.selectFrom('notifications_notificationpreference').selectAll().where('user_id', '=', userId).executeTakeFirst();
  if (existing) return existing;
  const values = Object.fromEntries(EMAIL_PREFERENCE_FIELDS.map((f) => [f, true])) as Record<(typeof EMAIL_PREFERENCE_FIELDS)[number], boolean>;
  await ex.insertInto('notifications_notificationpreference')
    .values({ ...values, in_app_enabled: true, user_id: userId, updated_at: nowPg() })
    .onConflict((oc) => oc.column('user_id').doNothing())
    .execute();
  return ex.selectFrom('notifications_notificationpreference').selectAll().where('user_id', '=', userId).executeTakeFirstOrThrow();
}

/** NotificationPreference.email_enabled_for: getattr(prefs, f'{type}_email', True). */
export function emailEnabledFor(prefs: Record<string, unknown>, notificationType: string): boolean {
  const field = `${notificationType}_email`;
  return field in prefs ? Boolean(prefs[field]) : true;
}

// ---- small helpers -----------------------------------------------------------

export interface UserLike { id: number; email: string; username: string; first_name: string; last_name: string }

/** user.get_full_name() or user.username */
export function displayName(u: Pick<UserLike, 'first_name' | 'last_name' | 'username'>): string {
  return `${u.first_name} ${u.last_name}`.trim() || u.username;
}

async function getUser(id: number, ex: Executor) {
  return ex.selectFrom('users_user').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
}
async function getListing(id: number, ex: Executor) {
  return ex.selectFrom('listings_listing').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
}

/** Datetime (pg text or Date) → pg-style text for lib/datetime. */
function pgText(v: Ts): string {
  const s = v instanceof Date ? v.toISOString() : String(v);
  return s.replace('T', ' ').replace(/Z$/, '+00');
}
/** datetime.isoformat() (None → null) */
function iso(v: Ts | null | undefined): string | null {
  return v === null || v === undefined ? null : isoformat(pgText(v));
}
/** f'{dt:%Y-%m-%d %H:%M UTC}' — None raises TypeError like Python's format(). */
function ymdHmUtc(v: Ts | null | undefined): string {
  if (v === null || v === undefined) throw new TypeError("unsupported format string passed to NoneType.__format__");
  const s = isoformat(pgText(v))!;
  return `${s.slice(0, 10)} ${s.slice(11, 16)} UTC`;
}
/** str(date) */
function dateStr(v: Ts): string {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}
/** str(Decimal) for a DB numeric value. */
function decStr(v: Num): string {
  return Dec.from(v).toString();
}
/** f'{Decimal(x):.2f}' */
function dec2(v: Num | Dec): string {
  return Dec.from(v as Num).fixed(2);
}
/** Python len()/slicing on code points. */
function pyChars(s: string): string[] {
  return Array.from(s);
}

// ---- _booking_amounts ----------------------------------------------------------

export interface BookingLike {
  id: number;
  listing_id: number;
  customer_id: number;
  start_date: Ts;
  end_date: Ts;
  total_price: Num | null;
  service_fee: Num | null;
  owner_notes?: string;
  decline_reason?: string;
  host_confirmed_at?: Ts | null;
  payment_due_at?: Ts | null;
}

export interface BookingAmounts {
  subtotal: Dec; guest_service_fee: Dec; guest_total: Dec; host_service_fee: Dec; host_received: Dec;
}

/** _booking_amounts(booking): canonical money breakdown (stored totals; legacy nightly fallback). */
export async function bookingAmounts(booking: BookingLike, ex: Executor = db): Promise<BookingAmounts> {
  const rate = await getServiceFeeRate(ex);
  let total: Dec;
  let guestFee: Dec;
  if (booking.total_price !== null && booking.total_price !== undefined && !Dec.from(booking.total_price).isZero()) {
    total = Dec.from(booking.total_price);
    guestFee = Dec.from(booking.service_fee === null || booking.service_fee === undefined || Dec.from(booking.service_fee).isZero() ? '0' : booking.service_fee);
  } else {
    // booking.total_amount: listing.price × max(days, 1)
    const listing = await getListing(booking.listing_id, ex);
    const days = Math.round((Date.parse(dateStr(booking.end_date)) - Date.parse(dateStr(booking.start_date))) / 86_400_000);
    const subtotalLegacy = Dec.from(listing.price).mul(String(Math.max(days, 1)));
    guestFee = subtotalLegacy.mul(rate).quantize(2);
    total = subtotalLegacy.add(guestFee);
  }
  const subtotal = total.sub(guestFee).quantize(2);
  const hostFee = subtotal.mul(rate).quantize(2);
  const hostReceived = subtotal.sub(hostFee).quantize(2);
  return {
    subtotal,
    guest_service_fee: guestFee.quantize(2),
    guest_total: total.quantize(2),
    host_service_fee: hostFee,
    host_received: hostReceived,
  };
}

// ---- realtime + core --------------------------------------------------------------

/** _push_realtime: group_send to notifications_<user_id>; failures are logged, never raised. */
export async function pushRealtime(userId: number, payload: Record<string, unknown>): Promise<void> {
  try {
    await channelLayer.groupSend(`notifications_${userId}`, { type: 'notification_message', notification: payload });
  } catch (exc) {
    logger.warn({ err: exc }, `Could not push real-time notification to user ${userId}: ${exc}`);
  }
}

export interface CreateNotificationArgs {
  user: Pick<UserLike, 'id' | 'email'>;
  notificationType: string;
  title: string;
  message: string;
  data?: Record<string, unknown> | null;
  /** send_email=True by default; False suppresses the email. */
  sendEmail?: boolean;
}

/** create_notification(user, notification_type, title, message, data=None, send_email=True) → the Notification row. */
export async function createNotification(args: CreateNotificationArgs, ex: Executor = db) {
  const { user, notificationType, title, message } = args;
  const data = args.data && Object.keys(args.data).length ? args.data : {};
  const sendEmail = args.sendEmail ?? true;

  const prefs = await getOrCreatePreferences(user.id, ex);

  const notification = await ex.insertInto('notifications_notification')
    .values({
      user_id: user.id, notification_type: notificationType, title, message, data: JSON.stringify(data),
      is_read: false, email_sent: false, created_at: nowPg(), read_at: null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  if (prefs.in_app_enabled) {
    await pushRealtime(user.id, {
      id: notification.id,
      type: notificationType,
      title,
      message,
      data,
      is_read: false,
      created_at: isoformat(notification.created_at),
    });
    try {
      await delay('notifications.tasks.send_push_notification_task', [notification.id]);
    } catch (exc) {
      logger.warn({ err: exc }, `Could not queue push for notification ${notification.id}: ${exc}`);
    }
  }

  if (sendEmail && user.email && emailEnabledFor(prefs, notificationType)) {
    try {
      await delay('notifications.tasks.send_notification_email', [notification.id]);
    } catch (exc) {
      logger.warn({ err: exc }, `Could not queue email for notification ${notification.id}: ${exc}`);
    }
  }
  return notification;
}

/** _notify_admins: every user with role admin/superadmin (active or not, unordered — same SQL as Django). */
export async function notifyAdmins(notificationType: string, title: string, message: string, data: Record<string, unknown> | null = null, ex: Executor = db) {
  const admins = await ex.selectFrom('users_user').selectAll().where('role', 'in', ['admin', 'superadmin']).execute();
  for (const admin of admins) await createNotification({ user: admin, notificationType, title, message, data: data ?? {} }, ex);
}

/** _notify_group: every active member of a Django auth Group (SELECT DISTINCT, like .distinct()). */
export async function notifyGroup(groupName: string, notificationType: string, title: string, message: string, data: Record<string, unknown> | null = null, ex: Executor = db) {
  const members = await ex.selectFrom('users_user')
    .innerJoin('users_user_groups', 'users_user_groups.user_id', 'users_user.id')
    .innerJoin('auth_group', 'auth_group.id', 'users_user_groups.group_id')
    .selectAll('users_user')
    .distinct()
    .where('auth_group.name', '=', groupName)
    .where('users_user.is_active', '=', true)
    .execute();
  for (const m of members) await createNotification({ user: m, notificationType, title, message, data: data ?? {} }, ex);
}

// ---- Booking helpers ------------------------------------------------------------

export async function notifyBookingRequested(booking: BookingLike, ex: Executor = db) {
  const listing = await getListing(booking.listing_id, ex);
  const owner = await getUser(listing.owner_id, ex);
  const customerName = displayName(await getUser(booking.customer_id, ex));
  const a = await bookingAmounts(booking, ex);
  await createNotification({
    user: owner,
    notificationType: 'booking_requested',
    title: 'New Booking Request',
    message: `${customerName} has requested to book "${listing.title}" from ${dateStr(booking.start_date)} to ${dateStr(booking.end_date)}.`,
    data: {
      booking_id: booking.id,
      listing_id: listing.id,
      listing_title: listing.title,
      customer_name: customerName,
      start_date: dateStr(booking.start_date),
      end_date: dateStr(booking.end_date),
      booking_amount: a.subtotal.fixed(),
      host_service_fee: a.host_service_fee.fixed(),
      amount_received: a.host_received.fixed(),
      total_amount: a.subtotal.fixed(),
    },
  }, ex);
}

/** leaseagreements.agreements.generate_lease_for_booking via domain/leaseagreements.ts when that app is ported. */
async function generateLeaseForBooking(booking: BookingLike, ex: Executor): Promise<{ document: string | null } | null> {
  const here = dirname(fileURLToPath(import.meta.url));
  let mod: { generateLeaseForBooking?: (b: BookingLike, ex?: Executor) => Promise<{ document: string | null } | null> } | null = null;
  try {
    mod = await import(pathToFileURL(join(here, 'leaseagreements.js')).href);
  } catch (e) {
    if ((e as { code?: string }).code !== 'ERR_MODULE_NOT_FOUND') throw e;
  }
  if (mod?.generateLeaseForBooking) return mod.generateLeaseForBooking(booking, ex);
  // Not ported yet: use an already-generated lease if one exists (ordering = ['-generated_at']).
  logger.warn({ booking_id: booking.id }, 'leaseagreements not ported: lease PDF not generated for notify_booking_submitted');
  return (await ex.selectFrom('leaseagreements_leaseagreement').select('document').where('booking_id', '=', booking.id).orderBy('generated_at', 'desc').executeTakeFirst()) ?? null;
}

export async function notifyBookingSubmitted(booking: BookingLike, ex: Executor = db) {
  const a = await bookingAmounts(booking, ex);
  const listing = await getListing(booking.listing_id, ex);
  const owner = await getUser(listing.owner_id, ex);
  const data: Record<string, unknown> = {
    booking_id: booking.id,
    listing_id: listing.id,
    listing_title: listing.title,
    owner_name: displayName(owner),
    start_date: dateStr(booking.start_date),
    end_date: dateStr(booking.end_date),
    booking_amount: a.subtotal.fixed(),
    service_fee: a.guest_service_fee.fixed(),
    total_amount: a.guest_total.fixed(),
  };
  try {
    if (listing.pricing_type === 'monthly') {
      const lease = await generateLeaseForBooking(booking, ex);
      if (lease && lease.document) data.attach_lease_booking_id = booking.id;
    }
  } catch (e) {
    logger.error({ err: e }, `Lease generation failed for booking #${booking.id}`);
  }
  await createNotification({
    user: await getUser(booking.customer_id, ex),
    notificationType: 'booking_submitted',
    title: 'Booking Requested',
    message:
      `Your request to book "${listing.title}" from ${dateStr(booking.start_date)} to ${dateStr(booking.end_date)} has been sent to the host. ` +
      "You'll be notified once they accept or decline.",
    data,
  }, ex);
}

export async function notifyBookingConfirmed(booking: BookingLike, ex: Executor = db) {
  const a = await bookingAmounts(booking, ex);
  const listing = await getListing(booking.listing_id, ex);
  const owner = await getUser(listing.owner_id, ex);
  await createNotification({
    user: await getUser(booking.customer_id, ex),
    notificationType: 'booking_confirmed',
    title: 'Booking Confirmed!',
    message: `Your booking for "${listing.title}" from ${dateStr(booking.start_date)} to ${dateStr(booking.end_date)} has been confirmed.`,
    data: {
      booking_id: booking.id,
      listing_id: listing.id,
      listing_title: listing.title,
      owner_name: displayName(owner),
      start_date: dateStr(booking.start_date),
      end_date: dateStr(booking.end_date),
      booking_amount: a.subtotal.fixed(),
      service_fee: a.guest_service_fee.fixed(),
      total_amount: a.guest_total.fixed(),
      owner_notes: booking.owner_notes ?? '',
    },
  }, ex);
}

export async function notifyBookingDeclined(booking: BookingLike, ex: Executor = db) {
  const listing = await getListing(booking.listing_id, ex);
  const previouslyConfirmed = booking.host_confirmed_at !== null && booking.host_confirmed_at !== undefined;
  const reason = booking.decline_reason || 'No reason provided.';
  await createNotification({
    user: await getUser(booking.customer_id, ex),
    notificationType: 'booking_declined',
    title: previouslyConfirmed ? 'Reservation Cancelled by Host' : 'Booking Declined',
    message: previouslyConfirmed
      ? `Your confirmed reservation for "${listing.title}" was cancelled by the host before payment. Reason: ${reason}`
      : `Your booking request for "${listing.title}" was declined. Reason: ${reason}`,
    data: {
      booking_id: booking.id,
      listing_id: listing.id,
      listing_title: listing.title,
      decline_reason: booking.decline_reason ?? '',
      previously_confirmed: previouslyConfirmed,
    },
  }, ex);
}

/** notify_booking_cancelled(booking, cancelled_by_user=None) */
export async function notifyBookingCancelled(booking: BookingLike, cancelledByUser: UserLike | null = null, ex: Executor = db) {
  const listing = await getListing(booking.listing_id, ex);
  if (cancelledByUser === null) {
    for (const recipientId of [booking.customer_id, listing.owner_id]) {
      await createNotification({
        user: await getUser(recipientId, ex),
        notificationType: 'booking_cancelled',
        title: 'Booking Cancelled',
        message: `The booking for "${listing.title}" has been cancelled.`,
        data: { booking_id: booking.id, listing_id: listing.id, listing_title: listing.title },
      }, ex);
    }
    return;
  }
  const notifyUserId = cancelledByUser.id === booking.customer_id ? listing.owner_id : booking.customer_id;
  const actor = displayName(cancelledByUser);
  await createNotification({
    user: await getUser(notifyUserId, ex),
    notificationType: 'booking_cancelled',
    title: 'Booking Cancelled',
    message: `The booking for "${listing.title}" from ${dateStr(booking.start_date)} to ${dateStr(booking.end_date)} was cancelled by ${actor}.`,
    data: {
      booking_id: booking.id,
      listing_id: listing.id,
      listing_title: listing.title,
      cancelled_by: actor,
      start_date: dateStr(booking.start_date),
      end_date: dateStr(booking.end_date),
    },
  }, ex);
}

export async function notifyBookingCompleted(booking: BookingLike, ex: Executor = db) {
  const listing = await getListing(booking.listing_id, ex);
  await createNotification({
    user: await getUser(booking.customer_id, ex),
    notificationType: 'booking_completed',
    title: 'Stay Complete - Leave a Review!',
    message: `Your stay at "${listing.title}" is complete. We hope you enjoyed it! Don't forget to leave a review.`,
    data: { booking_id: booking.id, listing_id: listing.id, listing_title: listing.title },
  }, ex);
}

// ---- Reservation flow ----------------------------------------------------------------

export async function notifyReservationRequested(booking: BookingLike, ex: Executor = db) {
  await notifyBookingRequested(booking, ex);
  const customerName = displayName(await getUser(booking.customer_id, ex));
  const listing = await getListing(booking.listing_id, ex);
  await notifyAdmins(
    'reservation_pending_admin',
    'New Reservation',
    `${customerName} reserved "${listing.title}" (${dateStr(booking.start_date)} → ${dateStr(booking.end_date)}). Awaiting host confirmation.`,
    { booking_id: booking.id, listing_id: listing.id, listing_title: listing.title, customer_name: customerName },
    ex,
  );
}

export async function notifyReservationReadyToPay(booking: BookingLike, ex: Executor = db) {
  const a = await bookingAmounts(booking, ex);
  const listing = await getListing(booking.listing_id, ex);
  const customer = await getUser(booking.customer_id, ex);
  const total = a.guest_total;
  await createNotification({
    user: customer,
    notificationType: 'booking_ready_to_pay',
    title: 'Reservation Confirmed — Complete Payment',
    message:
      `The host confirmed your reservation for "${listing.title}". ` +
      `Complete your payment of $${total.toString()} by ${ymdHmUtc(booking.payment_due_at)} to secure it.`,
    data: {
      booking_id: booking.id,
      listing_id: listing.id,
      listing_title: listing.title,
      booking_amount: a.subtotal.fixed(),
      service_fee: a.guest_service_fee.fixed(),
      total_amount: total.fixed(),
      payment_due_at: iso(booking.payment_due_at),
    },
  }, ex);
}

export async function notifyPaymentAwaitingAdmin(booking: BookingLike, ex: Executor = db) {
  const customerName = displayName(await getUser(booking.customer_id, ex));
  const listing = await getListing(booking.listing_id, ex);
  await notifyAdmins(
    'payment_awaiting_admin',
    'Payment Awaiting Confirmation',
    `${customerName} paid for "${listing.title}". Confirm the payment to release host contact details and create the payout.`,
    { booking_id: booking.id, listing_id: listing.id, listing_title: listing.title, customer_name: customerName },
    ex,
  );
}

export async function notifyHostPaymentReceived(booking: BookingLike, ex: Executor = db) {
  const listing = await getListing(booking.listing_id, ex);
  const owner = await getUser(listing.owner_id, ex);
  const a = await bookingAmounts(booking, ex);
  await createNotification({
    user: owner,
    notificationType: 'payment_received_host',
    title: 'Payment Received',
    message:
      `The guest has paid for "${listing.title}". ` +
      `You'll receive ${a.host_received.toString()} after our commission — ` +
      "Home Konet's team will disburse it to your account shortly.",
    data: {
      booking_id: booking.id,
      listing_id: listing.id,
      listing_title: listing.title,
      booking_amount: a.subtotal.fixed(),
      host_service_fee: a.host_service_fee.fixed(),
      amount_received: a.host_received.fixed(),
    },
  }, ex);
}

/** notify_reservation_expired(booking, reason='unpaid') — reason 'unconfirmed' | 'unpaid'. */
export async function notifyReservationExpired(booking: BookingLike, reason = 'unpaid', ex: Executor = db) {
  const listing = await getListing(booking.listing_id, ex);
  const guestMsg = reason === 'unconfirmed'
    ? `Your reservation for "${listing.title}" expired because the host did not confirm in time. You can reserve it again if it is still available.`
    : `Your reservation for "${listing.title}" expired because payment was not completed in time. The property has been relisted.`;
  await createNotification({
    user: await getUser(booking.customer_id, ex),
    notificationType: 'reservation_expired',
    title: 'Reservation Expired',
    message: guestMsg,
    data: { booking_id: booking.id, listing_id: listing.id, listing_title: listing.title, reason },
  }, ex);
  if (reason === 'unpaid') {
    await createNotification({
      user: await getUser(listing.owner_id, ex),
      notificationType: 'reservation_expired',
      title: 'Reservation Expired — Property Relisted',
      message: `A confirmed reservation for "${listing.title}" expired because the guest did not pay in time. The property has been relisted.`,
      data: { booking_id: booking.id, listing_id: listing.id, listing_title: listing.title, reason },
    }, ex);
  }
}

// ---- Viewings ---------------------------------------------------------------------------

export interface ViewingLike {
  id: number;
  listing_id: number;
  guest_id: number;
  viewing_date: Ts;
  viewing_time: string | null;
  viewing_fee: Num;
}

/** ViewingAppointment.viewing_time_range, e.g. '10:00 AM – 12:00 PM' ('' when no time). */
export function viewingTimeRange(viewingTime: string | null | undefined): string {
  if (!viewingTime) return '';
  const [h = 0, m = 0] = viewingTime.split(':').map(Number);
  const fmt = (hh: number, mm: number) => `${hh % 12 || 12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
  return `${fmt(h, m)} – ${fmt((h + 2) % 24, m)}`;
}

export async function notifyViewingRequested(viewing: ViewingLike, ex: Executor = db) {
  const guestName = displayName(await getUser(viewing.guest_id, ex));
  const listing = await getListing(viewing.listing_id, ex);
  const range = viewingTimeRange(viewing.viewing_time);
  await notifyAdmins(
    'viewing_requested',
    'New Viewing Request',
    `${guestName} requested a viewing of "${listing.title}" on ${dateStr(viewing.viewing_date)} (${range}). Schedule and confirm the appointment.`,
    {
      viewing_id: viewing.id, listing_id: listing.id, listing_title: listing.title, guest_name: guestName,
      viewing_date: dateStr(viewing.viewing_date), viewing_time: range,
    },
    ex,
  );
}

export interface PaymentLike {
  id: string;
  user_id: number;
  booking_id: number | null;
  amount: Num;
  currency_id: number;
  payment_method: string;
}

async function currencyCode(currencyId: number, ex: Executor): Promise<string> {
  return (await ex.selectFrom('payments_currency').select('code').where('id', '=', currencyId).executeTakeFirstOrThrow()).code;
}

/** notify_viewing_fee_paid(viewing, payment=None): in-app + email receipt. */
export async function notifyViewingFeePaid(viewing: ViewingLike, payment: PaymentLike | null = null, ex: Executor = db) {
  const amount = payment !== null ? payment.amount : viewing.viewing_fee;
  const amountStr = dec2(amount);
  const currency = payment !== null ? await currencyCode(payment.currency_id, ex) : 'USD';
  const method = payment !== null ? (PAYMENT_METHOD_LABELS[payment.payment_method] ?? payment.payment_method) : '';
  const reference = payment !== null ? String(payment.id) : '';
  const listing = await getListing(viewing.listing_id, ex);
  const range = viewingTimeRange(viewing.viewing_time);
  await createNotification({
    user: await getUser(viewing.guest_id, ex),
    notificationType: 'viewing_fee_paid',
    title: 'Viewing Fee Paid — Receipt',
    message:
      `We received your ${amountStr} ${currency} viewing fee for "${listing.title}". Our team will schedule and confirm your ` +
      `visit on ${dateStr(viewing.viewing_date)} (${range}).`,
    data: {
      viewing_id: viewing.id,
      listing_id: listing.id,
      listing_title: listing.title,
      viewing_date: dateStr(viewing.viewing_date),
      viewing_time: range,
      amount: dec2(amount),
      currency,
      payment_method: method,
      payment_id: reference,
    },
  }, ex);
}

export async function notifyViewingScheduled(viewing: ViewingLike, ex: Executor = db) {
  const listing = await getListing(viewing.listing_id, ex);
  const range = viewingTimeRange(viewing.viewing_time);
  await createNotification({
    user: await getUser(viewing.guest_id, ex),
    notificationType: 'viewing_scheduled',
    title: 'Viewing Scheduled',
    message:
      `Your viewing of "${listing.title}" on ${dateStr(viewing.viewing_date)} (${range}) has been confirmed. ` +
      'A Home Konet representative will meet you there.',
    data: {
      viewing_id: viewing.id, listing_id: listing.id, listing_title: listing.title,
      viewing_date: dateStr(viewing.viewing_date), viewing_time: range,
    },
  }, ex);
}

/** notify_viewing_cancelled(viewing, reason='') */
export async function notifyViewingCancelled(viewing: ViewingLike, reason = '', ex: Executor = db) {
  const listing = await getListing(viewing.listing_id, ex);
  const range = viewingTimeRange(viewing.viewing_time);
  let message = `Your viewing of "${listing.title}" on ${dateStr(viewing.viewing_date)} (${range}) has been cancelled.`;
  if (reason) message += ` Reason: ${reason}`;
  await createNotification({
    user: await getUser(viewing.guest_id, ex),
    notificationType: 'viewing_cancelled',
    title: 'Viewing Cancelled',
    message,
    data: {
      viewing_id: viewing.id, listing_id: listing.id, listing_title: listing.title,
      viewing_date: dateStr(viewing.viewing_date), viewing_time: range, reason,
    },
  }, ex);
}

// ---- Payouts ----------------------------------------------------------------------------------

export interface PayoutLike {
  id: string;
  host_id: number;
  booking_id: number | null;
  net_amount: Num;
  currency: string;
  reference?: string | null;
}

export async function notifyPayoutPending(payout: PayoutLike, ex: Executor = db) {
  const hostName = displayName(await getUser(payout.host_id, ex));
  const booking = await ex.selectFrom('bookings_booking').select('listing_id').where('id', '=', payout.booking_id!).executeTakeFirstOrThrow();
  const listing = await getListing(booking.listing_id, ex);
  await notifyAdmins(
    'payout_pending',
    'Host Payout Pending',
    `A payout of ${decStr(payout.net_amount)} ${payout.currency} is owed to ${hostName} for "${listing.title}".`,
    {
      payout_id: String(payout.id), booking_id: payout.booking_id, host_name: hostName,
      net_amount: dec2(payout.net_amount), currency: payout.currency,
    },
    ex,
  );
}

export async function notifyPayoutPaid(payout: PayoutLike, ex: Executor = db) {
  let listingTitle = 'your booking';
  if (payout.booking_id) {
    const booking = await ex.selectFrom('bookings_booking').select('listing_id').where('id', '=', payout.booking_id).executeTakeFirstOrThrow();
    listingTitle = (await getListing(booking.listing_id, ex)).title;
  }
  await createNotification({
    user: await getUser(payout.host_id, ex),
    notificationType: 'payout_paid',
    title: 'Payout Sent',
    message:
      `Home Konet has disbursed ${decStr(payout.net_amount)} ${payout.currency} to you ` +
      `for "${listingTitle}". It should reach your account shortly.`,
    data: {
      payout_id: String(payout.id),
      booking_id: payout.booking_id,
      listing_title: listingTitle,
      net_amount: dec2(payout.net_amount),
      currency: payout.currency,
      reference: payout.reference || '',
    },
  }, ex);
}

// ---- Payments ---------------------------------------------------------------------------------

async function paymentContext(payment: PaymentLike, ex: Executor) {
  const booking = await ex.selectFrom('bookings_booking').selectAll().where('id', '=', payment.booking_id!).executeTakeFirstOrThrow();
  const listing = await getListing(booking.listing_id, ex);
  return { booking, listing, currency: await currencyCode(payment.currency_id, ex) };
}

/**
 * notify_payment_received(payment). Reproduces a Django bug: after the guest's
 * notification, the host branch formats `rate`, which is undefined in that
 * function → NameError, so the host notification is never created and the
 * error propagates (the payment post_save receiver catches and logs it).
 */
export async function notifyPaymentReceived(payment: PaymentLike, ex: Executor = db) {
  if (!payment.booking_id) return;
  const { booking, listing, currency } = await paymentContext(payment, ex);
  await bookingAmounts(booking, ex); // computed before the guest notification in Django (reads PlatformFee)
  await createNotification({
    user: await getUser(payment.user_id, ex),
    notificationType: 'payment_received',
    title: 'Payment Successful',
    message: `Your payment of ${decStr(payment.amount)} ${currency} for "${listing.title}" was successful.`,
    data: {
      payment_id: String(payment.id),
      booking_id: booking.id,
      listing_id: listing.id,
      listing_title: listing.title,
      amount: decStr(payment.amount),
      currency,
    },
  }, ex);
  if (listing.owner_id !== payment.user_id) {
    throw new ReferenceError("name 'rate' is not defined");
  }
}

export async function notifyPaymentFailed(payment: PaymentLike, ex: Executor = db) {
  const { booking, listing, currency } = await paymentContext(payment, ex);
  await createNotification({
    user: await getUser(payment.user_id, ex),
    notificationType: 'payment_failed',
    title: 'Payment Failed',
    message: `Your payment of ${decStr(payment.amount)} ${currency} for "${listing.title}" failed. Please try again.`,
    data: {
      payment_id: String(payment.id), booking_id: booking.id, listing_id: listing.id, listing_title: listing.title,
      amount: decStr(payment.amount), currency,
    },
  }, ex);
}

export async function notifyPaymentRefunded(payment: PaymentLike, ex: Executor = db) {
  const { booking, listing, currency } = await paymentContext(payment, ex);
  await createNotification({
    user: await getUser(payment.user_id, ex),
    notificationType: 'payment_refunded',
    title: 'Refund Processed',
    message: `A refund of ${decStr(payment.amount)} ${currency} for "${listing.title}" has been processed.`,
    data: {
      payment_id: String(payment.id), booking_id: booking.id, listing_id: listing.id, listing_title: listing.title,
      amount: decStr(payment.amount), currency,
    },
  }, ex);
}

// ---- Messaging --------------------------------------------------------------------------------

export interface MessageLike { id: number; conversation_id: number; sender_id: number; content: string }

/** notify_new_message(message): every participant except the sender; preview capped at 100 chars. */
export async function notifyNewMessage(message: MessageLike, ex: Executor = db) {
  const conversation = await ex.selectFrom('messaging_conversation').selectAll().where('id', '=', message.conversation_id).executeTakeFirstOrThrow();
  const senderName = displayName(await getUser(message.sender_id, ex));
  const listing = conversation.listing_id ? await getListing(conversation.listing_id, ex) : null;
  const listingTitle = listing ? listing.title : 'General Chat';
  const chars = pyChars(message.content);
  const preview = chars.slice(0, 100).join('') + (chars.length > 100 ? '...' : '');
  const recipients = await ex.selectFrom('users_user')
    .innerJoin('messaging_conversation_participants', 'messaging_conversation_participants.user_id', 'users_user.id')
    .selectAll('users_user')
    .where('messaging_conversation_participants.conversation_id', '=', conversation.id)
    .where('users_user.id', '!=', message.sender_id)
    .execute();
  for (const user of recipients) {
    await createNotification({
      user,
      notificationType: 'new_message',
      title: `New message from ${senderName}`,
      message: `${senderName}: ${preview}`,
      data: {
        conversation_id: conversation.id,
        message_id: message.id,
        sender_name: senderName,
        listing_title: listingTitle,
        listing_id: listing ? listing.id : null,
      },
    }, ex);
  }
}

export async function notifyMessageViolationSender(sender: Pick<UserLike, 'id' | 'email'>, ex: Executor = db) {
  await createNotification({
    user: sender,
    notificationType: 'message_violation_sender',
    title: 'Message content removed',
    message:
      'We removed contact details or a restricted phrase from your message. ' +
      'Sharing contact info or arranging deals outside Home Konet means you lose ' +
      'refund and dispute protection, and repeated attempts can lead to suspension.',
    sendEmail: false,
  }, ex);
}

export async function notifyMessageViolationRecipient(recipient: Pick<UserLike, 'id' | 'email'>, sender: UserLike, ex: Executor = db) {
  const senderName = displayName(sender);
  await createNotification({
    user: recipient,
    notificationType: 'message_violation_recipient',
    title: 'Contact-sharing attempt flagged',
    message:
      `${senderName} attempted to share contact details or move this conversation ` +
      'off-platform. For your protection, please keep all communication and payments ' +
      'within Home Konet.',
    sendEmail: false,
  }, ex);
}

// ---- Listings -----------------------------------------------------------------------------------

export interface ListingLike { id: number; title: string; price: Num; is_available?: boolean }

async function favoriteUsers(listingId: number, ex: Executor) {
  return ex.selectFrom('listings_favorite')
    .innerJoin('users_user', 'users_user.id', 'listings_favorite.user_id')
    .selectAll('users_user')
    .where('listings_favorite.listing_id', '=', listingId)
    .orderBy('listings_favorite.created_at', 'desc')
    .execute();
}

/** notify_price_changed(listing, old_price) — old_price is the previous DB value (string). */
export async function notifyPriceChanged(listing: ListingLike, oldPrice: Num, ex: Executor = db) {
  const direction = Dec.from(listing.price).cmp(oldPrice) < 0 ? 'decreased' : 'increased';
  const Direction = direction[0]!.toUpperCase() + direction.slice(1);
  for (const user of await favoriteUsers(listing.id, ex)) {
    await createNotification({
      user,
      notificationType: 'price_changed',
      title: `Price ${Direction} - ${listing.title}`,
      message: `The price for "${listing.title}" has ${direction} from ${decStr(oldPrice)} to ${decStr(listing.price)}.`,
      data: {
        listing_id: listing.id, listing_title: listing.title, old_price: decStr(oldPrice), new_price: decStr(listing.price), direction,
      },
    }, ex);
  }
}

export async function notifyListingAvailable(listing: Pick<ListingLike, 'id' | 'title'>, ex: Executor = db) {
  for (const user of await favoriteUsers(listing.id, ex)) {
    await createNotification({
      user,
      notificationType: 'listing_available',
      title: `Listing Available - ${listing.title}`,
      message: `"${listing.title}" is now available for booking.`,
      data: { listing_id: listing.id, listing_title: listing.title },
    }, ex);
  }
}

// ---- Reports / suspensions ----------------------------------------------------------------------

export const REPORT_TYPE_LABELS: Record<string, string> = {
  scam: 'Scam / Fraud', fake_listing: 'Fake Listing', inappropriate_content: 'Inappropriate Content',
  harassment: 'Harassment', wrong_info: 'Wrong Information', other: 'Other',
};
export const REPORT_CONTENT_TYPE_LABELS: Record<string, string> = { user: 'User', listing: 'Listing', review: 'Review', message: 'Message' };
export const REPORT_STATUS_LABELS: Record<string, string> = { pending: 'Pending', under_review: 'Under Review', resolved: 'Resolved', dismissed: 'Dismissed' };

export interface ReportLike { id: number; reporter_id: number; report_type: string; content_type: string; status: string; admin_notes: string }

export async function notifyReportSubmitted(report: ReportLike, ex: Executor = db) {
  const reporterName = displayName(await getUser(report.reporter_id, ex));
  const admins = await ex.selectFrom('users_user').selectAll().where('role', 'in', ['admin', 'superadmin']).execute();
  const typeLabel = REPORT_TYPE_LABELS[report.report_type] ?? report.report_type;
  const ctLabel = REPORT_CONTENT_TYPE_LABELS[report.content_type] ?? report.content_type;
  for (const admin of admins) {
    await createNotification({
      user: admin,
      notificationType: 'report_submitted',
      title: 'New Report Filed',
      message: `${reporterName} filed a "${typeLabel}" report on a ${ctLabel}.`,
      data: { report_id: report.id, report_type: report.report_type, content_type: report.content_type, reporter_name: reporterName },
    }, ex);
  }
}

export interface SuspensionLike { id: number; user_id: number; suspension_type: string; reason: string; ends_at: Ts | null; status: string }

export async function notifyAccountSuspended(suspension: SuspensionLike, ex: Executor = db) {
  const adverb = ({ temporary: 'temporarily', indefinite: 'indefinitely', permanent: 'permanently' } as Record<string, string>)[suspension.suspension_type] ?? '';
  let message = `Your account has been ${adverb} suspended.`;
  if (suspension.ends_at) message += ` The suspension will be lifted on ${ymdHmUtc(suspension.ends_at)}.`;
  await createNotification({
    user: await getUser(suspension.user_id, ex),
    notificationType: 'account_suspended',
    title: 'Account Suspended',
    message,
    data: {
      suspension_id: suspension.id,
      suspension_type: suspension.suspension_type,
      reason: suspension.reason,
      ends_at: suspension.ends_at ? iso(suspension.ends_at) : null,
    },
  }, ex);
}

export async function notifyAccountReinstated(suspension: SuspensionLike, ex: Executor = db) {
  const message = suspension.status === 'revoked'
    ? 'Your account suspension has been lifted by an administrator. You can now log in again.'
    : 'Your temporary suspension has expired. You can now log in again.';
  await createNotification({
    user: await getUser(suspension.user_id, ex),
    notificationType: 'account_reinstated',
    title: 'Account Reinstated',
    message,
    data: { suspension_id: suspension.id, status: suspension.status },
  }, ex);
}

export async function notifyReportUpdated(report: ReportLike, ex: Executor = db) {
  const labels: Record<string, string> = { under_review: 'is now under review', resolved: 'has been resolved', dismissed: 'has been dismissed' };
  const label = labels[report.status] ?? `was updated to "${REPORT_STATUS_LABELS[report.status] ?? report.status}"`;
  await createNotification({
    user: await getUser(report.reporter_id, ex),
    notificationType: 'report_updated',
    title: 'Your Report Was Updated',
    message: `Your report (#${report.id}) ${label}.`,
    data: { report_id: report.id, report_type: report.report_type, new_status: report.status, admin_notes: report.admin_notes },
  }, ex);
}

// ---- Host / agent applications -------------------------------------------------------------------

export const GROUP_PRODUCT_SUPPORT = 'Product Support Officers';
export const GROUP_COMPLIANCE = 'Compliance Officers';
export const GROUP_SUPERVISOR = 'Supervisors';
const NEXT_GROUP: Record<string, string> = { ps_approved: GROUP_COMPLIANCE, compliance_approved: GROUP_SUPERVISOR };
const STAGE_LABELS: Record<string, [string, string]> = {
  ps_approved: ['Product Support', 'the Compliance team'],
  compliance_approved: ['Compliance', 'a Supervisor for final approval'],
};

export interface ApplicationLike {
  id: number; applicant_id: number; full_name: string; status: string; decline_reason: string; declined_stage: string;
  /** HostApplication only (FileField name). */
  agreement_document?: string | null;
}

const applicationData = (a: ApplicationLike) => ({ application_id: a.id, applicant_name: a.full_name, status: a.status });

export async function notifyHostApplicationSubmitted(application: ApplicationLike, ex: Executor = db) {
  await notifyGroup(GROUP_PRODUCT_SUPPORT, 'host_application_submitted', 'New Host Application',
    `${application.full_name} applied to become a host. Review the application to approve or decline it.`,
    applicationData(application), ex);
}

export async function notifyHostApplicationAdvanced(application: ApplicationLike, ex: Executor = db) {
  const next = NEXT_GROUP[application.status];
  if (!next) return;
  await notifyGroup(next, 'host_application_advanced', 'Host Application Awaiting Review',
    `${application.full_name}'s host application has advanced to your stage. Please review it to approve or decline.`,
    applicationData(application), ex);
}

export async function notifyHostApplicationReceived(application: ApplicationLike, ex: Executor = db) {
  await createNotification({
    user: await getUser(application.applicant_id, ex),
    notificationType: 'host_application_received',
    title: 'We Received Your Host Application',
    message: "Thanks for applying to become a host on Home Konet. Our team is now reviewing your application — we'll email you at each step.",
    data: { application_id: application.id },
  }, ex);
}

export async function notifyHostApplicationProgress(application: ApplicationLike, ex: Executor = db) {
  const labels = STAGE_LABELS[application.status];
  if (!labels) return;
  const [passed, next] = labels;
  await createNotification({
    user: await getUser(application.applicant_id, ex),
    notificationType: 'host_application_progress',
    title: 'Your Host Application Is Moving Forward',
    message: `Good news — your host application passed the ${passed} review and is now with ${next}. We'll email you at each step.`,
    data: { application_id: application.id, passed_stage: passed, next_stage: next, status: application.status },
  }, ex);
}

export async function notifyHostApplicationDeclined(application: ApplicationLike, ex: Executor = db) {
  await createNotification({
    user: await getUser(application.applicant_id, ex),
    notificationType: 'host_application_declined',
    title: 'Host Application Declined',
    message: `Unfortunately your application to become a host was not approved. Reason: ${application.decline_reason || 'No reason provided.'}`,
    data: { application_id: application.id, decline_reason: application.decline_reason, declined_stage: application.declined_stage },
  }, ex);
}

export async function notifyHostApplicationApproved(application: ApplicationLike, ex: Executor = db) {
  await createNotification({
    user: await getUser(application.applicant_id, ex),
    notificationType: 'host_application_approved',
    title: "You're Approved — Welcome, Host!",
    message: 'Congratulations! Your application has been approved and your account is now a host account. You can start listing your properties.',
    data: {
      application_id: application.id,
      attach_owner_agreement_application_id: application.agreement_document ? application.id : null,
    },
  }, ex);
}

export async function notifyAgentApplicationSubmitted(application: ApplicationLike, ex: Executor = db) {
  await notifyGroup(GROUP_PRODUCT_SUPPORT, 'agent_application_submitted', 'New Agent Application',
    `${application.full_name} applied to become a sourcing agent. Review the application to approve or decline it.`,
    applicationData(application), ex);
}

export async function notifyAgentApplicationAdvanced(application: ApplicationLike, ex: Executor = db) {
  const next = NEXT_GROUP[application.status];
  if (!next) return;
  await notifyGroup(next, 'agent_application_advanced', 'Agent Application Awaiting Review',
    `${application.full_name}'s agent application has advanced to your stage. Please review it to approve or decline.`,
    applicationData(application), ex);
}

export async function notifyAgentApplicationReceived(application: ApplicationLike, ex: Executor = db) {
  await createNotification({
    user: await getUser(application.applicant_id, ex),
    notificationType: 'agent_application_received',
    title: 'We Received Your Agent Application',
    message: "Thanks for applying to become a sourcing agent on Home Konet. Our team is reviewing your application — we'll email you at each step.",
    data: { application_id: application.id },
  }, ex);
}

export async function notifyAgentApplicationProgress(application: ApplicationLike, ex: Executor = db) {
  const labels = STAGE_LABELS[application.status];
  if (!labels) return;
  const [passed, next] = labels;
  await createNotification({
    user: await getUser(application.applicant_id, ex),
    notificationType: 'agent_application_progress',
    title: 'Your Agent Application Is Moving Forward',
    message: `Good news — your agent application passed the ${passed} review and is now with ${next}.`,
    data: { application_id: application.id, passed_stage: passed, next_stage: next },
  }, ex);
}

export async function notifyAgentApplicationDeclined(application: ApplicationLike, ex: Executor = db) {
  await createNotification({
    user: await getUser(application.applicant_id, ex),
    notificationType: 'agent_application_declined',
    title: 'Agent Application Declined',
    message: `Unfortunately your application to become a sourcing agent was not approved. Reason: ${application.decline_reason || 'No reason provided.'}`,
    data: { application_id: application.id, decline_reason: application.decline_reason, declined_stage: application.declined_stage },
  }, ex);
}

export async function notifyAgentApplicationApproved(application: ApplicationLike, ex: Executor = db) {
  await createNotification({
    user: await getUser(application.applicant_id, ex),
    notificationType: 'agent_application_approved',
    title: "You're Approved — Welcome, Agent!",
    message:
      'Congratulations! Your application has been approved. You can now source and ' +
      'list properties on behalf of owners and earn commission on their bookings.',
    data: { application_id: application.id },
  }, ex);
}

export interface CommissionLike { id: number; agent_id: number; booking_id: number; listing_id: number | null; amount: Num; currency: string; reference?: string }

export async function notifyAgentCommissionEarned(commission: CommissionLike, ex: Executor = db) {
  const listingTitle = commission.listing_id ? (await getListing(commission.listing_id, ex)).title : 'a property you sourced';
  await createNotification({
    user: await getUser(commission.agent_id, ex),
    notificationType: 'agent_commission_earned',
    title: 'You Earned a Commission',
    message:
      `You earned ${decStr(commission.amount)} ${commission.currency} commission from a booking on ` +
      `"${listingTitle}". It's pending and will be paid out shortly.`,
    data: { commission_id: commission.id, booking_id: commission.booking_id, amount: dec2(commission.amount), currency: commission.currency },
  }, ex);
}

export async function notifyAgentCommissionPaid(commission: CommissionLike, ex: Executor = db) {
  await createNotification({
    user: await getUser(commission.agent_id, ex),
    notificationType: 'agent_commission_paid',
    title: 'Your Commission Was Paid',
    message: `Your commission of ${decStr(commission.amount)} ${commission.currency} has been paid out. Thanks for sourcing with Home Konet!`,
    data: {
      commission_id: commission.id, booking_id: commission.booking_id, amount: dec2(commission.amount),
      currency: commission.currency, reference: commission.reference ?? '',
    },
  }, ex);
}

// ---- Property verification ---------------------------------------------------------------------

export interface VerificationLike {
  id: number; listing_id: number; applicant_id: number; ownership_type: string; status: string; review_notes: string; outcome_stage: string;
}

async function verificationData(v: VerificationLike, ex: Executor) {
  const listing = await getListing(v.listing_id, ex);
  const isAgent = v.ownership_type === 'agent';
  return {
    listing,
    data: {
      verification_id: v.id,
      listing_id: v.listing_id,
      listing_title: listing.title,
      ownership_type: v.ownership_type,
      status: v.status,
      dashboard_url: isAgent ? '/agent' : '/host',
      dashboard_label: isAgent ? 'Go to Agent Dashboard' : 'Go to Host Dashboard',
    } as Record<string, unknown>,
  };
}

export async function notifyPropertyVerificationSubmitted(v: VerificationLike, ex: Executor = db) {
  const { listing, data } = await verificationData(v, ex);
  await notifyGroup(GROUP_PRODUCT_SUPPORT, 'property_verification_submitted', 'New Property Verification',
    `"${listing.title}" was submitted for verification. Review the property details and documents to approve, reject, or request a correction.`,
    data, ex);
}

export async function notifyPropertyVerificationAdvanced(v: VerificationLike, ex: Executor = db) {
  const next = NEXT_GROUP[v.status];
  if (!next) return;
  const { listing, data } = await verificationData(v, ex);
  await notifyGroup(next, 'property_verification_advanced', 'Property Verification Awaiting Review',
    `The verification for "${listing.title}" has advanced to your stage. Please review it.`, data, ex);
}

export async function notifyPropertyVerificationReceived(v: VerificationLike, ex: Executor = db) {
  const { listing, data } = await verificationData(v, ex);
  await createNotification({
    user: await getUser(v.applicant_id, ex),
    notificationType: 'property_verification_received',
    title: 'Property Submitted for Verification',
    message:
      `Thanks — "${listing.title}" has been submitted for verification. ` +
      "Our team will review it and we'll email you at each step. It will be published once approved.",
    data,
  }, ex);
}

export async function notifyPropertyVerificationProgress(v: VerificationLike, ex: Executor = db) {
  const labels = ({
    ps_approved: ['Product Support', 'the Compliance team (site inspection)'],
    compliance_approved: ['Compliance', 'a Supervisor for final approval'],
  } as Record<string, [string, string]>)[v.status];
  if (!labels) return;
  const [passed, next] = labels;
  const { listing, data } = await verificationData(v, ex);
  await createNotification({
    user: await getUser(v.applicant_id, ex),
    notificationType: 'property_verification_progress',
    title: 'Your Property Verification Is Moving Forward',
    message: `"${listing.title}" passed the ${passed} review and is now with ${next}.`,
    data: { ...data, passed_stage: passed, next_stage: next },
  }, ex);
}

export async function notifyPropertyVerificationCorrection(v: VerificationLike, ex: Executor = db) {
  const { listing, data } = await verificationData(v, ex);
  await createNotification({
    user: await getUser(v.applicant_id, ex),
    notificationType: 'property_verification_correction',
    title: 'Correction Needed on Your Property Listing',
    message: `Your listing "${listing.title}" needs a correction before it can be published. ${v.review_notes || 'Please review and resubmit.'}`,
    data: { ...data, review_notes: v.review_notes, outcome_stage: v.outcome_stage },
  }, ex);
}

export async function notifyPropertyVerificationRejected(v: VerificationLike, ex: Executor = db) {
  const { listing, data } = await verificationData(v, ex);
  await createNotification({
    user: await getUser(v.applicant_id, ex),
    notificationType: 'property_verification_rejected',
    title: 'Property Verification Declined',
    message: `Your listing "${listing.title}" was not approved. Reason: ${v.review_notes || 'No reason provided.'}`,
    data: { ...data, review_notes: v.review_notes, outcome_stage: v.outcome_stage },
  }, ex);
}

export async function notifyPropertyVerificationPublished(v: VerificationLike, ex: Executor = db) {
  const { listing, data } = await verificationData(v, ex);
  await createNotification({
    user: await getUser(v.applicant_id, ex),
    notificationType: 'property_verification_published',
    title: 'Your Property Is Live!',
    message: `Great news — "${listing.title}" passed verification and is now published on Home Konet.`,
    data,
  }, ex);
}

// ---- Account security -------------------------------------------------------------------------

export async function notifyPhoneNumberChanged(user: Pick<UserLike, 'id' | 'email'>, oldNumber: string, newNumber: string, networkProvider: string, ex: Executor = db) {
  const networkLabel = networkProvider === 'mtn' ? 'MTN Mobile Money' : 'Orange Money';
  const mask = (n: string) => {
    const c = pyChars(n);
    return c.length >= 4 ? '*'.repeat(c.length - 4) + c.slice(-4).join('') : n;
  };
  const maskedOld = mask(oldNumber);
  const maskedNew = mask(newNumber);
  await createNotification({
    user,
    notificationType: 'phone_number_changed',
    title: `${networkLabel} Number Updated`,
    message:
      `Your ${networkLabel} wallet number has been changed from ${maskedOld} to ${maskedNew}. ` +
      'If you did not make this change, contact support immediately.',
    data: { network_provider: networkProvider, old_number_masked: maskedOld, new_number_masked: maskedNew },
  }, ex);
}

// ---- notifications.signals receivers ----------------------------------------------------------
// Django fires these from post_save; Express callers must call them where the
// Django code saves the model (pass the pre-save values Django stashed in pre_save).

/** post_save(users.User, created=True) → create_notification_preferences */
export async function onUserCreated(user: { id: number }, ex: Executor = db) {
  await getOrCreatePreferences(user.id, ex);
}

/** booking_post_save: created → requested (host) + submitted (guest); else status transitions. */
export async function bookingPostSave(booking: BookingLike & { status: string }, opts: { created: boolean; oldStatus?: string | null }, ex: Executor = db) {
  if (opts.created) {
    await notifyBookingRequested(booking, ex);
    await notifyBookingSubmitted(booking, ex);
    return;
  }
  const oldStatus = opts.oldStatus ?? null;
  if (oldStatus === booking.status) return;
  if (booking.status === 'confirmed') await notifyBookingConfirmed(booking, ex);
  else if (booking.status === 'declined') await notifyBookingDeclined(booking, ex);
  else if (booking.status === 'cancelled') await notifyBookingCancelled(booking, null, ex);
  else if (booking.status === 'completed') await notifyBookingCompleted(booking, ex);
}

/** payment_post_save: status change on a booking payment → received / failed / refunded (errors logged, never raised). */
export async function paymentPostSave(payment: PaymentLike & { status: string }, opts: { oldStatus?: string | null }, ex: Executor = db) {
  const oldStatus = opts.oldStatus ?? null;
  if (oldStatus === payment.status) return;
  if (!payment.booking_id) return;
  try {
    if (payment.status === 'completed') await notifyPaymentReceived(payment, ex);
    else if (payment.status === 'failed') await notifyPaymentFailed(payment, ex);
    else if (payment.status === 'refunded' || payment.status === 'partially_refunded') await notifyPaymentRefunded(payment, ex);
  } catch (err) {
    logger.warn({ err }, `payment_post_save: notification failed for payment ${payment.id}`);
  }
}

/** message_post_save: a newly created Message notifies the other participants. */
export async function messagePostSave(message: MessageLike, opts: { created: boolean }, ex: Executor = db) {
  if (opts.created) await notifyNewMessage(message, ex);
}

/** listing_post_save: price change → price_changed; is_available False→True → listing_available. */
export async function listingPostSave(
  listing: ListingLike & { is_available: boolean },
  opts: { created: boolean; oldPrice?: Num | null; oldIsAvailable?: boolean | null },
  ex: Executor = db,
) {
  if (opts.created) return;
  const oldPrice = opts.oldPrice ?? null;
  if (oldPrice !== null && Dec.from(oldPrice).cmp(listing.price) !== 0) await notifyPriceChanged(listing, oldPrice, ex);
  if (opts.oldIsAvailable === false && listing.is_available === true) await notifyListingAvailable(listing, ex);
}

/** report_post_save: a status change notifies the reporter (creation is handled by the view). */
export async function reportPostSave(report: ReportLike, opts: { created: boolean; oldStatus?: string | null }, ex: Executor = db) {
  if (opts.created) return;
  if ((opts.oldStatus ?? null) === report.status) return;
  await notifyReportUpdated(report, ex);
}
