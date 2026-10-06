// Parity tests for leaseagreements: /api/lease-agreements/ — lease lookup
// (tenant / owner / stranger), acceptance (+ PDF re-stamp), and lease
// generation when a long-term reservation is made. PDFs are compared by
// "a file was produced and the DB row matches" (document name), not bytes.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accounts, dbs, flushRedis, Pair, same, sameRows } from '../lib.js';

type Acct = { id: number; email: string };
let acct: Record<string, Acct>;
let HOST: Acct, GUEST: Acct, OTHER: Acct;
const L_MONTHLY = 9201, L_NIGHTLY = 9202;
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const both = async (q: string, params: unknown[] = []) => {
  const [d, e] = await Promise.all([dbs.django.query(q, params), dbs.express.query(q, params)]);
  return { django: d.rows, express: e.rows };
};
async function login(a: Acct) { await flushRedis(); const p = new Pair(); await p.login(a.email); return p; }

let leased = 0; // booking created through the API (lease generated at reservation time)
let N0 = 0;

beforeAll(async () => {
  acct = await accounts();
  HOST = acct.agent!; GUEST = acct.customer!; OTHER = acct.user!;
  const copy = (id: number, set: string) => `CREATE TEMP TABLE t AS SELECT * FROM listings_listing WHERE id = 5;
    UPDATE t SET sourced_by_agent_id = NULL; UPDATE t SET id = ${id}, owner_id = ${HOST.id}, deleted_at = NULL, is_available = true, ${set};
    INSERT INTO listings_listing SELECT * FROM t; DROP TABLE t;`;
  await both(copy(L_MONTHLY, `title = 'Lease <Flat> & Co', price = 1234567.5, pricing_type = 'monthly', payment_schedule = 'annual', address = '12 Broad St', city = 'Monrovia', state = 'Montserrado', country = ''`));
  await both(copy(L_NIGHTLY, `title = 'Nightly', pricing_type = 'nightly'`));
  await both(`UPDATE users_user SET first_name = 'Zoë', last_name = 'Tenant' WHERE id = ${GUEST.id}`);
  N0 = Number((await dbs.django.query('SELECT coalesce(max(id), 0) AS m FROM notifications_notification')).rows[0].m);
  const g = await login(GUEST);
  const r = await g.req('POST', '/api/bookings/', { json: { listing: L_MONTHLY, start_date: day(20), end_date: day(385) } });
  expect(r.django.status).toBe(201);
  expect(r.express.status).toBe(201);
  leased = (r.django.body as { id: number }).id;
  const ins = (id: number, listing: number) => both(`INSERT INTO bookings_booking (id, listing_id, customer_id, start_date, end_date, status, notes, requested_at, owner_notes,
    decline_reason, total_price, service_fee, requires_viewing, extension_reason) VALUES (${id}, ${listing}, ${GUEST.id}, '${day(30)}', '${day(60)}', 'awaiting_payment', '',
    '2026-03-07 08:09:10.5+00', '', '', '100.00', '4.00', false, '')`);
  await ins(92001, L_MONTHLY); // long-term, no lease yet
  await ins(92002, L_NIGHTLY); // short stay
});
beforeEach(flushRedis);

describe('lease-agreements', () => {
  it('anonymous → 401; bad methods → 405', async () => {
    const p = new Pair();
    same(await p.req('GET', `/api/lease-agreements/for-booking/${leased}/`), { headers: ['www-authenticate'] });
    same(await p.req('POST', `/api/lease-agreements/${leased}/accept/`), { headers: ['www-authenticate'] });
    const g = await login(GUEST);
    same(await g.req('POST', `/api/lease-agreements/for-booking/${leased}/`));
    same(await g.req('GET', `/api/lease-agreements/${leased}/accept/`));
  });
  it('generated at reservation time', async () => {
    await sameRows('leaseagreements_leaseagreement', `booking_id = ${leased}`);
    const { rows } = await dbs.express.query('SELECT document FROM leaseagreements_leaseagreement WHERE booking_id = $1', [leased]);
    expect(rows[0].document).toBe(`lease_agreements/lease_booking_${leased}_v1.0.pdf`);
    await sameRows('notifications_notification', `id > ${N0}`);
  });
  it('for-booking access matrix', async () => {
    const [g, h, o, s] = await Promise.all([login(GUEST), login(HOST), login(OTHER), login(acct.superadmin!)]);
    for (const p of [g, h, o, s]) {
      same(await p.req('GET', `/api/lease-agreements/for-booking/${leased}/`));
      same(await p.req('GET', '/api/lease-agreements/for-booking/99999999/'));
    }
    const r = await g.req('GET', '/api/lease-agreements/for-booking/92001/');
    expect(r.django.status).toBe(204);
    expect(r.express.status).toBe(204);
    expect(r.express.text).toBe(r.django.text);
    // existing (pre-snapshot) leases with their acceptances
    const { rows } = await dbs.django.query(`SELECT la.booking_id, b.customer_id FROM leaseagreements_leaseagreement la JOIN bookings_booking b ON b.id = la.booking_id
      WHERE la.booking_id < 9000 ORDER BY la.id`);
    for (const row of rows) same(await s.req('GET', `/api/lease-agreements/for-booking/${row.booking_id}/`));
  });
  it('accept: wrong user, short stay, success, repeat', async () => {
    const [g, h, o] = await Promise.all([login(GUEST), login(HOST), login(OTHER)]);
    same(await h.req('POST', `/api/lease-agreements/${leased}/accept/`));
    same(await o.req('POST', `/api/lease-agreements/${leased}/accept/`));
    same(await g.req('POST', '/api/lease-agreements/92002/accept/'));
    same(await g.req('POST', '/api/lease-agreements/99999999/accept/'));
    same(await g.req('POST', `/api/lease-agreements/${leased}/accept/`, { json: {} }), { ignore: ['document_url'] });
    await sameRows('leaseagreements_leaseacceptance', `booking_id = ${leased}`);
    // the re-stamped PDF collides with the first file → Django adds a random suffix before ".0.pdf"
    await sameRows('leaseagreements_leaseagreement', `booking_id = ${leased}`, { ignore: ['document'] });
    for (const side of ['django', 'express'] as const) {
      const { rows } = await dbs[side].query('SELECT document FROM leaseagreements_leaseagreement WHERE booking_id = $1', [leased]);
      expect(rows[0].document, side).toMatch(new RegExp(`^lease_agreements/lease_booking_${leased}_v1_[A-Za-z0-9]{7}\\.0\\.pdf$`));
    }
    same(await g.req('POST', `/api/lease-agreements/${leased}/accept/`), { ignore: ['document_url'] });
    await sameRows('leaseagreements_leaseacceptance', `booking_id = ${leased}`);
    // long-term booking without a lease: accept creates + renders it
    same(await g.req('POST', '/api/lease-agreements/92001/accept/'));
    await sameRows('leaseagreements_leaseagreement', 'booking_id = 92001');
    await sameRows('leaseagreements_leaseacceptance', 'booking_id = 92001');
    same(await h.req('GET', '/api/lease-agreements/for-booking/92001/'));
  });
});
