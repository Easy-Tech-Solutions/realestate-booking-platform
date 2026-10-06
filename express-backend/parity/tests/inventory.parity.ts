// inventory — /api/inventory/ parity: access matrix (inventory department role / trust_safety.flags role /
// listings.compliance role / plain staff), global listing search, suspend/unsuspend/bulk, compliance
// metadata, rule-based detectors, manual flags + review, audit rows and queued AI-scoring tasks.
import { Redis } from 'ioredis';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accounts, dbs, flushRedis, Pair, PASSWORD, same, sameRows } from '../lib.js';

// ---- helpers --------------------------------------------------------------------------------

let ipCounter = 0;
async function loginPair(email: string): Promise<Pair> {
  const p = new Pair();
  const r = await p.req('POST', '/api/auth/login/', { json: { email, password: PASSWORD }, headers: { 'X-Forwarded-For': `198.51.100.${++ipCounter}` } });
  expect(r.django.status, `login ${email}: ${r.django.text}`).toBe(200);
  expect(r.express.status, `login ${email}: ${r.express.text}`).toBe(200);
  p.django.token = (r.django.body as { access: string }).access;
  p.express.token = (r.express.body as { access: string }).access;
  return p;
}

async function both(q: string, params: unknown[] = []) {
  const [d, e] = await Promise.all([dbs.django.query(q, params), dbs.express.query(q, params)]);
  return { django: d.rows, express: e.rows };
}

async function cloneUser(newId: number, fromId: number, set: Record<string, string> = {}) {
  const cols: string[] = (await dbs.django.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='users_user' ORDER BY ordinal_position`,
  )).rows.map((r) => r.column_name);
  const exprs = cols.map((c) => (c === 'id' ? String(newId) : c === 'username' ? `'parity_${newId}'` : c === 'email' ? `'parity_${newId}@example.com'` : set[c] ?? `"${c}"`));
  await both(`INSERT INTO users_user (${cols.map((c) => `"${c}"`).join(',')}) SELECT ${exprs.join(',')} FROM users_user WHERE id = ${fromId}`);
  await both(`INSERT INTO users_profile (id, user_id, bio, is_superhost, phone_number, image) VALUES (${newId}, ${newId}, '', false, '', '')`);
  return `parity_${newId}@example.com`;
}

async function maxId(table: string): Promise<number> {
  const r = await dbs.django.query(`SELECT coalesce(max(id), 0) m FROM ${table}`);
  return Number(r.rows[0].m);
}

async function insertBooking(id: number, listing: number, customer: number, status: string, start: string, end: string, room: number | null = null, total = '100.00') {
  await both(`INSERT INTO bookings_booking (id, start_date, end_date, status, notes, requested_at, customer_id, listing_id, decline_reason, owner_notes,
    total_price, hotel_room_id, requires_viewing, extension_reason) VALUES ($1,$2,$3,$4,'',now(),$5,$6,'','',$7,$8,false,'')`,
  [id, start, end, status, customer, listing, total, room]);
}

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
let fileSeq = 0;
const uniq = (ext = 'png') => `parity_${Date.now()}_${++fileSeq}.${ext}`;
function form(fields: Record<string, string>, files: Record<string, [Buffer, string][]> = {}) {
  const fd = new FormData();
  // A multipart body with zero parts is rejected by Django's ASGI server (bare 400) before any view runs — keep one part.
  if (!Object.keys(fields).length && !Object.keys(files).length) fd.append('_parity', '1');
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  for (const [k, list] of Object.entries(files)) for (const [buf, name] of list) fd.append(k, new Blob([new Uint8Array(buf)], { type: 'image/png' }), name);
  return fd;
}

/** Tasks queued on Celery's ai_scoring queue (db 1) vs BullMQ hk:ai_scoring (db 2). */
async function aiQueue() {
  const r1 = new Redis('redis://parity-redis:6379/1');
  const r2 = new Redis('redis://parity-redis:6379/2');
  try {
    const celery = (await r1.lrange('ai_scoring', 0, -1)).map((raw) => {
      const m = JSON.parse(raw);
      const [args] = JSON.parse(Buffer.from(m.body, 'base64').toString('utf8'));
      return `${m.headers.task}(${JSON.stringify(args)})`;
    });
    const ids = [...(await r2.lrange('hk:ai_scoring:wait', 0, -1)), ...(await r2.zrange('hk:ai_scoring:prioritized', 0, -1))];
    const bull = await Promise.all(ids.map(async (id) => {
      const job = await r2.hgetall(`hk:ai_scoring:${id}`);
      return `${job.name}(${JSON.stringify(JSON.parse(job.data).args)})`;
    }));
    return { django: celery.sort(), express: bull.sort() };
  } finally { r1.disconnect(); r2.disconnect(); }
}
export { aiQueue };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const AUDIT_IGNORE = { ignore: ['id', 'created_at'] };

// ---- fixtures ---------------------------------------------------------------------------------

let acct: Awaited<ReturnType<typeof accounts>>;
const S: Record<string, Pair> = {};
const INV = 940001; // is_staff + inventory preset role
const FLAGS = 940002; // is_staff + custom trust_safety.flags role
const COMPLIANCE = 940003; // listings.compliance update (not staff)
const STAFF = 940004;
const HOST = 940005;
let LISTINGS: number[] = [];

beforeAll(async () => {
  acct = await accounts();
  await cloneUser(INV, acct.user!.id, { is_staff: 'true' });
  await cloneUser(FLAGS, acct.user!.id, { is_staff: 'true' });
  await cloneUser(COMPLIANCE, acct.user!.id);
  await cloneUser(STAFF, acct.user!.id, { is_staff: 'true' });
  await cloneUser(HOST, acct.agent!.id);
  await both(`INSERT INTO rbac_role (id, name, slug, description, is_preset, created_by_id, created_at, updated_at) VALUES
    (940001, 'Parity Flags', 'parity-flags', '', false, NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
    (940002, 'Parity Compliance', 'parity-compliance', '', false, NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`);
  await both(`INSERT INTO rbac_rolepermission (id, role_id, resource, action) VALUES (940001, 940001, 'trust_safety.flags', 'read'), (940002, 940002, 'listings.compliance', 'update')`);
  await both(`INSERT INTO rbac_userroleassignment (id, user_id, role_id, granted_by_id, granted_at) VALUES
    (940001, ${INV}, (SELECT id FROM rbac_role WHERE slug='inventory'), NULL, '2026-01-01T00:00:00Z'),
    (940002, ${FLAGS}, 940001, NULL, '2026-01-01T00:00:00Z'), (940003, ${COMPLIANCE}, 940002, NULL, '2026-01-01T00:00:00Z')`);
  // listings for duplicate / price-anomaly detection (same coordinates; one wildly priced)
  const cols = `title, description, price, bedrooms, beds, bathrooms, max_guests, property_type, privacy_type, booking_mode, owner_id, address, city, state, country,
    latitude, longitude, check_in_time, check_out_time, self_checkin, square_footage, amenities, highlights, weekend_premium_percent, new_listing_promo,
    last_minute_discount_enabled, last_minute_discount_percent, weekly_discount_enabled, weekly_discount_percent, monthly_discount_enabled, monthly_discount_percent,
    exterior_camera, noise_monitor, weapons_on_property, pricing_type, cancellation_policy, is_available, status, main_image, agent_owner_name, agent_owner_phone,
    agent_owner_email, agent_owner_payout_number, agent_owner_payout_network, created_at, updated_at, suspension_reason, local_registration_number, max_guests_dummy`;
  void cols;
  const prices = ['40', '42', '41', '43', '40', '900', '45'];
  for (const [i, price] of prices.entries()) {
    const id = 940001 + i;
    LISTINGS.push(id);
    await both(`INSERT INTO listings_listing (id, title, description, price, bedrooms, beds, bathrooms, max_guests, property_type, privacy_type, booking_mode, owner_id,
      address, city, state, country, latitude, longitude, check_in_time, check_out_time, self_checkin, square_footage, amenities, highlights, weekend_premium_percent,
      new_listing_promo, last_minute_discount_enabled, last_minute_discount_percent, weekly_discount_enabled, weekly_discount_percent, monthly_discount_enabled,
      monthly_discount_percent, exterior_camera, noise_monitor, weapons_on_property, pricing_type, cancellation_policy, is_available, status, main_image,
      agent_owner_name, agent_owner_phone, agent_owner_email, agent_owner_payout_number, agent_owner_payout_network, created_at, updated_at, suspension_reason,
      local_registration_number)
      VALUES ($1, $2, '', $3, 1, 1, 1, 4, 'house', 'entire_place', 'instant', ${HOST}, 'Inv Rd', 'Parityville', '', '', $4, $5, '15:00', '11:00', false, 0, '[]', '[]', 0,
      false, false, 0, false, 0, false, 0, false, false, false, 'nightly', 'flexible', true, 'published', '', '', '', '', '', '', now() - ($6 || ' minutes')::interval,
      now(), '', '')`, [id, `Inv listing ${i}`, price, i < 3 ? '6.123401' : `6.${200 + i}`, '-10.5', String(i)]);
  }
  for (const role of ['user', 'admin', 'superadmin'] as const) S[role] = await loginPair(acct[role]!.email);
  S.inv = await loginPair(`parity_${INV}@example.com`);
  S.flags = await loginPair(`parity_${FLAGS}@example.com`);
  S.compliance = await loginPair(`parity_${COMPLIANCE}@example.com`);
  S.staff = await loginPair(`parity_${STAFF}@example.com`);
  S.anon = new Pair();
});
beforeEach(flushRedis);

const ROUTES: [string, string][] = [
  ['GET', '/api/inventory/listings/'], ['POST', '/api/inventory/listings/bulk/'], ['POST', '/api/inventory/listings/940001/suspend/'],
  ['POST', '/api/inventory/listings/940001/unsuspend/'], ['PATCH', '/api/inventory/listings/940001/compliance/'], ['GET', '/api/inventory/flags/'],
  ['POST', '/api/inventory/flags/scan/'], ['POST', '/api/inventory/flags/manual/'], ['POST', '/api/inventory/flags/999999/review/'],
];

describe('access matrix', () => {
  for (const who of ['anon', 'user', 'staff', 'compliance', 'admin']) {
    it(`${who} on every route`, async () => {
      for (const [m, path] of ROUTES) same(await S[who]!.req(m, path, { json: {} }), { headers: ['www-authenticate'] });
    });
  }
  it('wrong methods', async () => {
    for (const [m, path] of [['POST', '/api/inventory/listings/'], ['GET', '/api/inventory/flags/scan/'], ['POST', '/api/inventory/listings/940001/compliance/']] as const) {
      same(await S.inv!.req(m, path, { json: {} }));
    }
  });
});

describe('inventory listings', () => {
  it('search / filter / paginate', async () => {
    for (const q of ['', '?page=2', '?page_size=5', '?page_size=5&page=3', '?status=published', '?status=draft', '?search=inv%20listing', '?search=%20%20',
      `?search=parity_${HOST}`, '?search=example.com&page_size=3', '?flagged=true', '?flagged=1', '?page=99']) {
      same(await S.inv!.req('GET', `/api/inventory/listings/${q}`));
    }
    same(await S.flags!.req('GET', '/api/inventory/listings/?page_size=2'));
    same(await S.superadmin!.req('GET', '/api/inventory/listings/?search=Parityville'));
  });
  it('suspend / unsuspend', async () => {
    const a0 = await maxId('superadmin_adminauditlog');
    same(await S.inv!.req('POST', '/api/inventory/listings/940001/suspend/', { json: {} }));
    same(await S.inv!.req('POST', '/api/inventory/listings/940001/suspend/', { json: { reason: '  ' } }));
    same(await S.inv!.req('POST', '/api/inventory/listings/999999/suspend/', { json: { reason: 'x' } }));
    same(await S.inv!.req('POST', '/api/inventory/listings/940001/unsuspend/'));
    same(await S.inv!.req('POST', '/api/inventory/listings/940001/suspend/', { json: { reason: ' Unsafe wiring ' } }));
    await sameRows('listings_listing', 'id = 940001', { ignore: ['updated_at', 'suspended_at'] });
    same(await S.inv!.req('GET', '/api/listings/940001/'));
    same(await S.inv!.req('POST', '/api/inventory/listings/999999/unsuspend/'));
    same(await S.flags!.req('POST', '/api/inventory/listings/940001/unsuspend/'));
    await sameRows('listings_listing', 'id = 940001', { ignore: ['updated_at', 'suspended_at'] });
    await sameRows('superadmin_adminauditlog', `id > ${a0}`, AUDIT_IGNORE);
  });
  it('bulk', async () => {
    const a0 = await maxId('superadmin_adminauditlog');
    for (const body of [{}, { action: 'delete', listing_ids: [1] }, { action: 'suspend' }, { action: 'suspend', listing_ids: 'x' }, { action: 'suspend', listing_ids: [940002] },
      { action: 'unsuspend', listing_ids: Array.from({ length: 201 }, (_, i) => i) }]) {
      same(await S.inv!.req('POST', '/api/inventory/listings/bulk/', { json: body }));
    }
    same(await S.inv!.req('POST', '/api/inventory/listings/bulk/', { json: { action: 'suspend', listing_ids: [940002, 940003, 999999, 999998, 940002, 17, 33], reason: 'Batch' } }));
    same(await S.inv!.req('POST', '/api/inventory/listings/bulk/', { json: { action: 'unsuspend', listing_ids: [940002, 940004, 940003, 1000001] } }));
    await sameRows('listings_listing', 'id IN (940002, 940003, 940004)', { ignore: ['updated_at', 'suspended_at'] });
    await sameRows('superadmin_adminauditlog', `id > ${a0}`, AUDIT_IGNORE);
    await both(`UPDATE listings_listing SET status = 'published' WHERE id IN (940002, 940003)`);
  });
  it('compliance', async () => {
    const a0 = await maxId('superadmin_adminauditlog');
    same(await S.compliance!.req('PATCH', '/api/inventory/listings/999999/compliance/', { json: {} }));
    same(await S.compliance!.req('PATCH', '/api/inventory/listings/940005/compliance/', { json: { occupancy_cap: 2 } }));
    same(await S.compliance!.req('PATCH', '/api/inventory/listings/940005/compliance/', { json: { local_registration_number: '  REG-1  ', occupancy_cap: '6' } }));
    same(await S.compliance!.req('PATCH', '/api/inventory/listings/940005/compliance/', { json: {} }));
    same(await S.compliance!.req('PATCH', '/api/inventory/listings/940005/compliance/', { json: { occupancy_cap: '' } }));
    same(await S.superadmin!.req('PATCH', '/api/inventory/listings/940005/compliance/', { json: { occupancy_cap: 4.9, local_registration_number: null } }));
    const bad = await S.compliance!.req('PATCH', '/api/inventory/listings/940005/compliance/', { json: { occupancy_cap: 'abc' } });
    expect(bad.express.status).toBe(bad.django.status);
    await sameRows('listings_listing', 'id = 940005', { ignore: ['updated_at'] });
    await sameRows('superadmin_adminauditlog', `id > ${a0}`, AUDIT_IGNORE);
    // the cap now constrains the host's max_guests edits
    const host = await loginPair(`parity_${HOST}@example.com`);
    same(await host.req('PUT', '/api/listings/940005/', { json: { max_guests: 9 } }));
  });
});

describe('listing flags', () => {
  let flagId = 0;
  it('scan (duplicates + price anomalies), idempotent', async () => {
    const f0 = await maxId('inventory_listingflag');
    const a0 = await maxId('superadmin_adminauditlog');
    same(await S.inv!.req('POST', '/api/inventory/flags/scan/'));
    same(await S.flags!.req('POST', '/api/inventory/flags/scan/'));
    await sameRows('inventory_listingflag', `id > ${f0}`, { ignore: ['created_at'] });
    await sameRows('superadmin_adminauditlog', `id > ${a0}`, AUDIT_IGNORE);
    const fired = (await dbs.django.query(`SELECT DISTINCT flag_type FROM inventory_listingflag WHERE listing_id >= 940001`)).rows.map((r) => r.flag_type).sort();
    expect(fired).toEqual(['duplicate', 'price_anomaly']); // both detectors fired (first run: the admin preset role in the access matrix)
    const q = await aiQueue();
    expect(q.express).toEqual(q.django);
  });
  it('manual + review + list', async () => {
    for (const body of [{}, { listing: 940001 }, { listing: 999999, details: 'x' }, { listing: 940001, details: ' ' }]) {
      same(await S.inv!.req('POST', '/api/inventory/flags/manual/', { json: body }));
    }
    const f0 = await maxId('inventory_listingflag');
    const a0 = await maxId('superadmin_adminauditlog');
    const r = await S.inv!.req('POST', '/api/inventory/flags/manual/', { json: { listing: '940006', details: ' Fake photos ', severity: 'low' } });
    same(r);
    flagId = (r.django.body as { id: number }).id;
    const q = await aiQueue();
    expect(q.express).toEqual(q.django);
    for (const body of [{}, { status: 'open' }]) same(await S.inv!.req('POST', `/api/inventory/flags/${flagId}/review/`, { json: body }));
    same(await S.inv!.req('POST', '/api/inventory/flags/999999/review/', { json: { status: 'confirmed' } }));
    same(await S.inv!.req('POST', `/api/inventory/flags/${flagId}/review/`, { json: { status: 'confirmed', notes: 'yes' } }));
    await sameRows('inventory_listingflag', `id >= ${f0}`, { ignore: ['created_at', 'reviewed_at'] });
    await sameRows('superadmin_adminauditlog', `id > ${a0}`, AUDIT_IGNORE);
    for (const qs of ['', '?status=all', '?status=confirmed', '?status=']) same(await S.inv!.req('GET', `/api/inventory/flags/${qs}`));
    same(await S.inv!.req('GET', '/api/inventory/listings/?flagged=true'));
  });
});
