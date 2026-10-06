// payments — what other apps import (port of payments.models helpers,
// payments.services.PaymentService and the payment serializers).
//
//   import { getServiceFeeRate, getPlatformFee, PaymentService, PyDecimal } from '../../domain/payments.js';
//
// Amounts are PyDecimal (Python decimal.Decimal semantics); Postgres numeric
// strings go in via dec('12.30').

export { PyDecimal, DecimalException, dec, dbDecimal } from '../apps/payments/decimal.js';
export {
  getPlatformFee, getServiceFeeRate, getAgentCommissionRate, getViewingFee, serviceFeeRate, agentCommissionRate,
  computeTransactionFee, platformFeeStr, amountInUsd, paymentStr, payoutStr, escrowHoldStr,
  PAYMENT_METHOD_LABELS, PAYMENT_STATUS_CHOICES, REASON_CODES, REASON_CODE_VALUES, ELIGIBLE_REASON_CODES, CARD_TYPE_LABELS,
  type PlatformFeeRow,
} from '../apps/payments/models.js';
export { PaymentService, savePayment, getPayment, reconcilePayments, DoesNotExist, type PaymentRow } from '../apps/payments/services.js';
export { MTNMoMoGateway, type GatewayResult } from '../apps/payments/gateways/mtnMomo.js';
export {
  serializePayment, serializeRefund, serializePayout, serializeAgentCommission, serializeSavedCard,
  serializePlatformFee, serializeTaxRate, serializeCurrency, decStr,
} from '../apps/payments/serializers.js';

import { db } from '../db/index.js';
import { Dec } from '../apps/notifications/decimal.js';
import { getAgentCommissionRate, getServiceFeeRate, getViewingFee, type Executor } from '../apps/payments/models.js';

// The same PlatformFee rates as notifications' Dec, for the ports that do their
// money math with it (notifications, bookings, agents).
/** get_service_fee_rate() as a Dec. */
export async function getServiceFeeRateDec(ex: Executor = db): Promise<Dec> {
  return Dec.from((await getServiceFeeRate(ex)).toString());
}
/** get_agent_commission_rate() as a Dec. */
export async function getAgentCommissionRateDec(ex: Executor = db): Promise<Dec> {
  return Dec.from((await getAgentCommissionRate(ex)).toString());
}
/** get_viewing_fee() as the stored decimal text. */
export async function getViewingFeeStr(ex: Executor = db): Promise<string> {
  return (await getViewingFee(ex)).toString();
}

/** An active (unreleased) EscrowHold on the booking blocks admin_confirm_payment. */
export async function activeEscrowHold(bookingId: number, ex: Executor = db) {
  return ex.selectFrom('payments_escrowhold').selectAll().where('booking_id', '=', bookingId).where('released_at', 'is', null)
    .orderBy('held_at', 'desc').executeTakeFirst();
}
