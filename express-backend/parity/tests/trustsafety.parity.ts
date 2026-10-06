// trustsafety — /api/trust-safety/ parity: access matrix (department role / custom RBAC role / staff / non-staff),
// detectors (rapid signups, shared cards), manual flags, reviews, fingerprint bans, blacklisted locations,
// audit-log rows and the AI-scoring tasks queued on the ai_scoring queue.
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
const TS = 930001; // is_staff + trust_safety preset role
const BANS = 930002; // is_staff + custom role (trust_safety.bans)
const STAFF = 930003; // is_staff, no role
const NONSTAFF_TS = 930004; // not staff but holds the trust_safety role → still refused
const SIGNUPS = [930010, 930011, 930012, 930013];

beforeAll(async () => {
  acct = await accounts();
  await cloneUser(TS, acct.user!.id, { is_staff: 'true' });
  await cloneUser(BANS, acct.user!.id, { is_staff: 'true' });
  await cloneUser(STAFF, acct.user!.id, { is_staff: 'true' });
  await cloneUser(NONSTAFF_TS, acct.user!.id);
  for (const id of SIGNUPS) await cloneUser(id, acct.user!.id);
  await both(`INSERT INTO rbac_role (id, name, slug, description, is_preset, created_by_id, created_at, updated_at) VALUES
    (930001, 'Parity Bans', 'parity-bans', '', false, NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`);
  await both(`INSERT INTO rbac_rolepermission (id, role_id, resource, action) VALUES (930001, 930001, 'trust_safety.bans', 'read')`);
  await both(`INSERT INTO rbac_userroleassignment (id, user_id, role_id, granted_by_id, granted_at) VALUES
    (930001, ${TS}, (SELECT id FROM rbac_role WHERE slug='trust_safety'), NULL, '2026-01-01T00:00:00Z'),
    (930002, ${BANS}, 930001, NULL, '2026-01-01T00:00:00Z'),
    (930003, ${NONSTAFF_TS}, (SELECT id FROM rbac_role WHERE slug='trust_safety'), NULL, '2026-01-01T00:00:00Z')`);
  for (const role of ['user', 'admin', 'superadmin'] as const) S[role] = await loginPair(acct[role]!.email);
  S.ts = await loginPair(`parity_${TS}@example.com`);
  S.bans = await loginPair(`parity_${BANS}@example.com`);
  S.staff = await loginPair(`parity_${STAFF}@example.com`);
  S.nonstaff = await loginPair(`parity_${NONSTAFF_TS}@example.com`);
  S.anon = new Pair();
});
beforeEach(flushRedis);

const ROUTES: [string, string][] = [
  ['GET', '/api/trust-safety/fraud-flags/'], ['POST', '/api/trust-safety/fraud-flags/scan/'], ['POST', '/api/trust-safety/fraud-flags/manual/'],
  ['POST', '/api/trust-safety/fraud-flags/999999/review/'], ['GET', '/api/trust-safety/blocked-fingerprints/'], ['POST', '/api/trust-safety/blocked-fingerprints/'],
  ['DELETE', '/api/trust-safety/blocked-fingerprints/999999/'], ['GET', '/api/trust-safety/blacklisted-locations/'], ['POST', '/api/trust-safety/blacklisted-locations/'],
  ['DELETE', '/api/trust-safety/blacklisted-locations/999999/'],
];

describe('access matrix', () => {
  for (const who of ['anon', 'user', 'staff', 'nonstaff', 'admin']) {
    it(`${who} on every route`, async () => {
      for (const [m, path] of ROUTES) same(await S[who]!.req(m, path, { json: {} }), { headers: ['www-authenticate'] });
    });
  }
  it('trust_safety role / bans role / superadmin reach the views', async () => {
    for (const who of ['ts', 'bans', 'superadmin']) {
      same(await S[who]!.req('GET', '/api/trust-safety/fraud-flags/'));
      same(await S[who]!.req('DELETE', '/api/trust-safety/blocked-fingerprints/999999/'));
    }
  });
  it('wrong methods', async () => {
    for (const [m, path] of [['POST', '/api/trust-safety/fraud-flags/'], ['GET', '/api/trust-safety/fraud-flags/scan/'], ['PUT', '/api/trust-safety/blocked-fingerprints/1/']] as const) {
      same(await S.ts!.req(m, path, { json: {} }));
    }
  });
});

describe('fraud flags', () => {
  let flagId = 0;
  it('scan: rapid signups + shared cards, idempotent', async () => {
    for (const id of SIGNUPS) await both(`INSERT INTO trustsafety_accountsignupevent (user_id, ip_address, created_at) VALUES (${id}, '198.18.0.77', now() - interval '5 minutes')`);
    await both(`INSERT INTO payments_savedcard (cardholder_name, last4, card_type, expiry_month, expiry_year, is_default, created_at, user_id) VALUES
      ('A', '4242', 'visa', '12', '2030', false, now(), ${SIGNUPS[0]}), ('B', '4242', 'visa', '12', '2030', true, now(), ${SIGNUPS[1]}),
      ('C', '4242', 'visa', '12', '2030', false, now(), ${SIGNUPS[1]})`);
    const f0 = await maxId('trustsafety_fraudflag');
    const a0 = await maxId('superadmin_adminauditlog');
    same(await S.ts!.req('POST', '/api/trust-safety/fraud-flags/scan/'));
    same(await S.ts!.req('POST', '/api/trust-safety/fraud-flags/scan/'));
    await sameRows('trustsafety_fraudflag', `id > ${f0}`, { ignore: ['created_at'] });
    await sameRows('superadmin_adminauditlog', `id > ${a0}`, AUDIT_IGNORE);
    const q = await aiQueue();
    expect(q.django.length).toBeGreaterThan(0);
    expect(q.express).toEqual(q.django);
  });
  it('manual flag: validation + success', async () => {
    for (const body of [{}, { user: acct.user!.id }, { details: 'x' }, { user: 0, details: 'x' }, { user: 999999, details: 'x' }, { user: acct.user!.id, details: '   ' }]) {
      same(await S.ts!.req('POST', '/api/trust-safety/fraud-flags/manual/', { json: body }));
    }
    const bad = await S.ts!.req('POST', '/api/trust-safety/fraud-flags/manual/', { json: { user: 'abc', details: 'x' } });
    expect(bad.express.status).toBe(bad.django.status);
    const f0 = await maxId('trustsafety_fraudflag');
    const a0 = await maxId('superadmin_adminauditlog');
    const r = await S.ts!.req('POST', '/api/trust-safety/fraud-flags/manual/', { json: { user: acct.user!.id, details: '  Suspicious  ', severity: 'high' } });
    same(r);
    flagId = (r.django.body as { id: number }).id;
    same(await S.superadmin!.req('POST', '/api/trust-safety/fraud-flags/manual/', { json: { user: String(acct.admin!.id), details: 'other' } }));
    same(await S.ts!.req('POST', '/api/trust-safety/fraud-flags/manual/', { form: form({ user: String(acct.user!.id), details: 'form', severity: 'low' }) }));
    await sameRows('trustsafety_fraudflag', `id > ${f0}`, { ignore: ['created_at'] });
    await sameRows('superadmin_adminauditlog', `id > ${a0}`, AUDIT_IGNORE);
    const q = await aiQueue();
    expect(q.express).toEqual(q.django);
  });
  it('list filters', async () => {
    for (const qs of ['', '?status=open', '?status=all', '?status=', '?status=dismissed', '?status=bogus']) same(await S.ts!.req('GET', `/api/trust-safety/fraud-flags/${qs}`));
  });
  it('review', async () => {
    const a0 = await maxId('superadmin_adminauditlog');
    same(await S.ts!.req('POST', '/api/trust-safety/fraud-flags/999999/review/', { json: { status: 'dismissed' } }));
    for (const body of [{}, { status: 'open' }, { status: ['dismissed'] }]) same(await S.ts!.req('POST', `/api/trust-safety/fraud-flags/${flagId}/review/`, { json: body }));
    same(await S.ts!.req('POST', `/api/trust-safety/fraud-flags/${flagId}/review/`, { json: { status: 'confirmed', notes: 'Verified fraud' } }));
    same(await S.bans!.req('POST', `/api/trust-safety/fraud-flags/${flagId}/review/`, { json: { status: 'dismissed' } }));
    await sameRows('trustsafety_fraudflag', `id = ${flagId}`, { ignore: ['reviewed_at'] });
    await sameRows('superadmin_adminauditlog', `id > ${a0}`, AUDIT_IGNORE);
    same(await S.ts!.req('GET', '/api/trust-safety/fraud-flags/?status=all'));
  });
});

describe('blocked fingerprints', () => {
  it('create / list / delete', async () => {
    const a0 = await maxId('superadmin_adminauditlog');
    const b0 = await maxId('trustsafety_blockedfingerprint');
    for (const body of [{}, { fingerprint: '' }, { fingerprint: 'f'.repeat(129) }, { fingerprint: null }, [1]]) {
      same(await S.ts!.req('POST', '/api/trust-safety/blocked-fingerprints/', { json: body }));
    }
    same(await S.ts!.req('POST', '/api/trust-safety/blocked-fingerprints/', { json: { fingerprint: '  parity-fp-abcdefghijklmnop  ', reason: 'bot farm' } }));
    same(await S.ts!.req('POST', '/api/trust-safety/blocked-fingerprints/', { json: { fingerprint: 'parity-fp-abcdefghijklmnop' } }));
    same(await S.bans!.req('POST', '/api/trust-safety/blocked-fingerprints/', { json: { fingerprint: 'short' } }));
    await sameRows('trustsafety_blockedfingerprint', `id > ${b0}`, { ignore: ['created_at'] });
    same(await S.ts!.req('GET', '/api/trust-safety/blocked-fingerprints/'));
    // the block is enforced at registration/login (authapp)
    same(await S.anon!.req('POST', '/api/auth/register/', { json: { email: 'x@example.com' }, headers: { 'X-Device-Fingerprint': 'short' } }));
    same(await S.ts!.req('DELETE', `/api/trust-safety/blocked-fingerprints/${b0 + 1}/`));
    same(await S.ts!.req('DELETE', `/api/trust-safety/blocked-fingerprints/${b0 + 1}/`));
    await sameRows('trustsafety_blockedfingerprint', `id > ${b0}`, { ignore: ['created_at'] });
    await sameRows('superadmin_adminauditlog', `id > ${a0}`, AUDIT_IGNORE);
  });
});

describe('blacklisted locations', () => {
  it('create / list / delete', async () => {
    const a0 = await maxId('superadmin_adminauditlog');
    const l0 = await maxId('trustsafety_blacklistedlocation');
    for (const body of [{}, { name: 'x', latitude: 'abc', longitude: '1' }, { name: 'x', latitude: '1234.5', longitude: '1.1234567' }, { name: 'x', latitude: 1, longitude: 2, radius_km: '1000' }]) {
      same(await S.ts!.req('POST', '/api/trust-safety/blacklisted-locations/', { json: body }));
    }
    same(await S.ts!.req('POST', '/api/trust-safety/blacklisted-locations/', { json: { name: 'Party house', latitude: 6.3, longitude: '-10.8', reason: 'noise' } }));
    same(await S.ts!.req('POST', '/api/trust-safety/blacklisted-locations/', { form: form({ name: 'Form zone', latitude: '6.4', longitude: '-10.9', radius_km: '0.5' }) }));
    await sameRows('trustsafety_blacklistedlocation', `id > ${l0}`, { ignore: ['created_at'] });
    same(await S.ts!.req('GET', '/api/trust-safety/blacklisted-locations/'));
    same(await S.ts!.req('DELETE', `/api/trust-safety/blacklisted-locations/${l0 + 1}/`));
    same(await S.ts!.req('DELETE', `/api/trust-safety/blacklisted-locations/${l0 + 1}/`));
    await sameRows('trustsafety_blacklistedlocation', `id > ${l0}`, { ignore: ['created_at'] });
    await sameRows('superadmin_adminauditlog', `id > ${a0}`, AUDIT_IGNORE);
  });
});
