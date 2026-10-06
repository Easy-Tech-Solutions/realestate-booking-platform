// payments/services.py — PaymentService. Every Payment save goes through
// savePayment() so the notifications payment_pre_save/post_save signal
// equivalent (paymentPostSave) fires exactly where Django's would.

import { db } from '../../db/index.js';
import { nowPg } from '../../lib/datetime.js';
import { logger } from '../../lib/logger.js';
import { paymentPostSave } from '../../domain/notifications.js';
import { dbDecimal, dec, PyDecimal } from './decimal.js';
import { MTNMoMoGateway, type GatewayResult } from './gateways/mtnMomo.js';
import { amountInUsd, type Executor } from './models.js';
import { pyFloatStr } from './py.js';
import { getBooking, getViewing, markGuestPaid, markViewingFeePaid } from '../../domain/bookings.js';

export type PaymentRow = NonNullable<Awaited<ReturnType<typeof getPayment>>>;

/** Python's DoesNotExist (message = str(exc)). */
export class DoesNotExist extends Error {}

export async function getPayment(id: string, ex: Executor = db) {
  return ex.selectFrom('payments_payment').selectAll().where('id', '=', id).executeTakeFirst();
}

const GATEWAY_CLASSES: Record<string, typeof MTNMoMoGateway> = { mtn_momo: MTNMoMoGateway };

/** Payment.save(update_fields=...) + the pre_save/post_save notification receivers. */
export async function savePayment(payment: PaymentRow, fields: Partial<PaymentRow>, ex: Executor = db): Promise<PaymentRow> {
  const old = await ex.selectFrom('payments_payment').select('status').where('id', '=', payment.id).executeTakeFirst();
  const set: Record<string, unknown> = { ...fields };
  if ('gateway_response' in set) set.gateway_response = JSON.stringify(set.gateway_response);
  await ex.updateTable('payments_payment').set(set as never).where('id', '=', payment.id).execute();
  const saved = { ...payment, ...fields } as PaymentRow;
  await paymentPostSave(saved as never, { oldStatus: old?.status ?? null }, ex);
  return saved;
}

async function gatewayName(payment: { gateway_id: number }, ex: Executor = db): Promise<string> {
  return (await ex.selectFrom('payments_paymentgateway').select('name').where('id', '=', payment.gateway_id).executeTakeFirstOrThrow()).name;
}

async function currencyCode(payment: { currency_id: number }, ex: Executor = db): Promise<string> {
  return (await ex.selectFrom('payments_currency').select('code').where('id', '=', payment.currency_id).executeTakeFirstOrThrow()).code;
}

export const PaymentService = {
  /** get_gateway(name): active configured gateway with an implementation, else null. */
  async getGateway(name: string, ex: Executor = db): Promise<MTNMoMoGateway | null> {
    const row = await ex.selectFrom('payments_paymentgateway').selectAll().where('name', '=', name).where('is_active', '=', true).executeTakeFirst();
    const cls = GATEWAY_CLASSES[name];
    if (!row || !cls) return null;
    return new cls(row);
  },

  /** create_payment(...) — exactly one of booking / viewing. */
  async createPayment(args: {
    gatewayName: string; amount: PyDecimal; currencyCode: string; paymentMethod: string;
    booking?: { id: number; customer_id: number } | null; viewing?: { id: number; guest_id: number } | null;
    phoneNumber?: string; networkProvider?: string;
  }): Promise<PaymentRow> {
    const booking = args.booking ?? null;
    const viewing = args.viewing ?? null;
    if ((booking === null) === (viewing === null)) throw new Error('Provide exactly one of booking or viewing');
    return db.transaction().execute(async (trx) => {
      const currency = await trx.selectFrom('payments_currency').selectAll().where('code', '=', args.currencyCode).execute();
      if (currency.length !== 1) throw new DoesNotExist(currency.length ? 'get() returned more than one Currency' : 'Currency matching query does not exist.');
      const gateway = await trx.selectFrom('payments_paymentgateway').selectAll().where('name', '=', args.gatewayName).executeTakeFirst();
      if (!gateway) throw new DoesNotExist('PaymentGateway matching query does not exist.');
      const usd = amountInUsd(args.amount, currency[0]!.exchange_rate_to_usd);
      const row = await trx.insertInto('payments_payment').values({
        id: crypto.randomUUID(),
        booking_id: booking?.id ?? null,
        viewing_id: viewing?.id ?? null,
        purpose: booking ? 'booking' : 'viewing_fee',
        gateway_id: gateway.id,
        user_id: booking ? booking.customer_id : viewing!.guest_id,
        amount: dbDecimal(args.amount, 12, 2),
        currency_id: currency[0]!.id,
        amount_in_usd: usd as string, // NULL → not-null violation, like Django
        payment_method: args.paymentMethod,
        gateway_transaction_id: '',
        gateway_response: JSON.stringify({}),
        status: 'pending',
        created_at: nowPg(),
        processed_at: null,
        completed_at: null,
        phone_number: args.phoneNumber ?? '',
        network_provider: args.networkProvider ?? '',
        card_last4: '', card_type: '', card_country: '',
      }).returningAll().executeTakeFirstOrThrow();
      // pre_save: the uuid pk is set but no row exists yet → old status None.
      await paymentPostSave(row as never, { oldStatus: null }, trx);
      return row;
    });
  },

  /** process_payment(payment, payment_data): request-to-pay; payment ends pending (accepted) or failed. */
  async processPayment(payment: PaymentRow, data: { amount: PyDecimal; phone_number: string; currency: string }): Promise<GatewayResult> {
    const gateway = await PaymentService.getGateway(await gatewayName(payment));
    if (!gateway) return { success: false, error: 'Payment gateway not available' };
    try {
      payment = await savePayment(payment, { status: 'processing', processed_at: nowPg() });
      const result = await gateway.processPayment({ ...data, payment_id: String(payment.id) });
      if (result.success) {
        payment = await savePayment(payment, {
          gateway_transaction_id: (result.transaction_id as string) ?? '', gateway_response: result as never, status: 'pending',
        });
      } else {
        payment = await savePayment(payment, { gateway_response: result as never, status: 'failed' });
      }
      return result;
    } catch (e) {
      const msg = (e as Error).message;
      await savePayment(payment, { status: 'failed', gateway_response: { error: msg } as never });
      return { success: false, error: msg };
    }
  },

  /** verify_payment(payment): poll MTN and sync the local status (completed → post-payment side effects). */
  async verifyPayment(payment: PaymentRow): Promise<GatewayResult> {
    const gateway = await PaymentService.getGateway(await gatewayName(payment));
    if (!gateway) return { success: false, error: 'Payment gateway not available' };
    try {
      const result = await gateway.verifyPayment(payment.gateway_transaction_id, await currencyCode(payment));
      if (result.success) {
        if (result.status === 'completed') {
          await db.transaction().execute(async (trx) => {
            let p = payment;
            if (p.status !== 'completed') {
              p = await savePayment(p, { status: 'completed', completed_at: nowPg(), gateway_response: result as never }, trx);
            }
            await PaymentService.onPaymentConfirmed(p, trx);
          });
        } else if (result.status === 'failed') {
          await savePayment(payment, { status: 'failed', gateway_response: result as never });
        }
      }
      return result;
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  },

  /** _on_payment_confirmed(payment): viewing fee → mark paid; rent → payment_received. */
  async onPaymentConfirmed(payment: PaymentRow, ex: Executor = db): Promise<void> {
    if (payment.purpose === 'viewing_fee' || payment.viewing_id) {
      const viewing = payment.viewing_id ? (await getViewing(payment.viewing_id, ex)) ?? null : null;
      await markViewingFeePaid(viewing, payment as never, ex);
      return;
    }
    const booking = payment.booking_id ? await getBooking(payment.booking_id, ex) : undefined;
    if (!booking) throw new TypeError("'NoneType' object has no attribute 'status'");
    await markGuestPaid(booking, ex);
  },

  /** transfer_to_owner(payment): disburse to the host's approved host-application MoMo number. */
  async transferToOwner(payment: PaymentRow): Promise<GatewayResult> {
    const gateway = await PaymentService.getGateway(await gatewayName(payment));
    if (!gateway) return { success: false, error: 'Payment gateway not available' };
    const booking = (await getBooking(payment.booking_id!))!;
    const listing = await db.selectFrom('listings_listing').select('owner_id').where('id', '=', booking.listing_id).executeTakeFirstOrThrow();
    const owner = await db.selectFrom('users_user').select(['id', 'username']).where('id', '=', listing.owner_id).executeTakeFirstOrThrow();
    let momo: string | null = null;
    try {
      const app = await db.selectFrom('hostapplications_hostapplication' as never).select('momo_number' as never)
        .where('applicant_id' as never, '=', owner.id as never).where('status' as never, '=', 'approved' as never)
        .orderBy('updated_at' as never, 'desc').executeTakeFirst() as { momo_number?: string } | undefined;
      momo = app?.momo_number || null;
    } catch { momo = null; }
    if (!momo) {
      return { success: false, error: `Owner ${owner.username} has no MoMo number registered. Payout skipped — disburse manually.` };
    }
    return gateway.transferToOwner(momo, dec(payment.amount).toNumber(), await currencyCode(payment), String(booking.id));
  },

  /** disburse_to_phone(phone, amount, currency, note) — Finance dashboard payouts. */
  async disburseToPhone(phone: string, amount: PyDecimal, currency: unknown, note: string): Promise<GatewayResult> {
    const gateway = await PaymentService.getGateway('mtn_momo');
    if (!gateway) return { success: false, error: 'Payment gateway not available' };
    if (!phone) return { success: false, error: 'No MoMo number on file for this recipient.' };
    return gateway.transferToOwner(phone, amount.toNumber(), currency as string, note);
  },

  /** convert_from_usd(amount_usd, code): USD as-is, else × rate rounded to a whole unit. */
  async convertFromUsd(amountUsd: PyDecimal, code: string, ex: Executor = db): Promise<PyDecimal> {
    const amount = PyDecimal.parse(amountUsd.toString());
    if (code === 'USD') return amount;
    const rows = await ex.selectFrom('payments_currency').select('exchange_rate_to_usd').where('code', '=', code).where('is_active', '=', true).execute();
    if (rows.length !== 1) throw new DoesNotExist('Currency matching query does not exist.');
    return amount.mul(dec(rows[0]!.exchange_rate_to_usd)).quantize(0);
  },

  /**
   * refund_payment(payment, amount, reason, reason_code). `amount` is a Decimal
   * (user refund serializer) or a Python float (admin / dual-auth payload).
   */
  async refundPayment(payment: PaymentRow, amount: PyDecimal | number, reason: string, reasonCode = ''): Promise<GatewayResult> {
    const gateway = await PaymentService.getGateway(await gatewayName(payment));
    if (!gateway) return { success: false, error: 'Payment gateway not available' };
    const agg = await db.selectFrom('payments_refund').select((eb) => eb.fn.sum<string | null>('amount').as('t'))
      .where('payment_id', '=', payment.id).where('status', '!=', 'failed').executeTakeFirst();
    const already = agg?.t !== null && agg?.t !== undefined && dec(agg.t).truthy() ? dec(agg.t) : PyDecimal.parse('0');
    const code = await currencyCode(payment);
    const remaining = dec(payment.amount).sub(already);
    const asDecimal = typeof amount === 'number' ? PyDecimal.parse(pyFloatStr(amount)) : PyDecimal.parse(amount.toString());
    if (asDecimal.gt(remaining)) {
      return { success: false, error: `Refund amount exceeds the remaining refundable balance (${remaining.toString()} ${code}).` };
    }
    const stored = typeof amount === 'number' ? dbDecimal(PyDecimal.createFromFloat(amount, 12), 12, 2) : dbDecimal(amount, 12, 2);
    try {
      return await db.transaction().execute(async (trx) => {
        const refund = await trx.insertInto('payments_refund').values({
          payment_id: payment.id, amount: stored, reason, reason_code: reasonCode || 'other',
          gateway_refund_id: '', status: 'pending', created_at: nowPg(), processed_at: null,
        }).returningAll().executeTakeFirstOrThrow();
        const result = await gateway.refundPayment(payment, code, typeof amount === 'number' ? amount : amount.toNumber(), reason);
        let status = payment.status;
        const upd: Record<string, unknown> = {};
        if (result.success) {
          upd.gateway_refund_id = (result.refund_id as string) ?? '';
          upd.status = 'completed';
          upd.processed_at = nowPg();
          const tot = await trx.selectFrom('payments_refund').select((eb) => eb.fn.sum<string | null>('amount').as('t'))
            .where('payment_id', '=', payment.id).executeTakeFirst();
          const total = tot?.t ? dec(tot.t) : PyDecimal.fromInt(0);
          status = dec(payment.amount).lte(total) ? 'refunded' : 'partially_refunded';
        } else {
          upd.status = 'failed';
        }
        await trx.updateTable('payments_refund').set(upd as never).where('id', '=', refund.id).execute();
        await savePayment(payment, { status }, trx);
        return result;
      });
    } catch (e) {
      logger.warn({ err: e }, 'refund_payment failed');
      return { success: false, error: (e as Error).message };
    }
  },
};

/**
 * manage.py reconcile_payments: re-run the idempotent post-payment side effects
 * for every completed payment. Returns the same counts the command prints.
 */
export async function reconcilePayments(): Promise<{ total: number; fixedViewings: number; fixedBookings: number }> {
  const completed = await db.selectFrom('payments_payment').selectAll().where('status', '=', 'completed').orderBy('created_at', 'desc').execute();
  let fixedViewings = 0; let fixedBookings = 0;
  for (const payment of completed) {
    const beforeViewing = payment.viewing_id ? (await getViewing(payment.viewing_id))?.is_fee_paid : null;
    const beforeBooking = payment.booking_id ? (await getBooking(payment.booking_id))?.status : null;
    await PaymentService.onPaymentConfirmed(payment);
    if (payment.viewing_id && beforeViewing === false && (await getViewing(payment.viewing_id))?.is_fee_paid) fixedViewings++;
    if (payment.booking_id && ['awaiting_payment', 'pending_host', 'requested'].includes(beforeBooking ?? '')
      && (await getBooking(payment.booking_id))?.status === 'payment_received') fixedBookings++;
  }
  logger.info(`Reconciled ${completed.length} completed payment(s): ${fixedViewings} viewing fee(s), ${fixedBookings} booking(s) fixed.`);
  return { total: completed.length, fixedViewings, fixedBookings };
}
