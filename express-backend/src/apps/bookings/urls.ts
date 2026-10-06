// bookings — /api/bookings/ (port of bookings/views.py + urls.py).

import type { Request, Response } from 'express';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { db } from '../../db/index.js';
import { nowPg } from '../../lib/datetime.js';
import { logActivity, logTransaction } from '../../lib/activity.js';
import { HttpResponseError, NotFound, notFoundFor } from '../../lib/errors.js';
import { AllowAny, IsAuthenticated, negotiatedView, type ApiRequest, type User } from '../../lib/view.js';
import { djangoRouter } from '../../routes/registry.js';
import { hasAnyPermission, hasPermission, isFullAdmin } from '../../domain/rbac.js';
import { auditTarget, isSuperadminStaff, logAdminAction } from '../../domain/superadmin.js';
import { notifyReservationRequested, notifyViewingCancelled, notifyViewingScheduled } from '../../domain/notifications.js';
import {
  boolField, charField, choiceField, dateField, decimalField, dget, FieldInvalid, intListField, integerField, pkField,
  requestData, runFields, strictStrip, type Spec,
} from './drf.js';
import { computeListingPricing, getAvailableRoomCount, serializeListing, type ListingRow } from '../../domain/listings.js';
import { getViewingFeeStr as getViewingFee } from '../../domain/payments.js';
import { activeEscrowHold } from '../../domain/payments.js';
import {
  addDays, awareIsoformat, floatToDec2, fromIsoDate, fromIsoTime, icontains, lookupId, parseDatetime, pyDecimal,
  pyInt, pyIntOrNull, pyRepr, pyRound, pyStr, pyStrip, pyTruthy, todayUtc, weekday,
} from './py.js';
import {
  ACTIVE_STATUSES, adminConfirmPayment, atomic, ExtendError, extendReservation, hostConfirmReservation, HOST_CONFIRM_DAYS,
  insertBooking, nowPlusDays, processBookingDecline, releaseListingIfUnheld, reservePropertyFromViewing, saveBooking,
  STATUS_LABELS, type BookingRow, type Executor,
} from './services.js';
import {
  serializeBooking, serializeBookings, serializeComparison, serializeSavedSearch, serializeSearchAlert, serializeViewing,
} from './serializers.js';

const r = djangoRouter('api/bookings/');

const q1 = (req: Request, k: string): string | undefined => {
  const v = req.query[k];
  const x = Array.isArray(v) ? v[v.length - 1] : v;
  return typeof x === 'string' ? x : undefined;
};
const json = (res: Response, status: number, body: unknown) => { res.status(status).json(body); };
const userOf = (req: ApiRequest) => req.user as User;

async function bookingById(raw: string, ex: Executor = db): Promise<BookingRow | undefined> {
  const id = lookupId(raw);
  if (id === null) return undefined;
  return ex.selectFrom('bookings_booking').selectAll().where('id', '=', id).executeTakeFirst();
}
async function listingById(id: number, ex: Executor = db): Promise<ListingRow> {
  return ex.selectFrom('listings_listing').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
}

// ---- _check_superhost ----------------------------------------------------------------------------
async function checkSuperhost(ownerId: number): Promise<void> {
  try {
    const count = async (statuses: string[]) => Number((await db.selectFrom('bookings_booking as b').innerJoin('listings_listing as l', 'l.id', 'b.listing_id')
      .select((eb) => eb.fn.countAll<number>().as('n')).where('l.owner_id', '=', ownerId).where('b.status', 'in', statuses).executeTakeFirstOrThrow()).n);
    const total = await count(['confirmed', 'completed']);
    if (total < 10) return;
    const a = await db.selectFrom('listings_review as rv').innerJoin('listings_listing as l', 'l.id', 'rv.listing_id')
      .select((eb) => eb.fn.avg<string | null>('rv.rating').as('avg')).where('l.owner_id', '=', ownerId).executeTakeFirstOrThrow();
    const avg = a.avg === null ? 0 : Number(a.avg);
    const responded = await count(['confirmed', 'declined']);
    const totalRequests = await count(['requested', 'confirmed', 'declined', 'completed']);
    const rate = totalRequests > 0 ? (responded / totalRequests) * 100 : 0;
    const qualifies = avg >= 4.8 && rate >= 90;
    const profile = await db.selectFrom('users_profile').selectAll().where('user_id', '=', ownerId).executeTakeFirst();
    if (!profile) return;
    if (profile.is_superhost !== qualifies) await db.updateTable('users_profile').set({ is_superhost: qualifies }).where('id', '=', profile.id).execute();
  } catch { /* pass */ }
}

// ---- permission helpers ---------------------------------------------------------------------------
async function requireFinancePayouts(user: User): Promise<boolean> {
  if (isFullAdmin(user)) return true;
  return isSuperadminStaff(user) && (await hasAnyPermission(user, 'finances.payouts'));
}
async function requireReservationsData(user: User): Promise<boolean> {
  if (isFullAdmin(user)) return true;
  return isSuperadminStaff(user) && (await hasAnyPermission(user, 'reservations.transactional_data'));
}

// ===== bookings_collection ==========================================================================

const BOOKING_CREATE_SPEC = (): Spec => ({
  listing: pkField('listings_listing'),
  hotel_room: pkField('listings_hotelroom', { required: false, allowNull: true }),
  start_date: dateField(),
  end_date: dateField(),
  notes: charField({ required: false, allowBlank: true }),
  stripe_payment_intent_id: charField({
    required: false, allowBlank: true, allowNull: true, maxLength: 100,
    unique: { table: 'bookings_booking', column: 'stripe_payment_intent_id', message: 'booking with this stripe payment intent id already exists.' },
  }),
  payment_method: choiceField(['stripe', 'mtn_momo'], { required: false, default: 'mtn_momo' }),
});

async function createBooking(req: ApiRequest, res: Response) {
  const user = userOf(req);
  const rd = await requestData(req, res);
  const { errors, values } = await runFields(rd, BOOKING_CREATE_SPEC());
  if (errors) return json(res, 400, errors);
  const listingIn = values.listing as ListingRow;
  const start = values.start_date as string;
  const end = values.end_date as string;
  const room = (values.hotel_room ?? null) as { id: number; listing_id: number; total_count: number; price_per_night: string } | null;
  // BookingCreateSerializer.validate
  if (start >= end) return json(res, 400, { non_field_errors: ['End date must be after start date'] });
  if (start < todayUtc()) return json(res, 400, { non_field_errors: ['Start date cannot be in the past'] });
  if (!room) {
    const has = await db.selectFrom('listings_hotelroom').select('id').where('listing_id', '=', listingIn.id).where('is_active', '=', true).executeTakeFirst();
    if (has) return json(res, 400, { hotel_room: ['This property offers specific room types — please select one to book.'] });
  }

  const outcome = await db.transaction().execute(async (trx) => {
    const listing = await trx.selectFrom('listings_listing').selectAll().where('id', '=', listingIn.id).forUpdate().executeTakeFirstOrThrow();
    if (listing.owner_id === user.id) return { status: 400, body: { error: 'You cannot book your own listing.' } };
    const existing = await trx.selectFrom('bookings_booking').select('id')
      .where('customer_id', '=', user.id).where('listing_id', '=', listing.id).where('start_date', '=', start).where('end_date', '=', end)
      .where('status', 'in', ACTIVE_STATUSES).orderBy('requested_at', 'desc').executeTakeFirst();
    if (existing) {
      return { status: 400, body: { error: 'You already have an active reservation for this property on these dates', existing_booking_id: existing.id } };
    }
    if (room) {
      if (room.listing_id !== listing.id) return { status: 400, body: { error: 'Room does not belong to this listing' } };
      if ((await getAvailableRoomCount(room, start, end, trx)) < 1) return { status: 400, body: { error: 'Room not available for selected dates' } };
    } else {
      const conflict = await trx.selectFrom('bookings_booking').select('id').where('listing_id', '=', listing.id).where('status', '=', 'confirmed')
        .where('start_date', '<', end).where('end_date', '>', start).executeTakeFirst();
      if (conflict) return { status: 409, body: { error: 'This property is already booked for the selected dates' } };
    }
    const pricing = await computeListingPricing(listing, start, end, room, trx);
    const booking = await insertBooking({
      listing_id: listing.id, hotel_room_id: room ? room.id : null, customer_id: user.id, start_date: start, end_date: end,
      ...(values.notes !== undefined ? { notes: values.notes as string } : {}),
      status: 'pending_host',
      total_price: floatToDec2(pyRound(pricing.total, 2)),
      service_fee: floatToDec2(pyRound(pricing.service_fee, 2)),
      host_confirm_deadline: nowPlusDays(HOST_CONFIRM_DAYS),
    }, trx);
    return { booking, listing };
  });
  if ('body' in outcome) return json(res, outcome.status as number, outcome.body);
  const { booking, listing } = outcome;
  try { await notifyReservationRequested(booking); } catch { /* pass */ }
  logActivity(req, 'booking_created', { resource_type: 'booking', resource_id: booking.id, listing_id: listing.id, start_date: start, end_date: end, status: booking.status });
  return json(res, 201, await serializeBooking(booking));
}

r.path('', negotiatedView({
  permissions: [IsAuthenticated],
  async GET(req) {
    const user = userOf(req);
    let q = db.selectFrom('bookings_booking as b').selectAll('b');
    if (q1(req, 'role') === 'host') {
      q = q.innerJoin('listings_listing as l', 'l.id', 'b.listing_id').where('l.owner_id', '=', user.id);
      const st = q1(req, 'status');
      if (st) q = q.where('b.status', '=', st);
    } else q = q.where('b.customer_id', '=', user.id);
    return serializeBookings(await q.orderBy('b.requested_at', 'desc').execute());
  },
  async POST(req, res) {
    try {
      return await createBooking(req, res);
    } catch (e) {
      // except Exception as e: return Response({'error': str(e)}, 400)
      return json(res, 400, { error: e instanceof Error ? e.message : String(e) });
    }
  },
}));

// ===== booking_detail ===============================================================================
r.path('<int:id>/', negotiatedView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    const user = userOf(req);
    const b = await bookingById(req.params.id as string);
    if (!b) return json(res, 404, { error: 'Booking not found' });
    const listing = await listingById(b.listing_id);
    if (!(b.customer_id === user.id || listing.owner_id === user.id || user.is_staff || user.is_superuser)) return json(res, 404, { error: 'Booking not found' });
    return serializeBooking(b);
  },
  async DELETE(req, res) {
    const user = userOf(req);
    const b = await bookingById(req.params.id as string);
    if (!b) return json(res, 404, { error: 'Booking not found' });
    const listing = await listingById(b.listing_id);
    if (!(b.customer_id === user.id || listing.owner_id === user.id || user.is_staff || user.is_superuser)) return json(res, 404, { error: 'Booking not found' });
    if (b.status === 'cancelled') return serializeBooking(b);
    if (b.status === 'declined' || b.status === 'completed') {
      return json(res, 400, { error: `A ${STATUS_LABELS[b.status]!.toLowerCase()} booking cannot be cancelled.` });
    }
    const wasHolding = ['awaiting_payment', 'payment_received', 'confirmed'].includes(b.status);
    await saveBooking(b, { status: 'cancelled', cancelled_at: nowPg() });
    if (wasHolding) await releaseListingIfUnheld(listing, b.id);
    return serializeBooking(b);
  },
}));

// ===== pending_bookings =============================================================================
r.path('pending/', negotiatedView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    const user = userOf(req);
    if (!['agent', 'admin', 'superadmin'].includes(user.role)) return json(res, 403, { error: 'Permission Denied' });
    const rows = await db.selectFrom('bookings_booking as b').innerJoin('listings_listing as l', 'l.id', 'b.listing_id').selectAll('b')
      .where('l.owner_id', '=', user.id).where('b.status', 'in', ['pending_host', 'requested', 'pending']).orderBy('b.requested_at', 'desc').execute();
    return serializeBookings(rows);
  },
}));

const HOST_ACTIONABLE = ['pending_host', 'requested', 'pending'];
const HOST_DECLINABLE = [...HOST_ACTIONABLE, 'awaiting_payment'];

// ===== confirm_booking ==============================================================================
r.path('<int:id>/confirm/', negotiatedView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    const user = userOf(req);
    const b = await bookingById(req.params.id as string);
    if (!b) return json(res, 404, { error: 'Booking not found' });
    const listing = await listingById(b.listing_id);
    if (listing.owner_id !== user.id) return json(res, 403, { error: 'Permission Denied' });
    if (!HOST_ACTIONABLE.includes(b.status)) return json(res, 400, { error: 'Booking cannot be confirmed' });
    await hostConfirmReservation(b, listing);
    await checkSuperhost(listing.owner_id);
    logActivity(req, 'booking_confirmed', { resource_type: 'booking', resource_id: b.id, listing_id: b.listing_id, customer_id: b.customer_id });
    return serializeBooking(b);
  },
}));

// ===== decline_booking ==============================================================================
const CONFIRMATION_SPEC = (): Spec => ({
  status: choiceField(Object.keys(STATUS_LABELS), { required: false }),
  owner_notes: charField({ required: false, allowBlank: true }),
  decline_reason: charField({ required: false, allowBlank: true }),
});

r.path('<int:id>/decline/', negotiatedView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    const user = userOf(req);
    const b = await bookingById(req.params.id as string);
    if (!b) return json(res, 404, { error: 'Booking not found' });
    const listing = await listingById(b.listing_id);
    if (listing.owner_id !== user.id) return json(res, 403, { error: 'Permission denied' });
    if (!HOST_DECLINABLE.includes(b.status)) {
      if (b.status === 'payment_received' || b.status === 'confirmed') {
        return json(res, 400, { error: 'This reservation has already been paid for and can no longer be declined directly — contact support to cancel and refund it.' });
      }
      return json(res, 400, { error: 'Booking cannot be declined' });
    }
    const { errors, values } = await runFields(await requestData(req, res), CONFIRMATION_SPEC());
    if (errors) return json(res, 400, errors);
    const reason = (values.decline_reason ?? '') as string;
    await processBookingDecline(b, reason, (values.owner_notes ?? '') as string, listing);
    logActivity(req, 'booking_declined', { resource_type: 'booking', resource_id: b.id, listing_id: b.listing_id, customer_id: b.customer_id, reason });
    return serializeBooking(b);
  },
}));

// ===== admin_confirm_payment ========================================================================
r.path('<int:id>/confirm-payment/', negotiatedView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    if (!(await requireFinancePayouts(userOf(req)))) return json(res, 403, { error: 'Permission Denied' });
    const b = await bookingById(req.params.id as string);
    if (!b) return json(res, 404, { error: 'Booking not found' });
    if (b.status !== 'payment_received') {
      return json(res, 400, { error: `Only a booking with a received payment can be confirmed (current: ${b.status}).` });
    }
    const hold = await activeEscrowHold(b.id);
    if (hold) {
      return json(res, 400, { error: `This booking's funds are on hold ("${hold.reason}") and cannot be confirmed until the hold is released.` });
    }
    await adminConfirmPayment(b, userOf(req));
    return serializeBooking(b);
  },
}));

// ===== admin_payment_received_bookings ==============================================================
r.path('admin/payment-received/', negotiatedView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    if (!(await requireFinancePayouts(userOf(req)))) return json(res, 403, { error: 'Permission Denied' });
    return serializeBookings(await db.selectFrom('bookings_booking').selectAll().where('status', '=', 'payment_received').orderBy('requested_at').execute());
  },
}));

// ===== admin_bookings_list ==========================================================================
r.path('admin/list/', negotiatedView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    if (!(await requireReservationsData(userOf(req)))) return json(res, 403, { error: 'Permission Denied' });
    let q = db.selectFrom('bookings_booking as b').innerJoin('listings_listing as l', 'l.id', 'b.listing_id')
      .innerJoin('users_user as u', 'u.id', 'b.customer_id');
    const st = q1(req, 'status');
    if (st) q = q.where('b.status', '=', st);
    const search = pyStrip(q1(req, 'search') ?? '');
    if (search) q = q.where((eb) => eb.or([icontains('u.username', search), icontains('u.email', search), icontains('l.title', search)]));
    const rawLimit = q1(req, 'limit');
    const rawOffset = q1(req, 'offset');
    const li = rawLimit === undefined ? 25 : pyIntOrNull(rawLimit);
    const oi = rawOffset === undefined ? 0 : pyIntOrNull(rawOffset);
    let limit = 25, offset = 0;
    if (li !== null && oi !== null) { limit = Math.max(1, Math.min(li, 100)); offset = Math.max(0, oi); }
    const total = Number((await q.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow()).n);
    const rows = await q.selectAll('b').orderBy('b.requested_at', 'desc').limit(limit).offset(offset).execute();
    return { count: total, limit, offset, results: await serializeBookings(rows) };
  },
}));

// ===== request_payment (legacy flow) ================================================================
r.path('<int:id>/request-payment/', negotiatedView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    const user = userOf(req);
    const b = await bookingById(req.params.id as string);
    if (!b) return json(res, 404, { error: 'Booking not found' });
    const listing = await listingById(b.listing_id);
    if (listing.owner_id !== user.id) return json(res, 403, { error: 'Permission denied' });
    if (b.status !== 'requested') return json(res, 400, { error: `Cannot send payment request for a booking in "${b.status}" status.` });
    if (await db.selectFrom('bookings_paymentrequest').select('id').where('booking_id', '=', b.id).executeTakeFirst()) {
      return json(res, 400, { error: 'A payment request has already been sent for this booking.' });
    }
    const data = (await requestData(req, res)).data;
    const amount = dget(data, 'amount');
    const notes = dget(data, 'notes', '');
    if (!pyTruthy(amount)) return json(res, 400, { error: 'amount is required' });
    const d = pyDecimal(pyStr(amount));
    // Decimal(str(amount)); NaN comparisons raise InvalidOperation; <= 0 → ValueError
    if (!d || d.kind === 'nan' || (d.kind === 'inf' && d.neg) || (d.kind === 'num' && (d.neg || d.zero))) {
      return json(res, 400, { error: 'amount must be a positive number' });
    }
    if (d.kind === 'inf') throw new Error('[<class \'decimal.InvalidOperation\'>]'); // DecimalField rejects non-finite → 500
    await atomic(db, async (trx) => {
      if (notes === null) throw new Error('null value in column "notes" violates not-null constraint');
      await trx.insertInto('bookings_paymentrequest').values({
        booking_id: b.id, amount: d.text, currency: 'USD', notes: pyStr(notes), created_by_id: user.id, created_at: nowPg(),
        is_paid: false, paid_at: null, stripe_payment_intent_id: null,
      }).execute();
      await saveBooking(b, { status: 'payment_requested' }, trx);
    });
    logTransaction('payment_request_sent', { user_id: user.id, booking_id: b.id, amount: d.text, gateway: 'platform' });
    return serializeBooking(b);
  },
}));

// ===== my_payment_requests ==========================================================================
r.path('payment-requests/', negotiatedView({
  permissions: [IsAuthenticated],
  async GET(req) {
    const rows = await db.selectFrom('bookings_paymentrequest as pr')
      .innerJoin('bookings_booking as b', 'b.id', 'pr.booking_id').innerJoin('listings_listing as l', 'l.id', 'b.listing_id')
      .innerJoin('users_user as u', 'u.id', 'pr.created_by_id')
      .select(['pr.id', 'pr.booking_id', 'l.title', 'pr.amount', 'pr.currency', 'pr.notes', 'pr.created_at', 'u.first_name', 'u.last_name', 'u.username'])
      .where('b.customer_id', '=', userOf(req).id).where('pr.is_paid', '=', false).orderBy('pr.created_at', 'desc').execute();
    const { isoformat } = await import('../../lib/datetime.js');
    return rows.map((p) => ({
      id: p.id, booking_id: p.booking_id, listing_title: p.title, amount: p.amount, currency: p.currency, notes: p.notes,
      created_at: isoformat(p.created_at), owner_name: pyStrip(`${p.first_name} ${p.last_name}`) || p.username,
    }));
  },
}));

// ===== saved searches ===============================================================================
const SAVED_SEARCH_SPEC = (): Spec => ({
  name: charField({ maxLength: 100 }),
  min_price: decimalField(12, 2, { required: false, allowNull: true }),
  max_price: decimalField(12, 2, { required: false, allowNull: true }),
  property_type: charField({ maxLength: 50, required: false, allowNull: true, allowBlank: true }),
  min_bedrooms: integerField({ required: false, allowNull: true }),
  max_bedrooms: integerField({ required: false, allowNull: true }),
  min_square_footage: integerField({ required: false, allowNull: true }),
  max_square_footage: integerField({ required: false, allowNull: true }),
  address: charField({ maxLength: 200, required: false, allowBlank: true }),
  keywords: charField({ maxLength: 200, required: false, allowBlank: true }),
  is_available: boolField({ required: false }),
  email_frequency: choiceField(['instantly', 'daily', 'weekly'], { required: false }),
});

/** SavedSearchCreateSerializer.validate */
function savedSearchValidate(v: Record<string, unknown>): string | null {
  const nz = (x: unknown) => x !== null && x !== undefined && Number(x) !== 0;
  if (nz(v.min_price) && nz(v.max_price) && Number(v.min_price) >= Number(v.max_price)) {
    // Decimal comparison (2-place quantized strings compare exactly as numbers here)
    return 'Min price must be less than max price';
  }
  if (nz(v.min_bedrooms) && nz(v.max_bedrooms) && (v.min_bedrooms as number) >= (v.max_bedrooms as number)) return 'Min bedrooms must be less than max bedrooms';
  if (nz(v.min_square_footage) && nz(v.max_square_footage) && (v.min_square_footage as number) >= (v.max_square_footage as number)) {
    return 'Min square footage must be less than max square footage';
  }
  return null;
}

r.path('searches/', negotiatedView({
  permissions: [IsAuthenticated],
  async GET(req) {
    const rows = await db.selectFrom('bookings_savedsearch').selectAll().where('user_id', '=', userOf(req).id).where('is_active', '=', true)
      .orderBy('created_at', 'desc').execute();
    const out = [];
    for (const s of rows) out.push(await serializeSavedSearch(s));
    return out;
  },
  async POST(req, res) {
    const { errors, values } = await runFields(await requestData(req, res), SAVED_SEARCH_SPEC());
    if (errors) return json(res, 400, errors);
    const err = savedSearchValidate(values);
    if (err) return json(res, 400, { non_field_errors: [err] });
    const now = nowPg();
    const row = await db.insertInto('bookings_savedsearch').values({
      user_id: userOf(req).id, name: values.name as string, min_price: null, max_price: null, property_type: null,
      min_bedrooms: null, max_bedrooms: null, min_square_footage: null, max_square_footage: null, address: '', keywords: '',
      is_available: true, email_frequency: 'daily', is_active: true, created_at: now, updated_at: now,
      ...(values as object),
    }).returningAll().executeTakeFirstOrThrow();
    return json(res, 201, await serializeSavedSearch(row));
  },
}));

r.path('searches/<int:id>/', negotiatedView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    const s = await savedSearchFor(req);
    if (!s) return json(res, 404, { error: 'Saved search not found' });
    return serializeSavedSearch(s);
  },
  async PUT(req, res) {
    const s = await savedSearchFor(req);
    if (!s) return json(res, 404, { error: 'Saved search not found' });
    const { errors, values } = await runFields(await requestData(req, res), SAVED_SEARCH_SPEC(), { partial: true });
    if (errors) return json(res, 400, errors);
    const err = savedSearchValidate(values);
    if (err) return json(res, 400, { non_field_errors: [err] });
    const row = await db.updateTable('bookings_savedsearch').set({ ...(values as object), updated_at: nowPg() }).where('id', '=', s.id)
      .returningAll().executeTakeFirstOrThrow();
    return serializeSavedSearch(row);
  },
  async DELETE(req, res) {
    const s = await savedSearchFor(req);
    if (!s) return json(res, 404, { error: 'Saved search not found' });
    await db.transaction().execute(async (trx) => {
      await trx.deleteFrom('bookings_searchalert').where('saved_search_id', '=', s.id).execute();
      await trx.deleteFrom('bookings_savedsearch').where('id', '=', s.id).execute();
    });
    res.status(204).end();
  },
}));

async function savedSearchFor(req: ApiRequest) {
  const id = lookupId(req.params.id);
  if (id === null) return undefined;
  return db.selectFrom('bookings_savedsearch').selectAll().where('id', '=', id).where('user_id', '=', userOf(req).id).executeTakeFirst();
}

r.path('searches/alerts/', negotiatedView({
  permissions: [IsAuthenticated],
  async GET(req) {
    const rows = await db.selectFrom('bookings_searchalert as a').innerJoin('bookings_savedsearch as s', 's.id', 'a.saved_search_id')
      .selectAll('a').where('s.user_id', '=', userOf(req).id).orderBy('a.sent_at', 'desc').execute();
    const out = [];
    for (const a of rows) out.push(await serializeSearchAlert(a, req));
    return out;
  },
}));

// ===== test_search ==================================================================================

/** DecimalField.to_python for a lookup value (ValidationError → 500). */
function decimalLookup(v: unknown): string {
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Error('“inf” value must be a decimal number.'); return String(v); }
  if (typeof v !== 'string') throw new Error(`“${pyStr(v)}” value must be a decimal number.`);
  const d = pyDecimal(v);
  if (!d || d.kind !== 'num') throw new Error(`“${v}” value must be a decimal number.`);
  return d.text;
}
/** BooleanField.to_python (ValidationError → 500). */
function boolLookup(v: unknown): boolean {
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  if (typeof v === 'string') {
    if (['t', 'True', '1'].includes(v)) return true;
    if (['f', 'False', '0'].includes(v)) return false;
  }
  throw new Error(`“${pyStr(v)}” value must be either True or False.`);
}

r.path('searches/test/', negotiatedView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    const data = (await requestData(req, res)).data;
    let q = db.selectFrom('listings_listing').selectAll();
    const g = (k: string) => dget(data, k);
    if (pyTruthy(g('min_price'))) q = q.where(sql<boolean>`price >= ${decimalLookup(g('min_price'))}::numeric`);
    if (pyTruthy(g('max_price'))) q = q.where(sql<boolean>`price <= ${decimalLookup(g('max_price'))}::numeric`);
    if (pyTruthy(g('property_type'))) q = q.where('property_type', '=', pyStr(g('property_type')));
    if (pyTruthy(g('min_bedrooms'))) q = q.where(sql<boolean>`bedrooms >= ${pyInt(g('min_bedrooms'), 'bedrooms').toString()}::numeric`);
    if (pyTruthy(g('max_bedrooms'))) q = q.where(sql<boolean>`bedrooms <= ${pyInt(g('max_bedrooms'), 'bedrooms').toString()}::numeric`);
    if (pyTruthy(g('address'))) q = q.where(icontains('address', pyStr(g('address'))));
    if (pyTruthy(g('keywords'))) {
      const kw = pyStr(g('keywords'));
      q = q.where((eb) => eb.or([icontains('title', kw), icontains('description', kw)]));
    }
    if (g('is_available') !== null) q = q.where('is_available', '=', boolLookup(g('is_available')));
    const out = [];
    for (const l of await q.execute()) out.push(await serializeListing(l, req));
    return out;
  },
}));

// ===== comparisons ==================================================================================
const COMPARISON_SPEC = (): Spec => {
  const ids = intListField();
  ids.validators = [(v) => {
    const n = (v as number[]).length;
    if (n < 2) throw new FieldInvalid(['At least two properties required for comparison']);
    if (n > 4) throw new FieldInvalid(['Maximum 4 properties allowed for comparison']);
  }];
  return { listing_ids: ids, name: charField({ maxLength: 100 }), is_public: boolField({ required: false, default: false }) };
};

async function createItems(comparisonId: number, ids: number[]) {
  for (const [order, lid] of ids.entries()) {
    if (lid > 9223372036854775807 || lid < -9223372036854775808) continue;
    const l = await db.selectFrom('listings_listing').select('id').where('id', '=', lid).executeTakeFirst();
    if (!l) continue;
    // IntegrityError on a duplicate id propagates (→ 500) like Django; earlier rows stay (autocommit).
    await db.insertInto('bookings_comparisonitem').values({ comparison_id: comparisonId, listing_id: l.id, order, notes: '' }).execute();
  }
}

r.path('comparisons/', negotiatedView({
  permissions: [IsAuthenticated],
  async GET(req) {
    const rows = await db.selectFrom('bookings_propertycomparison').selectAll().where('user_id', '=', userOf(req).id).orderBy('updated_at', 'desc').execute();
    const out = [];
    for (const c of rows) out.push(await serializeComparison(c, req));
    return out;
  },
  async POST(req, res) {
    const { errors, values } = await runFields(await requestData(req, res), COMPARISON_SPEC());
    if (errors) return json(res, 400, errors);
    const now = nowPg();
    const c = await db.insertInto('bookings_propertycomparison').values({
      user_id: userOf(req).id, name: values.name as string, is_public: values.is_public as boolean,
      share_token: values.is_public ? randomUUID().replace(/-/g, '') : null, created_at: now, updated_at: now,
    }).returningAll().executeTakeFirstOrThrow();
    await createItems(c.id, values.listing_ids as number[]);
    return json(res, 201, await serializeComparison(c, req));
  },
}));

async function comparisonFor(req: ApiRequest, raw: unknown) {
  const id = lookupId(raw);
  if (id === null) return undefined;
  return db.selectFrom('bookings_propertycomparison').selectAll().where('id', '=', id).where('user_id', '=', userOf(req).id).executeTakeFirst();
}

r.path('comparisons/<int:id>/', negotiatedView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    const c = await comparisonFor(req, req.params.id);
    if (!c) return json(res, 404, { error: 'Comparison not found' });
    return serializeComparison(c, req);
  },
  async PUT(req, res) {
    const c = await comparisonFor(req, req.params.id);
    if (!c) return json(res, 404, { error: 'Comparison not found' });
    const { errors, values } = await runFields(await requestData(req, res), COMPARISON_SPEC(), { partial: true });
    if (errors) return json(res, 400, errors);
    if ('listing_ids' in values) {
      await db.deleteFrom('bookings_comparisonitem').where('comparison_id', '=', c.id).execute();
      await createItems(c.id, values.listing_ids as number[]);
    }
    const name = 'name' in values ? (values.name as string) : c.name;
    const isPublic = 'is_public' in values ? (values.is_public as boolean) : c.is_public;
    const saved = await db.updateTable('bookings_propertycomparison').set({
      name, is_public: isPublic, share_token: isPublic && !c.share_token ? randomUUID().replace(/-/g, '') : c.share_token, updated_at: nowPg(),
    }).where('id', '=', c.id).returningAll().executeTakeFirstOrThrow();
    return serializeComparison(saved, req);
  },
  async DELETE(req, res) {
    const c = await comparisonFor(req, req.params.id);
    if (!c) return json(res, 404, { error: 'Comparison not found' });
    await db.transaction().execute(async (trx) => {
      await trx.deleteFrom('bookings_comparisonitem').where('comparison_id', '=', c.id).execute();
      await trx.deleteFrom('bookings_propertycomparison').where('id', '=', c.id).execute();
    });
    res.status(204).end();
  },
}));

r.path('comparisons/shared/<str:token>/', negotiatedView({
  permissions: [AllowAny],
  async GET(req, res) {
    const c = await db.selectFrom('bookings_propertycomparison').selectAll().where('share_token', '=', String(req.params.token)).where('is_public', '=', true).executeTakeFirst();
    if (!c) return json(res, 404, { error: 'Shared comparison not found or expired' });
    return serializeComparison(c, req);
  },
}));

/** Model.objects.get(pk=value, ...) lookup id: None → no match; garbage → 500 (ValueError/TypeError aren't caught). */
function getPk(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  return lookupId(v);
}

r.path('comparisons/add/', negotiatedView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    const data = (await requestData(req, res)).data;
    const cid = getPk(dget(data, 'comparison_id'));
    const lidRaw = dget(data, 'listing_id');
    const c = cid === null ? undefined : await db.selectFrom('bookings_propertycomparison').selectAll().where('id', '=', cid).where('user_id', '=', userOf(req).id).executeTakeFirst();
    if (!c) return json(res, 404, { error: 'Comparison or property not found' });
    const lid = getPk(lidRaw);
    const l = lid === null ? undefined : await db.selectFrom('listings_listing').select('id').where('id', '=', lid).executeTakeFirst();
    if (!l) return json(res, 404, { error: 'Comparison or property not found' });
    if (await db.selectFrom('bookings_comparisonitem').select('id').where('comparison_id', '=', c.id).where('listing_id', '=', l.id).executeTakeFirst()) {
      return json(res, 400, { error: 'Property already in comparison' });
    }
    const n = Number((await db.selectFrom('bookings_comparisonitem').select((eb) => eb.fn.countAll<number>().as('n')).where('comparison_id', '=', c.id).executeTakeFirstOrThrow()).n);
    await db.insertInto('bookings_comparisonitem').values({ comparison_id: c.id, listing_id: l.id, order: n, notes: '' }).execute();
    return serializeComparison(c, req);
  },
}));

r.path('comparisons/remove/', negotiatedView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    const data = (await requestData(req, res)).data;
    const notFound = () => json(res, 404, { error: 'Comparison, property or item not found' });
    const cid = getPk(dget(data, 'comparison_id'));
    const lidRaw = dget(data, 'listing_id');
    const c = cid === null ? undefined : await db.selectFrom('bookings_propertycomparison').selectAll().where('id', '=', cid).where('user_id', '=', userOf(req).id).executeTakeFirst();
    if (!c) return notFound();
    const lid = getPk(lidRaw);
    const l = lid === null ? undefined : await db.selectFrom('listings_listing').select('id').where('id', '=', lid).executeTakeFirst();
    if (!l) return notFound();
    const item = await db.selectFrom('bookings_comparisonitem').select('id').where('comparison_id', '=', c.id).where('listing_id', '=', l.id).executeTakeFirst();
    if (!item) return notFound();
    await db.deleteFrom('bookings_comparisonitem').where('id', '=', item.id).execute();
    const rest = await db.selectFrom('bookings_comparisonitem').select('id').where('comparison_id', '=', c.id).orderBy('order').execute();
    for (const [i, it] of rest.entries()) await db.updateTable('bookings_comparisonitem').set({ order: i }).where('id', '=', it.id).execute();
    return serializeComparison(c, req);
  },
}));

// ===== viewings (Path C) ============================================================================
const SATURDAY = 5;
const START_TIMES = ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00'];
const VIEWING_ACTIVE = ['requested', 'fee_paid', 'scheduled', 'completed', 'reserved'];

function nextSaturdays(after: string, count: number, exclude: Set<string>): string[] {
  let ahead = (SATURDAY - weekday(after) + 7) % 7;
  if (ahead === 0) ahead = 7;
  let sat = addDays(after, ahead);
  const out: string[] = [];
  while (out.length < count) {
    if (!exclude.has(sat)) out.push(sat);
    sat = addDays(sat, 7);
  }
  return out;
}

r.path('viewings/', negotiatedView({
  permissions: [IsAuthenticated],
  async GET(req) {
    const rows = await db.selectFrom('bookings_viewingappointment').selectAll().where('guest_id', '=', userOf(req).id).orderBy('created_at', 'desc').execute();
    const out = [];
    for (const v of rows) out.push(await serializeViewing(v));
    return out;
  },
  async POST(req, res) {
    const user = userOf(req);
    const data = (await requestData(req, res)).data;
    const listingId = dget(data, 'listing');
    const dateStr = dget(data, 'viewing_date');
    if (!pyTruthy(listingId) || !pyTruthy(dateStr)) return json(res, 400, { error: 'listing and viewing_date are required' });
    const lid = lookupId(listingId);
    const listing = lid === null ? undefined : await db.selectFrom('listings_listing').selectAll().where('id', '=', lid).executeTakeFirst();
    if (!listing) throw notFoundFor('Listing');
    if (listing.owner_id === user.id) return json(res, 400, { error: 'You cannot request a viewing of your own listing.' });
    let viewingDate: string;
    try { viewingDate = fromIsoDate(dateStr); } catch (e) {
      if (e instanceof TypeError) throw e;
      return json(res, 400, { error: 'Invalid viewing_date. Use YYYY-MM-DD' });
    }
    if (weekday(viewingDate) !== SATURDAY) return json(res, 400, { error: 'Viewings are only available on Saturdays' });
    if (viewingDate <= todayUtc()) return json(res, 400, { error: 'Viewing date must be in the future' });
    const rawTime = dget(data, 'viewing_time');
    const timeStr = Array.from(strictStrip(pyTruthy(rawTime) ? rawTime : '')).slice(0, 5).join('');
    if (!START_TIMES.includes(timeStr)) return json(res, 400, { error: 'Please choose a viewing time between 10:00 AM and 3:00 PM.' });
    const viewingTime = fromIsoTime(timeStr);
    const guestNotes = dget(data, 'guest_notes', '');
    let viewing;
    try {
      viewing = await db.transaction().execute(async (trx) => {
        const taken = await trx.selectFrom('bookings_viewingappointment').select('id').where('listing_id', '=', listing.id)
          .where('viewing_date', '=', viewingDate).where('status', 'in', VIEWING_ACTIVE).forUpdate().executeTakeFirst();
        if (taken) return null;
        const now = nowPg();
        return trx.insertInto('bookings_viewingappointment').values({
          listing_id: listing.id, guest_id: user.id, viewing_date: viewingDate, viewing_time: viewingTime, status: 'requested',
          viewing_fee: await getViewingFee(trx), is_fee_paid: false, fee_paid_at: null, stripe_payment_intent_id: null,
          scheduled_at: null, confirmed_by_id: null, admin_notes: '',
          guest_notes: guestNotes === null ? (null as unknown as string) : pyStr(guestNotes),
          booking_id: null, created_at: now, updated_at: now,
        }).returningAll().executeTakeFirstOrThrow();
      });
    } catch (e) {
      return json(res, 400, { error: e instanceof Error ? e.message : String(e) });
    }
    if (viewing === null) return json(res, 409, { error: 'That Saturday is already booked for this property. Please choose another.' });
    return json(res, 201, await serializeViewing(viewing));
  },
}));

r.path('viewings/slots/<int:listing_id>/', negotiatedView({
  permissions: [IsAuthenticated],
  async GET(req) {
    const lid = lookupId(req.params.listing_id);
    const listing = lid === null ? undefined : await db.selectFrom('listings_listing').select('id').where('id', '=', lid).executeTakeFirst();
    if (!listing) throw notFoundFor('Listing');
    const taken = await db.selectFrom('bookings_viewingappointment').select('viewing_date').where('listing_id', '=', listing.id)
      .where('status', 'in', VIEWING_ACTIVE).execute();
    const slots = nextSaturdays(todayUtc(), 8, new Set(taken.map((t) => String(t.viewing_date).slice(0, 10))));
    return { listing: listing.id, available_saturdays: slots };
  },
}));

r.path('viewings/admin/', negotiatedView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    if (!(await requireReservationsData(userOf(req)))) return json(res, 403, { error: 'Permission Denied' });
    let q = db.selectFrom('bookings_viewingappointment').selectAll();
    const st = q1(req, 'status');
    if (st) q = q.where('status', '=', st);
    const out = [];
    for (const v of await q.orderBy('created_at', 'desc').execute()) out.push(await serializeViewing(v));
    return out;
  },
}));

const VIEWING_TRANSITIONS: Record<string, string[]> = {
  requested: ['cancelled'], fee_paid: ['scheduled', 'cancelled'], scheduled: ['completed', 'cancelled'],
};

r.path('viewings/admin/<int:id>/status/', negotiatedView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    const user = userOf(req);
    if (!(await requireReservationsData(user))) return json(res, 403, { error: 'Permission Denied' });
    const id = lookupId(req.params.id);
    const viewing = id === null ? undefined : await db.selectFrom('bookings_viewingappointment').selectAll().where('id', '=', id).executeTakeFirst();
    if (!viewing) return json(res, 404, { error: 'Viewing not found' });
    const data = (await requestData(req, res)).data;
    const newStatus = dget(data, 'status');
    const notes = dget(data, 'admin_notes', '');
    const oldStatus = viewing.status;
    const allowed = VIEWING_TRANSITIONS[oldStatus] ?? [];
    if (newStatus !== null && typeof newStatus === 'object') throw new TypeError(`unhashable type: '${Array.isArray(newStatus) ? 'list' : 'dict'}'`);
    if (typeof newStatus !== 'string' || !allowed.includes(newStatus)) {
      return json(res, 400, { error: `Cannot move a viewing from "${oldStatus}" to "${pyStr(newStatus)}".` });
    }
    const changes: Record<string, unknown> = { status: newStatus };
    if (pyTruthy(notes)) changes.admin_notes = pyStr(notes);
    if (newStatus === 'scheduled') { changes.scheduled_at = nowPg(); changes.confirmed_by_id = user.id; }
    // update_fields excludes updated_at (auto_now not refreshed)
    const saved = await db.updateTable('bookings_viewingappointment').set(changes).where('id', '=', viewing.id).returningAll().executeTakeFirstOrThrow();
    try {
      if (newStatus === 'scheduled') await notifyViewingScheduled(saved);
      else if (newStatus === 'cancelled') await notifyViewingCancelled(saved, pyStr(notes));
    } catch { /* pass */ }
    const guest = await db.selectFrom('users_user').select('username').where('id', '=', saved.guest_id).executeTakeFirstOrThrow();
    const listing = await listingById(saved.listing_id);
    await logAdminAction(req, 'viewing.update_status', {
      target: auditTarget('ViewingAppointment', saved.id, `Viewing: ${guest.username} @ ${listing.title} on ${String(saved.viewing_date).slice(0, 10)} (${saved.status})`),
      reason: `${oldStatus} -> ${newStatus}`,
    });
    return serializeViewing(saved);
  },
}));

r.path('viewings/<int:viewing_id>/reserve/', negotiatedView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    const user = userOf(req);
    const id = lookupId(req.params.viewing_id);
    const viewing = id === null ? undefined : await db.selectFrom('bookings_viewingappointment').selectAll().where('id', '=', id).where('guest_id', '=', user.id).executeTakeFirst();
    if (!viewing) return json(res, 404, { error: 'Viewing not found' });
    const listing = await listingById(viewing.listing_id);
    if (listing.owner_id === user.id) return json(res, 400, { error: 'You cannot reserve your own listing.' });
    if (viewing.status !== 'completed') return json(res, 400, { error: 'You can only reserve after the viewing has been completed.' });
    if (viewing.booking_id) return json(res, 400, { error: 'You have already reserved this property.' });
    const data = (await requestData(req, res)).data;
    const s = dget(data, 'start_date');
    const e = dget(data, 'end_date');
    if (!pyTruthy(s) || !pyTruthy(e)) return json(res, 400, { error: 'start_date and end_date are required' });
    let start: string, end: string;
    try { start = fromIsoDate(s); end = fromIsoDate(e); } catch (err) {
      if (err instanceof TypeError) throw err;
      return json(res, 400, { error: 'Invalid date format. Use YYYY-MM-DD' });
    }
    if (start >= end) return json(res, 400, { error: 'End date must be after start date' });
    const dup = await db.selectFrom('bookings_booking').select('id').where('customer_id', '=', user.id).where('listing_id', '=', listing.id)
      .where('start_date', '=', start).where('end_date', '=', end)
      .where('status', 'in', ['pending_host', 'awaiting_payment', 'payment_received', 'confirmed']).executeTakeFirst();
    if (dup) return json(res, 400, { error: 'You already have an active booking for these dates.' });
    const pricing = await computeListingPricing(listing, start, end);
    const booking = await reservePropertyFromViewing(
      viewing, start, end, floatToDec2(pyRound(pricing.total, 2)), floatToDec2(pyRound(pricing.service_fee, 2)), listing,
    );
    return json(res, 201, await serializeBooking(booking));
  },
}));

// ===== admin communications =========================================================================
r.path('admin/<int:id>/communications/', negotiatedView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    if (!(await hasPermission(userOf(req), 'reservations.communications', 'read'))) return json(res, 403, { error: 'Permission denied' });
    const b = await bookingById(req.params.id as string);
    if (!b) throw notFoundFor('Booking');
    const listing = await listingById(b.listing_id);
    const convs = await db.selectFrom('messaging_conversation as c').select(['c.id', 'c.updated_at']).distinct()
      .innerJoin('messaging_conversation_participants as p1', 'p1.conversation_id', 'c.id')
      .innerJoin('messaging_conversation_participants as p2', 'p2.conversation_id', 'c.id')
      .where('c.listing_id', '=', listing.id).where('p1.user_id', '=', b.customer_id).where('p2.user_id', '=', listing.owner_id)
      .orderBy('c.updated_at', 'desc').execute();
    const { isoformat } = await import('../../lib/datetime.js');
    const messages: { id: number; conversation_id: number; sender_id: number; sender_username: string; content: string; message_type: string; created_at: string }[] = [];
    for (const c of convs) {
      const ms = await db.selectFrom('messaging_message as m').innerJoin('users_user as u', 'u.id', 'm.sender_id')
        .select(['m.id', 'm.sender_id', 'u.username', 'm.content', 'm.message_type', 'm.created_at'])
        .where('m.conversation_id', '=', c.id).orderBy('m.created_at').execute();
      for (const m of ms) {
        messages.push({ id: m.id, conversation_id: c.id, sender_id: m.sender_id, sender_username: m.username, content: m.content, message_type: m.message_type, created_at: isoformat(m.created_at)! });
      }
    }
    // list.sort(key=created_at isoformat string) — stable, code-point order
    messages.sort((a, b2) => (a.created_at < b2.created_at ? -1 : a.created_at > b2.created_at ? 1 : 0));
    const guest = await db.selectFrom('users_user').select('username').where('id', '=', b.customer_id).executeTakeFirstOrThrow();
    const host = await db.selectFrom('users_user').select('username').where('id', '=', listing.owner_id).executeTakeFirstOrThrow();
    return { booking_id: b.id, guest_username: guest.username, host_username: host.username, conversation_count: convs.length, messages };
  },
}));

// ===== admin extend reservation =====================================================================
r.path('admin/<int:id>/extend-reservation/', negotiatedView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    const user = userOf(req);
    if (!(await hasPermission(user, 'reservations.transactional_data', 'update'))) return json(res, 403, { error: 'Permission denied' });
    const b = await bookingById(req.params.id as string);
    if (!b) throw notFoundFor('Booking');
    const data = (await requestData(req, res)).data;
    const reason = pyStrip(pyStr(dget(data, 'reason', '')));
    if (!reason) return json(res, 400, { error: 'A reason is required to extend a reservation.' });
    const raw = dget(data, 'new_deadline');
    if (!pyTruthy(raw)) return json(res, 400, { error: 'new_deadline is required.' });
    const parsed = parseDatetime(raw);
    if (parsed === null) return json(res, 400, { error: 'new_deadline must be a valid ISO datetime.' });
    const requested = { us: parsed.us, offsetSec: parsed.offsetSec ?? 0 };
    let applied: bigint;
    try {
      applied = await extendReservation(b, requested.us, user, reason);
    } catch (e) {
      if (e instanceof ExtendError) return json(res, 400, { error: e.message });
      throw e;
    }
    // the applied deadline is the requested datetime object (own offset) unless capped at requested_at + 20d (UTC)
    const appliedIso = applied === requested.us ? awareIsoformat(requested) : awareIsoformat({ us: applied, offsetSec: 0 });
    const customer = await db.selectFrom('users_user').select('username').where('id', '=', b.customer_id).executeTakeFirstOrThrow();
    const listing = await listingById(b.listing_id);
    await logAdminAction(req, 'booking.extend_reservation', {
      target: auditTarget('Booking', b.id, `${customer.username} - ${listing.title} (${b.status})`),
      reason,
      metadata: { requested_deadline: raw, applied_deadline: appliedIso },
    });
    const capped = applied < requested.us;
    return {
      booking_id: b.id, new_deadline: appliedIso, capped_at_policy_ceiling: capped,
      message: capped ? 'Extended, but capped at 20 days from the original reservation request.' : 'Reservation extended.',
    };
  },
}));

// ===== my_payouts ===================================================================================
r.path('payouts/', negotiatedView({
  permissions: [IsAuthenticated],
  async GET(req) {
    const rows = await db.selectFrom('payments_payout as p').innerJoin('bookings_booking as b', 'b.id', 'p.booking_id')
      .innerJoin('listings_listing as l', 'l.id', 'b.listing_id')
      .select(['p.id', 'p.booking_id', 'l.title', 'p.gross_amount', 'p.service_fee_amount', 'p.net_amount', 'p.currency', 'p.status', 'p.paid_at', 'p.created_at'])
      .where('p.host_id', '=', userOf(req).id).orderBy('p.created_at', 'desc').execute();
    const { isoformat } = await import('../../lib/datetime.js');
    return rows.map((p) => ({
      id: String(p.id), booking_id: p.booking_id, listing_title: p.title, gross_amount: p.gross_amount, service_fee_amount: p.service_fee_amount,
      net_amount: p.net_amount, currency: p.currency, status: p.status, paid_at: p.paid_at ? isoformat(p.paid_at) : null, created_at: isoformat(p.created_at),
    }));
  },
}));

export { NotFound, HttpResponseError, pyRepr };
