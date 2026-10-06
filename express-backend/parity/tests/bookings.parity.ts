// Parity tests for the bookings app: /api/bookings/ — the reservation state
// machine (request → host confirm/decline → ready to pay → paid → confirmed /
// expired / cancelled), viewings, saved searches, comparisons, payment
// requests, payouts and the admin endpoints, with every side-effect table
// (bookings, listings, notifications, payouts, commissions, audit log).
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accounts, dbs, diff, flushRedis, Pair, same, sameRows } from '../lib.js';

type Acct = { id: number; email: string };
let acct: Record<string, Acct>;
let HOST: Acct; // role 'agent' — owns the fixture listings
let GUEST: Acct; // role 'customer'
let OTHER: Acct; // role 'user'
let N0 = 0; // notifications id watermark
let A0 = 0; // audit-log id watermark

const both = async (q: string, params: unknown[] = []) => {
  const [d, e] = await Promise.all([dbs.django.query(q, params), dbs.express.query(q, params)]);
  return { django: d.rows, express: e.rows };
};
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
/** next date ≥ today+n that is the given Python weekday (Mon=0). */
function nextWeekday(n: number, wd: number) {
  for (let i = n; i < n + 8; i++) {
    const d = new Date(Date.now() + i * 86_400_000);
    if ((d.getUTCDay() + 6) % 7 === wd) return d.toISOString().slice(0, 10);
  }
  throw new Error('unreachable');
}

const L_NIGHTLY = 9001, L_MONTHLY = 9002, L_HOTEL = 9003, L_AGENT = 9004, L_OTHER_HOTEL = 9005;
const ROOM_A = 9101, ROOM_INACTIVE = 9102, ROOM_OTHER = 9103;

async function login(a: Acct) { await flushRedis(); const p = new Pair(); await p.login(a.email); return p; }
const notifs = () => sameRows('notifications_notification', `id > ${N0}`, { ignore: ['payout_id'] });
const audit = () => sameRows('superadmin_adminauditlog', `id > ${A0}`);
const bookingsRows = (where = 'id >= 90000 OR listing_id >= 9000') => sameRows('bookings_booking', where);
const listingRows = () => sameRows('listings_listing', 'id >= 9000');

/** Insert a fixture booking identically on both copies. */
async function booking(id: number, f: Record<string, unknown>) {
  const v = {
    listing_id: L_NIGHTLY, customer_id: GUEST.id, start_date: day(40), end_date: day(43), status: 'pending_host', notes: '',
    requested_at: new Date(Date.now() - 3600_000).toISOString(), owner_notes: '', decline_reason: '', total_price: '330.00', service_fee: '13.20',
    requires_viewing: false, host_confirm_deadline: null, host_confirmed_at: null, payment_due_at: null, extension_reason: '', hotel_room_id: null,
    ...f,
  };
  const cols = Object.keys(v);
  await both(`INSERT INTO bookings_booking (id, ${cols.join(', ')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})`, [id, ...Object.values(v)]);
}

beforeAll(async () => {
  acct = await accounts();
  HOST = acct.agent!; GUEST = acct.customer!; OTHER = acct.user!;
  // Fixture listings owned by HOST (copied from listing 5, then adjusted)
  const copy = (id: number, set: string, owner = HOST.id) => `CREATE TEMP TABLE t AS SELECT * FROM listings_listing WHERE id = 5;
    UPDATE t SET sourced_by_agent_id = NULL; UPDATE t SET id = ${id}, owner_id = ${owner}, deleted_at = NULL, is_available = true, status = 'published', ${set};
    INSERT INTO listings_listing SELECT * FROM t; DROP TABLE t;`;
  await both(copy(L_NIGHTLY, `title = 'Fixture Nightly', price = 100.00, weekend_premium_percent = 10, weekly_discount_enabled = true, weekly_discount_percent = 10,
    monthly_discount_enabled = false, last_minute_discount_enabled = true, last_minute_discount_percent = 5, pricing_type = 'nightly', bedrooms = 3, square_footage = 1200`));
  await both(copy(L_MONTHLY, `title = 'Fixture Monthly', price = 1250.50, pricing_type = 'monthly', payment_schedule = 'quarterly', city = 'Monrovia', state = '', country = 'Liberia', bedrooms = 1, square_footage = 400`));
  await both(copy(L_HOTEL, `title = 'Fixture Hotel', price = 80.00, pricing_type = 'nightly', weekend_premium_percent = 0, weekly_discount_enabled = false, last_minute_discount_enabled = false`));
  await both(copy(L_AGENT, `title = 'Fixture Agent-Sourced', price = 75.25, pricing_type = 'nightly', sourced_by_agent_id = 415,
    agent_owner_name = 'Real Owner', agent_owner_payout_number = '0880000000', agent_owner_payout_network = 'mtn', weekend_premium_percent = 0, weekly_discount_enabled = false, last_minute_discount_enabled = false`, 402));
  await both(copy(L_OTHER_HOTEL, `title = 'Other Hotel', price = 50.00`, 107));
  const room = (id: number, listing: number, active: boolean, count: number) =>
    `INSERT INTO listings_hotelroom (id, listing_id, name, room_type, description, price_per_night, max_occupancy, beds, bed_type, bathrooms, amenities, total_count, is_active, created_at)
     VALUES (${id}, ${listing}, 'Room ${id}', 'deluxe', '', 64.99, 2, 1, 'queen', 1, '["tv"]', ${count}, ${active}, now())`;
  await both(room(ROOM_A, L_HOTEL, true, 1));
  await both(room(ROOM_INACTIVE, L_HOTEL, false, 3));
  await both(room(ROOM_OTHER, L_OTHER_HOTEL, true, 2));
  // Favorites so listing_available notifications fire on relist
  await both(`INSERT INTO listings_favorite (user_id, listing_id, created_at) VALUES (${OTHER.id}, ${L_NIGHTLY}, now()), (${OTHER.id}, ${L_MONTHLY}, now())`);
  // An agent account with a known password (approved agent 415 owns commissions on L_AGENT)
  await both(`UPDATE users_user SET password = (SELECT password FROM users_user WHERE id = ${OTHER.id}) WHERE id IN (415, 107)`);
  N0 = Number((await dbs.django.query('SELECT coalesce(max(id), 0) AS m FROM notifications_notification')).rows[0].m);
  A0 = Number((await dbs.django.query('SELECT coalesce(max(id), 0) AS m FROM superadmin_adminauditlog')).rows[0].m);
});
beforeEach(flushRedis);

const ROUTES: [string, string][] = [
  ['GET', '/api/bookings/'], ['POST', '/api/bookings/'], ['GET', '/api/bookings/1/'], ['DELETE', '/api/bookings/1/'],
  ['GET', '/api/bookings/pending/'], ['POST', '/api/bookings/1/confirm/'], ['POST', '/api/bookings/1/decline/'],
  ['POST', '/api/bookings/1/confirm-payment/'], ['GET', '/api/bookings/admin/payment-received/'], ['GET', '/api/bookings/admin/list/'],
  ['GET', '/api/bookings/admin/1/communications/'], ['POST', '/api/bookings/admin/1/extend-reservation/'],
  ['POST', '/api/bookings/1/request-payment/'], ['GET', '/api/bookings/payment-requests/'], ['GET', '/api/bookings/viewings/'],
  ['POST', '/api/bookings/viewings/'], ['GET', '/api/bookings/viewings/slots/5/'], ['GET', '/api/bookings/viewings/admin/'],
  ['POST', '/api/bookings/viewings/admin/1/status/'], ['POST', '/api/bookings/viewings/1/reserve/'], ['GET', '/api/bookings/payouts/'],
  ['GET', '/api/bookings/searches/'], ['POST', '/api/bookings/searches/'], ['GET', '/api/bookings/searches/1/'], ['PUT', '/api/bookings/searches/1/'],
  ['DELETE', '/api/bookings/searches/1/'], ['GET', '/api/bookings/searches/alerts/'], ['POST', '/api/bookings/searches/test/'],
  ['GET', '/api/bookings/comparisons/'], ['POST', '/api/bookings/comparisons/'], ['GET', '/api/bookings/comparisons/1/'],
  ['PUT', '/api/bookings/comparisons/1/'], ['DELETE', '/api/bookings/comparisons/1/'], ['POST', '/api/bookings/comparisons/add/'],
  ['POST', '/api/bookings/comparisons/remove/'],
];

describe('access control', () => {
  it('anonymous → 401 on every authenticated route', async () => {
    const p = new Pair();
    for (const [m, path] of ROUTES) same(await p.req(m, path, { json: {} }), { headers: ['www-authenticate'] });
  });
  it('shared comparison is public; bad token → 401', async () => {
    same(await new Pair().req('GET', '/api/bookings/comparisons/shared/nope/'));
    same(await new Pair().req('GET', '/api/bookings/comparisons/shared/nope/', { token: 'a.b.c' }));
  });
  it('wrong methods → 405 and format negotiation', async () => {
    const p = await login(GUEST);
    for (const [m, path] of [['PUT', '/api/bookings/'], ['POST', '/api/bookings/1/'], ['GET', '/api/bookings/1/confirm/'], ['POST', '/api/bookings/pending/'],
      ['GET', '/api/bookings/searches/test/'], ['PATCH', '/api/bookings/searches/1/'], ['GET', '/api/bookings/comparisons/add/'], ['DELETE', '/api/bookings/payouts/'],
      ['PUT', '/api/bookings/viewings/'], ['GET', '/api/bookings/viewings/1/reserve/']] as const) same(await p.req(m, path));
    same(await p.req('GET', '/api/bookings/?format=json'));
    same(await p.req('GET', '/api/bookings/?format=xml'));
    same(await p.req('GET', '/api/bookings/', { headers: { Accept: 'text/html' } }));
    const r = await p.req('GET', '/api/bookings/pending');
    expect(r.express.status).toBe(r.django.status);
  });
  it('role-gated admin endpoints', async () => {
    for (const who of ['user', 'agent', 'customer', 'admin', 'superadmin']) {
      const p = await login(acct[who]!);
      same(await p.req('GET', '/api/bookings/pending/'));
      same(await p.req('GET', '/api/bookings/admin/payment-received/'));
      same(await p.req('GET', '/api/bookings/admin/list/?limit=3'));
      same(await p.req('GET', '/api/bookings/viewings/admin/'));
      same(await p.req('POST', '/api/bookings/999999/confirm-payment/'));
      same(await p.req('GET', '/api/bookings/admin/999999/communications/'));
      same(await p.req('POST', '/api/bookings/admin/999999/extend-reservation/', { json: { reason: 'x', new_deadline: '2030-01-01' } }));
      same(await p.req('POST', '/api/bookings/viewings/admin/999999/status/', { json: {} }));
    }
  });
});

describe('reservation create validation', () => {
  let p: Pair;
  beforeAll(async () => { p = await login(GUEST); });
  it('field and object errors', async () => {
    const s = day(30), e = day(33);
    const bodies: unknown[] = [
      {}, [], { listing: L_NIGHTLY }, { listing: 'abc', start_date: s, end_date: e }, { listing: true, start_date: s, end_date: e },
      { listing: 99999999, start_date: s, end_date: e }, { listing: '99999999999999999999999', start_date: s, end_date: e },
      { listing: null, start_date: s, end_date: e }, { listing: L_NIGHTLY, start_date: 'tomorrow', end_date: e },
      { listing: L_NIGHTLY, start_date: '2030-02-30', end_date: e }, { listing: L_NIGHTLY, start_date: 20300101, end_date: e },
      { listing: L_NIGHTLY, start_date: e, end_date: s }, { listing: L_NIGHTLY, start_date: s, end_date: s },
      { listing: L_NIGHTLY, start_date: day(-3), end_date: day(2) },
      { listing: L_NIGHTLY, start_date: s, end_date: e, payment_method: 'cash' }, { listing: L_NIGHTLY, start_date: s, end_date: e, payment_method: ['stripe'] },
      { listing: L_NIGHTLY, start_date: s, end_date: e, notes: { a: 1 } }, { listing: L_NIGHTLY, start_date: s, end_date: e, notes: null },
      { listing: L_NIGHTLY, start_date: s, end_date: e, hotel_room: 'x' }, { listing: L_NIGHTLY, start_date: s, end_date: e, hotel_room: 987654 },
      { listing: L_NIGHTLY, start_date: s, end_date: e, stripe_payment_intent_id: 'x'.repeat(101) },
      { listing: L_HOTEL, start_date: s, end_date: e }, // room types → hotel_room required
      { listing: L_HOTEL, start_date: s, end_date: e, hotel_room: ROOM_OTHER },
      { listing: L_NIGHTLY, start_date: s.replace(/-/g, ''), end_date: e, stripe_payment_intent_id: '' , hotel_room: null, notes: '  x  ' },
    ];
    for (const json of bodies) same(await p.req('POST', '/api/bookings/', { json }));
    await bookingsRows();
    await notifs();
  });
  it('own listing / unsupported media type', async () => {
    const h = await login(HOST);
    same(await h.req('POST', '/api/bookings/', { json: { listing: L_NIGHTLY, start_date: day(30), end_date: day(33) } }));
    const fd = new FormData();
    fd.append('listing', String(L_NIGHTLY)); fd.append('start_date', 'bad'); fd.append('end_date', day(33)); fd.append('notes', '');
    same(await p.req('POST', '/api/bookings/', { form: fd }));
  });
  it('stripe intent uniqueness', async () => {
    await both(`UPDATE bookings_booking SET stripe_payment_intent_id = 'pi_fixture_dup' WHERE id = (SELECT min(id) FROM bookings_booking)`);
    same(await p.req('POST', '/api/bookings/', { json: { listing: L_NIGHTLY, start_date: day(30), end_date: day(33), stripe_payment_intent_id: 'pi_fixture_dup' } }));
  });
});

describe('state machine: request → host confirm → pay → admin confirm', () => {
  let guest: Pair, other: Pair, host: Pair, superadmin: Pair;
  let b1 = 0, b2 = 0, b3 = 0;
  beforeAll(async () => {
    [guest, other, host, superadmin] = await Promise.all([login(GUEST), login(OTHER), login(HOST), login(acct.superadmin!)]);
  });
  it('guest reserves (weekend premium + weekly discount pricing)', async () => {
    const start = nextWeekday(20, 3); // a Thursday — crosses Fri/Sat/Sun
    const r = await guest.req('POST', '/api/bookings/', { json: { listing: L_NIGHTLY, start_date: start, end_date: day(Math.round((Date.parse(start) - Date.now()) / 86_400_000) + 9), notes: 'hello', payment_method: 'stripe', stripe_payment_intent_id: 'pi_ignored' } });
    same(r);
    expect(r.django.status).toBe(201);
    b1 = (r.django.body as { id: number }).id;
    expect((r.express.body as { id: number }).id).toBe(b1);
    await bookingsRows();
    await listingRows();
    await notifs();
  });
  it('duplicate active reservation and competing reservations', async () => {
    const b = (await dbs.django.query('SELECT start_date::text s, end_date::text e FROM bookings_booking WHERE id = $1', [b1])).rows[0];
    same(await guest.req('POST', '/api/bookings/', { json: { listing: L_NIGHTLY, start_date: b.s, end_date: b.e } }));
    // two competitors overlapping b1 (other guest, short stay → last-minute discount not applicable)
    const r2 = await other.req('POST', '/api/bookings/', { json: { listing: L_NIGHTLY, start_date: b.s, end_date: day(Math.round((Date.parse(b.s) - Date.now()) / 86_400_000) + 2) } });
    same(r2);
    b2 = (r2.django.body as { id: number }).id;
    // last-minute discount (start within 3 days)
    const r3 = await other.req('POST', '/api/bookings/', { json: { listing: L_NIGHTLY, start_date: day(1), end_date: day(3) } });
    same(r3);
    b3 = (r3.django.body as { id: number }).id;
    await bookingsRows();
    await notifs();
  });
  it('lists: guest, host (?role=host, status filter), pending, detail perms', async () => {
    same(await guest.req('GET', '/api/bookings/'));
    same(await host.req('GET', '/api/bookings/?role=host'));
    same(await host.req('GET', '/api/bookings/?role=host&status=pending_host'));
    same(await host.req('GET', '/api/bookings/?role=guest'));
    same(await host.req('GET', '/api/bookings/pending/'));
    for (const p of [guest, other, host, superadmin, await login(acct.admin!)]) {
      same(await p.req('GET', `/api/bookings/${b1}/`));
      same(await p.req('GET', '/api/bookings/99999999/'));
    }
  });
  it('confirm: permission / not found / success declines competitors and pulls the listing', async () => {
    same(await guest.req('POST', `/api/bookings/${b1}/confirm/`));
    same(await host.req('POST', '/api/bookings/99999999/confirm/'));
    same(await host.req('POST', `/api/bookings/${b1}/confirm/`));
    same(await host.req('POST', `/api/bookings/${b1}/confirm/`)); // now awaiting_payment → 400
    await bookingsRows();
    await listingRows();
    await notifs();
    same(await host.req('POST', `/api/bookings/${b2}/decline/`)); // declined competitor → cannot be declined
    same(await host.req('POST', `/api/bookings/${b2}/confirm/`));
  });
  it('host backs out of awaiting_payment (relist + double listing_available notifications)', async () => {
    same(await host.req('POST', `/api/bookings/${b1}/decline/`, { json: { status: 'nope' } }));
    same(await host.req('POST', `/api/bookings/${b1}/decline/`, { json: [] }));
    same(await guest.req('POST', `/api/bookings/${b1}/decline/`, { json: {} }));
    same(await host.req('POST', `/api/bookings/${b1}/decline/`, { json: { decline_reason: ' Changed plans ', owner_notes: 'sorry', status: 'confirmed' } }));
    await bookingsRows();
    await listingRows();
    await notifs();
  });
  it('re-confirm a pending reservation, guest pays (fixture), paid cannot be declined', async () => {
    same(await host.req('POST', `/api/bookings/${b3}/confirm/`));
    await both(`UPDATE bookings_booking SET status = 'payment_received' WHERE id = $1`, [b3]);
    same(await host.req('POST', `/api/bookings/${b3}/decline/`, { json: {} }));
    same(await host.req('POST', `/api/bookings/${b3}/confirm/`));
    same(await superadmin.req('GET', '/api/bookings/admin/payment-received/'));
  });
  it('admin confirms payment: escrow hold, payout, notifications', async () => {
    same(await (await login(acct.admin!)).req('POST', `/api/bookings/${b3}/confirm-payment/`));
    same(await superadmin.req('POST', `/api/bookings/${b1}/confirm-payment/`)); // wrong status
    await both(`INSERT INTO payments_escrowhold (id, booking_id, reason, held_by_id, held_at, released_at, released_by_id) VALUES (9901, $1, 'fraud check', NULL, now(), NULL, NULL)`, [b3]);
    same(await superadmin.req('POST', `/api/bookings/${b3}/confirm-payment/`));
    await both(`UPDATE payments_escrowhold SET released_at = now() WHERE id = 9901`);
    same(await superadmin.req('POST', `/api/bookings/${b3}/confirm-payment/`));
    await bookingsRows();
    await sameRows('payments_payout', `booking_id = ${b3}`, { ignore: ['id'], order: 'booking_id' });
    await sameRows('notifications_notification', `id > ${N0}`, { ignore: ['payout_id'] });
    same(await host.req('GET', '/api/bookings/payouts/'), { ignore: ['id'] });
    same(await guest.req('DELETE', `/api/bookings/${b3}/`)); // cancelling a confirmed booking relists
    await bookingsRows();
    await listingRows();
    await sameRows('notifications_notification', `id > ${N0}`, { ignore: ['payout_id'] });
  });
  it('agent-sourced booking: payout recipient + agent commission', async () => {
    await booking(90010, { listing_id: L_AGENT, status: 'payment_received', total_price: '470.12', service_fee: '18.08' });
    await booking(90011, { listing_id: L_AGENT, status: 'payment_received', total_price: null, service_fee: null, start_date: day(50), end_date: day(53) });
    for (const id of [90010, 90011]) same(await superadmin.req('POST', `/api/bookings/${id}/confirm-payment/`));
    await bookingsRows();
    await sameRows('payments_payout', 'booking_id IN (90010, 90011)', { ignore: ['id'], order: 'booking_id' });
    await sameRows('agents_agentcommission', 'booking_id IN (90010, 90011)');
    await sameRows('notifications_notification', `id > ${N0}`, { ignore: ['payout_id'] });
    const agent = new Pair();
    await agent.login('rhykimgolee256@gmail.com');
    same(await agent.req('GET', '/api/bookings/payouts/'));
  });
});

describe('cancel (DELETE)', () => {
  it('pending, awaiting_payment (relist), idempotent, declined/completed/expired', async () => {
    await booking(90020, { status: 'pending_host', start_date: day(60), end_date: day(62) });
    await booking(90021, { status: 'awaiting_payment', listing_id: L_MONTHLY, start_date: day(60), end_date: day(150), host_confirmed_at: new Date().toISOString(), payment_due_at: day(9) });
    await both(`UPDATE listings_listing SET is_available = false WHERE id = ${L_MONTHLY}`);
    await booking(90022, { status: 'declined', start_date: day(70), end_date: day(72) });
    await booking(90023, { status: 'completed', start_date: day(80), end_date: day(82) });
    await booking(90024, { status: 'expired_unpaid', start_date: day(90), end_date: day(92) });
    const g = await login(GUEST);
    const h = await login(HOST);
    same(await (await login(OTHER)).req('DELETE', '/api/bookings/90020/'));
    for (const id of [90020, 90020, 90022, 90023, 90024]) same(await g.req('DELETE', `/api/bookings/${id}/`));
    same(await h.req('DELETE', '/api/bookings/90021/'));
    same(await g.req('DELETE', '/api/bookings/99999999/'));
    await bookingsRows();
    await listingRows();
    await notifs();
  });
});

describe('room bookings', () => {
  it('room capacity and inactive-room handling', async () => {
    const g = await login(GUEST);
    const o = await login(OTHER);
    const body = { listing: L_HOTEL, hotel_room: ROOM_A, start_date: day(30), end_date: day(32) };
    const r = await g.req('POST', '/api/bookings/', { json: body });
    same(r);
    same(await o.req('POST', '/api/bookings/', { json: body })); // only 1 unit → not available
    same(await o.req('POST', '/api/bookings/', { json: { ...body, hotel_room: ROOM_INACTIVE } }));
    // host confirms a room booking: listing stays public, nothing auto-declined
    same(await (await login(HOST)).req('POST', `/api/bookings/${(r.django.body as { id: number }).id}/confirm/`));
    await bookingsRows();
    await listingRows();
    await notifs();
  });
  it('confirmed overlap → 409', async () => {
    await booking(90030, { status: 'confirmed', start_date: day(100), end_date: day(105), customer_id: OTHER.id });
    same(await (await login(GUEST)).req('POST', '/api/bookings/', { json: { listing: L_NIGHTLY, start_date: day(103), end_date: day(107) } }));
  });
});

describe('monthly listing reservation generates a lease', () => {
  it('reserve + lease row', async () => {
    const g = await login(GUEST);
    same(await g.req('POST', '/api/bookings/', { json: { listing: L_MONTHLY, start_date: day(35), end_date: day(400) } }));
    await bookingsRows();
    await sameRows('leaseagreements_leaseagreement', 'booking_id >= (SELECT min(id) FROM bookings_booking WHERE listing_id = 9002)');
    await notifs();
  });
});

describe('admin list / communications / extend', () => {
  it('admin list filters and paging', async () => {
    const s = await login(acct.superadmin!);
    for (const q of ['', '?status=confirmed', '?search=fixture', '?search=E2E_GUEST', '?search=%25', '?search=_', '?limit=2&offset=3', '?limit=0', '?limit=500',
      '?limit=abc&offset=4', '?offset=-5', '?limit=+3', '?limit=1_0', '?limit=%203%20', '?status=pending_host&search=Fixture&limit=1', '?offset=100000']) {
      same(await s.req('GET', `/api/bookings/admin/list/${q}`));
    }
  });
  it('communications', async () => {
    const s = await login(acct.superadmin!);
    const { rows } = await dbs.django.query(`SELECT b.id FROM bookings_booking b JOIN messaging_conversation c ON c.listing_id = b.listing_id ORDER BY b.id LIMIT 5`);
    for (const r of rows) same(await s.req('GET', `/api/bookings/admin/${r.id}/communications/`));
    same(await s.req('GET', '/api/bookings/admin/90020/communications/'));
  });
  it('extend reservation: validation, capping, offsets, wrong status', async () => {
    const s = await login(acct.superadmin!);
    await booking(90040, { status: 'pending_host', start_date: day(120), end_date: day(122), requested_at: '2026-09-25T10:00:00.123456Z', host_confirm_deadline: day(1) });
    await booking(90041, { status: 'awaiting_payment', start_date: day(130), end_date: day(132), requested_at: new Date().toISOString(), payment_due_at: day(5) });
    const bodies: unknown[] = [
      {}, { reason: '   ' }, { reason: 'ok' }, { reason: 'ok', new_deadline: 'soon' }, { reason: 'ok', new_deadline: '2026-10-08' },
      { reason: 'ok', new_deadline: '2099-01-01T00:00:00Z' }, { reason: 5, new_deadline: '2026-10-09T12:30:00+05:30' },
      { reason: 'ok', new_deadline: '2026-10-09 12:30:00.5' }, { reason: 'ok', new_deadline: '2026-1-5T1:2' },
    ];
    for (const json of bodies) {
      same(await s.req('POST', '/api/bookings/admin/90040/extend-reservation/', { json }));
      same(await s.req('POST', '/api/bookings/admin/90041/extend-reservation/', { json }));
    }
    same(await s.req('POST', '/api/bookings/admin/90022/extend-reservation/', { json: { reason: 'r', new_deadline: '2026-11-01T00:00:00Z' } }));
    await bookingsRows('id IN (90040, 90041, 90022)');
    await audit();
    await notifs();
  });
});

describe('legacy payment requests', () => {
  it('request-payment amounts and list', async () => {
    await booking(90050, { status: 'requested', start_date: day(140), end_date: day(142) });
    await booking(90051, { status: 'requested', start_date: day(150), end_date: day(152) });
    const h = await login(HOST);
    same(await (await login(GUEST)).req('POST', '/api/bookings/90050/request-payment/', { json: { amount: 5 } }));
    for (const json of [{}, { amount: 0 }, { amount: '' }, { amount: 'abc' }, { amount: '-1' }, { amount: 'NaN' }, { amount: true }, { amount: [1] },
      { amount: ' 1_000.505 ', notes: 'pay soon' }]) same(await h.req('POST', '/api/bookings/90050/request-payment/', { json }));
    same(await h.req('POST', '/api/bookings/90050/request-payment/', { json: { amount: 10 } })); // already payment_requested
    same(await h.req('POST', '/api/bookings/90051/request-payment/', { json: { amount: 12.5, notes: 7 } }));
    same(await h.req('POST', '/api/bookings/90020/request-payment/', { json: { amount: 1 } }));
    await bookingsRows('id IN (90050, 90051)');
    await sameRows('bookings_paymentrequest', 'booking_id IN (90050, 90051)');
    same(await (await login(GUEST)).req('GET', '/api/bookings/payment-requests/'));
  });
});

describe('saved searches & alerts', () => {
  it('CRUD + validation', async () => {
    const p = await login(GUEST);
    for (const json of [{}, { name: '' }, { name: 'x'.repeat(101) }, { name: 'a', min_price: 'abc' }, { name: 'a', min_price: '1.234' },
      { name: 'a', min_price: '12345678901' }, { name: 'a', min_price: 500, max_price: 100 }, { name: 'a', min_bedrooms: 3, max_bedrooms: 2 },
      { name: 'a', min_square_footage: 5, max_square_footage: 5 }, { name: 'a', min_bedrooms: '2.0', max_bedrooms: 2.5 }, { name: 'a', email_frequency: 'hourly' },
      { name: 'a', is_available: 'maybe' }, { name: 'a', min_bedrooms: 99999999999 }]) {
      same(await p.req('POST', '/api/bookings/searches/', { json }));
    }
    const r = await p.req('POST', '/api/bookings/searches/', { json: { name: ' Beach ', min_price: '100', max_price: 2500.5, property_type: 'apartment', min_bedrooms: 1, max_bedrooms: '3', address: 'Monrovia', keywords: 'sea', is_available: 'false', email_frequency: 'weekly' } });
    same(r);
    const id = (r.django.body as { id: number }).id;
    same(await p.req('POST', '/api/bookings/searches/', { json: { name: 'Second', min_price: 0, max_price: 0 } }));
    await sameRows('bookings_savedsearch', `user_id = ${GUEST.id}`);
    await both(`INSERT INTO bookings_searchalert (saved_search_id, listing_id, sent_at) VALUES ($1, ${L_NIGHTLY}, now()), ($1, 5, now() - interval '1 hour')`, [id]);
    same(await p.req('GET', '/api/bookings/searches/'));
    same(await p.req('GET', `/api/bookings/searches/${id}/`));
    same(await p.req('GET', '/api/bookings/searches/alerts/'));
    same(await (await login(OTHER)).req('GET', `/api/bookings/searches/${id}/`));
    same(await p.req('PUT', `/api/bookings/searches/${id}/`, { json: { name: 'Renamed', min_price: 3000 } }));
    same(await p.req('PUT', `/api/bookings/searches/${id}/`, { json: { name: 'Renamed', keywords: '', max_bedrooms: null } }));
    await sameRows('bookings_savedsearch', `user_id = ${GUEST.id}`);
    same(await (await login(OTHER)).req('DELETE', `/api/bookings/searches/${id}/`));
    same(await p.req('DELETE', `/api/bookings/searches/${id}/`));
    same(await p.req('DELETE', `/api/bookings/searches/${id}/`));
    await sameRows('bookings_savedsearch', `user_id = ${GUEST.id}`);
    await sameRows('bookings_searchalert', 'true');
  });
  it('test search filters', async () => {
    const p = await login(GUEST);
    for (const json of [{}, { min_price: '50', max_price: 100 }, { property_type: 'apartment', min_bedrooms: 2 }, { max_bedrooms: '3' },
      { address: 'mon' }, { keywords: 'Fixture' }, { is_available: false }, { is_available: 'True', keywords: 'bed' }, { min_price: 0 }]) {
      // Listing has no Meta.ordering and the view adds none: row order is Postgres heap order, which
      // diverges between the two copies after updates — compare as a set (sorted by id).
      const r = await p.req('POST', '/api/bookings/searches/test/', { json });
      expect(r.express.status).toBe(r.django.status);
      const byId = (b: unknown) => [...(b as { id: number }[])].sort((x, y) => x.id - y.id);
      expect(diff(byId(r.django.body), byId(r.express.body))).toEqual([]);
    }
  });
});

describe('comparisons', () => {
  it('create / update / share / add / remove / delete', async () => {
    const p = await login(GUEST);
    for (const json of [{}, { name: 'x' }, { name: 'x', listing_ids: [5] }, { name: 'x', listing_ids: [1, 2, 3, 4, 5] }, { name: 'x', listing_ids: 'abc' },
      { name: 'x', listing_ids: ['a', 5] }, { name: '', listing_ids: [5, 6] }, { name: 'x', listing_ids: [5, 6], is_public: 'maybe' }]) {
      same(await p.req('POST', '/api/bookings/comparisons/', { json }));
    }
    const r = await p.req('POST', '/api/bookings/comparisons/', { json: { name: 'Mine', listing_ids: [L_NIGHTLY, 99999999, L_MONTHLY, L_HOTEL] } });
    same(r);
    const id = (r.django.body as { id: number }).id;
    const pub = await p.req('POST', '/api/bookings/comparisons/', { json: { name: 'Public', listing_ids: [5, 6], is_public: true } });
    expect(pub.django.status).toBe(201);
    const pubId = (pub.django.body as { id: number }).id;
    await sameRows('bookings_propertycomparison', `user_id = ${GUEST.id}`, { ignore: ['share_token'] });
    // share tokens are random uuid4 hex: align them, then compare everything
    await both('UPDATE bookings_propertycomparison SET share_token = $1 WHERE id = $2', ['f'.repeat(32), pubId]);
    same(await new Pair().req('GET', `/api/bookings/comparisons/shared/${'f'.repeat(32)}/`));
    same(await p.req('GET', '/api/bookings/comparisons/'));
    same(await p.req('GET', `/api/bookings/comparisons/${id}/`));
    same(await (await login(OTHER)).req('GET', `/api/bookings/comparisons/${id}/`));
    same(await p.req('PUT', `/api/bookings/comparisons/${id}/`, { json: { listing_ids: [6] } }));
    same(await p.req('PUT', `/api/bookings/comparisons/${id}/`, { json: { listing_ids: [L_HOTEL, L_NIGHTLY], name: 'Renamed' } }));
    const sharedPut = await p.req('PUT', `/api/bookings/comparisons/${id}/`, { json: { is_public: true } });
    expect(sharedPut.express.status).toBe(sharedPut.django.status);
    await both('UPDATE bookings_propertycomparison SET share_token = NULL, is_public = false WHERE id = $1', [id]);
    for (const json of [{}, { comparison_id: id }, { comparison_id: id, listing_id: 99999999 }, { comparison_id: id, listing_id: L_NIGHTLY },
      { comparison_id: id, listing_id: 5 }, { comparison_id: 99999999, listing_id: 5 }, { comparison_id: pubId, listing_id: L_AGENT }]) {
      same(await p.req('POST', '/api/bookings/comparisons/add/', { json }));
    }
    for (const json of [{}, { comparison_id: id, listing_id: 6 }, { comparison_id: id, listing_id: L_HOTEL }, { comparison_id: id, listing_id: 99999999 }]) {
      same(await p.req('POST', '/api/bookings/comparisons/remove/', { json }));
    }
    await sameRows('bookings_comparisonitem', `comparison_id IN (${id}, ${pubId})`);
    same(await p.req('DELETE', `/api/bookings/comparisons/${id}/`));
    same(await p.req('DELETE', `/api/bookings/comparisons/${id}/`));
    await sameRows('bookings_propertycomparison', `user_id = ${GUEST.id}`);
    await sameRows('bookings_comparisonitem', 'true');
  });
});

describe('viewings (Path C)', () => {
  it('slots, request validation, create, conflict', async () => {
    const g = await login(GUEST);
    const o = await login(OTHER);
    for (const id of [L_MONTHLY, 169, 99999999]) same(await g.req('GET', `/api/bookings/viewings/slots/${id}/`));
    const sat = nextWeekday(9, 5);
    const sat2 = nextWeekday(16, 5);
    const bodies: unknown[] = [
      {}, { listing: L_MONTHLY }, { listing: 99999999, viewing_date: sat }, { listing: L_MONTHLY, viewing_date: 'x' },
      { listing: L_MONTHLY, viewing_date: nextWeekday(9, 4) }, { listing: L_MONTHLY, viewing_date: nextWeekday(-7, 5) },
      { listing: L_MONTHLY, viewing_date: sat }, { listing: L_MONTHLY, viewing_date: sat, viewing_time: '09:00' },
      { listing: L_MONTHLY, viewing_date: sat, viewing_time: '16:00' },
    ];
    for (const json of bodies) same(await g.req('POST', '/api/bookings/viewings/', { json }));
    same(await (await login(HOST)).req('POST', '/api/bookings/viewings/', { json: { listing: L_MONTHLY, viewing_date: sat, viewing_time: '10:00' } }));
    same(await g.req('POST', '/api/bookings/viewings/', { json: { listing: L_MONTHLY, viewing_date: sat, viewing_time: ' 10:00:00 ', guest_notes: 'Hi' } }));
    same(await o.req('POST', '/api/bookings/viewings/', { json: { listing: L_MONTHLY, viewing_date: sat, viewing_time: '11:00' } })); // 409
    same(await o.req('POST', '/api/bookings/viewings/', { json: { listing: L_MONTHLY, viewing_date: sat2.replace(/-/g, ''), viewing_time: '15:00', guest_notes: 42 } }));
    same(await g.req('GET', '/api/bookings/viewings/'));
    same(await g.req('GET', `/api/bookings/viewings/slots/${L_MONTHLY}/`));
    await sameRows('bookings_viewingappointment', `listing_id = ${L_MONTHLY}`);
  });
  it('admin status transitions with notifications + audit', async () => {
    const s = await login(acct.superadmin!);
    const { rows } = await dbs.django.query(`SELECT id FROM bookings_viewingappointment WHERE listing_id = ${L_MONTHLY} ORDER BY id`);
    const [v1, v2] = rows.map((r) => Number(r.id));
    same(await s.req('GET', '/api/bookings/viewings/admin/'));
    same(await s.req('GET', '/api/bookings/viewings/admin/?status=requested'));
    same(await s.req('POST', `/api/bookings/viewings/admin/${v1}/status/`, { json: { status: 'scheduled' } })); // requested → scheduled not allowed
    same(await s.req('POST', `/api/bookings/viewings/admin/${v1}/status/`, { json: { status: 7 } }));
    same(await s.req('POST', `/api/bookings/viewings/admin/${v1}/status/`, { json: {} }));
    await both(`UPDATE bookings_viewingappointment SET status = 'fee_paid', is_fee_paid = true WHERE id = $1`, [v1]);
    same(await s.req('POST', `/api/bookings/viewings/admin/${v1}/status/`, { json: { status: 'scheduled', admin_notes: 'See you' } }));
    same(await s.req('POST', `/api/bookings/viewings/admin/${v1}/status/`, { json: { status: 'completed' } }));
    same(await s.req('POST', `/api/bookings/viewings/admin/${v2}/status/`, { json: { status: 'cancelled', admin_notes: 'No show' } }));
    same(await s.req('POST', `/api/bookings/viewings/admin/${v2}/status/`, { json: { status: 'cancelled' } }));
    await sameRows('bookings_viewingappointment', `listing_id = ${L_MONTHLY}`);
    await audit();
    await notifs();
  });
  it('reserve from a completed viewing', async () => {
    const g = await login(GUEST);
    const { rows } = await dbs.django.query(`SELECT id FROM bookings_viewingappointment WHERE listing_id = ${L_MONTHLY} AND status = 'completed'`);
    const v = Number(rows[0].id);
    same(await (await login(OTHER)).req('POST', `/api/bookings/viewings/${v}/reserve/`, { json: {} }));
    for (const json of [{}, { start_date: day(40) }, { start_date: 'x', end_date: day(41) }, { start_date: day(41), end_date: day(40) }]) {
      same(await g.req('POST', `/api/bookings/viewings/${v}/reserve/`, { json }));
    }
    same(await g.req('POST', `/api/bookings/viewings/${v}/reserve/`, { json: { start_date: day(45), end_date: day(410) } }));
    same(await g.req('POST', `/api/bookings/viewings/${v}/reserve/`, { json: { start_date: day(45), end_date: day(410) } }));
    await sameRows('bookings_viewingappointment', `listing_id = ${L_MONTHLY}`);
    await bookingsRows();
    await listingRows();
    await sameRows('leaseagreements_leaseagreement', `booking_id IN (SELECT id FROM bookings_booking WHERE listing_id = ${L_MONTHLY})`);
    await notifs();
    const notCompleted = await dbs.django.query(`SELECT id FROM bookings_viewingappointment WHERE guest_id = ${GUEST.id} AND status <> 'completed' ORDER BY id LIMIT 1`);
    if (notCompleted.rows[0]) same(await g.req('POST', `/api/bookings/viewings/${notCompleted.rows[0].id}/reserve/`, { json: {} }));
  });
});
