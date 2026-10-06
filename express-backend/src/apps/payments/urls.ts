// payments — /api/payments/ (port of payments/views.py + urls.py).
//
// Every view is an @api_view function view (view() = apiView + DRF content
// negotiation) except the two webhooks, which are plain csrf_exempt Django
// views (no auth/throttle/negotiation, JsonResponse bodies).

import type { NextFunction, Request, Response } from 'express';
import Stripe from 'stripe';
import { sql } from 'kysely';
import { db } from '../../db/index.js';
import { nowPg } from '../../lib/datetime.js';
import { HttpResponseError, NotFound, notFoundFor } from '../../lib/errors.js';
import { logTransaction } from '../../lib/activity.js';
import { AllowAny, IsAuthenticated, negotiatedView, type ApiRequest, type User } from '../../lib/view.js';
import { djangoRouter } from '../../routes/registry.js';
import { notifyAgentCommissionPaid, notifyPayoutPaid } from '../../domain/notifications.js';
import { hasAnyPermission, hasPermission, isFullAdmin, registerExecutor, submitOrExecute } from '../../domain/rbac.js';
import { auditTarget, isSuperadminStaff, logAdminAction, requireDepartment } from '../../domain/superadmin.js';
import { parseDate } from '../../lib/fields.js';
import { pyIntPk, pyTruthy as truthy } from '../../lib/py.js';
import { dataGet, dataHas, dataItem, qp, rawBody, requestData } from './drf.js';
import { dbDecimal, dec, DecimalException, PyDecimal } from './decimal.js';
import { fail, FieldError, parseUuid, validate, type FieldSpec } from './fields.js';
import {
  bookingStr, currencyStr, employeePaymentStr, ELIGIBLE_REASON_CODES, escrowHoldStr, getPlatformFee, paymentStr, payoutStr,
  platformFeeStr, REASON_CODE_VALUES, taxRateStr, agentCommissionStr,
} from './models.js';
import { pyFloat, pyFloatStr, pyListRepr, pyStr, pyStrip, inBigintRange, pyIntFromStr } from './py.js';
import {
  serializeAgentCommission, serializeCurrency, serializeEmployee, serializeEmployeePayment, serializePayment, serializePayout,
  serializePlatformFee, serializeRefund, serializeSavedCard, serializeTaxRate,
} from './serializers.js';
import { getPayment, PaymentService, type PaymentRow } from './services.js';
import { bookingTotalAmount, getBooking, getViewing, markGuestPaid, markViewingFeePaid } from '../../domain/bookings.js';
import { voidAgentCommission } from '../../domain/agents.js';
import { computeListingPricing } from '../../domain/listings.js';
import { bookingPostSave } from '../../domain/notifications.js';

const r = djangoRouter('api/payments/');

type Data = unknown;
const json = (res: Response, status: number, body: unknown) => res.status(status).json(body);


/** URL <int:...> kwarg → bigint (null when outside BIGINT: Django 5 then matches nothing). */
function intKwarg(req: Request, name: string): number | null {
  const n = BigInt(String((req.params as Record<string, string>)[name]));
  return inBigintRange(n) ? Number(n) : null;
}


/** pk lookup value for an int pk from request data: None → no match, garbage → ValueError (500). */
function intLookup(v: unknown, field = 'id'): number | null {
  if (v === null || v === undefined) return null;
  const n = pyIntPk(v, field);
  return Number.isSafeInteger(n) ? n : null;
}

/** UUID pk lookup (UUIDField.to_python): invalid → ValidationError → 500. */
function uuidLookup(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const u = parseUuid(v);
  if (u === null) throw new Error(`“${pyStr(v)}” is not a valid UUID.`);
  return u;
}

/** _is_admin(user, resource) */
async function isAdmin(user: User | null, resource?: string): Promise<boolean> {
  if (isFullAdmin(user)) return true;
  if (!(user && isSuperadminStaff(user))) return false;
  if (await requireDepartment(user, 'finance')) return true;
  if (resource) return hasAnyPermission(user, resource);
  return false;
}
const DENIED = { error: 'Permission Denied' };

/** Python round(x) on a float (ROUND_HALF_EVEN on the exact binary value). */
function pyRound(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

/** date.fromisoformat (Python 3.12: YYYY-MM-DD, YYYYMMDD) — null on ValueError. */
function fromIsoDate(s: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s) ?? /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1 || mo < 1 || mo > 12 || d < 1 || d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** filter(<col>__date__gte=value): DateField.to_python — unparseable → ValidationError (500). */
function dateFilterValue(v: string): string {
  const d = parseDate(v);
  if (d === null) throw new Error(`“${v}” value has an invalid date format. It must be in YYYY-MM-DD format.`);
  return d;
}
const utcDate = (col: string) => sql`(${sql.ref(col)} AT TIME ZONE 'UTC')::date`;

const todayUtc = () => new Date().toISOString().slice(0, 10);

class RuntimeError extends Error {}

// =====================================================================================
// currencies_list
// =====================================================================================
r.path('currencies/', negotiatedView({
  permissions: [AllowAny],
  async GET() {
    const rows = await db.selectFrom('payments_currency').selectAll().where('is_active', '=', true).orderBy('code').execute();
    return rows.map((c) => ({ code: c.code, name: c.name, symbol: c.symbol, exchange_rate_to_usd: dec(c.exchange_rate_to_usd).toString() }));
  },
}));

// =====================================================================================
// initiate_payment / initiate_viewing_payment
// =====================================================================================
const GATEWAY_CHOICES = ['mtn_momo', 'flutterwave', 'orange_money', 'paystack'];
const validateGateway = (v: string) => (GATEWAY_CHOICES.includes(v) ? v : fail('Invalid payment gateway'));
async function validateCurrency(v: string) {
  const c = await db.selectFrom('payments_currency').select('id').where('code', '=', v).where('is_active', '=', true).executeTakeFirst();
  return c ? v : fail('Currency not supported');
}
async function hasActivePayment(col: 'booking_id' | 'viewing_id', id: number): Promise<boolean> {
  return !!(await db.selectFrom('payments_payment').select('id').where(col, '=', id).where('status', 'in', ['completed', 'processing']).executeTakeFirst());
}
const commonSpecs: FieldSpec[] = [
  { name: 'gateway', kind: 'char', maxLength: 20, validate: validateGateway },
  { name: 'payment_method', kind: 'char', maxLength: 20 },
  { name: 'phone_number', kind: 'char', maxLength: 20 },
  { name: 'currency', kind: 'char', maxLength: 3, validate: validateCurrency },
];
const gatewayCurrencyCheck = (attrs: Record<string, unknown>) => {
  if (attrs.gateway === 'mtn_momo' && attrs.currency === 'LRD') {
    throw new FieldError({ currency: 'MTN MoMo payments in LRD are temporarily unavailable — pay in USD instead.' });
  }
};

r.path('initiate/', negotiatedView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    const data = await requestData(req, res);
    const { errors, values } = await validate(data, [
      {
        name: 'booking_id', kind: 'int',
        async validate(v: bigint) {
          const b = inBigintRange(v)
            ? await db.selectFrom('bookings_booking').selectAll().where('id', '=', Number(v)).where('customer_id', '=', req.user!.id).executeTakeFirst()
            : undefined;
          if (!b) return fail('Booking not found');
          if (!['awaiting_payment', 'requested'].includes(b.status)) return fail('Booking must be awaiting payment');
          if (await hasActivePayment('booking_id', b.id)) return fail('Payment already exists for this booking');
          return b;
        },
      },
      ...commonSpecs,
    ], { validate: gatewayCurrencyCheck });
    if (errors) return json(res, 400, { success: false, errors });
    try {
      const booking = values.booking_id as NonNullable<Awaited<ReturnType<typeof getBooking>>>;
      const gatewayName = values.gateway as string;
      const method = values.payment_method as string;
      const phone = values.phone_number as string;
      const currency = values.currency as string;
      const base = booking.total_price !== null && dec(booking.total_price).truthy() ? dec(booking.total_price) : dec((await bookingTotalAmount(booking)).toString());
      const amount = await PaymentService.convertFromUsd(PyDecimal.parse(base.toString()), currency);
      let payment = await PaymentService.createPayment({
        booking, gatewayName, amount, currencyCode: currency, paymentMethod: method, phoneNumber: phone, networkProvider: 'MTN',
      });
      logTransaction('payment_initiated', { user_id: req.user!.id, booking_id: booking.id, amount: amount.toString(), currency, payment_method: method, gateway: gatewayName });
      const result = await PaymentService.processPayment(payment, { amount, phone_number: phone, currency });
      if (result.success) {
        logTransaction('payment_processing_success', { user_id: req.user!.id, booking_id: booking.id, gateway: gatewayName, gateway_status: 'success' });
        payment = (await getPayment(payment.id))!;
        return json(res, 201, {
          success: true, payment: await serializePayment(payment),
          message: result.message ?? 'Payment request sent successfully',
        });
      }
      logTransaction('payment_processing_failed', { user_id: req.user!.id, booking_id: booking.id, gateway: gatewayName, gateway_status: result.error ?? 'unknown' });
      return json(res, 400, {
        success: false, error: 'error' in result ? result.error : 'Payment processing failed',
        details: result.details ?? null, debug: result.debug ?? null,
      });
    } catch (e) {
      return json(res, 500, { success: false, error: (e as Error).message });
    }
  },
}));

r.path('viewing/initiate/', negotiatedView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    const data = await requestData(req, res);
    const { errors, values } = await validate(data, [
      {
        name: 'viewing_id', kind: 'int',
        async validate(v: bigint) {
          const vw = inBigintRange(v)
            ? await db.selectFrom('bookings_viewingappointment').selectAll().where('id', '=', Number(v)).where('guest_id', '=', req.user!.id).executeTakeFirst()
            : undefined;
          if (!vw) return fail('Viewing not found');
          if (vw.is_fee_paid) return fail('Viewing fee already paid');
          if (vw.status !== 'requested') return fail('Fee can only be paid for a newly requested viewing');
          if (await hasActivePayment('viewing_id', vw.id)) return fail('A payment is already in progress for this viewing');
          return vw;
        },
      },
      ...commonSpecs,
    ], { validate: gatewayCurrencyCheck });
    if (errors) return json(res, 400, { success: false, errors });
    try {
      const viewing = values.viewing_id as NonNullable<Awaited<ReturnType<typeof getViewing>>>;
      const currency = values.currency as string;
      const phone = values.phone_number as string;
      const amount = await PaymentService.convertFromUsd(PyDecimal.parse(dec(viewing.viewing_fee).toString()), currency);
      let payment = await PaymentService.createPayment({
        viewing, gatewayName: values.gateway as string, amount, currencyCode: currency,
        paymentMethod: values.payment_method as string, phoneNumber: phone, networkProvider: 'MTN',
      });
      const result = await PaymentService.processPayment(payment, { amount, phone_number: phone, currency });
      if (result.success) {
        payment = (await getPayment(payment.id))!;
        return json(res, 201, { success: true, payment: await serializePayment(payment), message: result.message ?? 'Payment request sent successfully' });
      }
      return json(res, 400, { success: false, error: 'error' in result ? result.error : 'Payment processing failed', details: result.details ?? null });
    } catch (e) {
      return json(res, 500, { success: false, error: (e as Error).message });
    }
  },
}));

// =====================================================================================
// verify_payment
// =====================================================================================
async function paymentOr404(id: string): Promise<PaymentRow> {
  const p = await getPayment(id);
  if (!p) throw notFoundFor('Payment');
  return p;
}

r.path('verify/', negotiatedView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    const data = await requestData(req, res);
    const { errors, values } = await validate(data, [
      { name: 'payment_id', kind: 'uuid' },
      { name: 'gateway', kind: 'char', maxLength: 20 },
    ]);
    if (errors) return json(res, 400, { success: false, errors });
    let payment = await paymentOr404(values.payment_id as string);
    try {
      if (payment.user_id !== req.user!.id) return json(res, 403, { success: false, error: 'Permission denied' });
      const result = await PaymentService.verifyPayment(payment);
      if (result.success) {
        logTransaction('payment_verified', { user_id: req.user!.id, booking_id: payment.booking_id, gateway_status: 'verified' });
        payment = (await getPayment(payment.id))!;
        const extra: Record<string, unknown> = {};
        if (payment.booking_id) extra.booking_status = (await getBooking(payment.booking_id))!.status;
        else if (payment.viewing_id) extra.viewing_status = (await getViewing(payment.viewing_id))!.status;
        return json(res, 200, { success: true, payment: await serializePayment(payment), verification: result, ...extra });
      }
      logTransaction('payment_verification_failed', { user_id: req.user!.id, booking_id: payment.booking_id, gateway_status: result.error ?? 'unknown' });
      return json(res, 400, { success: false, error: 'error' in result ? result.error : 'Payment verification failed' });
    } catch (e) {
      return json(res, 500, { success: false, error: (e as Error).message });
    }
  },
}));

// =====================================================================================
// refunds (guest) + eligibility
// =====================================================================================
const REFUND_ELIGIBILITY_WINDOW_DAYS = 20;

/** _check_refund_eligibility → [ok, error] */
function checkRefundEligibility(payment: PaymentRow, reasonCode: unknown, allowStaffOverride: boolean): [boolean, string | null] {
  if (payment.purpose === 'viewing_fee') return [false, 'QA/viewing inspection fees are non-refundable.'];
  if (reasonCode !== null && typeof reasonCode === 'object') throw new TypeError(`unhashable type: '${Array.isArray(reasonCode) ? 'list' : 'dict'}'`);
  if (typeof reasonCode !== 'string' || !REASON_CODE_VALUES.includes(reasonCode)) {
    return [false, `reason_code must be one of ${pyListRepr(REASON_CODE_VALUES)}.`];
  }
  if (reasonCode === 'change_of_mind') return [false, 'Refunds are not available for a change of mind.'];
  if (!allowStaffOverride && !ELIGIBLE_REASON_CODES.includes(reasonCode)) {
    return [false, 'This reason is not eligible for a refund. Eligible reasons: property misrepresentation, a legal issue, or a safety concern.'];
  }
  const anchor = payment.completed_at || payment.created_at;
  if (!allowStaffOverride && anchor) {
    const anchorMs = Date.parse(String(anchor).replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
    const days = Math.floor((Date.now() - anchorMs) / 86_400_000);
    if (days > REFUND_ELIGIBILITY_WINDOW_DAYS) {
      return [false, `This payment is ${days} days old — refund requests must be made within ${REFUND_ELIGIBILITY_WINDOW_DAYS} days.`];
    }
  }
  return [true, null];
}

/** payment.refunds.last() — reverses Meta.ordering (-created_at), i.e. the OLDEST refund. */
async function lastRefund(paymentId: string) {
  return db.selectFrom('payments_refund').selectAll().where('payment_id', '=', paymentId).orderBy('created_at', 'asc').executeTakeFirst();
}

r.path('refund/', negotiatedView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    const data = await requestData(req, res);
    const { errors, values } = await validate(data, [
      { name: 'payment_id', kind: 'uuid' },
      { name: 'amount', kind: 'decimal', maxDigits: 12, decimalPlaces: 2 },
      { name: 'reason', kind: 'char', maxLength: 500 },
      { name: 'reason_code', kind: 'choice', choices: REASON_CODE_VALUES },
    ]);
    if (errors) return json(res, 400, { success: false, errors });
    const payment = await paymentOr404(values.payment_id as string);
    try {
      if (payment.user_id !== req.user!.id) return json(res, 403, { success: false, error: 'Permission denied' });
      if (payment.status !== 'completed') return json(res, 400, { success: false, error: 'Only completed payments can be refunded' });
      const reasonCode = dataGet(data, 'reason_code', '');
      const [ok, error] = checkRefundEligibility(payment, reasonCode, false);
      if (!ok) return json(res, 400, { success: false, error });
      const result = await PaymentService.refundPayment(payment, values.amount as PyDecimal, values.reason as string, reasonCode as string);
      if (result.success) {
        logTransaction('refund_processed', { user_id: req.user!.id, booking_id: payment.booking_id, amount: String(values.amount), gateway_status: 'refunded' });
        return json(res, 200, { success: true, refund: await serializeRefund(await lastRefund(payment.id)), message: 'Refund submitted successfully' });
      }
      return json(res, 400, { success: false, error: 'error' in result ? result.error : 'Refund processing failed' });
    } catch (e) {
      return json(res, 500, { success: false, error: (e as Error).message });
    }
  },
}));

// =====================================================================================
// user_payments / payment_detail
// =====================================================================================
r.path('user/', negotiatedView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    try {
      const rows = await db.selectFrom('payments_payment').selectAll().where('user_id', '=', req.user!.id).orderBy('created_at', 'desc').execute();
      const payments = [];
      for (const p of rows) payments.push(await serializePayment(p));
      return json(res, 200, { success: true, payments, count: rows.length });
    } catch (e) {
      return json(res, 500, { success: false, error: (e as Error).message });
    }
  },
}));

// =====================================================================================
// Admin: payouts
// =====================================================================================
async function payoutOr404(req: Request, res: Response) {
  const id = (req.params as Record<string, string>).payout_id!;
  const p = await db.selectFrom('payments_payout').selectAll().where('id', '=', id).executeTakeFirst();
  if (!p) { json(res, 404, { error: 'Payout not found' }); return null; }
  return p;
}

r.path('admin/payouts/', negotiatedView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    if (!(await isAdmin(req.user, 'finances.payouts'))) return json(res, 403, DENIED);
    let q = db.selectFrom('payments_payout').selectAll().orderBy('created_at', 'desc');
    const status = qp(req, 'status');
    if (status) q = q.where('status', '=', status);
    const out = [];
    for (const p of await q.execute()) out.push(await serializePayout(p));
    return out;
  },
}));

r.path('admin/payouts/<uuid:payout_id>/mark-paid/', negotiatedView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    if (!(await isAdmin(req.user, 'finances.payouts'))) return json(res, 403, DENIED);
    let payout = await payoutOr404(req, res);
    if (!payout) return;
    if (payout.status !== 'paid') {
      const data = await requestData(req, res);
      const reference = dataGet(data, 'reference', '');
      const paidAt = nowPg();
      await db.updateTable('payments_payout').set({
        status: 'paid', paid_at: paidAt, paid_by_id: req.user!.id, reference: reference === null ? (null as never) : pyStr(reference),
      }).where('id', '=', payout.id).execute();
      payout = { ...payout, status: 'paid', paid_at: paidAt, paid_by_id: req.user!.id, reference: reference as string };
      try { await notifyPayoutPaid(payout as never); } catch { /* except Exception: pass */ }
    }
    return serializePayout(payout);
  },
}));

r.path('admin/payouts/<uuid:payout_id>/cancel/', negotiatedView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    if (!(await isAdmin(req.user, 'finances.payouts'))) return json(res, 403, DENIED);
    let payout = await payoutOr404(req, res);
    if (!payout) return;
    if (payout.status !== 'pending') return json(res, 400, { error: `Only pending payouts can be cancelled (this one is ${payout.status}).` });
    const data = await requestData(req, res);
    const reason = pyStrip(pyStr(dataGet(data, 'reason', '')));
    if (!reason) return json(res, 400, { error: 'A reason is required to cancel a payout.' });
    const at = nowPg();
    await db.updateTable('payments_payout').set({ status: 'cancelled', cancelled_at: at, cancelled_by_id: req.user!.id, cancellation_reason: reason })
      .where('id', '=', payout.id).execute();
    payout = { ...payout, status: 'cancelled', cancelled_at: at, cancelled_by_id: req.user!.id, cancellation_reason: reason };
    try { await voidAgentCommission({ id: payout.booking_id }, `Payout cancelled: ${reason}`); } catch { /* pass */ }
    await logAdminAction(req, 'payout.cancel', { target: auditTarget('Payout', payout.id, await payoutStr(payout)), reason });
    return serializePayout(payout);
  },
}));

r.path('admin/payouts/<uuid:payout_id>/disburse/', negotiatedView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    if (!(await isAdmin(req.user, 'finances.payouts'))) return json(res, 403, DENIED);
    let payout = await payoutOr404(req, res);
    if (!payout) return;
    if (payout.status !== 'pending') return json(res, 400, { error: `Only pending payouts can be disbursed (this one is ${payout.status}).` });
    // users.Profile has no momo_number → AttributeError → '' in Django.
    const phone = payout.recipient_momo_number || '';
    const result = await PaymentService.disburseToPhone(phone, dec(payout.net_amount), payout.currency, `Host payout — booking #${payout.booking_id}`);
    if (!result.success) return json(res, 400, { error: result.error ?? 'Disbursement failed', details: result.details ?? null });
    const at = nowPg();
    const reference = (result.refund_id as string) ?? '';
    await db.updateTable('payments_payout').set({ status: 'paid', paid_at: at, paid_by_id: req.user!.id, reference }).where('id', '=', payout.id).execute();
    payout = { ...payout, status: 'paid', paid_at: at, paid_by_id: req.user!.id, reference };
    try { await notifyPayoutPaid(payout as never); } catch { /* pass */ }
    await logAdminAction(req, 'payout.disburse', { target: auditTarget('Payout', payout.id, await payoutStr(payout)), reason: 'MTN MoMo disbursement' });
    return serializePayout(payout);
  },
}));

// =====================================================================================
// Admin: agent commissions
// =====================================================================================
r.path('admin/agent-commissions/', negotiatedView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    if (!(await isAdmin(req.user, 'finances.agent_commissions'))) return json(res, 403, DENIED);
    let q = db.selectFrom('agents_agentcommission').selectAll().orderBy('created_at', 'desc');
    const status = qp(req, 'status');
    if (status) q = q.where('status', '=', status);
    const out = [];
    for (const c of await q.execute()) out.push(await serializeAgentCommission(c));
    return out;
  },
}));

r.path('admin/agent-commissions/<int:commission_id>/disburse/', negotiatedView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    if (!(await isAdmin(req.user, 'finances.agent_commissions'))) return json(res, 403, DENIED);
    const id = intKwarg(req, 'commission_id');
    let c = id === null ? undefined : await db.selectFrom('agents_agentcommission').selectAll().where('id', '=', id).executeTakeFirst();
    if (!c) return json(res, 404, { error: 'Commission not found' });
    if (c.status !== 'pending') return json(res, 400, { error: `Only pending commissions can be disbursed (this one is ${c.status}).` });
    const phone = ''; // agent.profile.momo_number doesn't exist → AttributeError → ''
    const result = await PaymentService.disburseToPhone(phone, dec(c.amount), c.currency, `Agent commission — booking #${c.booking_id}`);
    if (!result.success) return json(res, 400, { error: result.error ?? 'Disbursement failed', details: result.details ?? null });
    const at = nowPg();
    const reference = (result.refund_id as string) ?? '';
    await db.updateTable('agents_agentcommission').set({ status: 'paid', paid_at: at, paid_by_id: req.user!.id, reference, updated_at: at }).where('id', '=', c.id).execute();
    c = { ...c, status: 'paid', paid_at: at, paid_by_id: req.user!.id, reference, updated_at: at };
    try { await notifyAgentCommissionPaid(c as never); } catch { /* pass */ }
    await logAdminAction(req, 'agent_commission.disburse', { target: auditTarget('AgentCommission', c.id, await agentCommissionStr(c)), reason: 'MTN MoMo disbursement' });
    return serializeAgentCommission(c);
  },
}));

// =====================================================================================
// Admin: employees
// =====================================================================================
r.path('admin/employees/', negotiatedView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    if (!(await isAdmin(req.user, 'finances.employees'))) return json(res, 403, DENIED);
    const rows = await db.selectFrom('payments_employee').selectAll().where('is_active', '=', true).orderBy('name').execute();
    return rows.map(serializeEmployee);
  },
  async POST(req, res) {
    if (!(await isAdmin(req.user, 'finances.employees'))) return json(res, 403, DENIED);
    const data = await requestData(req, res);
    const name = pyStrip(pyStr(dataGet(data, 'name', '')));
    const momo = pyStrip(pyStr(dataGet(data, 'momo_number', '')));
    if (!name || !momo) return json(res, 400, { error: 'Name and MoMo number are required.' });
    const roleTitle = pyStrip(pyStr(dataGet(data, 'role_title', '')));
    const now = nowPg();
    const e = await db.insertInto('payments_employee').values({
      name, momo_number: momo, role_title: roleTitle, momo_network: 'MTN', is_active: true, created_at: now, updated_at: now,
    }).returningAll().executeTakeFirstOrThrow();
    return json(res, 201, serializeEmployee(e));
  },
}));

async function employeeOr404(req: Request, res: Response, activeOnly = false) {
  const id = intKwarg(req, 'employee_id');
  let q = db.selectFrom('payments_employee').selectAll().where('id', '=', id ?? -1);
  if (activeOnly) q = q.where('is_active', '=', true);
  const e = id === null ? undefined : await q.executeTakeFirst();
  if (!e) { json(res, 404, { error: 'Employee not found' }); return null; }
  return e;
}

r.path('admin/employees/<int:employee_id>/', negotiatedView({
  permissions: [IsAuthenticated],
  async PATCH(req, res) {
    if (!(await isAdmin(req.user, 'finances.employees'))) return json(res, 403, DENIED);
    const e = await employeeOr404(req, res);
    if (!e) return;
    const data = await requestData(req, res);
    const upd: Record<string, string> = {};
    for (const f of ['name', 'role_title', 'momo_number', 'momo_network'] as const) {
      if (dataHas(data, f)) upd[f] = pyStrip(pyStr(dataItem(data, f)));
    }
    const saved = await db.updateTable('payments_employee').set({ ...upd, updated_at: nowPg() }).where('id', '=', e.id).returningAll().executeTakeFirstOrThrow();
    return serializeEmployee(saved);
  },
  async DELETE(req, res) {
    if (!(await isAdmin(req.user, 'finances.employees'))) return json(res, 403, DENIED);
    const e = await employeeOr404(req, res);
    if (!e) return;
    await db.updateTable('payments_employee').set({ is_active: false }).where('id', '=', e.id).execute();
    res.status(204).end();
  },
}));

r.path('admin/employees/<int:employee_id>/pay/', negotiatedView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    if (!(await isAdmin(req.user, 'finances.employees'))) return json(res, 403, DENIED);
    const e = await employeeOr404(req, res, true);
    if (!e) return;
    const data = await requestData(req, res);
    let amount: PyDecimal | null;
    try { amount = PyDecimal.parse(pyStr(dataGet(data, 'amount', ''))); } catch (err) {
      if (!(err instanceof DecimalException)) throw err;
      amount = null;
    }
    if (!amount || !amount.truthy() || amount.lte(PyDecimal.fromInt(0))) return json(res, 400, { error: 'A positive amount is required.' });
    const currency = dataGet(data, 'currency', 'USD');
    const description = pyStrip(pyStr(dataGet(data, 'description', '')));
    const result = await PaymentService.disburseToPhone(e.momo_number, amount, currency, description || `Employee payment — ${e.name}`);
    const row = await db.insertInto('payments_employeepayment').values({
      id: crypto.randomUUID(), employee_id: e.id, amount: dbDecimal(amount, 12, 2),
      currency: currency === null ? (null as never) : pyStr(currency), description,
      status: result.success ? 'paid' : 'failed', reference: result.success ? ((result.refund_id as string) ?? '') : '',
      error_message: result.success ? '' : pyStr(result.error ?? 'Disbursement failed'), paid_by_id: req.user!.id, created_at: nowPg(),
    }).returningAll().executeTakeFirstOrThrow();
    const payment = { ...row, amount: amount.toString(), currency };
    if (!result.success) {
      return json(res, 400, { error: result.error ?? 'Disbursement failed', details: result.details ?? null, payment: await serializeEmployeePayment(payment) });
    }
    await logAdminAction(req, 'employee_payment.disburse', {
      target: auditTarget('EmployeePayment', row.id, await employeePaymentStr(payment)), reason: description || 'MTN MoMo disbursement',
    });
    return json(res, 201, await serializeEmployeePayment(payment));
  },
}));

r.path('admin/employee-payments/', negotiatedView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    if (!(await isAdmin(req.user, 'finances.employees'))) return json(res, 403, DENIED);
    let q = db.selectFrom('payments_employeepayment').selectAll().orderBy('created_at', 'desc');
    const employeeId = qp(req, 'employee_id');
    if (employeeId) {
      const n = pyIntFromStr(employeeId);
      if (n === null) throw new Error(`Field 'id' expected a number but got '${employeeId}'.`);
      if (!inBigintRange(n)) return [];
      q = q.where('employee_id', '=', Number(n));
    }
    const out = [];
    for (const p of await q.limit(200).execute()) out.push(await serializeEmployeePayment(p));
    return out;
  },
}));

// =====================================================================================
// Admin: refunds (MTN MoMo) + dual-auth executor
// =====================================================================================
const DUAL_AUTH_REFUND_THRESHOLD = 500.0;

registerExecutor('payment.refund', async (payload: Record<string, unknown>) => {
  const payment = await getPayment(String(payload.payment_id));
  if (!payment) throw new Error('Payment matching query does not exist.');
  const result = await PaymentService.refundPayment(payment, payload.amount as number, payload.reason as string,
    (payload.reason_code ?? '') as string);
  if (!result.success) throw new RuntimeError(String(result.error ?? 'Refund processing failed'));
  const fresh = (await getPayment(payment.id))!;
  return { payment_id: String(fresh.id), status: fresh.status, refund_id: result.refund_id ?? null };
});

r.path('admin/refund/', negotiatedView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    if (!(await isAdmin(req.user, 'customer_support.vouchers'))) return json(res, 403, DENIED);
    const data = await requestData(req, res);
    const paymentId = dataGet(data, 'payment_id', null);
    const reason = pyStrip(pyStr(dataGet(data, 'reason', '')));
    const reasonCode = dataGet(data, 'reason_code', 'other');
    if (!truthy(paymentId) || !reason) return json(res, 400, { error: 'payment_id and reason are required.' });
    const pk = uuidLookup(paymentId);
    const payment = pk === null ? undefined : await getPayment(pk);
    if (!payment) throw notFoundFor('Payment');
    const gw = (await db.selectFrom('payments_paymentgateway').select('name').where('id', '=', payment.gateway_id).executeTakeFirstOrThrow()).name;
    if (gw !== 'mtn_momo') {
      return json(res, 400, { error: `Refunds from this dashboard only support MTN MoMo payments. This payment used "${gw}" — issue that refund from the gateway's own dashboard.` });
    }
    if (!['completed', 'partially_refunded'].includes(payment.status)) {
      return json(res, 400, { error: `Only completed or partially-refunded payments can be refunded (this one is ${payment.status}).` });
    }
    const [ok, error] = checkRefundEligibility(payment, reasonCode, true);
    if (!ok) return json(res, 400, { error });
    const amount = pyFloat(dataGet(data, 'amount', null));
    if (amount === null) return json(res, 400, { error: 'A valid amount is required.' });
    if (amount <= 0) return json(res, 400, { error: 'Amount must be greater than zero.' });
    const payload = { payment_id: String(payment.id), amount, reason, reason_code: reasonCode };
    const target = auditTarget('Payment', payment.id, await paymentStr(payment));
    if (amount > DUAL_AUTH_REFUND_THRESHOLD) {
      if (!Number.isFinite(amount)) throw new Error('Token "Infinity" is invalid.'); // jsonb rejects Infinity → 500
      const [, approval] = await submitOrExecute('payment.refund', payload, req.user!, reason, true);
      await logAdminAction(req, 'payment.refund.requested', { target, reason, metadata: { amount, approval_id: approval!.id } });
      return json(res, 202, {
        pending_approval: true, approval_id: approval!.id,
        message: `This refund exceeds $${DUAL_AUTH_REFUND_THRESHOLD.toFixed(2)} and requires a second admin to approve it before it executes.`,
      });
    }
    try {
      await submitOrExecute('payment.refund', payload, req.user!, reason, false);
    } catch (e) {
      if (e instanceof RuntimeError) return json(res, 400, { error: e.message });
      throw e;
    }
    await logAdminAction(req, 'payment.refund', { target, reason, metadata: { amount } });
    const fresh = (await getPayment(payment.id))!;
    return json(res, 200, { payment: await serializePayment(fresh), refund: await serializeRefund(await lastRefund(fresh.id)) });
  },
}));

// =====================================================================================
// Admin: Stripe refunds + dual-auth executor
// =====================================================================================
/**
 * stripe-python 11.6 (Django's image) pins Stripe-Version 2025-02-24.acacia;
 * stripe-node would otherwise send its own (newer) default, which changes the
 * API semantics Stripe applies to these calls. Keep in step with Django's pin.
 */
const STRIPE_API_VERSION = '2025-02-24.acacia';
function stripeClient(secret: string) {
  return new Stripe(secret, { apiVersion: STRIPE_API_VERSION as never });
}

/** str(stripe.error.StripeError) */
function stripeErrStr(e: { message?: string; requestId?: string }): string {
  const msg = e.message || '<empty message>';
  return e.requestId ? `Request ${e.requestId}: ${msg}` : msg;
}

registerExecutor('stripe_refund', async (payload: Record<string, unknown>) => {
  const booking = await getBooking(pyIntPk(payload.booking_id));
  if (!booking) throw new Error('Booking matching query does not exist.');
  const amount = PyDecimal.parse(String(payload.amount));
  const reason = String(payload.reason);
  const reasonCode = (payload.reason_code as string) || 'other';
  const secret = process.env.STRIPE_SECRET_KEY || '';
  const base = {
    booking_id: booking.id, stripe_payment_intent_id: booking.stripe_payment_intent_id as string, amount: dbDecimal(amount, 12, 2),
    reason, reason_code: reasonCode, initiated_by_id: payload.initiated_by_id as number, created_at: nowPg(),
  };
  if (!secret) {
    await db.insertInto('payments_striperefund').values({ ...base, stripe_refund_id: '', status: 'failed', error_message: 'Stripe is not configured on the server' }).execute();
    throw new RuntimeError('Stripe is not configured on the server');
  }
  const amountCents = Number(amount.mul(PyDecimal.fromInt(100)).toIntegral());
  try {
    const result = await stripeClient(secret).refunds.create({
      payment_intent: booking.stripe_payment_intent_id as string, amount: amountCents,
      metadata: { admin_reason: [...reason].slice(0, 490).join(''), booking_id: String(booking.id) },
    });
    await db.insertInto('payments_striperefund').values({ ...base, stripe_refund_id: result.id, status: 'completed', error_message: '' }).execute();
    return { booking_id: booking.id, stripe_refund_id: result.id, status: 'completed' };
  } catch (e) {
    if (!(e instanceof Stripe.errors.StripeError)) throw e;
    const msg = stripeErrStr(e);
    await db.insertInto('payments_striperefund').values({ ...base, stripe_refund_id: '', status: 'failed', error_message: msg }).execute();
    throw new RuntimeError(`Stripe refund failed: ${msg}`);
  }
});

r.path('admin/stripe-refund/', negotiatedView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    if (!(await isAdmin(req.user, 'finances.payouts'))) return json(res, 403, DENIED);
    const data = await requestData(req, res);
    const bookingId = dataGet(data, 'booking_id', null);
    const reason = pyStrip(pyStr(dataGet(data, 'reason', '')));
    const reasonCode = dataGet(data, 'reason_code', 'other');
    if (!truthy(bookingId) || !reason) return json(res, 400, { error: 'booking_id and reason are required.' });
    if (reasonCode !== null && typeof reasonCode === 'object') throw new TypeError('unhashable type');
    if (typeof reasonCode !== 'string' || !REASON_CODE_VALUES.includes(reasonCode)) {
      return json(res, 400, { error: `reason_code must be one of ${pyListRepr(REASON_CODE_VALUES)}.` });
    }
    if (reasonCode === 'change_of_mind') return json(res, 400, { error: 'Refunds are not available for a change of mind.' });
    const pk = intLookup(bookingId);
    const booking = pk === null ? undefined : await getBooking(pk);
    if (!booking) throw notFoundFor('Booking');
    if (!booking.stripe_payment_intent_id) {
      return json(res, 400, { error: 'This booking was not paid via Stripe (no payment intent on record). If it was paid via MTN MoMo, use the MoMo refund tool instead.' });
    }
    if (!['confirmed', 'completed'].includes(booking.status)) {
      return json(res, 400, { error: `Only a confirmed or completed booking can be refunded (this one is ${booking.status}).` });
    }
    if (booking.total_price === null || !dec(booking.total_price).truthy()) return json(res, 400, { error: 'This booking has no recorded total price.' });
    let amount: PyDecimal;
    try { amount = PyDecimal.parse(pyStr(dataGet(data, 'amount', null))); } catch (e) {
      if (e instanceof DecimalException) return json(res, 400, { error: 'A valid amount is required.' });
      throw e;
    }
    if (amount.lte(PyDecimal.fromInt(0))) return json(res, 400, { error: 'Amount must be greater than zero.' });
    const agg = await db.selectFrom('payments_striperefund').select((eb) => eb.fn.sum<string | null>('amount').as('t'))
      .where('booking_id', '=', booking.id).where('status', '=', 'completed').executeTakeFirst();
    const already = agg?.t && dec(agg.t).truthy() ? dec(agg.t) : PyDecimal.parse('0');
    const remaining = dec(booking.total_price).sub(already);
    if (amount.gt(remaining)) return json(res, 400, { error: `Refund amount exceeds the remaining refundable balance (${remaining.toString()}).` });
    const payload = { booking_id: booking.id, amount: amount.toString(), reason, reason_code: reasonCode, initiated_by_id: req.user!.id };
    const [, approval] = await submitOrExecute('stripe_refund', payload, req.user!, reason, true);
    await logAdminAction(req, 'stripe_refund.requested', {
      target: auditTarget('Booking', booking.id, await bookingStr(booking)), reason, metadata: { amount: amount.toString(), approval_id: approval!.id },
    });
    return json(res, 202, { pending_approval: true, approval_id: approval!.id, message: 'Stripe refunds always require a second admin to approve before they execute.' });
  },
}));

// =====================================================================================
// Admin: platform fee
// =====================================================================================
r.path('admin/platform-fee/', negotiatedView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    if (!(await isAdmin(req.user, 'finances.platform_fee'))) return json(res, 403, DENIED);
    return serializePlatformFee(await getPlatformFee());
  },
  async PATCH(req, res) {
    if (!(await isAdmin(req.user, 'finances.platform_fee'))) return json(res, 403, DENIED);
    const fee = await getPlatformFee();
    const data = await requestData(req, res);
    const d = (name: string, maxDigits: number, dp: number, allowNull = false): FieldSpec =>
      ({ name, kind: 'decimal', maxDigits, decimalPlaces: dp, required: false, allowNull });
    const { errors, values } = await validate(data, [
      d('viewing_fee', 8, 2), d('service_fee_percent', 5, 2),
      { name: 'transaction_fee_type', kind: 'choice', choices: ['fixed', 'percentage', 'range'], required: false },
      d('transaction_fee_value', 8, 4), d('transaction_fee_min', 8, 2, true), d('transaction_fee_max', 8, 2, true),
    ], {
      partial: true,
      validate(attrs) {
        const type = 'transaction_fee_type' in attrs ? attrs.transaction_fee_type : fee.transaction_fee_type;
        if (type === 'range') {
          const lo = 'transaction_fee_min' in attrs ? (attrs.transaction_fee_min as PyDecimal | null) : (fee.transaction_fee_min === null ? null : dec(fee.transaction_fee_min));
          const hi = 'transaction_fee_max' in attrs ? (attrs.transaction_fee_max as PyDecimal | null) : (fee.transaction_fee_max === null ? null : dec(fee.transaction_fee_max));
          if (lo !== null && hi !== null && lo.gt(hi)) throw new FieldError({ transaction_fee_min: 'Minimum cannot exceed maximum.' });
        }
      },
    });
    if (errors) return json(res, 400, errors);
    const set: Record<string, unknown> = { updated_at: nowPg() };
    for (const [k, v] of Object.entries(values)) set[k] = v instanceof PyDecimal ? v.toFixedString() : v;
    const saved = await db.updateTable('payments_platformfee').set(set as never).where('id', '=', 1).returningAll().executeTakeFirstOrThrow();
    const snapshot = serializePlatformFee(saved);
    await logAdminAction(req, 'platform_fee.update', { target: auditTarget('PlatformFee', 1, platformFeeStr(saved)), metadata: { metadata_snapshot: snapshot } });
    return snapshot;
  },
}));

// =====================================================================================
// Admin: financial reporting
// =====================================================================================
function paymentsFiltered(req: Request) {
  let q = db.selectFrom('payments_payment');
  const since = qp(req, 'since');
  const until = qp(req, 'until');
  if (since) q = q.where(utcDate('payments_payment.created_at'), '>=', dateFilterValue(since));
  if (until) q = q.where(utcDate('payments_payment.created_at'), '<=', dateFilterValue(until));
  return q;
}

/** DRF's JSON encoder renders a raw Decimal as float(); `or 0` gives int 0. */
const decOrZero = (v: string | null | undefined) => (v === null || v === undefined || !dec(v).truthy() ? null : dec(v));
const asFloat = (d: PyDecimal | null) => (d === null ? 0 : d.toNumber());

r.path('admin/reports/summary/', negotiatedView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    if (!(await isAdmin(req.user, 'finances'))) return json(res, 403, DENIED);
    const payments = paymentsFiltered(req);
    const c = await payments.select((eb) => eb.fn.sum<string | null>('amount_in_usd').as('t'))
      .where('status', 'in', ['completed', 'partially_refunded', 'refunded']).executeTakeFirst();
    const ids = payments.select('payments_payment.id');
    const rf = await db.selectFrom('payments_refund').select((eb) => eb.fn.sum<string | null>('amount').as('t'))
      .where('status', '=', 'completed').where('payment_id', 'in', ids).executeTakeFirst();
    const collected = decOrZero(c?.t);
    const refunded = decOrZero(rf?.t);
    let net: number;
    if (collected === null && refunded === null) net = 0;
    else net = (collected ?? PyDecimal.fromInt(0)).sub(refunded ?? PyDecimal.fromInt(0)).toNumber();
    const p = await db.selectFrom('payments_payout').select([
      sql<string | null>`SUM(net_amount) FILTER (WHERE status = 'pending')`.as('pending_total'),
      sql<string | null>`SUM(net_amount) FILTER (WHERE status = 'paid')`.as('paid_total'),
      sql<string | null>`SUM(service_fee_amount)`.as('commission_total'),
      sql<string>`COUNT(id) FILTER (WHERE status = 'pending')`.as('pending_count'),
      sql<string>`COUNT(id) FILTER (WHERE status = 'paid')`.as('paid_count'),
      sql<string>`COUNT(id) FILTER (WHERE status = 'cancelled')`.as('cancelled_count'),
    ]).executeTakeFirstOrThrow();
    return {
      gross_collected: asFloat(collected), total_refunded: asFloat(refunded), net_revenue: net,
      commission_revenue: asFloat(decOrZero(p.commission_total)),
      payouts: {
        pending_total: asFloat(decOrZero(p.pending_total)), pending_count: Number(p.pending_count),
        paid_total: asFloat(decOrZero(p.paid_total)), paid_count: Number(p.paid_count), cancelled_count: Number(p.cancelled_count),
      },
    };
  },
}));

function transactionsQuery(req: Request) {
  let q = db.selectFrom('payments_payment')
    .innerJoin('payments_paymentgateway as g', 'g.id', 'payments_payment.gateway_id')
    .innerJoin('users_user as u', 'u.id', 'payments_payment.user_id')
    .selectAll('payments_payment');
  const status = qp(req, 'status'); const purpose = qp(req, 'purpose'); const gateway = qp(req, 'gateway');
  const since = qp(req, 'since'); const until = qp(req, 'until');
  const search = pyStrip(qp(req, 'search') ?? '');
  if (status) q = q.where('payments_payment.status', '=', status);
  if (purpose) q = q.where('payments_payment.purpose', '=', purpose);
  if (gateway) q = q.where('g.name', '=', gateway);
  if (since) q = q.where(utcDate('payments_payment.created_at'), '>=', dateFilterValue(since));
  if (until) q = q.where(utcDate('payments_payment.created_at'), '<=', dateFilterValue(until));
  if (search) {
    const pat = `%${search.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
    q = q.where(sql<boolean>`(UPPER(u.username::text) LIKE UPPER(${pat}) OR UPPER(u.email::text) LIKE UPPER(${pat}) OR UPPER(payments_payment.gateway_transaction_id::text) LIKE UPPER(${pat}))`);
  }
  return q;
}

r.path('admin/transactions/', negotiatedView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    if (!(await isAdmin(req.user, 'finances'))) return json(res, 403, DENIED);
    const q = transactionsQuery(req);
    let limit: number; let offset: number;
    const l = pyIntFromStr(qp(req, 'limit') ?? '25');
    const o = pyIntFromStr(qp(req, 'offset') ?? '0');
    if (l === null || o === null) { limit = 25; offset = 0; }
    else { limit = Math.max(1, Math.min(Number(l), 100)); offset = Math.max(0, Number(o)); }
    const { count } = await q.clearSelect().select((eb) => eb.fn.countAll<string>().as('count')).executeTakeFirstOrThrow();
    const rows = await q.orderBy('payments_payment.created_at', 'desc').offset(offset).limit(limit).execute();
    const results = [];
    for (const p of rows) results.push(await serializePayment(p));
    return { count: Number(count), limit, offset, results };
  },
}));

/** csv.writer (excel dialect, QUOTE_MINIMAL) */
function csvRow(fields: (string | null)[]): string {
  return fields.map((f) => {
    const s = f ?? '';
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',') + '\r\n';
}

r.path('admin/transactions/export/', negotiatedView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    if (!(await isAdmin(req.user, 'finances'))) return json(res, 403, DENIED);
    const rows = await transactionsQuery(req)
      .innerJoin('payments_currency as c', 'c.id', 'payments_payment.currency_id')
      .select(['g.name as gateway_name', 'u.username as username', 'c.code as currency_code'])
      .orderBy('payments_payment.created_at', 'desc').limit(5000).execute();
    let out = csvRow(['id', 'created_at', 'purpose', 'gateway', 'user', 'amount', 'currency', 'amount_in_usd', 'status', 'gateway_transaction_id']);
    const { isoformat } = await import('../../lib/datetime.js');
    for (const p of rows) {
      out += csvRow([String(p.id), isoformat(p.created_at), p.purpose, p.gateway_name, p.username, dec(p.amount).toString(),
        p.currency_code, dec(p.amount_in_usd).toString(), p.status, p.gateway_transaction_id]);
    }
    res.status(200);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="transactions.csv"');
    res.end(out);
  },
}));

// =====================================================================================
// Admin: escrow
// =====================================================================================
const isoOrNull = async (v: string | null) => (v === null ? null : (await import('../../lib/datetime.js')).isoformat(v));

r.path('admin/escrow/', negotiatedView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    if (!(await hasPermission(req.user, 'finances.escrow', 'read'))) return json(res, 403, { error: 'finances.escrow access required' });
    const bookings = await db.selectFrom('bookings_booking as b').innerJoin('listings_listing as l', 'l.id', 'b.listing_id')
      .innerJoin('users_user as u', 'u.id', 'b.customer_id')
      .select(['b.id', 'b.total_price', 'b.requested_at', 'l.title', 'u.username'])
      .where('b.status', '=', 'payment_received').orderBy('b.requested_at').execute();
    const holds = bookings.length ? await db.selectFrom('payments_escrowhold').selectAll()
      .where('booking_id', 'in', bookings.map((b) => b.id)).where('released_at', 'is', null).orderBy('held_at', 'desc').execute() : [];
    const byBooking = new Map<number, (typeof holds)[number]>();
    for (const h of holds) byBooking.set(h.booking_id, h);
    const out = [];
    for (const b of bookings) {
      const h = byBooking.get(b.id);
      out.push({
        booking_id: b.id, listing_title: b.title, guest_username: b.username,
        total_price: b.total_price !== null ? dec(b.total_price).toString() : null,
        requested_at: await isoOrNull(b.requested_at), on_hold: h !== undefined, hold_id: h ? h.id : null, hold_reason: h ? h.reason : '',
      });
    }
    return out;
  },
}));

r.path('admin/escrow/<int:booking_id>/hold/', negotiatedView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    if (!(await hasPermission(req.user, 'finances.escrow', 'update'))) return json(res, 403, { error: 'finances.escrow access required' });
    const id = intKwarg(req, 'booking_id');
    const booking = id === null ? undefined : await getBooking(id);
    if (!booking) throw notFoundFor('Booking');
    const data = await requestData(req, res);
    const reason = pyStrip(pyStr(dataGet(data, 'reason', '')));
    if (!reason) return json(res, 400, { error: 'A reason is required to place a hold.' });
    const active = await db.selectFrom('payments_escrowhold').select('id').where('booking_id', '=', booking.id).where('released_at', 'is', null).executeTakeFirst();
    if (active) return json(res, 400, { error: 'This booking already has an active hold.' });
    const hold = await db.insertInto('payments_escrowhold').values({
      booking_id: booking.id, reason, held_by_id: req.user!.id, held_at: nowPg(), released_at: null, released_by_id: null,
    }).returningAll().executeTakeFirstOrThrow();
    await logAdminAction(req, 'escrow.hold', { target: auditTarget('EscrowHold', hold.id, escrowHoldStr(hold)), reason });
    return json(res, 201, { id: hold.id, booking_id: booking.id, reason: hold.reason, held_at: await isoOrNull(hold.held_at) });
  },
}));

r.path('admin/escrow/<int:hold_id>/release/', negotiatedView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    if (!(await hasPermission(req.user, 'finances.escrow', 'update'))) return json(res, 403, { error: 'finances.escrow access required' });
    const id = intKwarg(req, 'hold_id');
    const hold = id === null ? undefined : await db.selectFrom('payments_escrowhold').selectAll().where('id', '=', id).executeTakeFirst();
    if (!hold) throw notFoundFor('EscrowHold');
    if (hold.released_at !== null) return json(res, 400, { error: 'This hold has already been released.' });
    const saved = await db.updateTable('payments_escrowhold').set({ released_at: nowPg(), released_by_id: req.user!.id })
      .where('id', '=', hold.id).returningAll().executeTakeFirstOrThrow();
    await logAdminAction(req, 'escrow.release', { target: auditTarget('EscrowHold', saved.id, escrowHoldStr(saved)) });
    return { id: saved.id, booking_id: saved.booking_id, released_at: await isoOrNull(saved.released_at) };
  },
}));

// =====================================================================================
// Admin: tax rates / tax report
// =====================================================================================
function taxRateSpecs(instanceId: number | null): FieldSpec[] {
  return [
    {
      name: 'jurisdiction', kind: 'char', maxLength: 100,
      validators: [async (v) => {
        let q = db.selectFrom('payments_taxrate').select('id').where('jurisdiction', '=', v as string);
        if (instanceId !== null) q = q.where('id', '!=', instanceId);
        return (await q.executeTakeFirst()) ? ['tax rate with this jurisdiction already exists.'] : [];
      }],
    },
    { name: 'rate_percent', kind: 'decimal', maxDigits: 5, decimalPlaces: 2 },
    { name: 'is_active', kind: 'bool', required: false },
  ];
}
const decFields = (values: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v instanceof PyDecimal ? v.toFixedString() : v]));

r.path('admin/tax-rates/', negotiatedView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    if (!(await hasPermission(req.user, 'finances.taxes', 'read'))) return json(res, 403, { error: 'finances.taxes access required' });
    const out = [];
    for (const t of await db.selectFrom('payments_taxrate').selectAll().orderBy('jurisdiction').execute()) out.push(await serializeTaxRate(t));
    return out;
  },
  async POST(req, res) {
    if (!(await hasPermission(req.user, 'finances.taxes', 'update'))) return json(res, 403, { error: 'finances.taxes access required' });
    const data = await requestData(req, res);
    const { errors, values } = await validate(data, taxRateSpecs(null));
    if (errors) return json(res, 400, errors);
    const now = nowPg();
    const rate = await db.insertInto('payments_taxrate').values({
      is_active: true, ...decFields(values), created_by_id: req.user!.id, created_at: now, updated_at: now,
    } as never).returningAll().executeTakeFirstOrThrow();
    await logAdminAction(req, 'tax_rate.create', { target: auditTarget('TaxRate', rate.id, taxRateStr(rate)), reason: `${rate.jurisdiction} ${rate.rate_percent}%` });
    return json(res, 201, await serializeTaxRate(rate));
  },
}));

r.path('admin/tax-rates/<int:pk>/', negotiatedView({
  permissions: [IsAuthenticated],
  async PATCH(req, res) {
    if (!(await hasPermission(req.user, 'finances.taxes', 'update'))) return json(res, 403, { error: 'finances.taxes access required' });
    const id = intKwarg(req, 'pk');
    const rate = id === null ? undefined : await db.selectFrom('payments_taxrate').selectAll().where('id', '=', id).executeTakeFirst();
    if (!rate) throw notFoundFor('TaxRate');
    const data = await requestData(req, res);
    const { errors, values } = await validate(data, taxRateSpecs(rate.id), { partial: true });
    if (errors) return json(res, 400, errors);
    const saved = await db.updateTable('payments_taxrate').set({ ...decFields(values), updated_at: nowPg() } as never)
      .where('id', '=', rate.id).returningAll().executeTakeFirstOrThrow();
    await logAdminAction(req, 'tax_rate.update', { target: auditTarget('TaxRate', saved.id, taxRateStr(saved)), reason: `${saved.jurisdiction} ${saved.rate_percent}%` });
    return serializeTaxRate(saved);
  },
  async DELETE(req, res) {
    if (!(await hasPermission(req.user, 'finances.taxes', 'update'))) return json(res, 403, { error: 'finances.taxes access required' });
    const id = intKwarg(req, 'pk');
    const rate = id === null ? undefined : await db.selectFrom('payments_taxrate').selectAll().where('id', '=', id).executeTakeFirst();
    if (!rate) throw notFoundFor('TaxRate');
    await logAdminAction(req, 'tax_rate.delete', { target: auditTarget('TaxRate', rate.id, taxRateStr(rate)) });
    await db.deleteFrom('payments_taxrate').where('id', '=', rate.id).execute();
    res.status(204).end();
  },
}));

r.path('admin/currencies/', negotiatedView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    if (!(await hasPermission(req.user, 'finances.currencies', 'read'))) return json(res, 403, { error: 'finances.currencies access required' });
    return (await db.selectFrom('payments_currency').selectAll().orderBy('code').execute()).map(serializeCurrency);
  },
}));

r.path('admin/currencies/<int:pk>/', negotiatedView({
  permissions: [IsAuthenticated],
  async PATCH(req, res) {
    if (!(await hasPermission(req.user, 'finances.currencies', 'update'))) return json(res, 403, { error: 'finances.currencies access required' });
    const id = intKwarg(req, 'pk');
    const cur = id === null ? undefined : await db.selectFrom('payments_currency').selectAll().where('id', '=', id).executeTakeFirst();
    if (!cur) throw notFoundFor('Currency');
    const data = await requestData(req, res);
    const { errors, values } = await validate(data, [
      { name: 'name', kind: 'char', maxLength: 50 },
      { name: 'symbol', kind: 'char', maxLength: 5 },
      {
        name: 'exchange_rate_to_usd', kind: 'decimal', maxDigits: 10, decimalPlaces: 4,
        validate: (v: PyDecimal) => (v.lte(PyDecimal.fromInt(0)) ? fail('Exchange rate must be greater than zero.') : v),
      },
      { name: 'is_active', kind: 'bool', required: false },
    ], { partial: true });
    if (errors) return json(res, 400, errors);
    const oldRate = cur.exchange_rate_to_usd;
    const saved = await db.updateTable('payments_currency').set({ ...decFields(values), updated_at: nowPg() } as never)
      .where('id', '=', cur.id).returningAll().executeTakeFirstOrThrow();
    await logAdminAction(req, 'currency.update', {
      target: auditTarget('Currency', saved.id, currencyStr(saved)), reason: `${saved.code} rate ${oldRate} -> ${saved.exchange_rate_to_usd}`,
    });
    return serializeCurrency(saved);
  },
}));

r.path('admin/tax-report/', negotiatedView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    if (!(await hasPermission(req.user, 'finances.taxes', 'read'))) return json(res, 403, { error: 'finances.taxes access required' });
    let q = db.selectFrom('bookings_booking as b').innerJoin('listings_listing as l', 'l.id', 'b.listing_id')
      .select(['b.id', 'b.total_price', 'l.city']).where('b.status', 'in', ['confirmed', 'completed']);
    const since = qp(req, 'since'); const until = qp(req, 'until');
    if (since) q = q.where(utcDate('b.requested_at'), '>=', dateFilterValue(since));
    if (until) q = q.where(utcDate('b.requested_at'), '<=', dateFilterValue(until));
    const rates = new Map<string, { jurisdiction: string; rate_percent: string }>();
    for (const t of await db.selectFrom('payments_taxrate').selectAll().where('is_active', '=', true).orderBy('jurisdiction').execute()) {
      rates.set(pyStrip(t.jurisdiction).toLowerCase(), t);
    }
    const buckets = new Map<string, { gross: PyDecimal; tax: PyDecimal; n: number }>();
    for (const b of await q.orderBy('b.requested_at', 'desc').execute()) {
      const rate = rates.get(pyStrip(b.city || '').toLowerCase());
      if (!rate || b.total_price === null || !dec(b.total_price).truthy()) continue;
      let bucket = buckets.get(rate.jurisdiction);
      if (!bucket) { bucket = { gross: PyDecimal.parse('0'), tax: PyDecimal.parse('0'), n: 0 }; buckets.set(rate.jurisdiction, bucket); }
      const total = dec(b.total_price);
      bucket.gross = bucket.gross.add(total);
      bucket.tax = bucket.tax.add(total.mul(dec(rate.rate_percent)).div(PyDecimal.fromInt(100)).quantize(-2));
      bucket.n += 1;
    }
    return {
      by_jurisdiction: [...buckets.entries()].map(([j, v]) => ({
        jurisdiction: j, gross_total: v.gross.toString(), tax_liability: v.tax.toString(), booking_count: v.n,
      })),
    };
  },
}));

// =====================================================================================
// payment_detail (after the admin/ routes, as in urls.py)
// =====================================================================================
r.path('<uuid:payment_id>/', negotiatedView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    const payment = await paymentOr404((req.params as Record<string, string>).payment_id!);
    try {
      if (payment.user_id !== req.user!.id) return json(res, 403, { success: false, error: 'Permission denied' });
      return json(res, 200, { success: true, payment: await serializePayment(payment) });
    } catch (e) {
      return json(res, 500, { success: false, error: (e as Error).message });
    }
  },
}));

// =====================================================================================
// Webhooks (plain Django views)
// =====================================================================================
function plain(fn: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try { await fn(req, res); } catch (e) { next(e); }
  };
}

/** json.loads(request.body) — bytes are decoded as UTF-8 (BOM-aware) like Python's detect_encoding for the common case. */
function pyJsonLoadsBytes(buf: Buffer): unknown {
  let text: string;
  if (buf.length >= 2 && ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff))) {
    text = new TextDecoder(buf[0] === 0xff ? 'utf-16le' : 'utf-16be').decode(buf);
  } else {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    if (text.startsWith('\ufeff')) throw new SyntaxError('Unexpected UTF-8 BOM');
  }
  return JSON.parse(text);
}

r.path('webhooks/mtn_momo/', plain(async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  let payload: unknown;
  if (!(req as unknown as { rawBody?: Buffer }).rawBody && req.is(['application/json', 'application/*+json']) && req.body !== undefined) {
    payload = req.body; // already parsed by the global JSON parser (invalid JSON never reaches this view — see report)
  } else {
    try { payload = pyJsonLoadsBytes(await rawBody(req)); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
  }
  const gateway = await db.selectFrom('payments_paymentgateway').select('id').where('name', '=', 'mtn_momo').where('is_active', '=', true).executeTakeFirst();
  if (!gateway) return json(res, 500, { error: 'Gateway not configured' });
  const status = dataGet(payload, 'status', 'unknown');
  if (typeof status !== 'string') throw new TypeError(`'${typeof status}' object has no attribute 'lower'`);
  const log = await db.insertInto('payments_webhooklog').values({
    gateway_id: gateway.id, event_type: `payment_${status.toLowerCase()}`, payload: JSON.stringify(payload), processed: false,
    error_message: '', created_at: nowPg(),
  }).returningAll().executeTakeFirstOrThrow();
  const externalId = dataGet(payload, 'externalId', null);
  const pk = externalId === null ? null : parseUuid(externalId);
  const payment = pk === null ? undefined : await getPayment(pk);
  if (!payment) {
    await db.updateTable('payments_webhooklog').set({ error_message: `Payment not found for externalId=${pyStr(externalId)}` }).where('id', '=', log.id).execute();
    return json(res, 404, { error: 'Payment not found' });
  }
  const result = await PaymentService.verifyPayment(payment);
  await db.updateTable('payments_webhooklog').set({
    processed: !!result.success, error_message: result.success ? log.error_message : String(result.error ?? 'verification failed'),
  }).where('id', '=', log.id).execute();
  return json(res, 200, { status: 'ok' });
}));

r.path('webhooks/stripe/', plain(async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  const secret = process.env.STRIPE_WEBHOOK_SECRET || '';
  if (!secret) return json(res, 500, { error: 'Webhook secret not configured' });
  const sig = String(req.headers['stripe-signature'] ?? '');
  if (!sig) return json(res, 400, { error: 'Missing Stripe-Signature header' });
  const raw = await rawBody(req);
  let event: Stripe.Event;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(raw); // payload.decode('utf-8') → ValueError
    event = Stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (e) {
    if (e instanceof Stripe.errors.StripeSignatureVerificationError) return json(res, 400, { error: 'Invalid signature' });
    return json(res, 400, { error: 'Invalid payload' });
  }
  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object as unknown as Record<string, unknown>;
    const meta = ((pi.metadata ?? {}) as Record<string, string>);
    const piId = (pi.id as string) ?? '';
    const type = meta.type ?? '';
    logTransaction(`stripe_${type}_succeeded`, {
      user_id: meta.user_id ?? null, booking_id: meta.booking_id ?? null, tx_ref: piId, gateway: 'stripe', gateway_status: 'succeeded',
      amount: pi.amount ?? null, listing_id: meta.listing_id ?? null,
    });
    if (type === 'viewing_fee') {
      if (meta.viewing_id) {
        const viewing = await getViewing(pyIntPk(meta.viewing_id));
        if (viewing) {
          await db.updateTable('bookings_viewingappointment').set({ stripe_payment_intent_id: piId }).where('id', '=', viewing.id).execute();
          await markViewingFeePaid({ ...viewing, stripe_payment_intent_id: piId });
        }
      }
    } else if (type === 'property_payment') {
      const bookingId = meta.booking_id;
      if (!bookingId) {
        const prs = await db.selectFrom('bookings_paymentrequest').selectAll().where('stripe_payment_intent_id', '=', piId).execute();
        if (prs.length > 1) throw new Error('get() returned more than one PaymentRequest');
        const pr = prs[0];
        if (pr) {
          await db.updateTable('bookings_paymentrequest').set({ is_paid: true, paid_at: nowPg() }).where('id', '=', pr.id).execute();
          const booking = (await getBooking(pr.booking_id))!;
          if (booking.status === 'payment_requested') {
            await db.updateTable('bookings_booking').set({ status: 'payment_received' }).where('id', '=', booking.id).execute();
            await bookingPostSave({ ...booking, status: 'payment_received' } as never, { created: false, oldStatus: booking.status });
          }
        }
      } else {
        const pk = pyIntPk(bookingId);
        let booking = await db.selectFrom('bookings_booking').selectAll().where('id', '=', pk)
          .where('status', 'in', ['awaiting_payment', 'payment_requested']).executeTakeFirst();
        if (booking) {
          await db.updateTable('bookings_booking').set({ stripe_payment_intent_id: piId }).where('id', '=', booking.id).execute();
          booking = { ...booking, stripe_payment_intent_id: piId };
          await bookingPostSave(booking as never, { created: false, oldStatus: booking.status });
          await markGuestPaid(booking);
          const pr = await db.selectFrom('bookings_paymentrequest').select('id').where('booking_id', '=', booking.id).executeTakeFirst();
          if (pr) await db.updateTable('bookings_paymentrequest').set({ is_paid: true, paid_at: nowPg(), stripe_payment_intent_id: piId }).where('id', '=', pr.id).execute();
        }
      }
    }
  }
  return json(res, 200, { status: 'ok' });
}));

// =====================================================================================
// Stripe PaymentIntents
// =====================================================================================
const STRIPE_503 = { error: 'Stripe is not configured on the server' };
const lower = (v: unknown) => {
  if (typeof v !== 'string') throw new TypeError(`'${typeof v}' object has no attribute 'lower'`);
  return v.toLowerCase();
};

r.path('stripe/payment-intent/', negotiatedView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    const secret = process.env.STRIPE_SECRET_KEY || '';
    if (!secret) return json(res, 503, STRIPE_503);
    const data = await requestData(req, res);
    const listingId = dataGet(data, 'listing_id', null);
    const checkIn = dataGet(data, 'check_in', null);
    const checkOut = dataGet(data, 'check_out', null);
    const roomId = dataGet(data, 'room_id', null);
    const currency = lower(dataGet(data, 'currency', 'usd'));
    if (!truthy(listingId) || !truthy(checkIn) || !truthy(checkOut)) return json(res, 400, { error: 'listing_id, check_in, and check_out are required' });
    const lid = intLookup(listingId);
    const listing = lid === null ? undefined : await db.selectFrom('listings_listing').selectAll().where('id', '=', lid).where('is_available', '=', true).executeTakeFirst();
    if (!listing) return json(res, 404, { error: 'Listing not found' });
    let room: { price_per_night: string } | null = null;
    if (truthy(roomId)) {
      const rid = intLookup(roomId);
      const found = rid === null ? undefined : await db.selectFrom('listings_hotelroom').selectAll().where('id', '=', rid)
        .where('listing_id', '=', listing.id).where('is_active', '=', true).executeTakeFirst();
      if (!found) return json(res, 404, { error: 'Room not found' });
      room = found;
    }
    if (typeof checkIn !== 'string' || typeof checkOut !== 'string') throw new TypeError('fromisoformat: argument must be str');
    const ci = fromIsoDate(checkIn); const co = fromIsoDate(checkOut);
    if (ci === null || co === null) return json(res, 400, { error: 'Invalid date format — use YYYY-MM-DD' });
    if (ci >= co) return json(res, 400, { error: 'check_out must be after check_in' });
    const today = todayUtc();
    if (ci < today) return json(res, 400, { error: 'check_in cannot be in the past' });
    const pricing = await computeListingPricing(listing, ci, co, room);
    const amountCents = pyRound((pricing.discounted_subtotal + pricing.service_fee) * 100);
    try {
      const intent = await stripeClient(secret).paymentIntents.create({
        amount: amountCents, currency,
        metadata: { user_id: String(req.user!.id), listing_id: pyStr(listingId), check_in: checkIn, check_out: checkOut, room_id: truthy(roomId) ? pyStr(roomId) : '' },
      });
      return json(res, 200, { client_secret: intent.client_secret, amount_cents: amountCents });
    } catch (e) {
      if (e instanceof Stripe.errors.StripeError) return json(res, 400, { error: e.message || stripeErrStr(e) });
      return json(res, 500, { error: 'Could not create payment intent' });
    }
  },
}));

r.path('stripe/booking-payment-intent/', negotiatedView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    const secret = process.env.STRIPE_SECRET_KEY || '';
    if (!secret) return json(res, 503, STRIPE_503);
    const data = await requestData(req, res);
    const bookingId = dataGet(data, 'booking_id', null);
    const currency = lower(dataGet(data, 'currency', 'usd'));
    const pk = intLookup(bookingId);
    const booking = pk === null ? undefined : await db.selectFrom('bookings_booking').selectAll().where('id', '=', pk).where('customer_id', '=', req.user!.id).executeTakeFirst();
    if (!booking) return json(res, 404, { error: 'Booking not found' });
    if (!['awaiting_payment', 'payment_requested'].includes(booking.status)) {
      return json(res, 400, { error: `This booking is not awaiting payment (status: ${booking.status}).` });
    }
    if (booking.total_price === null) return json(res, 400, { error: 'Booking has no price set' });
    const amountCents = pyRound(Number(booking.total_price) * 100);
    try {
      const intent = await stripeClient(secret).paymentIntents.create({
        amount: amountCents, currency, metadata: { user_id: String(req.user!.id), booking_id: String(booking.id), type: 'property_payment' },
      });
      return json(res, 200, { client_secret: intent.client_secret, amount_cents: amountCents });
    } catch (e) {
      return json(res, 400, { error: e instanceof Stripe.errors.StripeError ? stripeErrStr(e) : (e as Error).message });
    }
  },
}));

r.path('stripe/viewing-fee-intent/', negotiatedView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    const secret = process.env.STRIPE_SECRET_KEY || '';
    if (!secret) return json(res, 503, STRIPE_503);
    const data = await requestData(req, res);
    const viewingId = dataGet(data, 'viewing_id', null);
    const currency = lower(dataGet(data, 'currency', 'usd'));
    const pk = intLookup(viewingId);
    const viewing = pk === null ? undefined : await db.selectFrom('bookings_viewingappointment').selectAll().where('id', '=', pk).where('guest_id', '=', req.user!.id).executeTakeFirst();
    if (!viewing) return json(res, 404, { error: 'Viewing not found' });
    if (viewing.is_fee_paid) return json(res, 400, { error: 'Viewing fee already paid' });
    const amountCents = pyRound(Number(viewing.viewing_fee) * 100);
    try {
      const intent = await stripeClient(secret).paymentIntents.create({
        amount: amountCents, currency, metadata: { user_id: String(req.user!.id), viewing_id: String(viewing.id), type: 'viewing_fee' },
      });
      return json(res, 200, { client_secret: intent.client_secret, amount_cents: amountCents });
    } catch (e) {
      return json(res, 400, { error: e instanceof Stripe.errors.StripeError ? stripeErrStr(e) : (e as Error).message });
    }
  },
}));

// =====================================================================================
// Saved cards
// =====================================================================================
const isDigits = (s: string) => /^[\p{Nd}\u00b2\u00b3\u00b9\u2070-\u2079\u2080-\u2089]+$/u.test(s);
const cardSpecs: FieldSpec[] = [
  { name: 'cardholder_name', kind: 'char', maxLength: 100 },
  { name: 'last4', kind: 'char', maxLength: 4, validate: (v: string) => (!isDigits(v) || [...v].length !== 4 ? fail('last4 must be exactly 4 digits.') : v) },
  { name: 'card_type', kind: 'choice', choices: ['visa', 'mastercard', 'amex', 'discover', 'other'], required: false },
  {
    name: 'expiry_month', kind: 'char', maxLength: 2,
    validate: (v: string) => {
      if (!isDigits(v)) return fail('expiry_month must be 01-12.');
      const n = Number(v);
      if (!(n >= 1 && n <= 12)) return fail('expiry_month must be 01-12.');
      return v.padStart(2, '0');
    },
  },
  { name: 'expiry_year', kind: 'char', maxLength: 4, validate: (v: string) => (!isDigits(v) || [...v].length !== 4 ? fail('expiry_year must be a 4-digit year.') : v) },
  { name: 'is_default', kind: 'bool', required: false },
];

async function unsetOtherDefaults(userId: number, exceptId: number | null) {
  let q = db.updateTable('payments_savedcard').set({ is_default: false }).where('user_id', '=', userId).where('is_default', '=', true);
  if (exceptId !== null) q = q.where('id', '!=', exceptId);
  await q.execute();
}

r.path('cards/', negotiatedView({
  permissions: [IsAuthenticated],
  async GET(req) {
    const rows = await db.selectFrom('payments_savedcard').selectAll().where('user_id', '=', req.user!.id)
      .orderBy('is_default', 'desc').orderBy('created_at', 'desc').execute();
    return rows.map(serializeSavedCard);
  },
  async POST(req, res) {
    const data = await requestData(req, res);
    const { errors, values } = await validate(data, cardSpecs);
    if (errors) return json(res, 400, errors);
    const isFirst = !(await db.selectFrom('payments_savedcard').select('id').where('user_id', '=', req.user!.id).executeTakeFirst());
    const isDefault = (values.is_default as boolean | undefined) || isFirst;
    if (isDefault) await unsetOtherDefaults(req.user!.id, null);
    const card = await db.insertInto('payments_savedcard').values({
      card_type: 'other', ...values, user_id: req.user!.id, is_default: !!isDefault, created_at: nowPg(),
    } as never).returningAll().executeTakeFirstOrThrow();
    return json(res, 201, serializeSavedCard(card));
  },
}));

async function cardOr404(req: ApiRequest) {
  const id = intKwarg(req, 'card_id');
  const card = id === null ? undefined : await db.selectFrom('payments_savedcard').selectAll().where('id', '=', id).where('user_id', '=', req.user!.id).executeTakeFirst();
  if (!card) throw notFoundFor('SavedCard');
  return card;
}

async function updateCard(req: ApiRequest, res: Response, partial: boolean) {
  const card = await cardOr404(req);
  const data = await requestData(req, res);
  const { errors, values } = await validate(data, cardSpecs, { partial });
  if (errors) return json(res, 400, errors);
  const merged = { ...card, ...values };
  if (merged.is_default) await unsetOtherDefaults(req.user!.id, card.id);
  const { id: _id, ...cols } = merged;
  void _id;
  const saved = await db.updateTable('payments_savedcard').set(cols as never).where('id', '=', card.id).returningAll().executeTakeFirstOrThrow();
  return serializeSavedCard(saved);
}

r.path('cards/<int:card_id>/', negotiatedView({
  permissions: [IsAuthenticated],
  PUT: (req, res) => updateCard(req, res, false),
  PATCH: (req, res) => updateCard(req, res, true),
  async DELETE(req, res) {
    const card = await cardOr404(req);
    await db.deleteFrom('payments_savedcard').where('id', '=', card.id).execute();
    const remaining = await db.selectFrom('payments_savedcard').select(['id', 'is_default']).where('user_id', '=', req.user!.id)
      .orderBy('is_default', 'desc').orderBy('created_at', 'desc').execute();
    if (remaining.length && !remaining.some((c) => c.is_default)) {
      await db.updateTable('payments_savedcard').set({ is_default: true }).where('id', '=', remaining[0]!.id).execute();
    }
    res.status(204).end();
  },
}));

void HttpResponseError; void NotFound; void pyFloatStr;
