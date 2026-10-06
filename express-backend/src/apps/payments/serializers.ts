// payments/serializers.py (output side) and the views' hand-written _serialize_* helpers.

import { db } from '../../db/index.js';
import { drf, isoformat } from '../../lib/datetime.js';
import { displayName } from '../../domain/notifications.js';
import { dec } from './decimal.js';
import { CARD_TYPE_LABELS, type Executor } from './models.js';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** DecimalField.to_representation: '{:f}' of the value quantized to decimal_places. */
export function decStr(v: string | null, places: number): string | null {
  if (v === null || v === undefined) return null;
  return dec(v).quantize(-places).toFixedString();
}

/** PaymentSerializer — booking_title is skipped (absent) when the payment has no booking. */
export async function serializePayment(p: Row, ex: Executor = db): Promise<Row> {
  const gw = await ex.selectFrom('payments_paymentgateway').select('name').where('id', '=', p.gateway_id).executeTakeFirstOrThrow();
  const cur = await ex.selectFrom('payments_currency').select(['code', 'symbol']).where('id', '=', p.currency_id).executeTakeFirstOrThrow();
  const user = await ex.selectFrom('users_user').select('username').where('id', '=', p.user_id).executeTakeFirstOrThrow();
  const out: Row = { id: p.id, booking: p.booking_id };
  if (p.booking_id !== null) {
    const b = await ex.selectFrom('bookings_booking').select('listing_id').where('id', '=', p.booking_id).executeTakeFirstOrThrow();
    const l = await ex.selectFrom('listings_listing').select('title').where('id', '=', b.listing_id).executeTakeFirstOrThrow();
    out.booking_title = l.title;
  }
  Object.assign(out, {
    viewing: p.viewing_id, purpose: p.purpose, user: p.user_id, customer_username: user.username,
    gateway: p.gateway_id, gateway_name: gw.name, amount: decStr(p.amount, 2), currency: p.currency_id,
    currency_code: cur.code, currency_symbol: cur.symbol, payment_method: p.payment_method, status: p.status,
    phone_number: p.phone_number, card_last4: p.card_last4, card_type: p.card_type,
    created_at: drf(p.created_at), completed_at: drf(p.completed_at),
  });
  return out;
}

/** RefundDetailSerializer; null → DRF serializes None as an all-default dict. */
export async function serializeRefund(r: Row | undefined, ex: Executor = db): Promise<Row> {
  if (!r) {
    return {
      payment: null, payment_gateway: '', payment_amount: null, payment_currency: '',
      amount: null, reason: '', reason_code: 'other', status: 'pending', gateway_refund_id: '',
    };
  }
  const p = await ex.selectFrom('payments_payment').select(['gateway_id', 'amount', 'currency_id']).where('id', '=', r.payment_id).executeTakeFirstOrThrow();
  const gw = await ex.selectFrom('payments_paymentgateway').select('name').where('id', '=', p.gateway_id).executeTakeFirstOrThrow();
  const cur = await ex.selectFrom('payments_currency').select('code').where('id', '=', p.currency_id).executeTakeFirstOrThrow();
  return {
    id: r.id, payment: r.payment_id, payment_gateway: gw.name, payment_amount: decStr(p.amount, 2), payment_currency: cur.code,
    amount: decStr(r.amount, 2), reason: r.reason, reason_code: r.reason_code, status: r.status, gateway_refund_id: r.gateway_refund_id,
    created_at: drf(r.created_at), processed_at: drf(r.processed_at),
  };
}

export function serializeSavedCard(c: Row): Row {
  return {
    id: c.id, cardholder_name: c.cardholder_name, last4: c.last4, card_type: c.card_type,
    card_type_display: CARD_TYPE_LABELS[c.card_type] ?? c.card_type,
    expiry_month: c.expiry_month, expiry_year: c.expiry_year, is_default: c.is_default, created_at: drf(c.created_at),
  };
}

export function serializePlatformFee(f: Row): Row {
  return {
    viewing_fee: decStr(f.viewing_fee, 2), service_fee_percent: decStr(f.service_fee_percent, 2),
    transaction_fee_type: f.transaction_fee_type, transaction_fee_value: decStr(f.transaction_fee_value, 4),
    transaction_fee_min: decStr(f.transaction_fee_min, 2), transaction_fee_max: decStr(f.transaction_fee_max, 2),
    updated_at: drf(f.updated_at),
  };
}

export async function serializeTaxRate(t: Row, ex: Executor = db): Promise<Row> {
  const u = t.created_by_id === null ? null
    : await ex.selectFrom('users_user').select('username').where('id', '=', t.created_by_id).executeTakeFirst();
  return {
    id: t.id, jurisdiction: t.jurisdiction, rate_percent: decStr(t.rate_percent, 2), is_active: t.is_active,
    created_by: t.created_by_id, created_by_username: u ? u.username : null,
    created_at: drf(t.created_at), updated_at: drf(t.updated_at),
  };
}

export function serializeCurrency(c: Row): Row {
  return {
    id: c.id, code: c.code, name: c.name, symbol: c.symbol, exchange_rate_to_usd: decStr(c.exchange_rate_to_usd, 4),
    is_active: c.is_active, created_at: drf(c.created_at), updated_at: drf(c.updated_at),
  };
}

const iso = (v: string | null) => (v === null || v === undefined ? null : isoformat(v));

/** views._serialize_payout */
export async function serializePayout(p: Row, ex: Executor = db): Promise<Row> {
  let listingTitle = '';
  if (p.booking_id) {
    const b = await ex.selectFrom('bookings_booking').select('listing_id').where('id', '=', p.booking_id).executeTakeFirstOrThrow();
    listingTitle = (await ex.selectFrom('listings_listing').select('title').where('id', '=', b.listing_id).executeTakeFirstOrThrow()).title;
  }
  const host = await ex.selectFrom('users_user').select(['first_name', 'last_name', 'username']).where('id', '=', p.host_id).executeTakeFirstOrThrow();
  return {
    id: String(p.id), booking_id: p.booking_id, listing_title: listingTitle, host_name: displayName(host), host_id: p.host_id,
    gross_amount: String(p.gross_amount), service_fee_amount: String(p.service_fee_amount), net_amount: String(p.net_amount),
    currency: p.currency, status: p.status, reference: p.reference, paid_at: iso(p.paid_at), cancelled_at: iso(p.cancelled_at),
    cancellation_reason: p.cancellation_reason, created_at: iso(p.created_at),
  };
}

/** views._serialize_agent_commission */
export async function serializeAgentCommission(c: Row, ex: Executor = db): Promise<Row> {
  const listingTitle = c.listing_id
    ? (await ex.selectFrom('listings_listing').select('title').where('id', '=', c.listing_id).executeTakeFirstOrThrow()).title : '';
  const agent = await ex.selectFrom('users_user').select(['first_name', 'last_name', 'username']).where('id', '=', c.agent_id).executeTakeFirstOrThrow();
  return {
    id: c.id, booking_id: c.booking_id, listing_title: listingTitle, agent_name: displayName(agent), agent_id: c.agent_id,
    booking_amount: String(c.booking_amount), amount: String(c.amount), currency: c.currency, status: c.status,
    reference: c.reference, paid_at: iso(c.paid_at), voided_at: iso(c.voided_at), created_at: iso(c.created_at),
  };
}

export function serializeEmployee(e: Row): Row {
  return {
    id: e.id, name: e.name, role_title: e.role_title, momo_number: e.momo_number, momo_network: e.momo_network,
    is_active: e.is_active, created_at: iso(e.created_at),
  };
}

export async function serializeEmployeePayment(p: Row, ex: Executor = db): Promise<Row> {
  const e = await ex.selectFrom('payments_employee').select('name').where('id', '=', p.employee_id).executeTakeFirstOrThrow();
  return {
    id: String(p.id), employee_id: p.employee_id, employee_name: e.name, amount: String(p.amount), currency: p.currency,
    description: p.description, status: p.status, reference: p.reference, error_message: p.error_message, created_at: iso(p.created_at),
  };
}
