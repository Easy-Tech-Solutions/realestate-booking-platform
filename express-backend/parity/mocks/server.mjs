// Mock Stripe + MTN MoMo for the parity environment (node built-ins only).
//
// One process serves both providers over HTTPS on :443. The parity compose
// gives this container network aliases for the real hostnames
// (api.stripe.com, proxy.momoapi.mtn.com, sandbox.momodeveloper.mtn.com), so
// neither backend's provider URLs change: they resolve to this container and
// trust its certificate through the throwaway test CA (see gen-certs.sh).
//
// Callers are told apart by source IP (parity-django / parity-express are
// resolved through Docker DNS), and every side gets its OWN, identical,
// deterministic id sequence: the n-th PaymentIntent created by Django and the
// n-th created by Express are both pi_parity_<n>.
//
// Plain-HTTP admin API on :8080 (tests only):
//   POST /__reset              clear recorded requests, objects, counters, config
//   GET  /__requests[?side=]   recorded provider requests
//   POST /__config             merge config ({momo: {...}, stripe: {...}}), see DEFAULT_CONFIG
//   POST /__stripe/payment_intents/<id>/succeed   mark a PaymentIntent succeeded (both sides)
import { createServer as createHttps } from 'node:https';
import { createServer as createHttp } from 'node:http';
import { lookup } from 'node:dns/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const CERTS = process.env.MOCK_CERT_DIR ?? '/certs';
const env = (k, d = '') => process.env[k] ?? d;

const CREDS = {
  stripeKey: env('MOCK_STRIPE_SECRET_KEY'),
  momo: {
    collectionKey: env('MOCK_MTN_MOMO_COLLECTION_KEY'),
    disbursementKey: env('MOCK_MTN_MOMO_DISBURSEMENT_KEY'),
    targetEnvironment: env('MOCK_MTN_MOMO_TARGET_ENVIRONMENT', 'mtnliberia'),
    // product → accepted "user:secret" pairs (live accounts + sandbox account)
    users: {
      collection: [
        `${env('MOCK_MTN_MOMO_COLLECTION_USER_ID_USD')}:${env('MOCK_MTN_MOMO_COLLECTION_API_SECRET_USD')}`,
        `${env('MOCK_MTN_MOMO_USER_ID_SANDBOX')}:${env('MOCK_MTN_MOMO_API_SECRET_SANDBOX')}`,
      ],
      disbursement: [
        `${env('MOCK_MTN_MOMO_USER_ID_USD')}:${env('MOCK_MTN_MOMO_API_SECRET_USD')}`,
        `${env('MOCK_MTN_MOMO_USER_ID_SANDBOX')}:${env('MOCK_MTN_MOMO_API_SECRET_SANDBOX')}`,
      ],
    },
  },
};

const SANDBOX_HOST = 'sandbox.momodeveloper.mtn.com';
const MOMO_HOSTS = new Set(['proxy.momoapi.mtn.com', SANDBOX_HOST]);
const STRIPE_HOST = 'api.stripe.com';

const DEFAULT_CONFIG = () => ({
  momo: {
    /** status reported by GET requesttopay/<ref> (PENDING | SUCCESSFUL | FAILED | TIMEOUT) */
    collectionStatus: 'SUCCESSFUL',
    /** reason reported with FAILED / TIMEOUT */
    failureReason: 'APPROVAL_REJECTED',
    /** status reported by GET transfer/<ref> */
    transferStatus: 'SUCCESSFUL',
    /** HTTP status for POST requesttopay / transfer (202 = accepted) */
    requestToPayHttp: 202,
    transferHttp: 202,
    /** HTTP status for the token endpoints (200 = ok) */
    tokenHttp: 200,
    /** MSISDNs the account-holder check reports as not active (result:false) */
    inactiveMsisdns: [],
    /** MSISDNs the account-holder check answers 404 for */
    unknownMsisdns: [],
  },
  stripe: {
    /** force each side's next `count` Stripe calls to fail with this error ({count, status, type, code, message}) */
    failNext: null,
  },
});

let state;
function reset() {
  state = { config: DEFAULT_CONFIG(), requests: [], sides: {}, failBudget: {} };
}
reset();

function sideState(side) {
  return (state.sides[side] ??= {
    counters: {}, paymentIntents: {}, refunds: {}, customers: {}, paymentMethods: {}, requestToPay: {}, transfers: {}, tokens: {},
  });
}
function nextId(side, prefix, width = 6) {
  const s = sideState(side);
  s.counters[prefix] = (s.counters[prefix] ?? 0) + 1;
  return `${prefix}${String(s.counters[prefix]).padStart(width, '0')}`;
}

// --- caller identification ---------------------------------------------------
const norm = (ip) => (ip ?? '').replace(/^::ffff:/, '');
async function sideOf(req) {
  const ip = norm(req.socket.remoteAddress);
  for (const side of ['django', 'express']) {
    try {
      const addrs = await lookup(`parity-${side}`, { all: true });
      if (addrs.some((a) => norm(a.address) === ip)) return side;
    } catch { /* not running */ }
  }
  return `other:${ip}`;
}

// --- body helpers --------------------------------------------------------------
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

/** Stripe's form encoding (a[b][c]=v, a[0]=v) → nested object; values stay strings. */
function parseStripeForm(text) {
  const out = {};
  for (const [rawKey, value] of new URLSearchParams(text)) {
    const parts = rawKey.replace(/\]/g, '').split('[');
    let o = out;
    parts.forEach((p, i) => {
      if (i === parts.length - 1) o[p] = value;
      else o = (o[p] ??= {});
    });
  }
  return out;
}

function send(res, status, body, headers = {}) {
  const text = body === undefined ? '' : (typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(status, { ...(text ? { 'Content-Type': 'application/json' } : {}), 'Content-Length': Buffer.byteLength(text), ...headers });
  res.end(text);
}

const PICKED_HEADERS = ['authorization', 'ocp-apim-subscription-key', 'x-target-environment', 'x-reference-id', 'x-callback-url',
  'content-type', 'stripe-version', 'idempotency-key', 'stripe-account'];

// --- Stripe --------------------------------------------------------------------
const STRIPE_CURRENCIES = new Set(['usd', 'eur', 'gbp', 'lrd', 'cad', 'aud', 'ngn', 'ghs', 'xof', 'kes', 'zar']);
const MIN_CHARGE = { usd: 50, eur: 50, gbp: 30, cad: 50, aud: 50 };

function stripeError(res, side, status, err) {
  const requestId = nextId(side, 'req_parity_', 6);
  send(res, status, { error: { ...err, request_log_url: `https://dashboard.stripe.com/test/logs/${requestId}` } }, { 'Request-Id': requestId });
}
function stripeOk(res, side, obj) {
  send(res, 200, obj, { 'Request-Id': nextId(side, 'req_parity_', 6) });
}
const CREATED = 1790000000; // fixed "created" so objects are byte-identical across runs

function handleStripe(req, res, side, method, path, body) {
  const auth = req.headers.authorization ?? '';
  const key = auth.startsWith('Bearer ') ? auth.slice(7) : (auth.startsWith('Basic ') ? Buffer.from(auth.slice(6), 'base64').toString().split(':')[0] : '');
  if (!key || key !== CREDS.stripeKey) {
    return stripeError(res, side, 401, {
      message: `Invalid API Key provided: ${key ? key.slice(0, 8) + '*'.repeat(Math.max(0, key.length - 12)) + key.slice(-4) : '(none)'}`,
      type: 'invalid_request_error',
    });
  }
  const fail = state.config.stripe.failNext;
  if (fail && (state.failBudget[side] ??= fail.count ?? 1) > 0) {
    state.failBudget[side] -= 1;
    return stripeError(res, side, fail.status ?? 402, { type: fail.type ?? 'card_error', code: fail.code, message: fail.message ?? 'Your card was declined.' });
  }
  const s = sideState(side);
  let m;
  if (method === 'POST' && path === '/v1/payment_intents') {
    const amount = Number(body.amount);
    const currency = String(body.currency ?? '');
    if (!body.amount) return stripeError(res, side, 400, { type: 'invalid_request_error', code: 'parameter_missing', param: 'amount', message: 'Missing required param: amount.' });
    if (!Number.isInteger(amount) || amount < 0) {
      return stripeError(res, side, 400, { type: 'invalid_request_error', code: 'parameter_invalid_integer', param: 'amount', message: `Invalid integer: ${body.amount}` });
    }
    if (!currency) return stripeError(res, side, 400, { type: 'invalid_request_error', code: 'parameter_missing', param: 'currency', message: 'Missing required param: currency.' });
    if (!STRIPE_CURRENCIES.has(currency)) {
      return stripeError(res, side, 400, { type: 'invalid_request_error', param: 'currency', message: `Invalid currency: ${currency}. Stripe currently supports these currencies: ${[...STRIPE_CURRENCIES].join(', ')}` });
    }
    if (MIN_CHARGE[currency] && amount < MIN_CHARGE[currency]) {
      return stripeError(res, side, 400, {
        type: 'invalid_request_error', code: 'amount_too_small', param: 'amount', doc_url: 'https://stripe.com/docs/error-codes/amount-too-small',
        message: `Amount must be at least ${(MIN_CHARGE[currency] / 100).toFixed(2)} ${currency}`,
      });
    }
    const id = nextId(side, 'pi_parity_', 6);
    const secret = createHash('sha256').update(id).digest('hex').slice(0, 24);
    const pi = {
      id, object: 'payment_intent', amount, amount_capturable: 0, amount_received: 0, automatic_payment_methods: null,
      canceled_at: null, capture_method: 'automatic', client_secret: `${id}_secret_${secret}`, confirmation_method: 'automatic',
      created: CREATED, currency, customer: body.customer ?? null, description: body.description ?? null, last_payment_error: null,
      latest_charge: null, livemode: false, metadata: body.metadata ?? {}, payment_method: null, payment_method_types: ['card'],
      status: 'requires_payment_method',
    };
    s.paymentIntents[id] = pi;
    return stripeOk(res, side, pi);
  }
  if (method === 'GET' && (m = /^\/v1\/payment_intents\/([^/]+)$/.exec(path))) {
    const pi = s.paymentIntents[m[1]];
    if (!pi) return stripeError(res, side, 404, { type: 'invalid_request_error', code: 'resource_missing', param: 'intent', message: `No such payment_intent: '${m[1]}'` });
    return stripeOk(res, side, pi);
  }
  if (method === 'POST' && path === '/v1/refunds') {
    const piId = body.payment_intent;
    if (!piId && !body.charge) return stripeError(res, side, 400, { type: 'invalid_request_error', message: 'One of the following params should be provided for this request: payment_intent or charge.' });
    const pi = s.paymentIntents[piId];
    if (!pi) return stripeError(res, side, 400, { type: 'invalid_request_error', code: 'resource_missing', param: 'payment_intent', message: `No such payment_intent: '${piId}'` });
    if (pi.status !== 'succeeded') {
      return stripeError(res, side, 400, { type: 'invalid_request_error', message: `This PaymentIntent (${piId}) does not have a successful charge to refund.` });
    }
    const refunded = Object.values(s.refunds).filter((r) => r.payment_intent === piId).reduce((a, r) => a + r.amount, 0);
    const amount = body.amount === undefined ? pi.amount - refunded : Number(body.amount);
    if (refunded + amount > pi.amount) {
      return stripeError(res, side, 400, {
        type: 'invalid_request_error', code: 'amount_too_large', param: 'amount',
        message: `Refund amount ($${(amount / 100).toFixed(2)}) is greater than unrefunded amount on charge ($${((pi.amount - refunded) / 100).toFixed(2)})`,
      });
    }
    const id = nextId(side, 're_parity_', 6);
    const refund = {
      id, object: 'refund', amount, balance_transaction: `txn_${id.slice(3)}`, charge: pi.latest_charge, created: CREATED,
      currency: pi.currency, metadata: body.metadata ?? {}, payment_intent: piId, reason: body.reason ?? null, status: 'succeeded',
    };
    s.refunds[id] = refund;
    return stripeOk(res, side, refund);
  }
  if (method === 'GET' && (m = /^\/v1\/refunds\/([^/]+)$/.exec(path))) {
    const r = s.refunds[m[1]];
    if (!r) return stripeError(res, side, 404, { type: 'invalid_request_error', code: 'resource_missing', param: 'id', message: `No such refund: '${m[1]}'` });
    return stripeOk(res, side, r);
  }
  // Customers / payment methods: neither backend calls these today (saved cards
  // are stored locally), but they're cheap to serve if that ever changes.
  if (method === 'POST' && path === '/v1/customers') {
    const id = nextId(side, 'cus_parity_', 6);
    const c = { id, object: 'customer', created: CREATED, email: body.email ?? null, name: body.name ?? null, metadata: body.metadata ?? {}, livemode: false };
    s.customers[id] = c;
    return stripeOk(res, side, c);
  }
  if (method === 'GET' && (m = /^\/v1\/customers\/([^/]+)$/.exec(path))) {
    const c = s.customers[m[1]];
    if (!c) return stripeError(res, side, 404, { type: 'invalid_request_error', code: 'resource_missing', param: 'id', message: `No such customer: '${m[1]}'` });
    return stripeOk(res, side, c);
  }
  if (method === 'GET' && path === '/v1/payment_methods') {
    const data = Object.values(s.paymentMethods).filter((pm) => !body.customer || pm.customer === body.customer);
    return stripeOk(res, side, { object: 'list', data, has_more: false, url: '/v1/payment_methods' });
  }
  if (method === 'POST' && (m = /^\/v1\/payment_methods\/([^/]+)\/(attach|detach)$/.exec(path))) {
    const pm = (s.paymentMethods[m[1]] ??= {
      id: m[1], object: 'payment_method', type: 'card', created: CREATED, customer: null,
      card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030, country: 'US' },
    });
    pm.customer = m[2] === 'attach' ? body.customer ?? null : null;
    return stripeOk(res, side, pm);
  }
  return stripeError(res, side, 404, { type: 'invalid_request_error', message: `Unrecognized request URL (${method}: ${path}).` });
}

// --- MTN MoMo -------------------------------------------------------------------
const momoError = (res, status, code, message) => send(res, status, { code, message });

function handleMomo(req, res, side, host, method, path, body) {
  const cfg = state.config.momo;
  const s = sideState(side);
  const sandbox = host === SANDBOX_HOST;
  let m;
  if (method === 'POST' && (m = /^\/(collection|disbursement)\/token\/$/.exec(path))) {
    const product = m[1];
    const subKey = product === 'collection' ? CREDS.momo.collectionKey : CREDS.momo.disbursementKey;
    if (req.headers['ocp-apim-subscription-key'] !== subKey) {
      return send(res, 401, { statusCode: 401, message: 'Access denied due to invalid subscription key. Make sure to provide a valid key for an active subscription.' });
    }
    const basic = String(req.headers.authorization ?? '');
    const pair = basic.startsWith('Basic ') ? Buffer.from(basic.slice(6), 'base64').toString() : '';
    if (!CREDS.momo.users[product].includes(pair)) return send(res, 401, { error: 'login_failed' });
    if (cfg.tokenHttp !== 200) return momoError(res, cfg.tokenHttp, 'INTERNAL_PROCESSING_ERROR', 'An internal error occurred while processing.');
    const token = `${nextId(side, `momo_${product}_token_`, 4)}`;
    s.tokens[token] = { product, sandbox };
    return send(res, 200, { access_token: token, token_type: 'access_token', expires_in: 3600 });
  }
  if (!(m = /^\/(collection|disbursement)\/v1_0\/(.*)$/.exec(path))) return momoError(res, 404, 'RESOURCE_NOT_FOUND', 'Requested resource was not found.');
  const product = m[1];
  const rest = m[2];
  // Common auth for product endpoints.
  const subKey = product === 'collection' ? CREDS.momo.collectionKey : CREDS.momo.disbursementKey;
  if (req.headers['ocp-apim-subscription-key'] !== subKey) {
    return send(res, 401, { statusCode: 401, message: 'Access denied due to invalid subscription key. Make sure to provide a valid key for an active subscription.' });
  }
  const bearer = String(req.headers.authorization ?? '');
  const tok = bearer.startsWith('Bearer ') ? s.tokens[bearer.slice(7)] : undefined;
  if (!tok || tok.product !== product || tok.sandbox !== sandbox) return send(res, 401, { statusCode: 401, message: 'Access token is missing or invalid.' });
  const expectedEnv = sandbox ? 'sandbox' : CREDS.momo.targetEnvironment;
  if (req.headers['x-target-environment'] !== expectedEnv) {
    return momoError(res, 403, 'NOT_ALLOWED_TARGET_ENVIRONMENT', 'Access to target environment is forbidden.');
  }
  if (method === 'GET' && (m = /^accountholder\/msisdn\/([^/]+)\/active$/.exec(rest)) && product === 'collection') {
    if (cfg.unknownMsisdns.includes(m[1])) return momoError(res, 404, 'RESOURCE_NOT_FOUND', 'Requested resource was not found.');
    return send(res, 200, { result: !cfg.inactiveMsisdns.includes(m[1]) });
  }
  if (method === 'GET' && rest === 'account/balance') {
    return send(res, 200, { availableBalance: '1000000', currency: sandbox ? 'EUR' : 'USD' });
  }
  const isCreate = method === 'POST' && ((product === 'collection' && rest === 'requesttopay') || (product === 'disbursement' && rest === 'transfer'));
  if (isCreate) {
    const ref = req.headers['x-reference-id'];
    if (!ref || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref)) {
      return momoError(res, 400, 'INVALID_REFERENCE_ID', 'Reference id is invalid.');
    }
    const store = product === 'collection' ? s.requestToPay : s.transfers;
    if (store[ref]) return momoError(res, 409, 'RESOURCE_ALREADY_EXIST', 'Duplicated reference id. Creation for resource failed.');
    const party = product === 'collection' ? body?.payer : body?.payee;
    if (!body || typeof body !== 'object' || !body.amount || !body.currency || !party?.partyId) {
      return momoError(res, 400, 'INVALID_INPUT', 'Request body is invalid.');
    }
    if (!/^\d+(\.\d+)?$/.test(String(body.amount))) return momoError(res, 400, 'INVALID_AMOUNT', 'Amount is invalid.');
    if (sandbox && body.currency !== 'EUR') return momoError(res, 500, 'NOT_ENOUGH_FUNDS', 'The payer does not have enough funds.');
    const http = product === 'collection' ? cfg.requestToPayHttp : cfg.transferHttp;
    if (http !== 202) return momoError(res, http, http >= 500 ? 'INTERNAL_PROCESSING_ERROR' : 'PAYER_LIMIT_REACHED', 'The request could not be processed.');
    store[ref] = { body, created: Date.now() };
    return send(res, 202);
  }
  const isStatus = method === 'GET' && (m = /^(requesttopay|transfer)\/([^/]+)$/.exec(rest)) && (m[1] === 'requesttopay') === (product === 'collection');
  if (isStatus) {
    const store = product === 'collection' ? s.requestToPay : s.transfers;
    const tx = store[m[2]];
    if (!tx) return momoError(res, 404, 'RESOURCE_NOT_FOUND', 'Requested resource was not found.');
    const status = product === 'collection' ? cfg.collectionStatus : cfg.transferStatus;
    // A transaction's financialTransactionId is fixed once it succeeds.
    if (status === 'SUCCESSFUL' && !tx.financialTransactionId) tx.financialTransactionId = nextId(side, '', 9);
    const out = {
      ...(status === 'SUCCESSFUL' ? { financialTransactionId: tx.financialTransactionId } : {}),
      externalId: tx.body.externalId, amount: tx.body.amount, currency: tx.body.currency,
      ...(product === 'collection' ? { payer: tx.body.payer } : { payee: tx.body.payee }),
      payerMessage: tx.body.payerMessage, payeeNote: tx.body.payeeNote, status,
      ...(status === 'FAILED' || status === 'TIMEOUT' ? { reason: cfg.failureReason } : {}),
    };
    return send(res, 200, out);
  }
  return momoError(res, 404, 'RESOURCE_NOT_FOUND', 'Requested resource was not found.');
}

// --- servers ---------------------------------------------------------------------
async function onProvider(req, res) {
  try {
    const side = await sideOf(req);
    const host = String(req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();
    const url = new URL(req.url, `https://${host}`);
    const text = await readBody(req);
    const ctype = String(req.headers['content-type'] ?? '');
    let body = null;
    if (host === STRIPE_HOST) body = req.method === 'GET' ? Object.fromEntries(url.searchParams) : parseStripeForm(text);
    else if (text) { try { body = JSON.parse(text); } catch { body = text; } }
    const headers = Object.fromEntries(PICKED_HEADERS.filter((h) => req.headers[h] !== undefined).map((h) => [h, req.headers[h]]));
    state.requests.push({ seq: state.requests.length + 1, side, host, method: req.method, path: url.pathname, query: url.search, headers, contentType: ctype, body });
    if (host === STRIPE_HOST) return handleStripe(req, res, side, req.method, url.pathname, body ?? {});
    if (MOMO_HOSTS.has(host)) return handleMomo(req, res, side, host, req.method, url.pathname, body);
    return send(res, 421, { error: `mock does not serve host ${host}` });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: String(e) });
  }
}

function merge(target, src) {
  for (const [k, v] of Object.entries(src ?? {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object') merge(target[k], v);
    else target[k] = v;
  }
}

async function onAdmin(req, res) {
  const url = new URL(req.url, 'http://admin');
  const text = await readBody(req);
  const body = text ? JSON.parse(text) : {};
  let m;
  if (req.method === 'POST' && url.pathname === '/__reset') { reset(); return send(res, 200, { ok: true }); }
  if (req.method === 'GET' && url.pathname === '/__requests') {
    const side = url.searchParams.get('side');
    return send(res, 200, state.requests.filter((r) => !side || r.side === side));
  }
  if (req.method === 'GET' && url.pathname === '/__config') return send(res, 200, state.config);
  if (req.method === 'POST' && url.pathname === '/__config') {
    merge(state.config, body);
    if (body.stripe && 'failNext' in body.stripe) state.failBudget = {};
    return send(res, 200, state.config);
  }
  if (req.method === 'POST' && (m = /^\/__stripe\/payment_intents\/([^/]+)\/succeed$/.exec(url.pathname))) {
    let n = 0;
    for (const s of Object.values(state.sides)) {
      const pi = s.paymentIntents[m[1]];
      if (pi) { pi.status = 'succeeded'; pi.amount_received = pi.amount; pi.latest_charge = `ch_${m[1].slice(3)}`; n++; }
    }
    return send(res, n ? 200 : 404, { updated: n });
  }
  if (req.method === 'GET' && url.pathname === '/__health') return send(res, 200, { ok: true });
  return send(res, 404, { error: 'unknown admin route' });
}

createHttps({ key: readFileSync(`${CERTS}/server.key`), cert: readFileSync(`${CERTS}/server.pem`) }, onProvider).listen(443, () => console.log('mock providers on :443'));
createHttp((req, res) => onAdmin(req, res).catch((e) => send(res, 500, { error: String(e) }))).listen(8080, () => console.log('mock admin on :8080'));
