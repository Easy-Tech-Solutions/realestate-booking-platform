// @parity-mock-providers — run.sh gives both backends the mock Stripe / MTN MoMo
// credentials for this file (see docker-compose.parity.yml, parity/mocks/).
//
// Payment SUCCESS paths (and provider-side failures) against the same mock
// providers: MoMo request-to-pay → verify / callback → completed (booking +
// viewing fee, notifications, escrow, admin confirm → payout), MoMo refunds and
// disbursements (guest refund, admin + dual-auth refund, payout, employee pay,
// agent-commission quirk), sandbox mode, Stripe PaymentIntents (listing /
// booking / viewing fee), signed Stripe webhooks (every handled branch,
// duplicates, signature failures) and Stripe refunds via dual authorization.
// Each step compares the API responses, the DB rows and the provider requests
// each backend made (method, URL, auth/target/reference headers, body).
import { createHmac } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accounts, dbs, diff, flushRedis, Pair, type Resp, type Side } from '../lib.js';
import { mockConfig, mockReset, ProviderLog, sameNorm, stripeSignature, stripeSucceed, UuidNormaliser, MOCK, type MockRequest } from '../mocks/client.js';

const both = async (q: string, params: unknown[] = []) => {
  const [d, e] = await Promise.all([dbs.django.query(q, params), dbs.express.query(q, params)]);
  return { django: d.rows, express: e.rows };
};
const SIDES = ['django', 'express'] as const;

const U = (n: number) => `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`;
const P = { big: U(1), refundFail: U(2), staleRef: U(3) };
const T0 = `'${new Date().toISOString()}'::timestamptz`;
const DEFAULT_MOMO = {
  collectionStatus: 'SUCCESSFUL', failureReason: 'APPROVAL_REJECTED', transferStatus: 'SUCCESSFUL', requestToPayHttp: 202,
  transferHttp: 202, tokenHttp: 200, inactiveMsisdns: [] as string[], unknownMsisdns: [] as string[],
};

let acct: Awaited<ReturnType<typeof accounts>>;
const pairs: Record<string, Pair> = {};
const u = new UuidNormaliser();
const log = new ProviderLog(u);
let notifBase = 0; let auditBase = 0; let approvalBase = 0; let webhookBase = 0;
/** PaymentIntent ids created through the API (identical on both sides — asserted where captured). */
const pi = { viewing: '', booking: '' };
const piOf = (r: { django: Resp; express: Resp }) => {
  const ids = SIDES.map((s) => String((r[s].body as { client_secret: string }).client_secret).split('_secret_')[0]!);
  expect(ids[1], 'same PaymentIntent id on both sides').toBe(ids[0]);
  return ids[0]!;
};

function paymentSql(id: string, o: { status: string; booking: number; amount: string; txid?: string }) {
  return `INSERT INTO payments_payment (id, amount, amount_in_usd, payment_method, gateway_transaction_id, gateway_response, status, created_at,
    processed_at, completed_at, phone_number, network_provider, card_last4, card_type, card_country, currency_id, user_id, gateway_id, booking_id,
    viewing_id, purpose) VALUES ('${id}', ${o.amount}, ${o.amount}, 'mobile_money', '${o.txid ?? ''}', '{}', '${o.status}',
    ${T0} - interval '2 days' - interval '${Number(id.slice(-4))} seconds', NULL, ${o.status === 'completed' ? `${T0} - interval '1 day'` : 'NULL'},
    '0770123456', 'MTN', '', '', '', 2, ${acct.customer!.id}, 1, ${o.booking}, NULL, 'booking')`;
}

beforeAll(async () => {
  acct = await accounts();
  await mockReset();
  u.keepAs(...Object.values(P));
  const guest = acct.customer!.id;
  const fixtures = [
    `UPDATE bookings_booking SET status='awaiting_payment' WHERE id IN (69, 136, 139)`,
    `UPDATE bookings_booking SET customer_id=${guest} WHERE id IN (126, 129, 136, 139)`,
    `UPDATE bookings_booking SET status='awaiting_payment' WHERE id = 126`,
    `UPDATE bookings_booking SET status='payment_requested' WHERE id = 129`,
    `UPDATE bookings_booking SET stripe_payment_intent_id='pi_test_66' WHERE id = 66`,
    `INSERT INTO bookings_paymentrequest (amount, currency, notes, created_at, is_paid, paid_at, stripe_payment_intent_id, booking_id, created_by_id)
       VALUES (208.00, 'USD', '', ${T0}, false, NULL, NULL, 126, ${acct.admin!.id}),
              (104.00, 'USD', '', ${T0}, false, NULL, 'pi_legacy_129', 129, ${acct.admin!.id})`,
    `UPDATE bookings_viewingappointment SET guest_id=${guest} WHERE id IN (22, 26, 27, 30, 31)`,
    paymentSql(P.big, { status: 'completed', booking: 66, amount: '900.00' }),
    paymentSql(P.refundFail, { status: 'completed', booking: 66, amount: '40.00' }),
    paymentSql(P.staleRef, { status: 'pending', booking: 66, amount: '5.00', txid: '99999999-9999-4999-8999-999999999999' }),
  ];
  for (const f of fixtures) await both(f);
  const max = async (t: string) => Number((await dbs.django.query(`SELECT COALESCE(MAX(id), 0) AS m FROM ${t}`)).rows[0].m);
  notifBase = await max('notifications_notification');
  auditBase = await max('superadmin_adminauditlog');
  approvalBase = await max('rbac_pendingapproval');
  webhookBase = await max('payments_webhooklog');
  const logins = { guest: acct.customer!.email, admin: acct.admin!.email, superadmin: acct.superadmin!.email };
  for (const [k, email] of Object.entries(logins)) {
    await flushRedis();
    pairs[k] = new Pair();
    const r = await pairs[k].login(email, process.env.PARITY_PASSWORD);
    expect(r.django.status, `login ${k}`).toBe(200);
    expect(r.express.status, `login ${k}`).toBe(200);
  }
  await flushRedis();
  await log.take(); // nothing provider-side happened during setup
});
beforeEach(async () => {
  await flushRedis(); // also drops both sides' cached MoMo tokens → each test re-authenticates identically
  await mockConfig({ momo: DEFAULT_MOMO, stripe: { failNext: null } });
});

// --- helpers ------------------------------------------------------------------------------------
const g = () => pairs.guest!;
const a = () => pairs.admin!;

/** Same request on both sides with a per-side JSON body (e.g. that side's payment uuid). */
async function each(p: Pair, method: string, path: string, body: (side: Side) => unknown) {
  const [django, express] = await Promise.all(SIDES.map((s) => p[s].req(method, path, { json: body(s) })));
  return { django: django!, express: express! };
}

/** Latest payment uuid per side for a booking / viewing. */
async function latestPayment(where: string) {
  const r = await both(`SELECT id FROM payments_payment WHERE ${where} ORDER BY created_at DESC LIMIT 1`);
  return { django: r.django[0]!.id as string, express: r.express[0]!.id as string };
}

async function sameRowsN(table: string, where = 'true', opts: { ignore?: string[]; order?: string } = {}) {
  const q = `SELECT * FROM ${table} WHERE ${where} ORDER BY ${opts.order ?? 'id'}`;
  const r = await both(q);
  const problems = diff(u.norm('django', r.django), u.norm('express', r.express), { ignore: opts.ignore, toleranceMs: 10_000 });
  expect(problems, `table ${table} where ${where}`).toEqual([]);
  return r;
}
const sameNotifications = () => sameRowsN('notifications_notification', `id > ${notifBase}`);
const sameAudit = () => sameRowsN('superadmin_adminauditlog', `id > ${auditBase}`);
const sameApprovals = () => sameRowsN('rbac_pendingapproval', `id > ${approvalBase}`);

/** The request (per side) matching `pred` among `reqs`; asserts exactly one. */
function one(reqs: Record<Side, MockRequest[]>, pred: (r: MockRequest) => boolean) {
  const out = {} as Record<Side, MockRequest>;
  for (const s of SIDES) {
    const m = reqs[s].filter(pred);
    expect(m.length, `${s}: matching provider calls`).toBe(1);
    out[s] = m[0]!;
  }
  return out;
}
const isPost = (path: string) => (r: MockRequest) => r.method === 'POST' && r.path === path;

async function confirmPayment(bookingId: number) {
  return a().req('POST', `/api/bookings/${bookingId}/confirm-payment/`, { json: {} });
}

async function stripeWebhook(event: unknown, opts: { secret?: string; t?: number; header?: string; raw?: string | Buffer } = {}) {
  const payload = opts.raw ?? JSON.stringify(event);
  const header = opts.header ?? stripeSignature(typeof payload === 'string' ? payload : payload.toString('latin1'), opts);
  const p = new Pair();
  const raw = typeof payload === 'string' ? payload : payload.toString('latin1');
  return p.req('POST', '/api/payments/webhooks/stripe/', { raw, headers: { 'Content-Type': 'application/json', 'Stripe-Signature': header } });
}
/** POST raw bytes to both backends (Pair.req only takes strings). */
async function rawPost(path: string, body: Buffer, headers: Record<string, string>) {
  const one = (side: Side) => new Promise<Resp>((resolve, reject) => {
    const rq = httpRequest({ host: `parity-${side}`, port: 8000, path, method: 'POST', headers: {
      Host: 'homekonet.com', 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '203.0.113.9', 'Content-Length': String(body.length), ...headers,
    } }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => {
        let parsed: unknown = text;
        try { parsed = JSON.parse(text); } catch { /* non-JSON */ }
        resolve({ status: res.statusCode ?? 0, headers: new Headers(), body: parsed, text, setCookies: [] });
      });
    });
    rq.on('error', reject);
    rq.end(body);
  });
  const [django, express] = await Promise.all([one('django'), one('express')]);
  return { django, express };
}
let evtSeq = 0;
function piSucceeded(piId: string, metadata: Record<string, string>, amount = 100) {
  evtSeq += 1;
  return {
    id: `evt_parity_${evtSeq}`, object: 'event', api_version: '2025-02-24.acacia', created: 1790000000, livemode: false,
    pending_webhooks: 1, request: { id: null, idempotency_key: null }, type: 'payment_intent.succeeded',
    data: { object: { id: piId, object: 'payment_intent', amount, amount_received: amount, currency: 'usd', status: 'succeeded', metadata } },
  };
}

// ================================================================================================
describe('MTN MoMo collection (booking rent)', () => {
  const body = { booking_id: 69, gateway: 'mtn_momo', payment_method: 'mobile_money', phone_number: '0770123456', currency: 'USD' };

  it('request-to-pay accepted → verify PENDING → SUCCESSFUL → completed → payment_received', async () => {
    await mockConfig({ momo: { collectionStatus: 'PENDING' } });
    const init = await g().req('POST', '/api/payments/initiate/', { json: body });
    sameNorm(u, init);
    expect(init.django.status).toBe(201);
    const calls = await log.same(3); // token, account-holder check, requesttopay
    const rtp = one(calls, isPost('/collection/v1_0/requesttopay'));
    const pay = await latestPayment('booking_id = 69');
    for (const s of SIDES) {
      const row = (await dbs[s].query('SELECT gateway_transaction_id, status FROM payments_payment WHERE id = $1', [pay[s]])).rows[0];
      expect(row.gateway_transaction_id, `${s}: stored MoMo reference = X-Reference-Id sent`).toBe(rtp[s].headers['x-reference-id']);
      expect((rtp[s].body as { externalId: string }).externalId, `${s}: externalId = payment uuid`).toBe(pay[s]);
      expect(row.status).toBe('pending');
    }

    const v1 = await each(g(), 'POST', '/api/payments/verify/', (s) => ({ payment_id: pay[s], gateway: 'mtn_momo' }));
    sameNorm(u, v1);
    await log.same(1); // status poll (token cached in each side's Redis)
    await sameRowsN('bookings_booking', 'id = 69');

    await mockConfig({ momo: { collectionStatus: 'SUCCESSFUL' } });
    const v2 = await each(g(), 'POST', '/api/payments/verify/', (s) => ({ payment_id: pay[s], gateway: 'mtn_momo' }));
    sameNorm(u, v2);
    expect((v2.django.body as { booking_status: string }).booking_status).toBe('payment_received');
    await log.same(1);
    // Idempotent re-poll: no second transition / notification.
    sameNorm(u, await each(g(), 'POST', '/api/payments/verify/', (s) => ({ payment_id: pay[s], gateway: 'mtn_momo' })));
    await log.same(1);
    await sameRowsN('payments_payment', 'booking_id = 69', { order: 'created_at' });
    await sameRowsN('bookings_booking', 'id = 69');
    await sameNotifications();
  });

  it('escrow hold blocks admin confirm; release → confirm → payout; disburse needs a number, then succeeds', async () => {
    sameNorm(u, await a().req('POST', '/api/payments/admin/escrow/69/hold/', { json: { reason: 'Verify MoMo receipt' } }));
    sameNorm(u, await confirmPayment(69));
    const hold = (await dbs.django.query('SELECT max(id) AS id FROM payments_escrowhold WHERE booking_id = 69')).rows[0].id;
    sameNorm(u, await a().req('POST', `/api/payments/admin/escrow/${hold}/release/`));
    sameNorm(u, await confirmPayment(69));
    await sameRowsN('payments_escrowhold', 'booking_id = 69');
    await sameRowsN('payments_payout', 'booking_id = 69');
    const payout = await both('SELECT id FROM payments_payout WHERE booking_id = 69');
    const po = { django: payout.django[0]!.id as string, express: payout.express[0]!.id as string };
    // Host payouts have no recipient number and Profile has no momo_number (Django quirk) → refused, no MoMo call.
    const r1 = await Promise.all(SIDES.map((s) => a()[s].req('POST', `/api/payments/admin/payouts/${po[s]}/disburse/`)));
    sameNorm(u, { django: r1[0]!, express: r1[1]! });
    await log.same(0);
    await both(`UPDATE payments_payout SET recipient_momo_number = '+231 77 012 3456' WHERE booking_id = 69`);
    // Disbursement rejected by MTN → stays pending.
    await mockConfig({ momo: { transferHttp: 500 } });
    const r2 = await Promise.all(SIDES.map((s) => a()[s].req('POST', `/api/payments/admin/payouts/${po[s]}/disburse/`)));
    sameNorm(u, { django: r2[0]!, express: r2[1]! });
    await log.same(2); // disbursement token + transfer
    await mockConfig({ momo: { transferHttp: 202 } });
    const r3 = await Promise.all(SIDES.map((s) => a()[s].req('POST', `/api/payments/admin/payouts/${po[s]}/disburse/`)));
    sameNorm(u, { django: r3[0]!, express: r3[1]! });
    expect((r3[0]!.body as { status: string }).status).toBe('paid');
    const calls = await log.same(1); // token cached within the test
    const tr = one(calls, isPost('/disbursement/v1_0/transfer'));
    for (const s of SIDES) {
      const row = (await dbs[s].query('SELECT reference FROM payments_payout WHERE id = $1', [po[s]])).rows[0];
      expect(row.reference, `${s}: payout reference = transfer X-Reference-Id`).toBe(tr[s].headers['x-reference-id']);
    }
    // Already paid → refused.
    const r4 = await Promise.all(SIDES.map((s) => a()[s].req('POST', `/api/payments/admin/payouts/${po[s]}/disburse/`)));
    sameNorm(u, { django: r4[0]!, express: r4[1]! });
    await log.same(0);
    await sameRowsN('payments_payout', 'booking_id = 69');
    await sameRowsN('bookings_booking', 'id = 69');
    await sameNotifications();
    await sameAudit();
  });

  it('MoMo callback (unsigned) re-verifies against the API: agent-sourced booking → payout to captured owner number', async () => {
    await mockConfig({ momo: { collectionStatus: 'PENDING' } });
    sameNorm(u, await g().req('POST', '/api/payments/initiate/', { json: { ...body, booking_id: 139, phone_number: '+231770123456' } }));
    await log.same(3);
    const pay = await latestPayment('booking_id = 139');
    const cb = (status: string) => Promise.all(SIDES.map((s) => new Pair()[s].req('POST', '/api/payments/webhooks/mtn_momo/', { json: { externalId: pay[s], status } })))
      .then(([django, express]) => ({ django: django!, express: express! }));
    // Forged SUCCESSFUL callback while MTN still says PENDING → stays pending.
    sameNorm(u, await cb('SUCCESSFUL'));
    await log.same(1);
    await sameRowsN('payments_payment', 'booking_id = 139', { order: 'created_at' });
    await mockConfig({ momo: { collectionStatus: 'SUCCESSFUL' } });
    sameNorm(u, await cb('SUCCESSFUL'));
    sameNorm(u, await cb('SUCCESSFUL')); // duplicate delivery → idempotent
    await log.same(2);
    await sameRowsN('payments_webhooklog', `id > ${webhookBase}`);
    await sameRowsN('payments_payment', 'booking_id = 139', { order: 'created_at' });
    await sameRowsN('bookings_booking', 'id = 139');
    sameNorm(u, await confirmPayment(139));
    await sameRowsN('payments_payout', 'booking_id = 139');
    await sameRowsN('agents_agentcommission', 'booking_id = 139');
    const po = await both('SELECT id FROM payments_payout WHERE booking_id = 139');
    const r = await Promise.all(SIDES.map((s) => a()[s].req('POST', `/api/payments/admin/payouts/${po[s][0]!.id}/disburse/`)));
    sameNorm(u, { django: r[0]!, express: r[1]! });
    expect(r[0]!.status).toBe(200);
    const calls = await log.same(2);
    const tr = one(calls, isPost('/disbursement/v1_0/transfer'));
    expect((tr.django.body as { payee: { partyId: string } }).payee.partyId).toBe('231880948751');
    // Agent commission: Django reads agent.profile.momo_number, which doesn't exist → always
    // "No MoMo number on file" (reproduced quirk) — never reaches MTN.
    const c = (await dbs.django.query('SELECT id FROM agents_agentcommission WHERE booking_id = 139')).rows[0];
    expect(c, 'agent commission created on confirm').toBeTruthy();
    sameNorm(u, await a().req('POST', `/api/payments/admin/agent-commissions/${c.id}/disburse/`));
    await log.same(0);
    await sameRowsN('payments_payout', 'booking_id = 139');
    await sameRowsN('agents_agentcommission', 'booking_id = 139');
    await sameNotifications();
    await sameAudit();
  });

  it('provider failures: inactive / unknown MSISDN, requesttopay 500, token endpoint down, FAILED / TIMEOUT, unknown reference', async () => {
    const b = { ...body, booking_id: 136 };
    await mockConfig({ momo: { inactiveMsisdns: ['231770000001'], unknownMsisdns: ['231880000002'] } });
    sameNorm(u, await g().req('POST', '/api/payments/initiate/', { json: { ...b, phone_number: '0770000001' } }));
    await log.same(2); // token + account check; no requesttopay
    sameNorm(u, await g().req('POST', '/api/payments/initiate/', { json: { ...b, phone_number: '0880000002' } }));
    await log.same(1);
    await mockConfig({ momo: { requestToPayHttp: 500 } });
    sameNorm(u, await g().req('POST', '/api/payments/initiate/', { json: b }));
    await log.same(2);
    await flushRedis(); // force a token fetch
    await mockConfig({ momo: { requestToPayHttp: 202, tokenHttp: 500 } });
    // Account check fails open on the token error; requesttopay's own token fetch → raise_for_status → "Network error".
    sameNorm(u, await g().req('POST', '/api/payments/initiate/', { json: b }));
    await log.same(2);
    await mockConfig({ momo: { tokenHttp: 200, collectionStatus: 'FAILED' } });
    sameNorm(u, await g().req('POST', '/api/payments/initiate/', { json: b }));
    await log.same(3);
    let pay = await latestPayment('booking_id = 136');
    sameNorm(u, await each(g(), 'POST', '/api/payments/verify/', (s) => ({ payment_id: pay[s], gateway: 'mtn_momo' })));
    await log.same(1);
    await mockConfig({ momo: { collectionStatus: 'TIMEOUT', failureReason: 'EXPIRED' } });
    sameNorm(u, await g().req('POST', '/api/payments/initiate/', { json: b }));
    pay = await latestPayment('booking_id = 136');
    sameNorm(u, await each(g(), 'POST', '/api/payments/verify/', (s) => ({ payment_id: pay[s], gateway: 'mtn_momo' })));
    await log.same(3);
    // A reference MTN has never seen → 404 → "Verification failed: 404".
    sameNorm(u, await g().req('POST', '/api/payments/verify/', { json: { payment_id: P.staleRef, gateway: 'mtn_momo' } }));
    await log.same(1);
    await sameRowsN('payments_payment', `booking_id = 136 OR id = '${P.staleRef}'`, { order: 'created_at' });
    await sameRowsN('bookings_booking', 'id = 136');
    await sameNotifications();
  });
});

describe('MTN MoMo viewing fee', () => {
  const body = { viewing_id: 26, gateway: 'mtn_momo', payment_method: 'mobile_money', phone_number: '0880123456', currency: 'USD' };
  it('live: initiate → verify → fee_paid (+ admin + guest notifications)', async () => {
    sameNorm(u, await g().req('POST', '/api/payments/viewing/initiate/', { json: body }));
    await log.same(3);
    const pay = await latestPayment('viewing_id = 26');
    const v = await each(g(), 'POST', '/api/payments/verify/', (s) => ({ payment_id: pay[s], gateway: 'mtn_momo' }));
    sameNorm(u, v);
    expect((v.django.body as { viewing_status: string }).viewing_status).toBe('fee_paid');
    await log.same(1);
    sameNorm(u, await g().req('POST', '/api/payments/viewing/initiate/', { json: body })); // already paid → validation error
    await log.same(0);
    await sameRowsN('payments_payment', 'viewing_id = 26', { order: 'created_at' });
    await sameRowsN('bookings_viewingappointment', 'id = 26');
    await sameNotifications();
  });

  it('sandbox mode: sandbox host, EUR wire currency, sandbox credentials + target environment', async () => {
    await both(`UPDATE payments_paymentgateway SET sandbox_mode = true WHERE name = 'mtn_momo'`);
    try {
      sameNorm(u, await g().req('POST', '/api/payments/viewing/initiate/', { json: { ...body, viewing_id: 30, phone_number: '46733123450' } }));
      const calls = await log.same(2); // no account-holder check in sandbox
      const rtp = one(calls, isPost('/collection/v1_0/requesttopay'));
      expect(rtp.django.host).toBe('sandbox.momodeveloper.mtn.com');
      expect(rtp.django.headers['x-target-environment']).toBe('sandbox');
      expect((rtp.django.body as { currency: string }).currency).toBe('EUR');
      const pay = await latestPayment('viewing_id = 30');
      sameNorm(u, await each(g(), 'POST', '/api/payments/verify/', (s) => ({ payment_id: pay[s], gateway: 'mtn_momo' })));
      await log.same(1);
      await sameRowsN('payments_payment', 'viewing_id = 30', { order: 'created_at' });
      await sameRowsN('bookings_viewingappointment', 'id = 30');
      // Sandbox-only: a rejected requesttopay returns a `debug` block (url, request body, MTN's response headers).
      await mockConfig({ momo: { requestToPayHttp: 500 } });
      const r = await g().req('POST', '/api/payments/viewing/initiate/', { json: { ...body, viewing_id: 31, phone_number: '46733123450' } });
      sameNorm(u, r);
      await log.same(1);
      const rows = await sameRowsN('payments_payment', 'viewing_id = 31', { order: 'created_at', ignore: ['Date'] });
      const dbg = (rows.django.at(-1)!.gateway_response as { debug: { response_headers: Record<string, string> } }).debug;
      expect(Object.keys(dbg.response_headers), 'server header spelling kept').toContain('Content-Type');
    } finally {
      await both(`UPDATE payments_paymentgateway SET sandbox_mode = false WHERE name = 'mtn_momo'`);
    }
  });
});

describe('MTN MoMo refunds (disbursement back to the payer)', () => {
  it('guest refund success → partially_refunded; second guest refund refused; admin refunds the rest → refunded', async () => {
    const pay = await latestPayment(`booking_id = 69 AND status = 'completed'`);
    const r = await each(g(), 'POST', '/api/payments/refund/', (s) => ({ payment_id: pay[s], amount: '10.00', reason: 'Not as described', reason_code: 'misrepresentation' }));
    sameNorm(u, r);
    expect(r.django.status).toBe(200);
    const calls = await log.same(2);
    const tr = one(calls, isPost('/disbursement/v1_0/transfer'));
    for (const s of SIDES) {
      const row = (await dbs[s].query('SELECT gateway_refund_id FROM payments_refund WHERE payment_id = $1', [pay[s]])).rows[0];
      expect(row.gateway_refund_id, `${s}: refund id = transfer reference`).toBe(tr[s].headers['x-reference-id']);
    }
    sameNorm(u, await each(g(), 'POST', '/api/payments/refund/', (s) => ({ payment_id: pay[s], amount: '1.00', reason: 'again', reason_code: 'misrepresentation' })));
    sameNorm(u, await each(a(), 'POST', '/api/payments/admin/refund/', (s) => ({ payment_id: pay[s], amount: '52.41', reason: 'too much' })));
    await log.same(0);
    sameNorm(u, await each(a(), 'POST', '/api/payments/admin/refund/', (s) => ({ payment_id: pay[s], amount: 52.4, reason: 'remaining balance', reason_code: 'safety_concern' })));
    await log.same(1);
    await sameRowsN('payments_refund', `payment_id IN (SELECT id FROM payments_payment WHERE booking_id = 69)`, { order: 'created_at' });
    await sameRowsN('payments_payment', 'booking_id = 69', { order: 'created_at' });
    await sameNotifications();
    await sameAudit();
  });

  it('disbursement rejected → refund row failed, payment unchanged', async () => {
    await mockConfig({ momo: { transferHttp: 500 } });
    sameNorm(u, await g().req('POST', '/api/payments/refund/', { json: { payment_id: P.refundFail, amount: '5', reason: 'r', reason_code: 'legal_issue' } }));
    sameNorm(u, await a().req('POST', '/api/payments/admin/refund/', { json: { payment_id: P.refundFail, amount: '6', reason: 'admin r' } }));
    await log.same(3);
    await sameRowsN('payments_refund', `payment_id = '${P.refundFail}'`, { order: 'created_at' });
    await sameRowsN('payments_payment', `id = '${P.refundFail}'`);
  });

  it('large admin refund → dual authorization → approved → executor disburses', async () => {
    sameNorm(u, await a().req('POST', '/api/payments/admin/refund/', { json: { payment_id: P.big, amount: 600.5, reason: 'big refund', reason_code: 'legal_issue' } }));
    await log.same(0);
    const id = (await dbs.django.query('SELECT max(id) AS id FROM rbac_pendingapproval')).rows[0].id;
    sameNorm(u, await pairs.superadmin!.req('POST', `/api/rbac/approvals/${id}/approve/`, { json: {} }));
    const calls = await log.same(2);
    const tr = one(calls, isPost('/disbursement/v1_0/transfer'));
    expect((tr.django.body as { amount: string }).amount).toBe('600.5');
    await sameApprovals();
    await sameRowsN('payments_refund', `payment_id = '${P.big}'`, { order: 'created_at' });
    await sameRowsN('payments_payment', `id = '${P.big}'`);
    await sameAudit();
  });
});

describe('MTN MoMo employee payments', () => {
  it('pay success (201, reference = transfer id) and rejected disbursement (400, failed row)', async () => {
    const f = a();
    sameNorm(u, await f.req('POST', '/api/payments/admin/employees/', { json: { name: 'Parity Cleaner', momo_number: '0770555555', role_title: 'Cleaner' } }));
    const emp = (await dbs.django.query(`SELECT id FROM payments_employee WHERE name = 'Parity Cleaner'`)).rows[0].id;
    const ok = await f.req('POST', `/api/payments/admin/employees/${emp}/pay/`, { json: { amount: '25.50', description: ' October ' } });
    sameNorm(u, ok);
    expect(ok.django.status).toBe(201);
    const calls = await log.same(2);
    const tr = one(calls, isPost('/disbursement/v1_0/transfer'));
    expect((tr.express.body as { amount: string }).amount).toBe('25.5');
    await mockConfig({ momo: { transferHttp: 500 } });
    sameNorm(u, await f.req('POST', `/api/payments/admin/employees/${emp}/pay/`, { json: { amount: 3, currency: 'USD' } }));
    await log.same(1);
    await sameRowsN('payments_employeepayment', `employee_id = ${emp}`, { order: 'created_at' });
    await sameAudit();
  });
});

// ================================================================================================
describe('Stripe PaymentIntents', () => {
  it('viewing fee intent (+ amount_too_small / invalid currency errors)', async () => {
    const ok = await g().req('POST', '/api/payments/stripe/viewing-fee-intent/', { json: { viewing_id: 27 } });
    sameNorm(u, ok);
    pi.viewing = piOf(ok);
    expect(pi.viewing).toMatch(/^pi_parity_\d+$/);
    let calls = await log.same(1);
    expect(calls.django[0]!.headers['stripe-version']).toBe('2025-02-24.acacia');
    expect(calls.django[0]!.headers.authorization).toBe(`Bearer ${MOCK.stripeSecretKey}`);
    sameNorm(u, await g().req('POST', '/api/payments/stripe/viewing-fee-intent/', { json: { viewing_id: 22 } })); // 10 cents
    sameNorm(u, await g().req('POST', '/api/payments/stripe/viewing-fee-intent/', { json: { viewing_id: 31, currency: 'XYZ' } }));
    calls = await log.same(2);
    sameNorm(u, await g().req('POST', '/api/payments/stripe/viewing-fee-intent/', { json: { viewing_id: 26 } })); // already paid (MoMo)
    await log.same(0);
  });

  it('booking payment intent', async () => {
    const r = await g().req('POST', '/api/payments/stripe/booking-payment-intent/', { json: { booking_id: 126, currency: 'USD' } });
    sameNorm(u, r);
    pi.booking = piOf(r);
    sameNorm(u, await g().req('POST', '/api/payments/stripe/booking-payment-intent/', { json: { booking_id: 66 } })); // not awaiting payment
    await log.same(1);
  });

  it('listing payment intent (server-side pricing) + Stripe user_message error', async () => {
    const d = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    const listing = (await dbs.django.query('SELECT id FROM listings_listing WHERE is_available ORDER BY id LIMIT 1')).rows[0].id;
    sameNorm(u, await g().req('POST', '/api/payments/stripe/payment-intent/', { json: { listing_id: listing, check_in: d(40), check_out: d(43) } }));
    sameNorm(u, await g().req('POST', '/api/payments/stripe/payment-intent/', { json: { listing_id: String(listing), check_in: d(40), check_out: d(41), currency: 'Nope' } }));
    await log.same(2);
  });

  it('Stripe API errors: card_error and a 500 that both clients retry twice', async () => {
    await mockConfig({ stripe: { failNext: { count: 1, status: 402, type: 'card_error', code: 'card_declined', message: 'Your card was declined.' } } });
    sameNorm(u, await g().req('POST', '/api/payments/stripe/viewing-fee-intent/', { json: { viewing_id: 31 } }));
    await log.same(1);
    // (The mock keeps a separate failure budget per side.)
    await mockConfig({ stripe: { failNext: { count: 3, status: 500, type: 'api_error', message: 'Something went wrong on our end.' } } });
    sameNorm(u, await g().req('POST', '/api/payments/stripe/viewing-fee-intent/', { json: { viewing_id: 31 } }));
    await log.same(3); // 1 + 2 retries each
    // Two 500s then success: the second retry succeeds on both sides.
    await mockConfig({ stripe: { failNext: { count: 2, status: 503, type: 'api_error', message: 'Service unavailable.' } } });
    sameNorm(u, await g().req('POST', '/api/payments/stripe/viewing-fee-intent/', { json: { viewing_id: 31 } }));
    await log.same(3);
  });
});

describe('Stripe webhooks (signed with the test whsec)', () => {
  it('payment_intent.succeeded: viewing_fee → fee paid + PI stored; duplicate delivery is idempotent', async () => {
    const ev = piSucceeded(pi.viewing, { user_id: String(acct.customer!.id), viewing_id: '27', type: 'viewing_fee' });
    sameNorm(u, await stripeWebhook(ev));
    sameNorm(u, await stripeWebhook(ev));
    await sameRowsN('bookings_viewingappointment', 'id = 27');
    await sameNotifications();
    sameNorm(u, await stripeWebhook(piSucceeded('pi_x', { viewing_id: '999999', type: 'viewing_fee' })));
    await log.same(0);
  });

  it('payment_intent.succeeded: property_payment with booking_id → payment_received + PaymentRequest paid; duplicate ignored', async () => {
    const ev = piSucceeded(pi.booking, { user_id: String(acct.customer!.id), booking_id: '126', type: 'property_payment' }, 20800);
    sameNorm(u, await stripeWebhook(ev));
    sameNorm(u, await stripeWebhook(ev));
    await sameRowsN('bookings_booking', 'id = 126');
    await sameRowsN('bookings_paymentrequest', 'booking_id IN (126, 129)');
    await sameNotifications();
  });

  it('property_payment without booking_id → legacy PaymentRequest lookup', async () => {
    sameNorm(u, await stripeWebhook(piSucceeded('pi_legacy_129', { user_id: String(acct.customer!.id), type: 'property_payment' }, 10400)));
    sameNorm(u, await stripeWebhook(piSucceeded('pi_unknown', { type: 'property_payment' })));
    await sameRowsN('bookings_booking', 'id = 129');
    await sameRowsN('bookings_paymentrequest', 'booking_id IN (126, 129)');
    await sameNotifications();
  });

  it('unhandled types / no metadata type → 200 no-op', async () => {
    const base = piSucceeded('pi_parity_999999', {});
    for (const ev of [base, { ...base, type: 'payment_intent.payment_failed' }, { ...base, type: 'charge.refunded', data: { object: { id: 'ch_1', object: 'charge' } } },
      piSucceeded('pi_y', { type: 'something_else', booking_id: '136' })]) {
      sameNorm(u, await stripeWebhook(ev));
    }
    await sameRowsN('bookings_booking', 'id IN (126, 129, 136)');
  });

  it('signature / payload failures', async () => {
    const ev = piSucceeded(pi.booking, { booking_id: '136', type: 'property_payment' });
    sameNorm(u, await stripeWebhook(ev, { secret: 'whsec_wrong' }));
    sameNorm(u, await stripeWebhook(ev, { t: Math.floor(Date.now() / 1000) - 400 })); // outside the 300 s tolerance
    sameNorm(u, await stripeWebhook(ev, { header: 'garbage' }));
    sameNorm(u, await stripeWebhook(ev, { header: `t=${Math.floor(Date.now() / 1000)}` }));
    // Valid signature, but the PaymentIntent id is already stored on booking 126 (unique column)
    // → IntegrityError → 500 on both sides, nothing written.
    const dup = await stripeWebhook(ev);
    sameNorm(u, dup);
    expect(dup.django.status).toBe(500);
    // Several v1 signatures, one valid → accepted; booking 136 advances.
    const ev2 = piSucceeded('pi_multi_sig_136', { booking_id: '136', type: 'property_payment' });
    const raw2 = JSON.stringify(ev2);
    const good = stripeSignature(raw2);
    const multi = await stripeWebhook(ev2, { header: `${good.split(',')[0]},v1=${'0'.repeat(64)},${good.split(',')[1]}` });
    sameNorm(u, multi);
    expect(multi.django.text).toBe('{"status": "ok"}');
    // Valid signature over a non-JSON body → "Invalid payload".
    sameNorm(u, await stripeWebhook(null, { raw: 'not json' }));
    sameNorm(u, await stripeWebhook(null, { raw: '{"type": "payment_intent.succeeded"' }));
    // Non-UTF-8 body (validly signed over its bytes) → "Invalid payload" (Python's payload.decode('utf-8') fails first).
    const bytes = Buffer.concat([Buffer.from('{"type": "x", "v": "'), Buffer.from([0xff, 0xfe]), Buffer.from('"}')]);
    const t = Math.floor(Date.now() / 1000);
    const sig = `t=${t},v1=${createHmac('sha256', MOCK.stripeWebhookSecret).update(Buffer.concat([Buffer.from(`${t}.`), bytes])).digest('hex')}`;
    sameNorm(u, await rawPost('/api/payments/webhooks/stripe/', bytes, { 'Content-Type': 'application/json', 'Stripe-Signature': sig }));
    await sameRowsN('bookings_booking', 'id = 136');
    await sameNotifications();
  });
});

describe('Stripe refunds (always dual-authorized)', () => {
  it('confirm Stripe-paid booking → refund requested → approved → Stripe refund created', async () => {
    sameNorm(u, await confirmPayment(126));
    await stripeSucceed(pi.booking);
    sameNorm(u, await a().req('POST', '/api/payments/admin/stripe-refund/', { json: { booking_id: 126, amount: '50.00', reason: ' Partial goodwill ', reason_code: 'safety_concern' } }));
    await log.same(0);
    let id = (await dbs.django.query('SELECT max(id) AS id FROM rbac_pendingapproval')).rows[0].id;
    sameNorm(u, await pairs.superadmin!.req('POST', `/api/rbac/approvals/${id}/approve/`, { json: {} }));
    const calls = await log.same(1);
    const ref = one(calls, isPost('/v1/refunds'));
    expect(ref.django.body).toEqual({ payment_intent: pi.booking, amount: '5000', metadata: { admin_reason: 'Partial goodwill', booking_id: '126' } });
    sameNorm(u, await a().req('POST', '/api/payments/admin/stripe-refund/', { json: { booking_id: 126, amount: '158.01', reason: 'too much' } }));
    sameNorm(u, await a().req('POST', '/api/payments/admin/stripe-refund/', { json: { booking_id: 126, amount: 158, reason: 'rest' } }));
    id = (await dbs.django.query('SELECT max(id) AS id FROM rbac_pendingapproval')).rows[0].id;
    sameNorm(u, await pairs.superadmin!.req('POST', `/api/rbac/approvals/${id}/approve/`, { json: {} }));
    await log.same(1);
    await sameRowsN('payments_striperefund', 'booking_id = 126');
    await sameApprovals();
    await sameAudit();
  });

  it('Stripe rejects the refund (unknown PaymentIntent) → failed StripeRefund with the Stripe error', async () => {
    sameNorm(u, await a().req('POST', '/api/payments/admin/stripe-refund/', { json: { booking_id: 66, amount: '5', reason: 'dup' } }));
    const id = (await dbs.django.query('SELECT max(id) AS id FROM rbac_pendingapproval')).rows[0].id;
    sameNorm(u, await pairs.superadmin!.req('POST', `/api/rbac/approvals/${id}/approve/`, { json: {} }));
    await log.same(1);
    await sameRowsN('payments_striperefund', 'booking_id = 66');
    await sameApprovals();
  });
});

describe('final state', () => {
  it('payments-related tables match (uuids normalised)', async () => {
    await log.same();
    await sameRowsN('payments_payment', 'true', { order: 'created_at, status, amount' });
    await sameRowsN('payments_refund', 'true', { order: 'created_at' });
    await sameRowsN('payments_payout', 'true', { order: 'created_at' });
    await sameRowsN('payments_webhooklog', 'true');
    await sameRowsN('bookings_booking', 'true');
    await sameRowsN('bookings_viewingappointment', 'true');
    await sameNotifications();
    await sameAudit();
    await sameApprovals();
  });
});

