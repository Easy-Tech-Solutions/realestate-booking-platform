// payments/models.py — choices, PlatformFee singleton helpers, Payment.save()
// amount_in_usd rule, and the __str__ of every model (used by audit-log targets).

import type { Transaction } from 'kysely';
import { db, type DB } from '../../db/index.js';
import { nowPg } from '../../lib/datetime.js';
import { dbDecimal, dec, PyDecimal } from './decimal.js';

export type Executor = typeof db | Transaction<DB>;

export const PAYMENT_STATUS_CHOICES = ['pending', 'processing', 'completed', 'failed', 'cancelled', 'refunded', 'partially_refunded'];
export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  card: 'Bank Card', mobile_money: 'Mobile Money', bank_transfer: 'Bank Transfer',
};

/** Refund.ReasonCode (TextChoices, in declaration order). */
export const REASON_CODES: [string, string][] = [
  ['misrepresentation', 'Property misrepresentation'],
  ['legal_issue', 'Legal issue discovered'],
  ['safety_concern', 'Safety concern'],
  ['change_of_mind', 'Change of mind (not eligible)'],
  ['other', 'Other (admin discretion)'],
];
export const REASON_CODE_VALUES = REASON_CODES.map(([v]) => v);
export const ELIGIBLE_REASON_CODES = ['misrepresentation', 'legal_issue', 'safety_concern'];

export const CARD_TYPE_LABELS: Record<string, string> = {
  visa: 'Visa', mastercard: 'Mastercard', amex: 'American Express', discover: 'Discover', other: 'Other',
};

export const TRANSACTION_FEE_TYPE_LABELS: Record<string, string> = {
  fixed: 'Fixed Amount (USD)', percentage: 'Percentage of transaction', range: 'Range (Min–Max USD)',
};

// ---- PlatformFee ---------------------------------------------------------------------

export type PlatformFeeRow = Awaited<ReturnType<typeof getPlatformFee>>;

/** PlatformFee.get_current(): get_or_create(pk=1) with the model defaults. */
export async function getPlatformFee(ex: Executor = db) {
  const row = await ex.selectFrom('payments_platformfee').selectAll().where('id', '=', 1).executeTakeFirst();
  if (row) return row;
  await ex.insertInto('payments_platformfee').values({
    id: 1, viewing_fee: '3.00', service_fee_percent: '4.00', transaction_fee_type: 'fixed', transaction_fee_value: '0.0000',
    transaction_fee_min: null, transaction_fee_max: null, agent_commission_percent: '0.50', updated_at: nowPg(),
  }).onConflict((oc) => oc.column('id').doNothing()).execute();
  return ex.selectFrom('payments_platformfee').selectAll().where('id', '=', 1).executeTakeFirstOrThrow();
}

/** PlatformFee.service_fee_rate: service_fee_percent / 100. */
export function serviceFeeRate(fee: { service_fee_percent: string | null }): PyDecimal {
  const pct = fee.service_fee_percent ? dec(fee.service_fee_percent) : PyDecimal.fromInt(0);
  return (pct.truthy() ? pct : PyDecimal.fromInt(0)).div(PyDecimal.fromInt(100));
}

/** PlatformFee.agent_commission_rate */
export function agentCommissionRate(fee: { agent_commission_percent: string | null }): PyDecimal {
  const pct = fee.agent_commission_percent ? dec(fee.agent_commission_percent) : PyDecimal.fromInt(0);
  return (pct.truthy() ? pct : PyDecimal.fromInt(0)).div(PyDecimal.fromInt(100));
}

/** PlatformFee.compute_transaction_fee(amount_usd) */
export function computeTransactionFee(fee: PlatformFeeRow, amountUsd: PyDecimal): PyDecimal {
  if (fee.transaction_fee_type === 'fixed') return dec(fee.transaction_fee_value);
  if (fee.transaction_fee_type === 'percentage') return amountUsd.mul(dec(fee.transaction_fee_value)).div(PyDecimal.fromInt(100));
  if (fee.transaction_fee_type === 'range') {
    const f = amountUsd.mul(PyDecimal.parse('0.029'));
    const lo = fee.transaction_fee_min && dec(fee.transaction_fee_min).truthy() ? dec(fee.transaction_fee_min) : PyDecimal.parse('0');
    const hi = fee.transaction_fee_max === null ? null : dec(fee.transaction_fee_max);
    if (f.lt(lo)) return lo;
    if (hi && hi.truthy() && f.gt(hi)) return hi;
    return f;
  }
  return PyDecimal.parse('0');
}

/** get_service_fee_rate() */
export async function getServiceFeeRate(ex: Executor = db): Promise<PyDecimal> {
  return serviceFeeRate(await getPlatformFee(ex));
}
/** get_agent_commission_rate() */
export async function getAgentCommissionRate(ex: Executor = db): Promise<PyDecimal> {
  return agentCommissionRate(await getPlatformFee(ex));
}
/** get_viewing_fee() */
export async function getViewingFee(ex: Executor = db): Promise<PyDecimal> {
  return dec((await getPlatformFee(ex)).viewing_fee);
}

/** PlatformFee.__str__ */
export function platformFeeStr(fee: { service_fee_percent: string; transaction_fee_type: string }): string {
  const label = TRANSACTION_FEE_TYPE_LABELS[fee.transaction_fee_type] ?? fee.transaction_fee_type;
  return `Service fee: ${fee.service_fee_percent}% | Transaction: ${label}`;
}

// ---- Payment.save() ----------------------------------------------------------------------

/** amount_in_usd = Decimal(str(amount)) / currency.exchange_rate_to_usd (when amount is truthy), stored at 2 dp. */
export function amountInUsd(amount: PyDecimal, rate: string): string | null {
  if (!amount.truthy()) return null;
  return dbDecimal(amount.div(dec(rate)));
}

// ---- __str__ --------------------------------------------------------------------------------

export async function paymentStr(p: { id: string; amount: string; currency_id: number }, ex: Executor = db): Promise<string> {
  const c = await ex.selectFrom('payments_currency').select('code').where('id', '=', p.currency_id).executeTakeFirstOrThrow();
  return `Payment ${p.id} - ${p.amount} ${c.code}`;
}

export async function payoutStr(p: { host_id: number; net_amount: string; currency: string; status: string }, ex: Executor = db): Promise<string> {
  const h = await ex.selectFrom('users_user').select('username').where('id', '=', p.host_id).executeTakeFirstOrThrow();
  return `Payout to ${h.username} — ${p.net_amount} ${p.currency} (${p.status})`;
}

export async function employeePaymentStr(p: { employee_id: number; amount: string; currency: unknown; status: string }, ex: Executor = db): Promise<string> {
  const e = await ex.selectFrom('payments_employee').select('name').where('id', '=', p.employee_id).executeTakeFirstOrThrow();
  return `Payment to ${e.name} — ${p.amount} ${String(p.currency)} (${p.status})`;
}

export function escrowHoldStr(h: { booking_id: number; released_at: unknown }): string {
  return `Hold on booking #${h.booking_id} (${h.released_at === null ? 'active' : 'released'})`;
}

export function taxRateStr(t: { jurisdiction: string; rate_percent: string }): string {
  return `${t.jurisdiction} — ${t.rate_percent}%`;
}

export function currencyStr(c: { code: string; name: string }): string {
  return `${c.code} - ${c.name}`;
}

export async function agentCommissionStr(c: { agent_id: number; amount: string; currency: string; status: string }, ex: Executor = db): Promise<string> {
  const a = await ex.selectFrom('users_user').select('username').where('id', '=', c.agent_id).executeTakeFirstOrThrow();
  return `Commission ${c.amount} ${c.currency} → ${a.username} (${c.status})`;
}

/** bookings.Booking.__str__ */
export async function bookingStr(b: { customer_id: number; listing_id: number; status: string }, ex: Executor = db): Promise<string> {
  const u = await ex.selectFrom('users_user').select('username').where('id', '=', b.customer_id).executeTakeFirstOrThrow();
  const l = await ex.selectFrom('listings_listing').select('title').where('id', '=', b.listing_id).executeTakeFirstOrThrow();
  return `${u.username} - ${l.title} (${b.status})`;
}
