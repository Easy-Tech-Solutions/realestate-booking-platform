// listings — /api/listings/ parity: every route, access matrix, filters/ordering/pagination,
// validation, multipart image uploads, and the rows written (listings, images, rooms,
// favorites, reviews, notifications, audit log, verification side effects).
import ExcelJS from 'exceljs';
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

// ---- fixtures -----------------------------------------------------------------------------------

let acct: Awaited<ReturnType<typeof accounts>>;
const S: Record<string, Pair> = {};
const HOST = 920001; // agent-role host (owns test listings)
const HOST2 = 920002; // another host
const GUEST = 920003; // regular user with stays
const CONTENT = 920004; // is_staff + custom role with listings.content
const SETTINGS = 920005; // is_staff + listings.settings
const STAFF = 920006; // is_staff, no roles

beforeAll(async () => {
  acct = await accounts();
  await cloneUser(HOST, acct.agent!.id, { role: `'agent'` });
  await cloneUser(HOST2, acct.agent!.id, { role: `'agent'` });
  await cloneUser(GUEST, acct.user!.id);
  await cloneUser(CONTENT, acct.user!.id, { is_staff: 'true' });
  await cloneUser(SETTINGS, acct.user!.id, { is_staff: 'true' });
  await cloneUser(STAFF, acct.user!.id, { is_staff: 'true' });
  await both(`INSERT INTO rbac_role (id, name, slug, description, is_preset, created_by_id, created_at, updated_at) VALUES
    (920001, 'Parity Listing Content', 'parity-listing-content', '', false, NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
    (920002, 'Parity Listing Settings', 'parity-listing-settings', '', false, NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`);
  await both(`INSERT INTO rbac_rolepermission (id, role_id, resource, action) VALUES (920001, 920001, 'listings.content', 'read'), (920002, 920002, 'listings.settings', 'update')`);
  await both(`INSERT INTO rbac_userroleassignment (id, user_id, role_id, granted_by_id, granted_at) VALUES
    (920001, ${CONTENT}, 920001, NULL, '2026-01-01T00:00:00Z'), (920002, ${SETTINGS}, 920002, NULL, '2026-01-01T00:00:00Z')`);
  for (const role of ['user', 'agent', 'admin', 'superadmin'] as const) S[role] = await loginPair(acct[role]!.email);
  S.host = await loginPair(`parity_${HOST}@example.com`);
  S.host2 = await loginPair(`parity_${HOST2}@example.com`);
  S.guest = await loginPair(`parity_${GUEST}@example.com`);
  S.content = await loginPair(`parity_${CONTENT}@example.com`);
  S.settings = await loginPair(`parity_${SETTINGS}@example.com`);
  S.staff = await loginPair(`parity_${STAFF}@example.com`);
  S.anon = new Pair();
});
beforeEach(flushRedis);

// ---- categories / settings ------------------------------------------------------------------------

describe('categories & settings', () => {
  it('categories: public sees active only, full admin sees all', async () => {
    await both(`UPDATE listings_propertycategory SET is_active = false WHERE slug = 'highway'`);
    for (const who of ['anon', 'user', 'admin', 'superadmin', 'staff']) same(await S[who]!.req('GET', '/api/listings/categories/'));
    same(await S.anon!.req('POST', '/api/listings/categories/', { json: {} }));
    await both(`UPDATE listings_propertycategory SET is_active = true WHERE slug = 'highway'`);
  });
  it('settings GET (creates the singleton when missing)', async () => {
    same(await S.anon!.req('GET', '/api/listings/settings/'));
    await both('DELETE FROM listings_listingsettings');
    same(await S.anon!.req('GET', '/api/listings/settings/'));
    await sameRows('listings_listingsettings', 'true', { ignore: ['updated_at'] });
  });
  it('settings PATCH access + validation + audit', async () => {
    for (const who of ['anon', 'user', 'admin', 'staff']) same(await S[who]!.req('PATCH', '/api/listings/settings/', { json: { min_monthly_price: '7' } }));
    const before = await maxId('superadmin_adminauditlog');
    for (const body of [{ min_monthly_price: 'abc' }, { min_monthly_price: '1.234' }, { min_monthly_price: '12345678901' }, { min_monthly_price: null }, [1], {}, { min_monthly_price: 7.5 }, { min_monthly_price: '6' }]) {
      same(await S.settings!.req('PATCH', '/api/listings/settings/', { json: body }));
    }
    same(await S.superadmin!.req('PATCH', '/api/listings/settings/', { json: { min_monthly_price: '5' } }));
    await sameRows('listings_listingsettings', 'true', { ignore: ['updated_at'] });
    await sameRows('superadmin_adminauditlog', `id > ${before}`, { ignore: ['id', 'created_at', 'metadata'] });
    same(await S.anon!.req('GET', '/api/listings/settings/'));
  });
});

// ---- browse --------------------------------------------------------------------------------------------

describe('GET /api/listings/ (filters, ordering, pagination)', () => {
  const queries = [
    '', '?page=2', '?page=last', '?page=0', '?page=abc', '?page_size=3', '?page_size=3&page=2', '?page_size=0', '?page_size=500', '?page_size=-1',
    '?ordering=price', '?ordering=-price', '?ordering=title,-created_at', '?ordering=bogus', '?ordering=-bedrooms', '?ordering=square_footage&page_size=5',
    '?min_price=40', '?max_price=50', '?min_price=abc', '?min_price=1e2', '?min_price=40&max_price=100&ordering=price',
    '?min_bedrooms=1', '?max_bedrooms=2.7', '?min_bedrooms=99999999999', '?min_guests=2', '?min_square_footage=1', '?max_square_footage=-5',
    '?owner_id=4', '?owner_id=abc', '?owner_id=107&ordering=-price', '?property_type=hotels', '?property_type_exact=lodge', '?property_type_in=hotels,lodge',
    '?property_type_in=', '?property_type_in=apartment,', '?property_type__icontains=OTEL', '?title__icontains=bed', '?description__icontains=%25',
    '?address__icontains=st', '?location=monrovia', '?location=%20%20', '?location=_', '?is_available=true', '?is_available=false', '?is_available=1',
    '?is_available=3', '?is_available=0', '?is_available=TRUE', '?is_available=False', '?created_after=2026-06-01', '?created_before=2026-06-01', '?created_after=06/01/2026', '?created_after=garbage',
    '?check_in=2026-06-10&check_out=2026-06-20', '?check_in=2026-06-10', '?check_in=20260610&check_out=2026-6-20', '?ordering=price&page_size=4&page=3',
  ];
  for (const q of queries) it(`GET ${q || '(none)'}`, async () => same(await S.anon!.req('GET', `/api/listings/${q}`)));
  it('bad check_in date → 500 like Django', async () => {
    const r = await S.anon!.req('GET', '/api/listings/?check_in=2026-02-30&check_out=2026-03-05');
    expect(r.express.status).toBe(r.django.status);
  });
  it('trailing empty ordering item is ignored', async () => {
    same(await S.anon!.req('GET', '/api/listings/?ordering=price,'));
    same(await S.anon!.req('GET', '/api/listings/?ordering=,-price'));
  });
  it('authenticated browse + bad token', async () => {
    same(await S.user!.req('GET', '/api/listings/?page_size=5'));
    same(await S.anon!.req('GET', '/api/listings/', { token: 'x.y.z' }), { headers: ['www-authenticate'] });
  });
});

// ---- create / detail / update / delete ------------------------------------------------------------------

let L1 = 0; // host's main test listing (published + available after setup)
let L2 = 0; // host2's listing
let LDRAFT = 0;

describe('create listing (multipart only)', () => {
  it('auth / content type', async () => {
    same(await S.anon!.req('POST', '/api/listings/', { form: form({ title: 'x' }) }));
    same(await S.host!.req('POST', '/api/listings/', { json: { title: 'x' } }));
    same(await S.host!.req('POST', '/api/listings/'));
  });
  it('validation errors', async () => {
    const cases: Record<string, string>[] = [
      {}, { title: '  ', address: 'a' }, { title: 'T' }, { title: 'T', address: 'A', price: '1' }, { title: 'T', address: 'A', price: 'abc' },
      { title: 'T', address: 'A', price: '10.555' }, { title: 'T', address: 'A', property_type: 'castle' }, { title: 'T', address: 'A', property_type: '' },
      { title: 'T', address: 'A', amenities: 'not json' }, { title: 'T', address: 'A', amenities: '"wifi"' }, { title: 'T', address: 'A', amenities: '{"a":1}' },
      { title: 'T', address: 'A', privacy_type: 'castle', booking_mode: 'x', status: 'nope' }, { title: 'T', address: 'A', bedrooms: 'two', beds: '1.5', bathrooms: '2.0' },
      { title: 'T', address: 'A', lease_term_months: '0' }, { title: 'T', address: 'A', latitude: '123.4567891' }, { title: 'T', address: 'A', self_checkin: 'maybe' },
      { title: 'x'.repeat(201), address: 'A' }, { title: 'T', address: 'A', check_in_time: '' }, { title: 'T', address: 'A', payment_schedule: 'weekly' },
      { title: 'T', address: 'A', main_image: 'notafile' }, { status: 'draft', price: '2' },
    ];
    for (const c of cases) same(await S.host!.req('POST', '/api/listings/', { form: form(c) }));
    same(await S.host!.req('POST', '/api/listings/', { form: form({ title: 'T', address: 'A' }, { main_image: [[Buffer.from('not an image'), uniq('png')]] }) }));
    same(await S.host!.req('POST', '/api/listings/', { form: form({ title: 'T', address: 'A' }, { main_image: [[PNG, 'parity_noext']] }) }));
    same(await S.host!.req('POST', '/api/listings/', { form: form({ title: 'T', address: 'A' }, { main_image: [[Buffer.alloc(0), uniq()]] }) }));
  });
  it('blacklisted location → 403', async () => {
    await both(`INSERT INTO trustsafety_blacklistedlocation (id, name, latitude, longitude, radius_km, reason, created_by_id, created_at)
      VALUES (920001, 'Parity zone', 6.300000, -10.800000, 1.00, '', NULL, now())`);
    const before = await maxId('listings_listing');
    same(await S.host!.req('POST', '/api/listings/', { form: form({ title: 'Blocked', address: 'A', latitude: '6.3001', longitude: '-10.8002' }) }));
    expect(await maxId('listings_listing')).toBe(before);
  });
  it('success: full listing with main image, draft, minimal', async () => {
    const before = await maxId('listings_listing');
    let r = await S.host!.req('POST', '/api/listings/', {
      form: form({
        title: 'Parity Villa', description: 'Nice', price: '45.5', property_type: ' Hotels ', privacy_type: 'private_room', address: '1 Parity Rd',
        city: 'Monrovia', state: 'Montserrado', country: 'Liberia', latitude: '6.31', longitude: '-10.7', bedrooms: '2', beds: '3', bathrooms: '1',
        max_guests: '4', amenities: '["wifi","ac"]', highlights: '["quiet"]', booking_mode: 'approve_first', cancellation_policy: 'strict', weekend_premium_percent: '10',
        weekly_discount_enabled: 'true', weekly_discount_percent: '5', last_minute_discount_enabled: 'on', last_minute_discount_percent: '20', is_available: 'true',
      }, { main_image: [[PNG, uniq()]] }),
    });
    same(r);
    expect(r.django.status, r.django.text).toBe(201);
    L1 = (r.django.body as { id: number }).id;
    r = await S.host!.req('POST', '/api/listings/', { form: form({ title: '', status: 'draft', amenities: 'null' }) });
    same(r);
    expect(r.django.status, r.django.text).toBe(201);
    LDRAFT = (r.django.body as { id: number }).id;
    same(await S.host2!.req('POST', '/api/listings/', { form: form({ title: 'Host2 Flat', address: '2 Parity Rd', city: 'Paynesville', price: '30', pricing_type: 'monthly', payment_schedule: 'quarterly', lease_term_months: '6', latitude: '6.32', longitude: '-10.71', max_guests: '3' }) }).then((x) => { expect(x.django.status, x.django.text).toBe(201); L2 = (x.django.body as { id: number }).id; return x; }));
    const fu = new URLSearchParams({ title: 'Form encoded', address: '3 Rd', price: '12' }).toString();
    same(await rawPost(S.host!, '/api/listings/', 'application/x-www-form-urlencoded', fu));
    await sameRows('listings_listing', `id > ${before}`);
  });
  it('make test listings live', async () => {
    await both(`UPDATE listings_listing SET status = 'published', is_available = true WHERE id IN (${L1}, ${L2})`);
  });
});

async function rawPost(p: Pair, path: string, ctype: string, body: string, method = 'POST') {
  const { request } = await import('node:http');
  const one = (side: 'django' | 'express') => new Promise<{ status: number; headers: Headers; body: unknown; text: string; setCookies: string[] }>((resolve, reject) => {
    const headers: Record<string, string> = { Host: 'homekonet.com', 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '203.0.113.9', 'Content-Type': ctype, 'Content-Length': String(Buffer.byteLength(body)) };
    if (p[side].token) headers.Authorization = `Bearer ${p[side].token}`;
    const rq = request({ host: `parity-${side}`, port: 8000, path, method, headers }, (res) => {
      let text = ''; res.on('data', (c) => (text += c));
      res.on('end', () => { let parsed: unknown = text; try { parsed = text ? JSON.parse(text) : null; } catch { /* */ } resolve({ status: res.statusCode ?? 0, headers: new Headers(), body: parsed, text, setCookies: [] }); });
    });
    rq.on('error', reject); rq.end(body);
  });
  const [django, express] = await Promise.all([one('django'), one('express')]);
  return { django, express };
}

describe('listing detail / update / delete', () => {
  it('GET detail', async () => {
    for (const id of [L1, L2, LDRAFT, 5, 15, 999999, 99999999999999999999]) same(await S.anon!.req('GET', `/api/listings/${id}/`));
    same(await S.host!.req('GET', `/api/listings/${L1}/`));
  });
  it('soft-deleted listing visible to owner / superuser only', async () => {
    const deleted = (await dbs.django.query(`SELECT id, owner_id FROM listings_listing WHERE deleted_at IS NOT NULL ORDER BY id LIMIT 1`)).rows[0];
    for (const who of ['anon', 'user', 'superadmin', 'admin']) same(await S[who]!.req('GET', `/api/listings/${deleted.id}/`));
  });
  it('PUT access', async () => {
    same(await S.anon!.req('PUT', `/api/listings/${L1}/`, { json: { title: 'x' } }));
    same(await S.host2!.req('PUT', `/api/listings/${L1}/`, { json: { title: 'x' } }));
    same(await S.admin!.req('PUT', `/api/listings/${L1}/`, { json: { title: 'x' } }));
    same(await S.anon!.req('PUT', '/api/listings/999999/', { json: {} }));
  });
  it('PUT validation + occupancy cap + price change notifies favoriters', async () => {
    same(await S.guest!.req('POST', `/api/listings/${L1}/favorite/`));
    same(await S.user!.req('POST', `/api/listings/${L1}/favorite/`));
    const n0 = await maxId('notifications_notification');
    await both(`UPDATE listings_listing SET occupancy_cap = 5 WHERE id = ${L1}`);
    for (const body of [{ max_guests: 9 }, { price: '1' }, { price: 'x' }, { title: '' }, [1], { amenities: ['a', { b: 1 }] }, { amenities: 'x' }, { property_type: 'nope' }]) {
      same(await S.host!.req('PUT', `/api/listings/${L1}/`, { json: body }));
    }
    same(await S.host!.req('PUT', `/api/listings/${L1}/`, { json: { max_guests: 5, price: '55.00', amenities: ['wifi', 'pool'], status: 'published', is_available: true } }));
    same(await S.superadmin!.req('PUT', `/api/listings/${L1}/`, { json: { description: 'Updated by admin', latitude: null, longitude: null } }));
    same(await S.host!.req('PUT', `/api/listings/${L1}/`, { json: { latitude: '6.31', longitude: '-10.7' } }));
    same(await S.host!.req('PUT', `/api/listings/${L1}/`, { form: form({ title: 'Parity Villa', price: '50' }, { main_image: [[PNG, uniq()]] }) }));
    await sameRows('listings_listing', `id = ${L1}`, { ignore: ['updated_at'] });
    await sameRows('notifications_notification', `id > ${n0}`, { ignore: ['created_at'] });
  });
});

// ---- gallery images ----------------------------------------------------------------------------------------

describe('gallery images', () => {
  it('list / upload / delete', async () => {
    same(await S.anon!.req('GET', `/api/listings/${L1}/images/`));
    same(await S.anon!.req('GET', '/api/listings/999999/images/'));
    same(await S.anon!.req('POST', `/api/listings/${L1}/images/`, { form: form({}, { image: [[PNG, uniq()]] }) }));
    same(await S.host2!.req('POST', `/api/listings/${L1}/images/`, { form: form({}, { image: [[PNG, uniq()]] }) }));
    same(await S.superadmin!.req('POST', `/api/listings/${L1}/images/`, { form: form({}, { image: [[PNG, uniq()]] }) }));
    same(await S.host!.req('POST', `/api/listings/${L1}/images/`, { form: form({ caption: 'x' }) }));
    same(await S.host!.req('POST', `/api/listings/${L1}/images/`, { json: { caption: 'x' } }));
    same(await S.host!.req('POST', `/api/listings/${L1}/images/`, { form: form({}, { image: [[Buffer.from('nope'), uniq()]] }) }));
    same(await S.host!.req('POST', `/api/listings/${L1}/images/`, { form: form({}, { image: [[PNG, uniq('exe')]] }) }));
    same(await S.host!.req('POST', `/api/listings/${L1}/images/`, { form: form({}, { image: [[Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]), 'parity_big.png']] }) }));
    const before = await maxId('listings_listingimage');
    same(await S.host!.req('POST', `/api/listings/${L1}/images/`, { form: form({ caption: 'Front', order: '7' }, { image: [[PNG, uniq()]] }) }));
    same(await S.host!.req('POST', `/api/listings/${L1}/images/`, { form: form({}, { image: [[PNG, 'parity weird name (1).png']] }) }));
    same(await S.host!.req('POST', `/api/listings/${L1}/images/`, { form: form({ caption: 'c'.repeat(256) }, { image: [[PNG, uniq()]] }) }));
    await sameRows('listings_listingimage', `id > ${before}`);
    same(await S.anon!.req('GET', `/api/listings/${L1}/images/`));
    same(await S.anon!.req('GET', `/api/listings/${L1}/`));
    const img = before + 1;
    same(await S.host!.req('DELETE', `/api/listings/${L2}/images/${img}/`));
    same(await S.anon!.req('DELETE', `/api/listings/${L1}/images/${img}/`));
    same(await S.host2!.req('DELETE', `/api/listings/${L1}/images/${img}/`));
    same(await S.host!.req('DELETE', `/api/listings/${L1}/images/${img + 1}/`));
    await sameRows('listings_listingimage', `listing_id = ${L1}`);
    same(await S.host!.req('GET', `/api/listings/${L1}/images/`));
  });
});

// ---- favorites --------------------------------------------------------------------------------------------------

describe('favorites', () => {
  it('add / list / remove', async () => {
    same(await S.anon!.req('GET', '/api/listings/favorites/'));
    same(await S.anon!.req('POST', `/api/listings/${L2}/favorite/`));
    same(await S.guest!.req('POST', '/api/listings/999999/favorite/'));
    same(await S.guest!.req('POST', `/api/listings/${L2}/favorite/`));
    same(await S.guest!.req('POST', `/api/listings/${L2}/favorite/`));
    same(await S.guest!.req('GET', '/api/listings/favorites/'));
    same(await S.guest!.req('DELETE', `/api/listings/${L2}/favorite/`));
    same(await S.guest!.req('DELETE', `/api/listings/${L2}/favorite/`));
    same(await S.guest!.req('GET', '/api/listings/favorite/'));
    await sameRows('listings_favorite', `user_id = ${GUEST}`, { ignore: ['created_at'] });
  });
});

// ---- reviews ------------------------------------------------------------------------------------------------------

let R1 = 0;
describe('reviews', () => {
  beforeAll(async () => {
    await insertBooking(920001, L1, GUEST, 'completed', '2026-05-01', '2026-05-04');
    await insertBooking(920002, L2, GUEST, 'confirmed', '2026-04-01', '2026-04-03');
    await insertBooking(920003, L1, acct.user!.id, 'confirmed', '2030-01-01', '2030-01-05');
  });
  it('create: access, stays, validation', async () => {
    same(await S.anon!.req('POST', '/api/listings/reviews/create/', { json: { listing: L1 } }));
    same(await S.guest!.req('POST', '/api/listings/reviews/create/', { json: {} }));
    same(await S.guest!.req('POST', '/api/listings/reviews/create/', { json: { listing: 999999 } }));
    same(await S.user!.req('POST', '/api/listings/reviews/create/', { json: { listing: L1, rating: 5 } }));
    for (const body of [{ listing: L1 }, { listing: L1, rating: 6 }, { listing: L1, rating: '5', cleanliness: 'x' }, { listing: String(L1), rating: 4, title: 't'.repeat(101) }]) {
      same(await S.guest!.req('POST', '/api/listings/reviews/create/', { json: body }));
    }
    const r = await S.anon!.req('POST', '/api/listings/reviews/create/', { json: { listing: 'abc' } });
    expect(r.express.status).toBe(r.django.status);
  });
  it('create with images (multipart) and duplicate', async () => {
    const before = await maxId('listings_review');
    const r = await S.guest!.req('POST', '/api/listings/reviews/create/', {
      form: form({ listing: String(L1), rating: '4', content: 'Great stay', cleanliness: '5', value: '' }, { images: [[PNG, uniq()], [PNG, uniq()]] }),
    });
    same(r);
    R1 = (r.django.body as { id: number }).id;
    same(await S.guest!.req('POST', '/api/listings/reviews/create/', { json: { listing: L1, rating: 3 } }));
    same(await S.guest!.req('POST', '/api/listings/reviews/create/', { json: { listing: L2, rating: 2, title: 'meh' } }));
    await sameRows('listings_review', `id > ${before}`);
    await sameRows('listings_reviewimage', `review_id > ${before}`);
  });
  it('lists', async () => {
    for (const q of ['', '?ordering=rating', '?ordering=-rating', '?ordering=bogus', '?min_rating=4', '?min_rating=x', `?listing_id=${L1}`, '?page=2', '?page_size=1&page=2', '?min_rating=99999999999']) {
      same(await S.anon!.req('GET', `/api/listings/reviews/${q}`));
    }
    const bad = await S.anon!.req('GET', '/api/listings/reviews/?listing_id=abc');
    expect(bad.express.status).toBe(bad.django.status);
    same(await S.anon!.req('GET', `/api/listings/${L1}/reviews/`));
    same(await S.anon!.req('GET', '/api/listings/999999/reviews/'));
    same(await S.anon!.req('GET', `/api/listings/users/${GUEST}/reviews/`));
    same(await S.anon!.req('GET', '/api/listings/users/999999/reviews/'));
    same(await S.anon!.req('GET', `/api/listings/${L1}/`));
    same(await S.anon!.req('GET', '/api/listings/?ordering=-price&page_size=50'));
  });
  it('detail / update / respond / delete', async () => {
    same(await S.anon!.req('GET', `/api/listings/reviews/${R1}/`));
    same(await S.user!.req('GET', `/api/listings/reviews/${R1}/`));
    same(await S.user!.req('GET', '/api/listings/reviews/999999/'));
    same(await S.user!.req('PUT', `/api/listings/reviews/${R1}/`, { json: { rating: 1 } }));
    for (const body of [{ rating: 9 }, { content: '' }, { listing: 999999 }, { rating: 2, title: 'Edited', content: 'Changed' }]) {
      same(await S.guest!.req('PUT', `/api/listings/reviews/${R1}/`, { json: body }));
    }
    await sameRows('listings_review', `id = ${R1}`, { ignore: ['updated_at'] });
    same(await S.host2!.req('POST', `/api/listings/reviews/${R1}/respond/`, { json: { response: 'hi' } }));
    same(await S.host!.req('POST', `/api/listings/reviews/${R1}/respond/`, { json: { response: '   ' } }));
    same(await S.host!.req('POST', `/api/listings/reviews/${R1}/respond/`, { json: {} }));
    same(await S.host!.req('POST', `/api/listings/reviews/${R1}/respond/`, { json: { response: '  Thanks!  ' } }));
    const bad = await S.host!.req('POST', `/api/listings/reviews/${R1}/respond/`, { json: { response: 5 } });
    expect(bad.express.status).toBe(bad.django.status);
    await sameRows('listings_review', `id = ${R1}`, { ignore: ['updated_at', 'host_response_at'] });
    const other = (await dbs.django.query(`SELECT id FROM listings_review WHERE listing_id = ${L2}`)).rows[0].id;
    same(await S.user!.req('DELETE', `/api/listings/reviews/${other}/`));
    same(await S.superadmin!.req('DELETE', `/api/listings/reviews/${other}/`));
    await sameRows('listings_review', `reviewer_id = ${GUEST}`, { ignore: ['updated_at', 'host_response_at'] });
    same(await S.anon!.req('GET', '/api/listings/analytics/platform-stats/'));
  });
});

// ---- stats / analytics / nearby / availability / pricing ------------------------------------------------------------

describe('stats & analytics', () => {
  it('listing stats', async () => {
    await both(`INSERT INTO listings_propertystats (id, listing_id, date, views, unique_views, favorites, bookings, revenue) VALUES
      (920001, ${L1}, current_date - 1, 5, 3, 1, 1, 100.00), (920002, ${L1}, current_date - 40, 2, 2, 0, 0, 0)`);
    await sleep(500); // view-tracking rows from earlier detail GETs
    same(await S.anon!.req('GET', `/api/listings/${L1}/stats/`));
    same(await S.host2!.req('GET', `/api/listings/${L1}/stats/`));
    same(await S.anon!.req('GET', '/api/listings/999999/stats/'));
    for (const q of ['', '?days=7', '?days=1000', '?days=-3', '?days=abc', '?days=%207%20', '?days=60']) {
      same(await S.host!.req('GET', `/api/listings/${L1}/stats/${q}`));
    }
    same(await S.superadmin!.req('GET', `/api/listings/${L1}/stats/`));
    same(await S.superadmin!.req('GET', '/api/listings/5/stats/'));
    const huge = await S.host!.req('GET', `/api/listings/${L1}/stats/?days=-99999999`);
    expect(huge.express.status).toBe(huge.django.status);
  });
  it('agent analytics', async () => {
    same(await S.anon!.req('GET', '/api/listings/analytics/agent/'));
    same(await S.user!.req('GET', '/api/listings/analytics/agent/'));
    for (const q of ['', '?days=10', '?days=x']) same(await S.host!.req('GET', `/api/listings/analytics/agent/${q}`));
    same(await S.superadmin!.req('GET', '/api/listings/analytics/agent/'));
    same(await S.admin!.req('GET', '/api/listings/analytics/agent/'));
  });
  it('popular / platform stats', async () => {
    for (const q of ['', '?days=30', '?days=3650', '?days=0']) same(await S.anon!.req('GET', `/api/listings/analytics/popular/${q}`));
    const bad = await S.anon!.req('GET', '/api/listings/analytics/popular/?days=x');
    expect(bad.express.status).toBe(bad.django.status);
    same(await S.anon!.req('GET', '/api/listings/analytics/platform-stats/'));
  });
  it('nearby', async () => {
    for (const q of ['', '?lat=6.3', '?lat=6.3&lng=-10.7', '?lat=6.3&lng=-10.7&radius=1', '?lat=6.3&lng=-10.7&radius=abc', '?lat=6.3&lng=-10.7&radius=nan',
      '?lat=nan&lng=1', '?lat=x&lng=1', '?lat=%206.31%20&lng=-10.7&radius=5000', '?lat=0&lng=0&radius=200', '?lat=-nan&lng=1']) {
      same(await S.anon!.req('GET', `/api/listings/nearby/${q}`));
    }
  });
  it('availability', async () => {
    await insertBooking(920010, L1, acct.user!.id, 'pending_host', '2031-03-01', '2031-03-04');
    await insertBooking(920011, L1, acct.user!.id, 'declined', '2031-04-01', '2031-04-04');
    same(await S.anon!.req('GET', `/api/listings/${L1}/availability/`));
    same(await S.anon!.req('GET', '/api/listings/999999/availability/'));
    same(await S.anon!.req('GET', '/api/listings/15/availability/'));
    same(await S.anon!.req('GET', '/api/listings/15/availability/?room_id=6'));
    same(await S.anon!.req('GET', '/api/listings/15/availability/?room_id=999999'));
    same(await S.anon!.req('GET', '/api/listings/11/availability/?room_id=1'));
    const bad = await S.anon!.req('GET', '/api/listings/15/availability/?room_id=abc');
    expect(bad.express.status).toBe(bad.django.status);
  });
  it('pricing', async () => {
    for (const q of ['', '?start_date=2026-11-01', '?start_date=2026-11-01&end_date=2026-11-01', '?start_date=x&end_date=y', '?start_date=2026-11-01&end_date=2026-11-08',
      '?start_date=2026-11-01&end_date=2026-12-15', '?start_date=2026-11-06&end_date=2026-11-09', '?start_date=20261101&end_date=2026-11-03',
      `?start_date=${new Date(Date.now() + 86400000).toISOString().slice(0, 10)}&end_date=2099-01-03`]) {
      same(await S.anon!.req('GET', `/api/listings/${L1}/pricing/${q}`));
    }
    same(await S.anon!.req('GET', `/api/listings/${L2}/pricing/?start_date=2026-11-01&end_date=2027-05-01`));
    same(await S.anon!.req('GET', '/api/listings/15/pricing/?start_date=2026-11-01&end_date=2026-11-05&room_id=6'));
    same(await S.anon!.req('GET', '/api/listings/15/pricing/?start_date=2026-11-01&end_date=2026-11-05&room_id=99999'));
    same(await S.anon!.req('GET', '/api/listings/999999/pricing/'));
  });
});

// ---- hotel rooms -----------------------------------------------------------------------------------------------------

let ROOM = 0;
describe('hotel rooms', () => {
  it('list / create / update / delete', async () => {
    same(await S.anon!.req('GET', '/api/listings/15/rooms/'));
    same(await S.anon!.req('GET', `/api/listings/${L1}/rooms/`));
    same(await S.anon!.req('POST', `/api/listings/${L1}/rooms/`, { json: {} }));
    same(await S.host2!.req('POST', `/api/listings/${L1}/rooms/`, { json: {} }));
    for (const body of [{}, { name: 'Std' }, { name: 'Std', price_per_night: 'x', room_type: 'castle', beds: -1 }, { name: 'Std', price_per_night: '20', listing: 1 }]) {
      const r = await S.host!.req('POST', `/api/listings/${L1}/rooms/`, { json: body });
      same(r);
      if (r.django.status === 201) ROOM = (r.django.body as { id: number }).id;
    }
    same(await S.host!.req('POST', `/api/listings/${L1}/rooms/`, { form: form({ name: 'Deluxe', price_per_night: '35.5', room_type: 'deluxe', amenities: '["tv"]', total_count: '2' }) }));
    same(await S.host!.req('POST', `/api/listings/${L1}/rooms/`, { json: { name: 'Hidden', price_per_night: '10', is_active: false, amenities: ['a'] } }));
    const bad = await S.host!.req('POST', `/api/listings/${L1}/rooms/`, { json: [1] });
    expect(bad.express.status).toBe(bad.django.status);
    await sameRows('listings_hotelroom', `listing_id = ${L1}`);
    same(await S.anon!.req('GET', `/api/listings/${L1}/rooms/`));
    same(await S.host!.req('GET', `/api/listings/${L1}/rooms/`));
    same(await S.anon!.req('GET', `/api/listings/${L1}/rooms/${ROOM}/`));
    same(await S.anon!.req('GET', `/api/listings/${L2}/rooms/${ROOM}/`));
    same(await S.anon!.req('PUT', `/api/listings/${L1}/rooms/${ROOM}/`, { json: { name: 'x' } }));
    for (const body of [{ name: '' }, { price_per_night: '-1.999' }, { name: 'Standard Plus', total_count: 3, amenities: { a: 1 } }]) {
      same(await S.host!.req('PUT', `/api/listings/${L1}/rooms/${ROOM}/`, { json: body }));
    }
    same(await S.superadmin!.req('PUT', `/api/listings/${L1}/rooms/${ROOM}/`, { form: form({ description: 'via form' }) }));
    await sameRows('listings_hotelroom', `listing_id = ${L1}`);
    same(await S.anon!.req('GET', `/api/listings/${L1}/`));
  });
  it('room images + availability', async () => {
    same(await S.anon!.req('GET', `/api/listings/${L1}/rooms/${ROOM}/images/`));
    same(await S.host2!.req('POST', `/api/listings/${L1}/rooms/${ROOM}/images/`, { form: form({}, { image: [[PNG, uniq()]] }) }));
    same(await S.host!.req('POST', `/api/listings/${L1}/rooms/${ROOM}/images/`, { json: {} }));
    same(await S.host!.req('POST', `/api/listings/${L1}/rooms/${ROOM}/images/`, { form: form({}) }));
    const before = await maxId('listings_hotelroomimage');
    same(await S.host!.req('POST', `/api/listings/${L1}/rooms/${ROOM}/images/`, { form: form({ caption: 'bed' }, { image: [[PNG, uniq()]] }) }));
    same(await S.host!.req('POST', `/api/listings/${L1}/rooms/${ROOM}/images/`, { form: form({}, { image: [[PNG, uniq()]] }) }));
    await sameRows('listings_hotelroomimage', `id > ${before}`);
    same(await S.anon!.req('GET', `/api/listings/${L1}/rooms/${ROOM}/images/`));
    same(await S.anon!.req('GET', `/api/listings/${L1}/rooms/`));
    same(await S.anon!.req('DELETE', `/api/listings/${L1}/rooms/${ROOM}/images/${before + 1}/`));
    same(await S.host!.req('DELETE', `/api/listings/${L1}/rooms/${ROOM}/images/999999/`));
    same(await S.host!.req('DELETE', `/api/listings/${L1}/rooms/${ROOM}/images/${before + 1}/`));
    await sameRows('listings_hotelroomimage', `room_id = ${ROOM}`);
    await insertBooking(920020, L1, acct.user!.id, 'confirmed', '2031-05-01', '2031-05-05', ROOM);
    for (const q of ['', '?start_date=2031-05-02&end_date=2031-05-03', '?start_date=x&end_date=y', '?start_date=2031-06-01&end_date=2031-06-02']) {
      same(await S.anon!.req('GET', `/api/listings/${L1}/rooms/availability/${q}`));
    }
    same(await S.anon!.req('GET', `/api/listings/${L1}/availability/?room_id=${ROOM}`));
    same(await S.anon!.req('GET', `/api/listings/${L1}/pricing/?start_date=2031-05-01&end_date=2031-05-04&room_id=${ROOM}`));
  });
  it('delete room (bookings keep a null room)', async () => {
    same(await S.host2!.req('DELETE', `/api/listings/${L1}/rooms/${ROOM}/`));
    same(await S.host!.req('DELETE', `/api/listings/${L1}/rooms/${ROOM}/`));
    same(await S.host!.req('DELETE', `/api/listings/${L1}/rooms/${ROOM}/`));
    await sameRows('listings_hotelroom', `listing_id = ${L1}`);
    await sameRows('bookings_booking', 'id = 920020', { ignore: ['requested_at'] });
  });
});

// ---- host dashboards / admin review / duplicate / bulk / delete -----------------------------------------------------------

describe('dashboards & admin review', () => {
  it('my-drafts / my-listings / pending-review', async () => {
    for (const path of ['my-drafts', 'my-listings']) {
      same(await S.anon!.req('GET', `/api/listings/${path}/`));
      same(await S.host!.req('GET', `/api/listings/${path}/`));
      same(await S.host2!.req('GET', `/api/listings/${path}/`));
    }
    for (const who of ['anon', 'user', 'staff', 'admin', 'content', 'superadmin']) same(await S[who]!.req('GET', '/api/listings/pending-review/'));
  });
  it('approve / reject', async () => {
    const a0 = await maxId('superadmin_adminauditlog');
    const n0 = await maxId('notifications_notification');
    await both(`UPDATE listings_listing SET status = 'pending_review', is_available = false WHERE id = ${L2}`);
    same(await S.anon!.req('POST', `/api/listings/${L2}/approve/`));
    same(await S.staff!.req('POST', `/api/listings/${L2}/approve/`));
    same(await S.content!.req('POST', '/api/listings/999999/approve/'));
    same(await S.content!.req('POST', `/api/listings/${L1}/approve/`));
    // a pending verification blocks non-full admins
    await both(`INSERT INTO propertyverifications_propertyverification (id, listing_id, applicant_id, ownership_type, owner_name, property_location, deed_volume_number,
      page_number, mou_document, inspection_report, status, outcome_stage, review_notes, resubmission_count, ai_rationale, created_at, updated_at)
      VALUES (920001, ${L2}, ${HOST2}, 'owner', 'O', 'L', 'D', 'P', '', '', 'ps_approved', '', 'earlier', 0, '', now(), now())`);
    same(await S.content!.req('POST', `/api/listings/${L2}/approve/`));
    same(await S.content!.req('POST', `/api/listings/${L2}/reject/`, { json: { reason: 'x' } }));
    same(await S.superadmin!.req('POST', `/api/listings/${L2}/approve/`));
    await sameRows('propertyverifications_propertyverification', 'id = 920001', { ignore: ['updated_at'] });
    await sameRows('listings_listing', `id = ${L2}`);
    same(await S.superadmin!.req('POST', `/api/listings/${L2}/approve/`));
    same(await S.content!.req('POST', `/api/listings/${L2}/reject/`, { json: { reason: 'Blurry photos' } }));
    same(await S.content!.req('POST', `/api/listings/${L2}/approve/`));
    await both(`UPDATE propertyverifications_propertyverification SET status = 'submitted' WHERE id = 920001`);
    same(await S.superadmin!.req('POST', `/api/listings/${L2}/reject/`, { json: {} }));
    await sameRows('propertyverifications_propertyverification', 'id = 920001', { ignore: ['updated_at'] });
    same(await S.content!.req('POST', `/api/listings/${LDRAFT}/reject/`, { form: form({ reason: 'form reason' }) }));
    await sameRows('listings_listing', `id IN (${L2}, ${LDRAFT})`);
    await sameRows('superadmin_adminauditlog', `id > ${a0}`, AUDIT_IGNORE);
    await sameRows('notifications_notification', `id > ${n0}`, { ignore: ['created_at'] });
    await both(`UPDATE listings_listing SET status = 'published', is_available = true WHERE id = ${L2}`);
  });
  it('duplicate', async () => {
    const before = await maxId('listings_listing');
    const a0 = await maxId('superadmin_adminauditlog');
    same(await S.anon!.req('POST', `/api/listings/${L1}/duplicate/`));
    same(await S.host2!.req('POST', `/api/listings/${L1}/duplicate/`));
    same(await S.host!.req('POST', '/api/listings/999999/duplicate/'));
    same(await S.host!.req('POST', `/api/listings/${L1}/duplicate/`));
    same(await S.superadmin!.req('POST', '/api/listings/15/duplicate/'));
    await sameRows('listings_listing', `id > ${before}`);
    await sameRows('listings_listingimage', `listing_id > ${before}`);
    await sameRows('listings_hotelroom', `listing_id > ${before}`);
    await sameRows('superadmin_adminauditlog', `id > ${a0}`, AUDIT_IGNORE);
  });
});

async function readXlsx(text: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(text as never);
  return wb.worksheets.map((ws) => ({
    name: ws.name,
    rows: Array.from({ length: ws.rowCount }, (_, i) => (ws.getRow(i + 1).values as unknown[]).slice(1).map((v) => (v === undefined || v === null ? '' : v))),
  }));
}

async function rawGet(p: Pair, path: string) {
  const { request } = await import('node:http');
  const one = (side: 'django' | 'express') => new Promise<{ status: number; ctype: string; disp: string; body: Buffer }>((resolve, reject) => {
    const headers: Record<string, string> = { Host: 'homekonet.com', 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '203.0.113.9' };
    if (p[side].token) headers.Authorization = `Bearer ${p[side].token}`;
    const rq = request({ host: `parity-${side}`, port: 8000, path, method: 'GET', headers }, (res) => {
      const chunks: Buffer[] = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, ctype: String(res.headers['content-type']), disp: String(res.headers['content-disposition']), body: Buffer.concat(chunks) }));
    });
    rq.on('error', reject); rq.end();
  });
  return Promise.all([one('django'), one('express')]);
}

function xlsxBuffer(rows: unknown[][], rooms: unknown[][] = [], sheet = 'Listings'): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet);
  for (const r of rows) ws.addRow(r);
  const rs = wb.addWorksheet('HotelRooms');
  for (const r of rooms) rs.addRow(r);
  return wb.xlsx.writeBuffer().then((b) => Buffer.from(b));
}

describe('bulk xlsx', () => {
  it('template / export', async () => {
    same(await S.anon!.req('GET', '/api/listings/bulk/template/'));
    for (const [who, q] of [['host', ''], ['superadmin', ''], ['superadmin', `?owner_id=${HOST}`], ['host', `?owner_id=4`]] as const) {
      const [d, e] = await rawGet(S[who]!, `/api/listings/bulk/${q ? 'export' : 'template'}/${q}`);
      expect(e.status).toBe(d.status);
      expect(e.ctype).toBe(d.ctype);
      expect(e.disp).toBe(d.disp);
      expect(await readXlsx(e.body)).toEqual(await readXlsx(d.body));
    }
    for (const who of ['host', 'superadmin']) {
      const [d, e] = await rawGet(S[who]!, '/api/listings/bulk/export/');
      expect(e.status).toBe(d.status);
      expect(await readXlsx(e.body)).toEqual(await readXlsx(d.body));
    }
  });
  it('import', async () => {
    const header = ['row_id', 'owner_email', 'title', 'price', 'property_type', 'address', 'city', 'amenities', 'self_checkin', 'bedrooms', 'latitude', 'privacy_type'];
    const rooms = [['row_id', 'name', 'price_per_night', 'room_type', 'amenities', 'total_count'], [1, 'Bulk Std', 25, 'standard', 'wifi, tv', 2], [1, 'Bad room', 'x'], [9, 'Orphan', 10]];
    const rows = [header,
      [1, '', 'Bulk One', 40, 'Hotels', '9 Bulk St', 'Monrovia', 'wifi, kitchen,', 'yes', 2.7, '6.4', 'entire_place'],
      [2, '', 'Bulk Two', 1, 'apartment', '', '', '', 'no', 'abc', '', ''],
      [3, `parity_${HOST2}@example.com`, 'Other owner', 40, 'apartment', 'x', '', '', '', '', '', ''],
      [], [5, '', '', 30, 'castle', 'y', '', '', 'TRUE', 1, 1000, 'bogus'],
    ];
    const good = await xlsxBuffer(rows, rooms);
    const a0 = await maxId('superadmin_adminauditlog');
    const before = await maxId('listings_listing');
    same(await S.anon!.req('POST', '/api/listings/bulk/import/', { form: form({}) }));
    same(await S.host!.req('POST', '/api/listings/bulk/import/', { form: form({}) }));
    same(await S.host!.req('POST', '/api/listings/bulk/import/', { json: {} }));
    same(await S.host!.req('POST', '/api/listings/bulk/import/', { form: form({}, { file: [[good, 'listings.csv']] }) }));
    same(await S.host!.req('POST', '/api/listings/bulk/import/', { form: form({}, { file: [[Buffer.alloc(5 * 1024 * 1024 + 1), 'big.xlsx']] }) }));
    same(await S.host!.req('POST', '/api/listings/bulk/import/', { form: form({}, { file: [[Buffer.from('not a zip'), 'x.xlsx']] }) }));
    same(await S.host!.req('POST', '/api/listings/bulk/import/', { form: form({}, { file: [[await xlsxBuffer(rows, [], 'Other'), 'x.xlsx']] }) }));
    same(await S.host!.req('POST', '/api/listings/bulk/import/', { form: form({}, { file: [[good, 'Listings.XLSX']] }) }));
    same(await S.superadmin!.req('POST', '/api/listings/bulk/import/', { form: form({}, { file: [[good, 'x.xlsx']] }) }));
    same(await S.superadmin!.req('POST', '/api/listings/bulk/import/', { form: form({}, { file: [[await xlsxBuffer([header, [1, 'nobody@example.com', 'X', 40, 'apartment', 'a']]), 'x.xlsx']] }) }));
    await sameRows('listings_listing', `id > ${before}`);
    await sameRows('listings_hotelroom', `listing_id > ${before}`);
    await sameRows('superadmin_adminauditlog', `id > ${a0}`, AUDIT_IGNORE);
  });
});

describe('delete listing', () => {
  it('soft vs hard delete with cascades', async () => {
    const victim = (await dbs.django.query(`SELECT max(id) m FROM listings_listing WHERE owner_id = ${HOST}`)).rows[0].m;
    same(await S.anon!.req('DELETE', `/api/listings/${victim}/`));
    same(await S.host2!.req('DELETE', `/api/listings/${victim}/`));
    same(await S.host!.req('DELETE', `/api/listings/${victim}/`));
    await sameRows('listings_listing', `id = ${victim}`);
    same(await S.host!.req('DELETE', `/api/listings/${victim}/`));
    // L1 has a completed booking → soft delete
    same(await S.host!.req('DELETE', `/api/listings/${L1}/`));
    await sameRows('listings_listing', `id = ${L1}`, { ignore: ['deleted_at'] });
    same(await S.host!.req('GET', `/api/listings/${L1}/`));
    same(await S.guest!.req('GET', `/api/listings/${L1}/`));
    // LDRAFT: hard delete incl. favorites/images
    await both(`INSERT INTO listings_favorite (id, user_id, listing_id, created_at) VALUES (920001, ${GUEST}, ${LDRAFT}, now())`);
    same(await S.superadmin!.req('DELETE', `/api/listings/${LDRAFT}/`));
    await sameRows('listings_favorite', `id = 920001`);
    await sameRows('listings_listing', `id = ${LDRAFT}`);
    same(await S.anon!.req('GET', '/api/listings/?page_size=100'));
    same(await S.host!.req('GET', '/api/listings/my-listings/'));
  });
  it('wrong methods → 405', async () => {
    for (const [m, path] of [['POST', '/api/listings/categories/'], ['DELETE', '/api/listings/settings/'], ['PATCH', `/api/listings/${L2}/`],
      ['GET', `/api/listings/${L2}/approve/`], ['GET', '/api/listings/reviews/create/'], ['PATCH', `/api/listings/${L2}/rooms/`], ['GET', '/api/listings/bulk/import/']] as const) {
      same(await S.host!.req(m, path, { json: {} }));
    }
  });
});
