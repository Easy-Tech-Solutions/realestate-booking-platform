// Parity tests for the payments app: every /api/payments/ route (access matrix,
// validation, Decimal math, filters/pagination, rows written incl. audit log,
// notifications and dual-auth approvals) plus the MoMo/Stripe webhooks.
// Stripe/MoMo credentials are blank in the parity env, so provider calls end in
// the "not configured" error paths — everything up to the call is compared.
// Success paths against mock providers: payments-providers.parity.ts.
import { request as httpRequest } from 'node:http';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accounts, dbs, flushRedis, Pair, same, sameRows, type Side } from '../lib.js';

const both = async (q: string, params: unknown[] = []) => {
  const [d, e] = await Promise.all([dbs.django.query(q, params), dbs.express.query(q, params)]);
  return { django: d.rows, express: e.rows };
};

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PO = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;
const P = {
  refundable: U(1), viewingFee: U(2), old: U(3), flutterwave: U(4), pending: U(5), other: U(6), noPhone: U(7),
  bigRefund: U(8), flutterPending: U(9),
};

let acct: Awaited<ReturnType<typeof accounts>>;
const EMAILS = { finance: 'fin@parity.test', staff: 'staff@parity.test', support: 'support@parity.test', finrole: 'finrole@parity.test' };
const pairs: Record<string, Pair> = {};
let auditBase = 0;
let notifBase = 0;
let approvalBase = 0;
/** One fixed 'now' for fixtures so both copies get identical timestamps. */
const T0 = `'${new Date().toISOString()}'::timestamptz`;

function paymentSql(id: string, o: { user: number; status: string; purpose?: string; booking?: number | null; viewing?: number | null; gateway?: number; amount?: string; phone?: string; completedDaysAgo?: number | null; txid?: string }) {
  const completed = o.completedDaysAgo === null || o.completedDaysAgo === undefined ? 'NULL' : `${T0} - interval '${o.completedDaysAgo} days'`;
  return `INSERT INTO payments_payment (id, amount, amount_in_usd, payment_method, gateway_transaction_id, gateway_response, status, created_at,
    processed_at, completed_at, phone_number, network_provider, card_last4, card_type, card_country, currency_id, user_id, gateway_id, booking_id,
    viewing_id, purpose) VALUES ('${id}', ${o.amount ?? '62.40'}, ${o.amount ?? '62.40'}, 'mobile_money', '${o.txid ?? ''}', '{}', '${o.status}',
    ${T0} - interval '${(o.completedDaysAgo ?? 0) + 1} days' - interval '${Number(id.slice(-4))} seconds', NULL, ${completed}, '${o.phone ?? '0770123456'}', 'MTN', '', '', '', 2, ${o.user},
    ${o.gateway ?? 1}, ${o.booking ?? 'NULL'}, ${o.viewing ?? 'NULL'}, '${o.purpose ?? 'booking'}')`;
}

function payoutSql(id: string, booking: number, recipient: string, status = 'pending') {
  return `INSERT INTO payments_payout (id, gross_amount, service_fee_amount, net_amount, currency, status, reference, paid_at, notes, created_at,
    updated_at, booking_id, host_id, paid_by_id, cancellation_reason, cancelled_at, cancelled_by_id, recipient_momo_number, recipient_name, recipient_network)
    VALUES ('${id}', 104.00, 4.16, 99.84, 'USD', '${status}', '', NULL, '', ${T0} - interval '${booking} minutes', ${T0}, ${booking}, 4, NULL, '', NULL, NULL,
    '${recipient}', '', '')`;
}

function commissionSql(booking: number, status: string) {
  return `INSERT INTO agents_agentcommission (booking_amount, amount, currency, status, reference, paid_at, voided_at, notes, created_at, updated_at,
    agent_id, booking_id, listing_id, paid_by_id) VALUES (100.00, 0.50, 'USD', '${status}', '', NULL, NULL, '', ${T0} - interval '${booking} minutes', ${T0}, 3, ${booking},
    (SELECT listing_id FROM bookings_booking WHERE id = ${booking}), NULL)`;
}

beforeAll(async () => {
  acct = await accounts();
  const pw = `(SELECT password FROM users_user WHERE id = ${acct.customer!.id})`;
  const fixtures = [
    `UPDATE users_user SET email='${EMAILS.finance}', is_staff=true, email_verified=true, is_active=true, password=${pw} WHERE id=12`,
    `UPDATE users_user SET email='${EMAILS.staff}', is_staff=true, email_verified=true, is_active=true, password=${pw} WHERE id=27`,
    `UPDATE users_user SET email='${EMAILS.support}', is_staff=true, email_verified=true, is_active=true, password=${pw} WHERE id=32`,
    `UPDATE users_user SET email='${EMAILS.finrole}', is_staff=false, email_verified=true, is_active=true, password=${pw} WHERE id=34`,
    `INSERT INTO rbac_userroleassignment (granted_at, role_id, user_id) VALUES (${T0}, 4, 12), (${T0}, 3, 32), (${T0}, 4, 34)`,
    `UPDATE bookings_booking SET status='awaiting_payment' WHERE id=69`,
    `UPDATE bookings_booking SET stripe_payment_intent_id='pi_test_66' WHERE id=66`,
    `UPDATE bookings_viewingappointment SET guest_id=${acct.customer!.id} WHERE id IN (22, 26)`,
    paymentSql(P.refundable, { user: 60, status: 'completed', booking: 66, completedDaysAgo: 2 }),
    paymentSql(P.viewingFee, { user: 60, status: 'completed', purpose: 'viewing_fee', viewing: 3, amount: '3.00', completedDaysAgo: 2 }),
    paymentSql(P.old, { user: 60, status: 'completed', booking: 66, completedDaysAgo: 30 }),
    paymentSql(P.flutterwave, { user: 60, status: 'completed', booking: 66, gateway: 2, completedDaysAgo: 1 }),
    paymentSql(P.pending, { user: 60, status: 'pending', booking: 69, txid: 'mtn-ref-1' }),
    paymentSql(P.other, { user: 3, status: 'completed', booking: 37, completedDaysAgo: 1 }),
    paymentSql(P.noPhone, { user: 60, status: 'completed', booking: 66, phone: '', completedDaysAgo: 1 }),
    paymentSql(P.bigRefund, { user: 60, status: 'completed', booking: 66, amount: '900.00', completedDaysAgo: 1 }),
    paymentSql(P.flutterPending, { user: 60, status: 'pending', booking: 69, gateway: 2 }),
    payoutSql(PO(1), 37, ''),
    payoutSql(PO(2), 42, '0770123456'),
    payoutSql(PO(3), 43, '12345'),
    payoutSql(PO(4), 51, ''),
    commissionSql(37, 'pending'),
    commissionSql(42, 'paid'),
    commissionSql(51, 'pending'),
  ];
  for (const f of fixtures) await both(f);
  auditBase = Number((await dbs.django.query('SELECT COALESCE(MAX(id), 0) AS m FROM superadmin_adminauditlog')).rows[0].m);
  notifBase = Number((await dbs.django.query('SELECT COALESCE(MAX(id), 0) AS m FROM notifications_notification')).rows[0].m);
  approvalBase = Number((await dbs.django.query('SELECT COALESCE(MAX(id), 0) AS m FROM rbac_pendingapproval')).rows[0].m);
  const logins: Record<string, string> = {
    guest: acct.customer!.email, host: acct.agent!.email, user: acct.user!.email, admin: acct.admin!.email, superadmin: acct.superadmin!.email,
    ...EMAILS,
  };
  for (const [k, email] of Object.entries(logins)) {
    await flushRedis();
    pairs[k] = new Pair();
    const r = await pairs[k].login(email, process.env.PARITY_PASSWORD);
    expect(r.django.status, `login ${k}`).toBe(200);
    expect(r.express.status, `login ${k}`).toBe(200);
  }
  await flushRedis();
});
beforeEach(flushRedis);

const anon = () => new Pair();

/** Audit rows written since the start of the file (ids are sequential on both sides). */
const sameAudit = () => sameRows('superadmin_adminauditlog', `id > ${auditBase}`);
/** Notifications written since the start (payment uuids inside `data` legitimately differ). */
const sameNotifications = () => sameRows(
  `(SELECT id, user_id, notification_type, title, message, is_read, created_at, data - 'payment_id' AS data FROM notifications_notification) n`,
  `id > ${notifBase}`,
);

async function rawReq(p: Pair | null, method: string, path: string, contentType: string | null, body: string | Buffer, extra: Record<string, string> = {}) {
  const one = (side: Side) => new Promise<{ status: number; headers: Headers; body: unknown; text: string; setCookies: string[] }>((resolve, reject) => {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const headers: Record<string, string> = {
      Host: 'homekonet.com', 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '203.0.113.9', 'Content-Length': String(buf.length), ...extra,
    };
    if (contentType) headers['Content-Type'] = contentType;
    if (p?.[side].token) headers.Authorization = `Bearer ${p[side].token}`;
    const rq = httpRequest({ host: `parity-${side}`, port: 8000, path, method, headers }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => {
        let parsed: unknown = text;
        try { parsed = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
        const h = new Headers();
        for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) h.set(k, Array.isArray(v) ? v.join(', ') : v);
        resolve({ status: res.statusCode ?? 0, headers: h, body: parsed, text, setCookies: [] });
      });
    });
    rq.on('error', reject);
    rq.end(buf);
  });
  const [django, express] = await Promise.all([one('django'), one('express')]);
  return { django, express };
}

// ---------------------------------------------------------------------------------------------
const AUTH_ROUTES: [string, string][] = [
  ['POST', '/api/payments/initiate/'], ['POST', '/api/payments/viewing/initiate/'], ['POST', '/api/payments/verify/'],
  ['POST', '/api/payments/refund/'], ['GET', '/api/payments/user/'], ['GET', '/api/payments/admin/payouts/'],
  ['POST', `/api/payments/admin/payouts/${PO(1)}/mark-paid/`], ['POST', `/api/payments/admin/payouts/${PO(1)}/cancel/`],
  ['POST', `/api/payments/admin/payouts/${PO(1)}/disburse/`], ['GET', '/api/payments/admin/agent-commissions/'],
  ['POST', '/api/payments/admin/agent-commissions/1/disburse/'], ['GET', '/api/payments/admin/employees/'], ['POST', '/api/payments/admin/employees/'],
  ['PATCH', '/api/payments/admin/employees/1/'], ['DELETE', '/api/payments/admin/employees/1/'], ['POST', '/api/payments/admin/employees/1/pay/'],
  ['GET', '/api/payments/admin/employee-payments/'], ['POST', '/api/payments/admin/refund/'], ['POST', '/api/payments/admin/stripe-refund/'],
  ['GET', '/api/payments/admin/platform-fee/'], ['PATCH', '/api/payments/admin/platform-fee/'], ['GET', '/api/payments/admin/reports/summary/'],
  ['GET', '/api/payments/admin/transactions/'], ['GET', '/api/payments/admin/transactions/export/'], ['GET', '/api/payments/admin/escrow/'],
  ['POST', '/api/payments/admin/escrow/134/hold/'], ['POST', '/api/payments/admin/escrow/1/release/'], ['GET', '/api/payments/admin/tax-rates/'],
  ['POST', '/api/payments/admin/tax-rates/'], ['PATCH', '/api/payments/admin/tax-rates/1/'], ['DELETE', '/api/payments/admin/tax-rates/1/'],
  ['GET', '/api/payments/admin/currencies/'], ['PATCH', '/api/payments/admin/currencies/1/'], ['GET', '/api/payments/admin/tax-report/'],
  ['GET', `/api/payments/${P.refundable}/`], ['POST', '/api/payments/stripe/payment-intent/'], ['POST', '/api/payments/stripe/booking-payment-intent/'],
  ['POST', '/api/payments/stripe/viewing-fee-intent/'], ['GET', '/api/payments/cards/'], ['POST', '/api/payments/cards/'],
  ['PUT', '/api/payments/cards/2/'], ['PATCH', '/api/payments/cards/2/'], ['DELETE', '/api/payments/cards/2/'],
];

describe('access control', () => {
  it('anonymous → 401 on every authenticated route', async () => {
    for (const [m, path] of AUTH_ROUTES) same(await anon().req(m, path, { json: {} }), { headers: ['www-authenticate'] });
  });
  it('bad token → 401 even on public currencies', async () => {
    same(await anon().req('GET', '/api/payments/currencies/', { token: 'x.y.z' }));
  });
  it('wrong methods → 405', async () => {
    const p = pairs.admin!;
    for (const [m, path] of [
      ['POST', '/api/payments/currencies/'], ['GET', '/api/payments/initiate/'], ['GET', '/api/payments/refund/'], ['POST', '/api/payments/user/'],
      ['DELETE', '/api/payments/admin/payouts/'], ['GET', `/api/payments/admin/payouts/${PO(1)}/mark-paid/`], ['GET', '/api/payments/admin/employees/1/'],
      ['PUT', '/api/payments/admin/platform-fee/'], ['POST', '/api/payments/admin/currencies/'], ['GET', '/api/payments/cards/2/'],
      ['POST', `/api/payments/${P.refundable}/`], ['DELETE', '/api/payments/admin/escrow/'], ['GET', '/api/payments/stripe/payment-intent/'],
    ] as const) same(await p.req(m, path));
  });
  it('content negotiation', async () => {
    same(await anon().req('GET', '/api/payments/currencies/?format=xml'));
    same(await anon().req('GET', '/api/payments/currencies/?format=json'));
    same(await anon().req('GET', '/api/payments/currencies/', { headers: { Accept: 'application/xml' } }));
    same(await pairs.admin!.req('GET', '/api/payments/admin/payouts/?format=api'));
  });

  const ADMIN_GETS = [
    '/api/payments/admin/payouts/', '/api/payments/admin/agent-commissions/', '/api/payments/admin/employees/', '/api/payments/admin/employee-payments/',
    '/api/payments/admin/platform-fee/', '/api/payments/admin/reports/summary/', '/api/payments/admin/transactions/',
    '/api/payments/admin/escrow/', '/api/payments/admin/tax-rates/', '/api/payments/admin/currencies/', '/api/payments/admin/tax-report/',
  ];
  for (const role of ['guest', 'host', 'user', 'staff', 'support', 'finrole', 'finance', 'admin', 'superadmin']) {
    it(`admin GET matrix as ${role}`, async () => {
      for (const path of ADMIN_GETS) same(await pairs[role]!.req('GET', path));
      const exp = await pairs[role]!.req('GET', '/api/payments/admin/transactions/export/');
      expect(exp.express.status).toBe(exp.django.status);
      expect(exp.express.text).toBe(exp.django.text);
    });
    it(`admin POST matrix (denied paths, no side effects) as ${role}`, async () => {
      if (['finance', 'admin', 'superadmin'].includes(role)) return;
      for (const [m, path] of AUTH_ROUTES.filter(([, p]) => p.includes('/admin/'))) {
        if (m === 'GET') continue;
        same(await pairs[role]!.req(m, path, { json: {} }));
      }
    });
  }
});

describe('public / guest endpoints', () => {
  it('currencies list', async () => same(await anon().req('GET', '/api/payments/currencies/')));
  it('user payments + detail', async () => {
    same(await pairs.guest!.req('GET', '/api/payments/user/'));
    same(await pairs.host!.req('GET', '/api/payments/user/'));
    same(await pairs.guest!.req('GET', `/api/payments/${P.refundable}/`));
    same(await pairs.guest!.req('GET', `/api/payments/${P.viewingFee}/`)); // no booking → booking_title omitted
    same(await pairs.guest!.req('GET', `/api/payments/${P.other}/`)); // someone else's → 403
    same(await pairs.guest!.req('GET', `/api/payments/${U(999)}/`));
    same(await pairs.guest!.req('GET', '/api/payments/ABCDEF00-0000-4000-8000-000000000001/'));
  });
});

describe('initiate payment', () => {
  const g = () => pairs.guest!;
  const base = { booking_id: 69, gateway: 'mtn_momo', payment_method: 'mobile_money', phone_number: '0770123456', currency: 'USD' };
  it('validation errors', async () => {
    for (const body of [
      {}, [], { ...base, booking_id: 'abc' }, { ...base, booking_id: 66 }, { ...base, booking_id: 37 }, { ...base, booking_id: '999999999999999999999' },
      { ...base, booking_id: '69.0' }, { ...base, booking_id: true }, { ...base, booking_id: null }, { ...base, gateway: 'paypal' },
      { ...base, gateway: '' }, { ...base, gateway: '   ' }, { ...base, gateway: 5 }, { ...base, gateway: ['x'] }, { ...base, phone_number: '0'.repeat(21) },
      { ...base, currency: 'EUR' }, { ...base, currency: 'USDX' }, { ...base, currency: 'LRD' }, { ...base, payment_method: 'x'.repeat(21) },
      { ...base, gateway: 'mtn_momo', currency: 'LRD', phone_number: '' },
    ]) same(await g().req('POST', '/api/payments/initiate/', { json: body }));
    same(await g().req('POST', '/api/payments/initiate/', { form: (() => { const f = new FormData(); f.set('booking_id', '69'); return f; })() }));
    await sameRows('payments_payment', 'booking_id = 69', { ignore: ['id'], order: 'created_at' });
  });
  it('gateway without implementation / missing gateway row / MoMo errors', async () => {
    same(await g().req('POST', '/api/payments/initiate/', { json: { ...base, gateway: 'flutterwave' } }));
    same(await g().req('POST', '/api/payments/initiate/', { json: { ...base, gateway: 'flutterwave', currency: 'LRD' } }));
    same(await g().req('POST', '/api/payments/initiate/', { json: { ...base, gateway: 'orange_money' } }));
    same(await g().req('POST', '/api/payments/initiate/', { json: { ...base, phone_number: '12345' } }));
    same(await g().req('POST', '/api/payments/initiate/', { json: { ...base, phone_number: ' +231 77 012 3456 ' } }));
    await sameRows('payments_payment', 'booking_id = 69', { ignore: ['id'], order: 'created_at, amount' });
    await sameNotifications();
  });
  it('viewing fee initiate', async () => {
    const vb = { ...base, viewing_id: 22 } as Record<string, unknown>;
    delete vb.booking_id;
    for (const body of [{}, { ...vb, viewing_id: 2 }, { ...vb, viewing_id: 4 }, { ...vb, viewing_id: 999 }, { ...vb, currency: 'LRD' }]) {
      same(await g().req('POST', '/api/payments/viewing/initiate/', { json: body }));
    }
    same(await g().req('POST', '/api/payments/viewing/initiate/', { json: vb })); // 0.10 USD → under 1 whole unit
    same(await g().req('POST', '/api/payments/viewing/initiate/', { json: { ...vb, viewing_id: 26 } })); // MoMo not configured
    same(await g().req('POST', '/api/payments/viewing/initiate/', { json: { ...vb, viewing_id: 26, gateway: 'flutterwave', currency: 'LRD' } }));
    await sameRows('payments_payment', 'viewing_id IN (22, 26)', { ignore: ['id'], order: 'created_at' });
    await sameNotifications();
  });
});

describe('verify payment', () => {
  it('validation, 404, 403, gateway errors', async () => {
    const g = pairs.guest!;
    for (const body of [{}, { payment_id: 'nope', gateway: 'mtn_momo' }, { payment_id: 5, gateway: 'x' }, { payment_id: P.pending },
      { payment_id: U(999), gateway: 'mtn_momo' }, { payment_id: P.other, gateway: 'mtn_momo' }, { payment_id: P.pending, gateway: 'mtn_momo' },
      { payment_id: `{${P.pending.toUpperCase()}}`, gateway: 'mtn_momo' }, { payment_id: P.flutterPending, gateway: 'x' }, { payment_id: true, gateway: 'x' }]) {
      same(await g.req('POST', '/api/payments/verify/', { json: body }));
    }
    await sameRows('payments_payment', `id = '${P.pending}'`);
  });
});

describe('guest refunds', () => {
  const g = () => pairs.guest!;
  const base = { payment_id: P.refundable, amount: '10.00', reason: 'Broken', reason_code: 'misrepresentation' };
  it('validation (Decimal parsing/precision) and eligibility', async () => {
    for (const body of [
      {}, { ...base, amount: '1.005' }, { ...base, amount: 'abc' }, { ...base, amount: '1e2' }, { ...base, amount: 'NaN' }, { ...base, amount: 'Infinity' },
      { ...base, amount: '12345678901.00' }, { ...base, amount: '0.000' }, { ...base, amount: 1.5 }, { ...base, amount: true }, { ...base, amount: '' },
      { ...base, amount: ' 1_000.5 ' }, { ...base, reason: 'x'.repeat(501) }, { ...base, reason_code: 'nope' }, { ...base, reason_code: '' },
      { ...base, payment_id: U(999) }, { ...base, payment_id: P.other }, { ...base, payment_id: P.pending }, { ...base, payment_id: P.viewingFee },
      { ...base, reason_code: 'change_of_mind' }, { ...base, reason_code: 'other' }, { ...base, payment_id: P.old }, { ...base, amount: '62.41' },
    ]) same(await g().req('POST', '/api/payments/refund/', { json: body }));
  });
  it('provider path: disbursement not configured / no phone', async () => {
    same(await g().req('POST', '/api/payments/refund/', { json: base }));
    same(await g().req('POST', '/api/payments/refund/', { json: { ...base, payment_id: P.noPhone, amount: '5' } }));
    await sameRows('payments_refund', `payment_id IN ('${P.refundable}', '${P.noPhone}')`, { order: 'id' });
    await sameRows('payments_payment', `id IN ('${P.refundable}', '${P.noPhone}')`);
  });
});

describe('admin payouts + agent commissions', () => {
  it('list + filter', async () => {
    for (const q of ['', '?status=pending', '?status=paid', '?status=cancelled', '?status=']) same(await pairs.finance!.req('GET', `/api/payments/admin/payouts/${q}`));
    for (const q of ['', '?status=pending', '?status=paid', '?status=voided']) same(await pairs.admin!.req('GET', `/api/payments/admin/agent-commissions/${q}`));
  });
  it('disburse errors (no number / invalid number / MoMo not configured / not pending / 404)', async () => {
    const a = pairs.admin!;
    for (const n of [1, 2, 3]) same(await a.req('POST', `/api/payments/admin/payouts/${PO(n)}/disburse/`));
    same(await a.req('POST', `/api/payments/admin/payouts/${PO(99)}/disburse/`));
    same(await a.req('POST', `/api/payments/admin/payouts/${PO(1).toUpperCase()}/disburse/`));
    await sameRows('payments_payout', `id::text LIKE 'aaaaaaaa%'`);
  });
  it('mark paid (reference kept raw in the response) then idempotent', async () => {
    const a = pairs.finance!;
    same(await a.req('POST', `/api/payments/admin/payouts/${PO(1)}/mark-paid/`, { json: { reference: 12345 } }));
    same(await a.req('POST', `/api/payments/admin/payouts/${PO(1)}/mark-paid/`, { json: { reference: 'other' } }));
    same(await a.req('POST', `/api/payments/admin/payouts/${PO(1)}/disburse/`));
    same(await a.req('POST', `/api/payments/admin/payouts/${PO(99)}/mark-paid/`));
    await sameRows('payments_payout', `id::text LIKE 'aaaaaaaa%'`);
    await sameNotifications();
  });
  it('cancel (+ agent commission clawback + audit)', async () => {
    const a = pairs.admin!;
    same(await a.req('POST', `/api/payments/admin/payouts/${PO(4)}/cancel/`, { json: {} }));
    same(await a.req('POST', `/api/payments/admin/payouts/${PO(4)}/cancel/`, { json: { reason: '   ' } }));
    same(await a.req('POST', `/api/payments/admin/payouts/${PO(4)}/cancel/`, { json: { reason: ' Disputed ' } }));
    same(await a.req('POST', `/api/payments/admin/payouts/${PO(4)}/cancel/`, { json: { reason: 'again' } }));
    same(await a.req('POST', `/api/payments/admin/payouts/${PO(1)}/cancel/`, { json: { reason: 'paid one' } }));
    await sameRows('payments_payout', `id::text LIKE 'aaaaaaaa%'`);
    await sameRows('agents_agentcommission', 'booking_id IN (37, 42, 51)');
    await sameAudit();
  });
  it('agent commission disburse', async () => {
    const ids = (await dbs.django.query('SELECT id, booking_id FROM agents_agentcommission WHERE booking_id IN (37, 42, 51) ORDER BY booking_id')).rows;
    for (const c of ids) same(await pairs.admin!.req('POST', `/api/payments/admin/agent-commissions/${c.id}/disburse/`));
    same(await pairs.admin!.req('POST', '/api/payments/admin/agent-commissions/999999/disburse/'));
    same(await pairs.admin!.req('POST', '/api/payments/admin/agent-commissions/99999999999999999999/disburse/'));
    await sameRows('agents_agentcommission', 'booking_id IN (37, 42, 51)');
  });
});

describe('admin employees', () => {
  it('create / list / patch / pay / delete', async () => {
    const a = pairs.finance!;
    for (const body of [{}, { name: 'X' }, { name: '  ', momo_number: '1' }, [], { name: null, momo_number: 5 }]) {
      same(await a.req('POST', '/api/payments/admin/employees/', { json: body }));
    }
    same(await a.req('POST', '/api/payments/admin/employees/', { json: { name: ' Zed ', momo_number: ' 0770123456 ', role_title: 'Cleaner' } }));
    same(await a.req('POST', '/api/payments/admin/employees/', { json: { name: 'Amy', momo_number: '12345' } }));
    same(await a.req('POST', '/api/payments/admin/employees/', { form: (() => { const f = new FormData(); f.set('name', 'Bo'); f.set('momo_number', '0880000000'); return f; })() }));
    same(await a.req('GET', '/api/payments/admin/employees/'));
    const ids = (await dbs.django.query("SELECT id, name FROM payments_employee ORDER BY id")).rows;
    const zed = ids.find((r) => r.name === 'Zed')!.id; const amy = ids.find((r) => r.name === 'Amy')!.id; const bo = ids.find((r) => r.name === 'Bo')!.id;
    same(await a.req('PATCH', `/api/payments/admin/employees/${zed}/`, { json: { role_title: ' Driver ', momo_network: 'MTN', ignored: 1 } }));
    same(await a.req('PATCH', `/api/payments/admin/employees/999999/`, { json: {} }));
    for (const body of [{}, { amount: '0' }, { amount: '-5' }, { amount: 'abc' }, { amount: null }]) {
      same(await a.req('POST', `/api/payments/admin/employees/${zed}/pay/`, { json: body }));
    }
    same(await a.req('POST', `/api/payments/admin/employees/${zed}/pay/`, { json: { amount: '25.5', description: ' Bonus ' } }), { ignore: ['id'] });
    same(await a.req('POST', `/api/payments/admin/employees/${amy}/pay/`, { json: { amount: 10, currency: 'LRD' } }), { ignore: ['id'] });
    same(await a.req('DELETE', `/api/payments/admin/employees/${bo}/`));
    same(await a.req('POST', `/api/payments/admin/employees/${bo}/pay/`, { json: { amount: '1' } }));
    same(await a.req('GET', '/api/payments/admin/employees/'));
    await sameRows('payments_employee', 'true', { order: 'id' });
    await sameRows('payments_employeepayment', 'true', { ignore: ['id'], order: 'created_at' });
    for (const q of ['', `?employee_id=${zed}`, `?employee_id=${amy}`, '?employee_id=999999']) {
      same(await a.req('GET', `/api/payments/admin/employee-payments/${q}`), { ignore: ['id'] });
    }
  });
});

describe('admin refunds + dual authorization', () => {
  const a = () => pairs.admin!;
  it('validation', async () => {
    for (const body of [
      {}, { payment_id: P.refundable }, { payment_id: U(999), reason: 'x' }, { payment_id: P.flutterwave, reason: 'x', amount: 5 },
      { payment_id: P.pending, reason: 'x', amount: 5 }, { payment_id: P.viewingFee, reason: 'x', amount: 1 },
      { payment_id: P.refundable, reason: 'x', reason_code: 'change_of_mind', amount: 1 }, { payment_id: P.refundable, reason: 'x', reason_code: 'bogus', amount: 1 },
      { payment_id: P.refundable, reason: 'x' }, { payment_id: P.refundable, reason: 'x', amount: 'abc' }, { payment_id: P.refundable, reason: 'x', amount: [] },
      { payment_id: P.refundable, reason: 'x', amount: 0 }, { payment_id: P.refundable, reason: 'x', amount: '-1' }, { payment_id: P.refundable, reason: 'x', amount: '-inf' },
      { payment_id: P.refundable, reason: 'x', amount: '100' },
    ]) same(await a().req('POST', '/api/payments/admin/refund/', { json: body }));
    same(await a().req('POST', '/api/payments/admin/refund/', { json: { payment_id: 'garbage', reason: 'x' } })); // UUID ValidationError → 500
  });
  it('immediate refund (≤ threshold) → executor → MoMo not configured', async () => {
    same(await a().req('POST', '/api/payments/admin/refund/', { json: { payment_id: P.refundable, reason: 'damage', amount: '12.345' } }));
    same(await pairs.support!.req('POST', '/api/payments/admin/refund/', { json: { payment_id: P.noPhone, reason: 'nophone', amount: 3 } }));
    await sameRows('payments_refund', `payment_id IN ('${P.refundable}', '${P.noPhone}')`, { order: 'id' });
    await sameAudit();
  });
  it('large refund → pending approval → approved by another admin → executor error recorded', async () => {
    same(await a().req('POST', '/api/payments/admin/refund/', { json: { payment_id: P.bigRefund, reason: 'big', amount: 600.5, reason_code: 'legal_issue' } }));
    await sameRows('rbac_pendingapproval', `id > ${approvalBase}`);
    const id = (await dbs.django.query(`SELECT max(id) AS id FROM rbac_pendingapproval`)).rows[0].id;
    same(await a().req('POST', `/api/rbac/approvals/${id}/approve/`, { json: {} })); // same admin → refused
    same(await pairs.superadmin!.req('POST', `/api/rbac/approvals/${id}/approve/`, { json: {} }));
    await sameRows('rbac_pendingapproval', `id > ${approvalBase}`);
    await sameRows('payments_refund', `payment_id = '${P.bigRefund}'`, { order: 'id' });
    await sameAudit();
  });
  it('stripe refund: validation, pending approval, executor without Stripe key', async () => {
    for (const body of [
      {}, { booking_id: 66 }, { booking_id: 66, reason: 'x', reason_code: 'nope' }, { booking_id: 66, reason: 'x', reason_code: 'change_of_mind' },
      { booking_id: 999999, reason: 'x' }, { booking_id: 37, reason: 'x' }, { booking_id: 69, reason: 'x' }, { booking_id: 66, reason: 'x' },
      { booking_id: 66, reason: 'x', amount: 'abc' }, { booking_id: 66, reason: 'x', amount: '0' }, { booking_id: 66, reason: 'x', amount: '62.41' },
      { booking_id: 66, reason: 'x', amount: 'Infinity' }, { booking_id: '66', reason: 'x', amount: null },
    ]) same(await a().req('POST', '/api/payments/admin/stripe-refund/', { json: body }));
    await both("UPDATE bookings_booking SET stripe_payment_intent_id='pi_test_37' WHERE id=37");
    same(await a().req('POST', '/api/payments/admin/stripe-refund/', { json: { booking_id: 37, reason: 'x', amount: '1e2' } }));
    same(await a().req('POST', '/api/payments/admin/stripe-refund/', { json: { booking_id: 66, reason: ' dup charge ', amount: '20.5' } }));
    await sameRows('rbac_pendingapproval', `id > ${approvalBase}`);
    const id = (await dbs.django.query(`SELECT max(id) AS id FROM rbac_pendingapproval`)).rows[0].id;
    same(await pairs.superadmin!.req('POST', `/api/rbac/approvals/${id}/approve/`, { json: {} }));
    await sameRows('rbac_pendingapproval', `id > ${approvalBase}`);
    await sameRows('payments_striperefund', 'true');
    await sameAudit();
  });
});

describe('platform fee', () => {
  it('get / validation / update / range rule', async () => {
    const a = pairs.finance!;
    same(await a.req('GET', '/api/payments/admin/platform-fee/'));
    for (const body of [
      { viewing_fee: 'abc' }, { viewing_fee: '1234567.00' }, { viewing_fee: null }, { transaction_fee_type: 'weird' }, { transaction_fee_value: '1.23456' },
      { transaction_fee_type: 'range', transaction_fee_min: '5', transaction_fee_max: '2' }, [], { service_fee_percent: '1000' },
    ]) same(await a.req('PATCH', '/api/payments/admin/platform-fee/', { json: body }));
    same(await a.req('PATCH', '/api/payments/admin/platform-fee/', { json: { viewing_fee: '2.5', service_fee_percent: 5, transaction_fee_min: null, extra: 1 } }));
    same(await a.req('PATCH', '/api/payments/admin/platform-fee/', { json: { transaction_fee_type: 'range', transaction_fee_min: '1', transaction_fee_max: '3.10' } }));
    same(await a.req('PATCH', '/api/payments/admin/platform-fee/', { json: { transaction_fee_max: '0.5' } }));
    same(await a.req('PATCH', '/api/payments/admin/platform-fee/', { form: (() => { const f = new FormData(); f.set('viewing_fee', ''); f.set('transaction_fee_value', '0.0125'); return f; })() }));
    await sameRows('payments_platformfee');
    await sameAudit();
  });
});

describe('reporting', () => {
  it('financial summary', async () => {
    for (const q of ['', '?since=2026-01-01', '?until=2026-06-30', '?since=2026-9-1&until=2026-12-31', '?since=2030-01-01']) {
      same(await pairs.finance!.req('GET', `/api/payments/admin/reports/summary/${q}`));
    }
    same(await pairs.finance!.req('GET', '/api/payments/admin/reports/summary/?since=garbage'));
  });
  it('transactions list: filters + pagination', async () => {
    for (const q of ['', '?limit=5', '?limit=5&offset=5', '?limit=0', '?limit=500', '?limit=abc&offset=3', '?offset=-4', '?status=failed',
      '?purpose=viewing_fee', '?gateway=flutterwave', '?since=2026-08-01&until=2026-12-31', '?search=e2e', '?search=%20GUEST%20', '?search=mtn-ref',
      '?search=%25', '?status=completed&purpose=booking&limit=3']) {
      same(await pairs.finance!.req('GET', `/api/payments/admin/transactions/${q}`), { ignore: ['id'] });
    }
    same(await pairs.finance!.req('GET', '/api/payments/admin/transactions/?until=2026-02-30'));
  });
  it('transactions CSV export', async () => {
    for (const q of ['?status=completed', '?purpose=viewing_fee&status=completed', '?search=zzz', '?gateway=flutterwave&status=completed']) {
      const r = await pairs.finance!.req('GET', `/api/payments/admin/transactions/export/${q}`);
      expect(r.express.status).toBe(r.django.status);
      expect(r.express.headers.get('content-type')).toBe(r.django.headers.get('content-type'));
      expect(r.express.headers.get('content-disposition')).toBe(r.django.headers.get('content-disposition'));
      expect(r.express.text).toBe(r.django.text);
    }
    // Rows created during this run carry fresh uuids/timestamps: compare everything else.
    const r = await pairs.finance!.req('GET', '/api/payments/admin/transactions/export/?status=failed');
    const norm = (t: string) => t.split('\r\n').map((l) => l.split(',').slice(2).join(','));
    expect(r.express.status).toBe(r.django.status);
    expect(norm(r.express.text)).toEqual(norm(r.django.text));
  });
});

describe('escrow', () => {
  it('list / hold / release', async () => {
    const f = pairs.finrole!; // not staff, but holds the finance role → has_permission passes
    same(await f.req('GET', '/api/payments/admin/escrow/'));
    same(await f.req('POST', '/api/payments/admin/escrow/134/hold/', { json: {} }));
    same(await f.req('POST', '/api/payments/admin/escrow/999999/hold/', { json: { reason: 'x' } }));
    same(await f.req('POST', '/api/payments/admin/escrow/134/hold/', { json: { reason: ' Fraud flag ' } }));
    same(await f.req('POST', '/api/payments/admin/escrow/134/hold/', { json: { reason: 'again' } }));
    same(await f.req('GET', '/api/payments/admin/escrow/'));
    const id = (await dbs.django.query('SELECT max(id) AS id FROM payments_escrowhold')).rows[0].id;
    same(await pairs.admin!.req('POST', `/api/payments/admin/escrow/${id}/release/`));
    same(await pairs.admin!.req('POST', `/api/payments/admin/escrow/${id}/release/`));
    same(await pairs.admin!.req('POST', '/api/payments/admin/escrow/999999/release/'));
    same(await f.req('GET', '/api/payments/admin/escrow/'));
    await sameRows('payments_escrowhold');
    await sameAudit();
  });
});

describe('taxes + currencies', () => {
  it('tax rates CRUD + report', async () => {
    const a = pairs.finance!;
    for (const body of [{}, { jurisdiction: 'Monrovia' }, { jurisdiction: 'x'.repeat(101), rate_percent: '1' }, { jurisdiction: 'A', rate_percent: '1000' },
      { jurisdiction: 'A', rate_percent: '1.234' }, { jurisdiction: 'A', rate_percent: '5', is_active: 'maybe' }]) {
      same(await a.req('POST', '/api/payments/admin/tax-rates/', { json: body }));
    }
    same(await a.req('POST', '/api/payments/admin/tax-rates/', { json: { jurisdiction: ' monrovia ', rate_percent: '7.5' } }));
    same(await a.req('POST', '/api/payments/admin/tax-rates/', { json: { jurisdiction: 'monrovia', rate_percent: '1' } }));
    same(await a.req('POST', '/api/payments/admin/tax-rates/', { json: { jurisdiction: 'Bushrod Island', rate_percent: 2.25, is_active: 'false' } }));
    same(await a.req('GET', '/api/payments/admin/tax-rates/'));
    same(await a.req('GET', '/api/payments/admin/tax-report/'));
    const ids = (await dbs.django.query('SELECT id, jurisdiction FROM payments_taxrate ORDER BY id')).rows;
    const bi = ids.find((r) => r.jurisdiction === 'Bushrod Island')!.id; const mo = ids.find((r) => r.jurisdiction === 'monrovia')!.id;
    same(await a.req('PATCH', `/api/payments/admin/tax-rates/${bi}/`, { json: { is_active: true, jurisdiction: 'monrovia' } }));
    same(await a.req('PATCH', `/api/payments/admin/tax-rates/${bi}/`, { json: { is_active: true, rate_percent: '3.333' } }));
    same(await a.req('PATCH', `/api/payments/admin/tax-rates/${bi}/`, { json: { is_active: true, jurisdiction: 'Bushrod Island' } }));
    same(await a.req('PATCH', '/api/payments/admin/tax-rates/999999/', { json: {} }));
    for (const q of ['', '?since=2026-06-01', '?until=2026-06-15', '?since=2027-01-01']) same(await a.req('GET', `/api/payments/admin/tax-report/${q}`));
    same(await a.req('DELETE', `/api/payments/admin/tax-rates/${mo}/`));
    same(await a.req('DELETE', `/api/payments/admin/tax-rates/${mo}/`));
    await sameRows('payments_taxrate');
    await sameAudit();
  });
  it('currencies admin', async () => {
    const a = pairs.admin!;
    same(await a.req('GET', '/api/payments/admin/currencies/'));
    for (const body of [{ exchange_rate_to_usd: '0' }, { exchange_rate_to_usd: '-1' }, { exchange_rate_to_usd: '0.00001' }, { exchange_rate_to_usd: '1234567.0000' },
      { name: '' }, { symbol: 'TOOLONG' }, { code: 'XXX', name: 'Liberian $' }]) {
      same(await a.req('PATCH', '/api/payments/admin/currencies/1/', { json: body }));
    }
    same(await a.req('PATCH', '/api/payments/admin/currencies/1/', { json: { exchange_rate_to_usd: '185.5', is_active: true } }));
    same(await a.req('PATCH', '/api/payments/admin/currencies/999/', { json: {} }));
    same(await anon().req('GET', '/api/payments/currencies/'));
    await sameRows('payments_currency');
    await sameAudit();
  });
});

describe('webhooks', () => {
  it('MTN MoMo callback', async () => {
    same(await anon().req('GET', '/api/payments/webhooks/mtn_momo/'));
    same(await rawReq(null, 'POST', '/api/payments/webhooks/mtn_momo/', 'text/plain', 'not json'));
    same(await rawReq(null, 'POST', '/api/payments/webhooks/mtn_momo/', null, ''));
    same(await anon().req('POST', '/api/payments/webhooks/mtn_momo/', { json: {} }));
    same(await anon().req('POST', '/api/payments/webhooks/mtn_momo/', { json: { status: 'SUCCESSFUL', externalId: 'abc' } }));
    same(await anon().req('POST', '/api/payments/webhooks/mtn_momo/', { json: { status: 'FAILED', externalId: { a: 1 } } }));
    same(await anon().req('POST', '/api/payments/webhooks/mtn_momo/', { json: { status: 'SUCCESSFUL', externalId: P.pending } }));
    same(await rawReq(null, 'POST', '/api/payments/webhooks/mtn_momo/', 'text/plain', JSON.stringify({ status: 'Pending', externalId: P.flutterPending })));
    same(await anon().req('POST', '/api/payments/webhooks/mtn_momo/', { json: [1, 2] }));
    same(await anon().req('POST', '/api/payments/webhooks/mtn_momo/', { json: { status: 5 } }));
    same(await anon().req('POST', '/api/payments/webhooks/mtn_momo/', { json: { status: 'x'.repeat(60) } }));
    await sameRows('payments_webhooklog');
    await sameRows('payments_payment', `id IN ('${P.pending}', '${P.flutterPending}')`);
  });
  it('Stripe webhook (secret not configured in parity)', async () => {
    same(await anon().req('GET', '/api/payments/webhooks/stripe/'));
    same(await rawReq(null, 'POST', '/api/payments/webhooks/stripe/', 'application/json', '{}', { 'Stripe-Signature': 't=1,v1=abc' }));
    same(await rawReq(null, 'POST', '/api/payments/webhooks/stripe/', 'application/json', '{}'));
  });
});

describe('Stripe PaymentIntents (no key → 503)', () => {
  it('all three', async () => {
    for (const path of ['payment-intent', 'booking-payment-intent', 'viewing-fee-intent']) {
      same(await pairs.guest!.req('POST', `/api/payments/stripe/${path}/`, { json: { booking_id: 69, viewing_id: 26, currency: 5 } }));
    }
  });
});

describe('saved cards', () => {
  it('create / list / update / delete with default promotion', async () => {
    const g = pairs.user!;
    const card = { cardholder_name: ' Ann ', last4: '4242', card_type: 'visa', expiry_month: '3', expiry_year: '2030' };
    same(await g.req('GET', '/api/payments/cards/'));
    for (const body of [{}, [], { ...card, last4: '42a2' }, { ...card, last4: '42424' }, { ...card, expiry_month: '13' }, { ...card, expiry_month: '0' },
      { ...card, expiry_year: '30' }, { ...card, card_type: 'diners' }, { ...card, is_default: 'perhaps' }, { ...card, cardholder_name: '' }]) {
      same(await g.req('POST', '/api/payments/cards/', { json: body }));
    }
    same(await g.req('POST', '/api/payments/cards/', { json: card })); // first → default
    same(await g.req('POST', '/api/payments/cards/', { json: { ...card, last4: '1111', card_type: undefined } }));
    same(await g.req('POST', '/api/payments/cards/', { json: { ...card, last4: '2222', is_default: 'yes' } }));
    same(await g.req('GET', '/api/payments/cards/'));
    const ids = (await dbs.django.query('SELECT id, last4 FROM payments_savedcard WHERE user_id = $1 ORDER BY id', [acct.user!.id])).rows;
    const [c1, c2, c3] = ids.map((r) => r.id);
    same(await g.req('PATCH', `/api/payments/cards/${c1}/`, { json: { is_default: true, expiry_month: '7' } }));
    same(await g.req('PUT', `/api/payments/cards/${c2}/`, { json: { cardholder_name: 'Bob' } }));
    same(await g.req('PUT', `/api/payments/cards/${c2}/`, { json: { ...card, cardholder_name: 'Bob', last4: '9999' } }));
    same(await pairs.guest!.req('PATCH', `/api/payments/cards/${c2}/`, { json: {} })); // someone else's card
    same(await g.req('DELETE', `/api/payments/cards/${c1}/`));
    same(await g.req('GET', '/api/payments/cards/'));
    same(await g.req('DELETE', `/api/payments/cards/${c3}/`));
    same(await g.req('DELETE', '/api/payments/cards/999999/'));
    await sameRows('payments_savedcard');
  });
});

describe('final state', () => {
  it('all payments-related tables match', async () => {
    await sameRows('payments_payment', 'true', { ignore: ['id'], order: 'created_at, status, amount' });
    await sameNotifications();
    await sameAudit();
  });
});
