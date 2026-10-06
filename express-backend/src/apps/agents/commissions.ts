// agents.commissions — sourcing-agent commission (created at admin payment
// confirmation, voided on refund before disbursement).

import { db } from '../../db/index.js';
import { nowPg } from '../../lib/datetime.js';
import { logger } from '../../lib/logger.js';
import { notifyAgentCommissionEarned } from '../../domain/notifications.js';
import { Dec } from '../notifications/decimal.js';
import { getAgentCommissionRateDec as getAgentCommissionRate } from '../../domain/payments.js';
import { bookingTotalAmount, type BookingRow, type Executor } from '../bookings/services.js';

/** _booking_rent(booking): total_price − (service_fee or 0), else total_amount; quantized to cents. */
export async function bookingRent(booking: BookingRow, ex: Executor = db): Promise<Dec> {
  if (booking.total_price !== null) {
    const fee = booking.service_fee === null ? '0' : booking.service_fee;
    return Dec.from(booking.total_price).sub(Dec.from(fee)).quantize(2);
  }
  return (await bookingTotalAmount(booking, ex)).quantize(2);
}

/** create_agent_commission_for_booking(booking) — idempotent; null for non-agent listings. */
export async function createAgentCommissionForBooking(booking: BookingRow, ex: Executor = db) {
  const listing = await ex.selectFrom('listings_listing').select(['id', 'sourced_by_agent_id']).where('id', '=', booking.listing_id).executeTakeFirstOrThrow();
  if (listing.sourced_by_agent_id === null) return null;
  const existing = await ex.selectFrom('agents_agentcommission').selectAll().where('booking_id', '=', booking.id).executeTakeFirst();
  if (existing) return existing;
  const rent = await bookingRent(booking, ex);
  const amount = rent.mul(await getAgentCommissionRate(ex)).quantize(2);
  const now = nowPg();
  const commission = await ex.insertInto('agents_agentcommission').values({
    booking_id: booking.id, agent_id: listing.sourced_by_agent_id, listing_id: listing.id,
    booking_amount: rent.toString(), amount: amount.toString(), currency: 'USD', status: 'pending', reference: '',
    paid_at: null, paid_by_id: null, voided_at: null, notes: '', created_at: now, updated_at: now,
  }).returningAll().executeTakeFirstOrThrow();
  try {
    await notifyAgentCommissionEarned(commission, ex);
  } catch (e) {
    logger.error({ err: e }, `notify_agent_commission_earned failed for booking #${booking.id}`);
  }
  return commission;
}

/** void_agent_commission(booking, reason='') — only a still-PENDING commission. */
export async function voidAgentCommission(booking: { id: number }, reason = '', ex: Executor = db) {
  const c = await ex.selectFrom('agents_agentcommission').selectAll().where('booking_id', '=', booking.id).where('status', '=', 'pending')
    .orderBy('created_at', 'desc').executeTakeFirst();
  if (!c) return null;
  return ex.updateTable('agents_agentcommission').set({
    status: 'voided', voided_at: nowPg(), notes: reason ? reason : c.notes, updated_at: nowPg(),
  }).where('id', '=', c.id).returningAll().executeTakeFirstOrThrow();
}
