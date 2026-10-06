// payments/gateways/mtn_momo.py — MTN MoMo Collection (request-to-pay) and
// Disbursement (transfer) over the same HTTP endpoints, headers, sandbox/live
// handling and token caching as the Django gateway.

import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { logger } from '../../../lib/logger.js';
import { redis } from '../../../lib/redis.js';
import { PyDecimal } from '../decimal.js';
import { pyFloatStr } from '../py.js';

export type GatewayResult = Record<string, unknown> & { success: boolean };

export interface GatewayRow {
  name: string; sandbox_mode: boolean; sandbox_url: string; live_url: string;
}

const env = (k: string) => process.env[k];
/** os.environ.get(a) or os.environ.get(b) or ... */
const orChain = (...keys: string[]) => { for (const k of keys) { const v = env(k); if (v) return v; } return ''; };

/** settings.PAYMENT_GATEWAYS['mtn_momo'] */
function mtnConfig() {
  return {
    collection_key: env('MTN_MOMO_COLLECTION_KEY') ?? '',
    disbursement_key: env('MTN_MOMO_DISBURSEMENT_KEY') ?? '',
    target_environment: env('MTN_MOMO_TARGET_ENVIRONMENT') ?? 'production',
    accounts: {
      LRD: {
        collection: {
          user_id: orChain('MTN_MOMO_USER_ID_LRD', 'MTN_MOMO_USER_ID', 'MTN_MOMO_COLLECTION_USER_ID_USD'),
          api_secret: orChain('MTN_MOMO_API_SECRET_LRD', 'MTN_MOMO_API_SECRET', 'MTN_MOMO_COLLECTION_API_SECRET_USD'),
        },
        disbursement: {
          user_id: orChain('MTN_MOMO_USER_ID_LRD', 'MTN_MOMO_USER_ID', 'MTN_MOMO_USER_ID_USD'),
          api_secret: orChain('MTN_MOMO_API_SECRET_LRD', 'MTN_MOMO_API_SECRET', 'MTN_MOMO_API_SECRET_USD'),
        },
      },
      USD: {
        collection: { user_id: env('MTN_MOMO_COLLECTION_USER_ID_USD') ?? '', api_secret: env('MTN_MOMO_COLLECTION_API_SECRET_USD') ?? '' },
        disbursement: { user_id: env('MTN_MOMO_USER_ID_USD') ?? '', api_secret: env('MTN_MOMO_API_SECRET_USD') ?? '' },
      },
      SANDBOX: {
        collection: {
          user_id: env('MTN_MOMO_USER_ID_SANDBOX') ?? env('MTN_MOMO_USER_ID') ?? '',
          api_secret: env('MTN_MOMO_API_SECRET_SANDBOX') ?? env('MTN_MOMO_API_SECRET') ?? '',
        },
        disbursement: {
          user_id: env('MTN_MOMO_USER_ID_SANDBOX') ?? env('MTN_MOMO_USER_ID') ?? '',
          api_secret: env('MTN_MOMO_API_SECRET_SANDBOX') ?? env('MTN_MOMO_API_SECRET') ?? '',
        },
      },
    } as Record<string, Record<string, { user_id: string; api_secret: string }>>,
  };
}

/** requests.exceptions.RequestException (network failure or raise_for_status). */
class RequestException extends Error {}
/** ValueError raised by _account_for */
class ConfigError extends Error {}

const REASONS: Record<number, string> = {
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict', 500: 'Internal Server Error',
  502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout',
};

/**
 * requests.request(...). node:http(s) rather than fetch so the response headers
 * keep the server's own casing — `dict(response.headers)` (sandbox `debug`
 * block) shows e.g. "Content-Type", not fetch's lowercased "content-type".
 * Repeated headers are joined with ", " under the first spelling, like urllib3.
 */
function http(url: string, init: { method: string; headers: Record<string, string>; body?: string }, timeoutS: number) {
  return new Promise<{ status: number; text: string; headers: Record<string, string>; url: string }>((resolve, reject) => {
    const u = new URL(url);
    const body = init.body === undefined ? undefined : Buffer.from(init.body);
    const headers = body ? { ...init.headers, 'Content-Length': String(body.length) } : init.headers;
    const send = u.protocol === 'https:' ? httpsRequest : httpRequest;
    const rq = send(u, { method: init.method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('error', (e) => reject(new RequestException(String(e.message ?? e))));
      res.on('end', () => {
        const out: Record<string, string> = {};
        const spelling = new Map<string, string>();
        for (let i = 0; i < res.rawHeaders.length; i += 2) {
          const name = res.rawHeaders[i]!; const value = res.rawHeaders[i + 1]!;
          const key = spelling.get(name.toLowerCase());
          if (key === undefined) { spelling.set(name.toLowerCase(), name); out[name] = value; } else out[key] += `, ${value}`;
        }
        resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8'), headers: out, url });
      });
    });
    rq.setTimeout(timeoutS * 1000, () => rq.destroy(new Error(`Read timed out. (read timeout=${timeoutS})`)));
    rq.on('error', (e) => reject(new RequestException(String(e.message ?? e))));
    rq.end(body);
  });
}

function jsonOrText(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}

export class MTNMoMoGateway {
  static COLLECTION_TOKEN_PATH = 'collection/token/';
  static COLLECTION_REQUEST_PATH = 'collection/v1_0/requesttopay';
  static COLLECTION_ACCOUNT_HOLDER_PATH = 'collection/v1_0/accountholder/msisdn/{msisdn}/active';
  static DISBURSEMENT_TOKEN_PATH = 'disbursement/token/';
  static DISBURSEMENT_TRANSFER_PATH = 'disbursement/v1_0/transfer';

  readonly isSandbox: boolean;
  private cfg = mtnConfig();
  readonly targetEnv: string;

  constructor(readonly gateway: GatewayRow) {
    this.isSandbox = gateway.sandbox_mode;
    this.targetEnv = this.isSandbox ? 'sandbox' : this.cfg.target_environment;
  }

  getApiUrl(endpoint: string): string {
    const base = this.gateway.sandbox_mode ? this.gateway.sandbox_url : this.gateway.live_url;
    return `${base}/${endpoint}`;
  }

  private accountFor(currency: string, product = 'collection') {
    const key = this.isSandbox ? 'SANDBOX' : (currency || '').toUpperCase();
    const account = this.cfg.accounts[key]?.[product] ?? { user_id: '', api_secret: '' };
    if (!account.user_id || !account.api_secret) {
      if (this.isSandbox) {
        throw new ConfigError('No MTN MoMo sandbox API user configured (MTN_MOMO_USER_ID_SANDBOX / MTN_MOMO_API_SECRET_SANDBOX, or the legacy MTN_MOMO_USER_ID / MTN_MOMO_API_SECRET).');
      }
      const prefix = product === 'collection' ? 'MTN_MOMO_COLLECTION_' : 'MTN_MOMO_';
      throw new ConfigError(
        `No MTN MoMo ${product} API user configured for the ${key} account. Create one in MTN's ` +
        `partner portal (Configure -> Create API user, Account: ${key}, Product: ${product}) and set ` +
        `${prefix}USER_ID_${key} / ${prefix}API_SECRET_${key} in backend/.env.`,
      );
    }
    return account;
  }

  private async accessToken(currency: string, product = 'collection'): Promise<string> {
    const account = this.accountFor(currency, product);
    const cacheCurrency = this.isSandbox ? 'SANDBOX' : currency.toUpperCase();
    const cacheKey = `mtn_momo_${this.targetEnv}_${cacheCurrency}_${product}_token`;
    const cached = await redis.get(cacheKey);
    if (cached) return cached;
    const tokenUrl = this.getApiUrl(product === 'collection' ? MTNMoMoGateway.COLLECTION_TOKEN_PATH : MTNMoMoGateway.DISBURSEMENT_TOKEN_PATH);
    const subKey = product === 'collection' ? this.cfg.collection_key : (this.cfg.disbursement_key || this.cfg.collection_key);
    const credentials = Buffer.from(`${account.user_id}:${account.api_secret}`).toString('base64');
    const r = await http(tokenUrl, { method: 'POST', headers: { Authorization: `Basic ${credentials}`, 'Ocp-Apim-Subscription-Key': subKey } }, 30);
    if (r.status >= 400) {
      throw new RequestException(`${r.status} ${r.status < 500 ? 'Client' : 'Server'} Error: ${REASONS[r.status] ?? ''} for url: ${tokenUrl}`);
    }
    const body = jsonOrText(r.text) as { access_token?: string } | null;
    if (body === null) throw new RequestException('Expecting value: line 1 column 1 (char 0)');
    if (!body.access_token) throw new Error("'access_token'");
    await redis.set(cacheKey, body.access_token, 'EX', 50 * 60);
    return body.access_token;
  }

  private async collectionHeaders(currency: string, referenceId?: string) {
    const token = await this.accessToken(currency, 'collection');
    const h: Record<string, string> = {
      Authorization: `Bearer ${token}`, 'Ocp-Apim-Subscription-Key': this.cfg.collection_key,
      'X-Target-Environment': this.targetEnv, 'Content-Type': 'application/json',
    };
    if (referenceId) h['X-Reference-Id'] = referenceId;
    return h;
  }

  private async disbursementHeaders(currency: string, referenceId?: string) {
    const token = await this.accessToken(currency, 'disbursement');
    const h: Record<string, string> = {
      Authorization: `Bearer ${token}`, 'Ocp-Apim-Subscription-Key': this.cfg.disbursement_key || this.cfg.collection_key,
      'X-Target-Environment': this.targetEnv, 'Content-Type': 'application/json',
    };
    if (referenceId) h['X-Reference-Id'] = referenceId;
    return h;
  }

  /** is_account_active — fails open. */
  async isAccountActive(phone: string, currency: string): Promise<boolean> {
    try {
      const formatted = this.isSandbox ? phone : this.formatPhone(phone);
      const url = this.getApiUrl(MTNMoMoGateway.COLLECTION_ACCOUNT_HOLDER_PATH.replace('{msisdn}', formatted));
      const r = await http(url, { method: 'GET', headers: await this.collectionHeaders(currency) }, 15);
      if (r.status === 404) return false;
      if (r.status === 200) return !!(jsonOrText(r.text) as { result?: unknown } | null)?.result;
      logger.warn(`MTN MoMo account-holder check: unexpected status ${r.status} for ${formatted} — proceeding anyway`);
      return true;
    } catch (e) {
      logger.warn({ err: e }, `MTN MoMo account-holder check failed for ${phone} — proceeding anyway`);
      return true;
    }
  }

  /** process_payment(payment_data): request-to-pay. */
  async processPayment(data: { amount: PyDecimal; phone_number: string; currency: string; payment_id: string }): Promise<GatewayResult> {
    try {
      const { amount, phone_number: phone, currency } = data;
      const wireCurrency = this.isSandbox ? 'EUR' : currency;
      if (!this.isSandbox && !this.validLiberianPhone(phone)) {
        return { success: false, error: 'Invalid Liberian MTN number. Use format: 0770123456 or +231770123456' };
      }
      const formatted = this.isSandbox ? phone : this.formatPhone(phone);
      if (!this.isSandbox && !(await this.isAccountActive(phone, currency))) {
        logger.warn(`MTN MoMo requesttopay blocked: ${formatted} is not an active MoMo account`);
        return { success: false, error: 'This phone number is not registered for MTN Mobile Money. Please check the number or use a different payment method.' };
      }
      const reference = randomUUID();
      const whole = amount.toIntegral();
      if (whole < 1n) {
        return {
          success: false,
          error: `MTN Mobile Money cannot process amounts under 1 whole ${wireCurrency} (this charge is ${amount.toString()} ${wireCurrency}). Use a different payment method.`,
        };
      }
      const body = {
        amount: whole.toString(), currency: wireCurrency, externalId: String(data.payment_id),
        payer: { partyIdType: 'MSISDN', partyId: formatted },
        payerMessage: 'Property booking payment', payeeNote: 'Real Estate Platform - Liberia',
      };
      const url = this.getApiUrl(MTNMoMoGateway.COLLECTION_REQUEST_PATH);
      const headers = await this.collectionHeaders(currency, reference);
      const r = await http(url, { method: 'POST', headers, body: JSON.stringify(body) }, 30);
      if (r.status === 202) {
        return { success: true, transaction_id: reference, status: 'pending', message: 'Payment request sent to customer phone. Awaiting approval.' };
      }
      const detail = jsonOrText(r.text) ?? (r.text || '(empty body)');
      logger.error(`MTN MoMo requesttopay failed: env=${this.targetEnv} status=${r.status} url=${url} currency=${wireCurrency}`);
      return {
        success: false, error: `MTN API error ${r.status}`, details: detail,
        debug: this.isSandbox ? { url, request_body: body, response_headers: r.headers } : {},
      };
    } catch (e) {
      if (e instanceof RequestException) return { success: false, error: 'Network error', details: e.message };
      logger.error({ err: e }, 'MTN MoMo requesttopay unexpected error');
      return { success: false, error: 'Payment processing error', details: (e as Error).message };
    }
  }

  /** verify_payment(transaction_id, currency) */
  async verifyPayment(transactionId: string, currency = 'LRD'): Promise<GatewayResult> {
    try {
      const url = this.getApiUrl(`${MTNMoMoGateway.COLLECTION_REQUEST_PATH}/${transactionId}`);
      const r = await http(url, { method: 'GET', headers: await this.collectionHeaders(currency) }, 30);
      if (r.status === 200) {
        const data = (JSON.parse(r.text) ?? {}) as Record<string, unknown>;
        const mtnStatus = (data.status as string) ?? '';
        const map: Record<string, string> = { PENDING: 'pending', SUCCESSFUL: 'completed', FAILED: 'failed', TIMEOUT: 'failed' };
        const payer = (data.payer as Record<string, unknown>) || {};
        return {
          success: true, status: map[mtnStatus] ?? 'pending', mtn_status: mtnStatus,
          amount: data.amount ?? null, currency: data.currency ?? null, phone_number: payer.partyId ?? '',
          financial_transaction_id: data.financialTransactionId ?? '', paid_at: data.completedTimestamp ?? null, gateway_data: data,
        };
      }
      logger.error(`MTN MoMo verify_payment failed: env=${this.targetEnv} status=${r.status} transaction_id=${transactionId}`);
      return { success: false, error: `Verification failed: ${r.status}`, details: r.text };
    } catch (e) {
      logger.error({ err: e }, `MTN MoMo verify_payment unexpected error for transaction ${transactionId}`);
      return { success: false, error: 'Verification error', details: (e as Error).message };
    }
  }

  /** refund_payment(payment, amount, reason): disbursement back to the payer. */
  async refundPayment(payment: { id: string; phone_number: string }, currencyCode: string, amount: number, reason: string): Promise<GatewayResult> {
    if (!payment.phone_number) return { success: false, error: 'No phone number on record for this payment' };
    return this.disburse(payment.phone_number, amount, currencyCode, `Refund for booking payment ${payment.id}. Reason: ${reason}`);
  }

  /** transfer_to_owner(owner_phone, amount, currency, booking_ref) */
  async transferToOwner(ownerPhone: string, amount: number, currency: string, bookingRef: string): Promise<GatewayResult> {
    if (!this.validLiberianPhone(ownerPhone)) return { success: false, error: 'Invalid owner MoMo number. Cannot disburse payment.' };
    return this.disburse(ownerPhone, amount, currency, `Property rental payout – Booking ${bookingRef}`);
  }

  private async disburse(phone: string, amount: number, currency: string, note: string): Promise<GatewayResult> {
    try {
      const formatted = this.formatPhone(phone);
      const reference = randomUUID();
      const body = {
        amount: pyFloatStr(amount), currency, externalId: reference,
        payee: { partyIdType: 'MSISDN', partyId: formatted }, payerMessage: note, payeeNote: note,
      };
      const headers = await this.disbursementHeaders(currency, reference);
      const r = await http(this.getApiUrl(MTNMoMoGateway.DISBURSEMENT_TRANSFER_PATH), { method: 'POST', headers, body: JSON.stringify(body) }, 30);
      if (r.status === 202) return { success: true, refund_id: reference, status: 'pending', message: 'Disbursement submitted successfully.' };
      return { success: false, error: `Disbursement API error ${r.status}`, details: jsonOrText(r.text) ?? r.text };
    } catch (e) {
      if (e instanceof RequestException) return { success: false, error: 'Network error during disbursement', details: e.message };
      return { success: false, error: 'Disbursement error', details: (e as Error).message };
    }
  }

  validateWebhook(): boolean { return false; }

  validLiberianPhone(phone: string | null | undefined): boolean {
    if (!phone) return false;
    const clean = phone.replace(/\D/g, '');
    return [/^231(77|88)\d{7}$/, /^0(77|88)\d{7}$/, /^(77|88)\d{7}$/].some((p) => p.test(clean));
  }

  formatPhone(phone: string): string {
    const clean = phone.replace(/\D/g, '');
    if (clean.startsWith('231')) return clean;
    if (clean.startsWith('0')) return `231${clean.slice(1)}`;
    return `231${clean}`;
  }
}
