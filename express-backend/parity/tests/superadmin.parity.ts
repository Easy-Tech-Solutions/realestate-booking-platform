// superadmin — /api/superadmin/ parity: access matrix for every route and every
// kind of caller (anon / user / plain staff / each department officer / RBAC
// grant holders / admin / superadmin / break-glass), the generic admin CRUD
// framework (list/filter/search/order/paginate/create/update/delete +
// validation for every registered model), the MFA enrollment + step-up login
// flow (TOTP, backup codes, email-code fallback, error paths), the audit log,
// impersonation and staff onboarding / self-service profile records — with
// sameRows on every table written, audit log included.
import { createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { Redis } from 'ioredis';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accounts, cookie, dbs, flushRedis, Pair, PASSWORD, same, sameCookie, sameRows, type Resp, type Side } from '../lib.js';

// --- helpers ---------------------------------------------------------------------------

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
const one = async (side: Side, q: string, params: unknown[] = []) => (await dbs[side].query(q, params)).rows;
const maxId = async (table: string) => Number((await one('django', `SELECT coalesce(max(id), 0) AS m FROM ${table}`))[0].m);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Pairish = { django: Resp; express: Resp };

/** Every audit row written since `since` (break-glass request logging is async middleware — excluded). */
async function sameAudit(since: number) {
  await sleep(150);
  // random username suffixes (username collisions) normalised in target_repr
  const t = `(SELECT *, regexp_replace(target_repr, '-[0-9a-f]{6} ', '-xxxxxx ') AS repr FROM superadmin_adminauditlog) AS a`;
  await sameRows(t, `id > ${since} AND action <> 'break_glass.request'`, { ignore: ['id', 'target_repr'], order: 'created_at, action, target_id' });
}

let acct: Awaited<ReturnType<typeof accounts>>;
const ID = {
  STAFF: 920001, TS: 920002, INV: 920003, SUP: 920004, FIN: 920005, ENG: 920006,
  AUDITOR: 920007, IMPER: 920008, HR: 920009, CAT: 920010, BG: 920011, NONSTAFF: 920012, TARGET: 920013, MKT: 920014,
};
const emailOf = (id: number) => `sa${id}@example.com`;

async function makeUser(id: number, f: Record<string, unknown> = {}) {
  const v = { username: `sa${id}`, email: emailOf(id), first_name: `First${id}`, last_name: `Last${id}`, role: 'user', is_staff: false, is_superuser: false, ...f };
  await both(
    `INSERT INTO users_user (id, password, is_superuser, username, first_name, last_name, email, is_staff, is_active, date_joined, email_verified, role, is_archived)
     VALUES ($1::bigint, (SELECT password FROM users_user WHERE id = $2), $3, $4, $5, $6, $7, $8, true,
       '2026-01-01T00:00:00Z'::timestamptz + ($1::bigint - 920000) * interval '1 minute', true, $9, false)`,
    [id, acct.user!.id, v.is_superuser, v.username, v.first_name, v.last_name, v.email, v.is_staff, v.role]);
  await both(`INSERT INTO users_profile (user_id, image, bio, is_superhost, phone_number) VALUES ($1, '', '', false, '')`, [id]);
}
const assignSlug = (userId: number, slug: string) =>
  both(`INSERT INTO rbac_userroleassignment (user_id, role_id, granted_at) VALUES ($1, (SELECT id FROM rbac_role WHERE slug = $2), '2026-01-01T00:00:00Z')`, [userId, slug]);
async function customRole(id: number, slug: string, grants: [string, string][]) {
  await both(`INSERT INTO rbac_role (id, name, slug, description, is_preset, created_by_id, created_at, updated_at) VALUES ($1, $2, $2, '', false, NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`, [id, slug]);
  for (const [res, act] of grants) await both('INSERT INTO rbac_rolepermission (role_id, resource, action) VALUES ($1, $2, $3)', [id, res, act]);
}

// --- TOTP / hashing helpers (computed from each side's own secret) -------------------------

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function totp(secret: string, offset = 0): string {
  let bits = 0; let value = 0; const bytes: number[] = [];
  for (const ch of secret) { value = (value << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 0xff); bits -= 8; } }
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
  const h = createHmac('sha1', Buffer.from(bytes)).update(msg).digest();
  const o = h[19]! & 0xf;
  return String((((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!) % 1_000_000).padStart(6, '0');
}
/** A Django-format PBKDF2 hash (low iteration count — check_password accepts any count). */
function djangoHash(plain: string): string {
  const salt = randomBytes(12).toString('hex');
  return `pbkdf2_sha256$1000$${salt}$${pbkdf2Sync(plain, salt, 1000, 32, 'sha256').toString('base64')}`;
}
/** pickle.dumps(str, protocol=5) — how Django's RedisCache stores a str value. */
function pickleStr(s: string): Buffer {
  const b = Buffer.from(s, 'utf8');
  const body = b.length < 256 ? Buffer.concat([Buffer.from([0x8c, b.length]), b]) : Buffer.concat([Buffer.from([0x8d]), Buffer.from(new BigUint64Array([BigInt(b.length)]).buffer), b]);
  const frame = Buffer.concat([body, Buffer.from([0x94, 0x2e])]);
  const len = Buffer.alloc(8); len.writeBigUInt64LE(BigInt(frame.length));
  return Buffer.concat([Buffer.from([0x80, 0x05, 0x95]), len, frame]);
}
/** Plants the same MFA email code in both sides' caches (Django: django-redis db 1 ':1:' prefix; Express: db 2). */
async function plantEmailCode(userId: number, code: string) {
  const r1 = new Redis('redis://parity-redis:6379/1'); const r2 = new Redis('redis://parity-redis:6379/2');
  try {
    await r1.set(`:1:mfa_email_code:${userId}`, pickleStr(djangoHash(code)), 'EX', 600);
    await r2.set(`mfa_email_code:${userId}`, djangoHash(code), 'EX', 600);
  } finally { r1.disconnect(); r2.disconnect(); }
}
async function emailCodeKeys(userId: number) {
  const r1 = new Redis('redis://parity-redis:6379/1'); const r2 = new Redis('redis://parity-redis:6379/2');
  try { return { django: await r1.exists(`:1:mfa_email_code:${userId}`), express: await r2.exists(`mfa_email_code:${userId}`) }; } finally { r1.disconnect(); r2.disconnect(); }
}

// --- fixtures ---------------------------------------------------------------------------

const S: Record<string, Pair> = {};
const WHO = ['anon', 'user', 'agent', 'staff', 'ts', 'inv', 'sup', 'fin', 'eng', 'auditor', 'imper', 'hr', 'cat', 'mkt', 'bg', 'nonstaff', 'admin', 'superadmin'];

beforeAll(async () => {
  acct = await accounts();
  await makeUser(ID.STAFF, { is_staff: true });
  for (const [id, slug] of [[ID.TS, 'trust_safety'], [ID.INV, 'inventory'], [ID.SUP, 'support'], [ID.FIN, 'finance'], [ID.ENG, 'engineering']] as const) {
    await makeUser(id, { is_staff: true }); await assignSlug(id, slug);
  }
  await customRole(920101, 'sa-auditor', [['audit_log', 'read']]);
  await customRole(920102, 'sa-imper', [['users.impersonation', 'execute']]);
  await customRole(920103, 'sa-hr', [['users.staff_management', 'read']]);
  await customRole(920104, 'sa-cat', [['listings.categories', 'read'], ['listings.categories', 'create'], ['listings.categories', 'update']]);
  await customRole(920105, 'sa-mkt', [['marketing', 'read'], ['marketing', 'create'], ['marketing', 'update'], ['marketing', 'delete'], ['finances.currencies', 'read']]);
  for (const [id, role] of [[ID.AUDITOR, 920101], [ID.IMPER, 920102], [ID.HR, 920103], [ID.CAT, 920104], [ID.MKT, 920105]] as const) {
    await makeUser(id, { is_staff: true });
    await both(`INSERT INTO rbac_userroleassignment (user_id, role_id, granted_at) VALUES ($1, $2, '2026-01-01T00:00:00Z')`, [id, role]);
  }
  await makeUser(ID.BG, { is_staff: true });
  await both(`INSERT INTO rbac_breakglasssession (user_id, reason, granted_at, expires_at, revoked_at, revoked_by_id) VALUES ($1, 'incident', now(), now() + interval '2 hours', NULL, NULL)`, [ID.BG]);
  // grants everything but is not is_staff → generic admin still denied (is_superadmin_staff gate)
  await makeUser(ID.NONSTAFF);
  await both(`INSERT INTO rbac_userroleassignment (user_id, role_id, granted_at) VALUES ($1, (SELECT id FROM rbac_role WHERE slug = 'admin'), '2026-01-01T00:00:00Z')`, [ID.NONSTAFF]);
  await makeUser(ID.TARGET, { first_name: 'Tara', last_name: 'Get' });

  for (const role of ['user', 'agent', 'admin', 'superadmin'] as const) S[role] = await loginPair(acct[role]!.email);
  const map: [string, number][] = [['staff', ID.STAFF], ['ts', ID.TS], ['inv', ID.INV], ['sup', ID.SUP], ['fin', ID.FIN], ['eng', ID.ENG], ['auditor', ID.AUDITOR],
    ['imper', ID.IMPER], ['hr', ID.HR], ['cat', ID.CAT], ['mkt', ID.MKT], ['bg', ID.BG], ['nonstaff', ID.NONSTAFF]];
  for (const [k, id] of map) S[k] = await loginPair(emailOf(id));
  S.anon = new Pair();
});
beforeEach(flushRedis);

// --- access matrix -------------------------------------------------------------------------

describe('access matrix (every route, every kind of caller)', () => {
  const routes: [string, string, unknown?][] = [
    ['GET', '/api/superadmin/me/'],
    ['GET', '/api/superadmin/audit-log/'],
    ['GET', '/api/superadmin/generic/property_category/'],
    ['POST', '/api/superadmin/generic/property_category/', {}],
    ['GET', '/api/superadmin/generic/currency/'],
    ['POST', '/api/superadmin/generic/currency/', {}],
    ['GET', '/api/superadmin/generic/testimonial/'],
    ['GET', '/api/superadmin/generic/subscriber/'],
    ['GET', '/api/superadmin/generic/nope/'],
    ['GET', '/api/superadmin/generic/currency/1/'],
    ['PATCH', '/api/superadmin/generic/currency/1/', {}],
    ['DELETE', '/api/superadmin/generic/currency/1/'],
    ['GET', '/api/superadmin/generic/property_category/999999/'],
    ['PATCH', '/api/superadmin/generic/property_category/999999/', {}],
    ['DELETE', '/api/superadmin/generic/testimonial/999999/'],
    ['GET', '/api/superadmin/generic/nope/1/'],
    ['POST', '/api/superadmin/mfa/confirm/', {}],
    ['POST', '/api/superadmin/mfa/disable/', {}],
    ['POST', '/api/superadmin/mfa/verify-login/', {}],
    ['POST', '/api/superadmin/mfa/send-email-code/', {}],
    ['POST', '/api/superadmin/impersonate/999999/start/', {}],
    ['POST', '/api/superadmin/impersonate/stop/', {}],
    ['GET', '/api/superadmin/staff/'],
    ['POST', '/api/superadmin/staff/', {}],
    ['GET', '/api/superadmin/staff/999999/'],
    ['PATCH', '/api/superadmin/staff/999999/', {}],
    ['DELETE', '/api/superadmin/staff/999999/'],
    ['GET', '/api/superadmin/staff/me/'],
    ['PATCH', '/api/superadmin/staff/me/', {}],
    ['GET', '/api/superadmin/staff/me/education/'],
    ['POST', '/api/superadmin/staff/me/education/', {}],
    ['PATCH', '/api/superadmin/staff/me/education/999999/', {}],
    ['DELETE', '/api/superadmin/staff/me/education/999999/'],
    ['GET', '/api/superadmin/staff/me/legal/'],
    ['POST', '/api/superadmin/staff/me/legal/', {}],
    ['PATCH', '/api/superadmin/staff/me/legal/999999/', {}],
    ['DELETE', '/api/superadmin/staff/me/legal/999999/'],
  ];
  for (const [method, path, json] of routes) {
    it(`${method} ${path}`, async () => {
      const a0 = await maxId('superadmin_adminauditlog');
      for (const who of WHO) {
        if (path.includes('audit-log')) { await sleep(100); await both("DELETE FROM superadmin_adminauditlog WHERE action = 'break_glass.request'"); }
        const r = await S[who]!.req(method, path, json === undefined ? {} : { json });
        same(r, { headers: ['www-authenticate'] });
      }
      await sameAudit(a0);
    });
  }
  it('mfa/setup: who may enroll (secret/QR differ per side)', async () => {
    const m0 = await maxId('superadmin_mfadevice');
    for (const who of WHO) {
      const r = await S[who]!.req('POST', '/api/superadmin/mfa/setup/');
      same(r, { ignore: ['secret', 'otpauth_url', 'qr_code_base64'], headers: ['www-authenticate'] });
    }
    await sameRows('superadmin_mfadevice', 'true', { ignore: ['secret', 'created_at', 'id'], order: 'user_id' });
    await both(`DELETE FROM superadmin_mfadevice WHERE id > ${m0}`);
  });
  it('wrong methods → 405; bad converters → 404', async () => {
    for (const [m, p] of [['PUT', '/api/superadmin/me/'], ['GET', '/api/superadmin/mfa/setup/'], ['PUT', '/api/superadmin/generic/currency/'],
      ['POST', '/api/superadmin/generic/currency/1/'], ['GET', '/api/superadmin/impersonate/1/start/'], ['GET', '/api/superadmin/staff/me/education/1/'],
      ['PUT', '/api/superadmin/staff/me/legal/'], ['GET', '/api/superadmin/generic/currency/abc/'], ['GET', '/api/superadmin/staff/abc/']] as const) {
      same(await S.superadmin!.req(m, p));
      same(await S.anon!.req(m, p), { headers: ['www-authenticate'] });
    }
  });
});

describe('me', () => {
  it('departments / full-admin / mfa flag for each staff kind', async () => {
    for (const who of ['staff', 'ts', 'inv', 'sup', 'fin', 'eng', 'bg', 'admin', 'superadmin']) {
      const r = await S[who]!.req('GET', '/api/superadmin/me/');
      expect(r.django.status).toBe(200);
      same(r);
    }
  });
});

// --- generic admin ----------------------------------------------------------------------------

describe('generic admin — list', () => {
  it('pagination, page_size, ordering, filters, search on every registered model', async () => {
    const qs = [
      'property_category/', 'property_category/?page_size=5', 'property_category/?page_size=5&page=2', 'property_category/?page_size=5&page=3',
      'property_category/?page_size=5&page=4', 'property_category/?page=0', 'property_category/?page=last&page_size=4', 'property_category/?page=abc',
      'property_category/?page_size=0', 'property_category/?page_size=-1', 'property_category/?page_size=1000', 'property_category/?page_size=x',
      'property_category/?ordering=-name', 'property_category/?ordering=name', 'property_category/?ordering=-id', 'property_category/?ordering=slug',
      'property_category/?ordering=-sort_order&page_size=3', 'property_category/?is_active=true', 'property_category/?is_active=false',
      'property_category/?is_active=1', 'property_category/?is_active=f', 'property_category/?search=ho', 'property_category/?search=%20HO%20',
      'property_category/?search=', 'property_category/?search=a&ordering=-name&page_size=2&page=2', 'property_category/?search=%25', 'property_category/?search=_',
      'currency/', 'currency/?ordering=-exchange_rate_to_usd', 'currency/?ordering=exchange_rate_to_usd', 'currency/?search=us', 'currency/?is_active=false',
      'testimonial/', 'testimonial/?ordering=rating', 'testimonial/?ordering=-rating', 'testimonial/?rating=5', 'testimonial/?rating=4', 'testimonial/?rating=%205',
      'testimonial/?search=a', 'testimonial/?is_active=true&rating=5',
      'subscriber/', 'subscriber/?ordering=email', 'subscriber/?ordering=-email', 'subscriber/?search=EXAMPLE', 'subscriber/?is_active=true',
    ];
    for (const q of qs) same(await S.superadmin!.req('GET', `/api/superadmin/generic/${q}`));
    for (const q of ['property_category/', 'currency/', 'testimonial/?ordering=rating', 'subscriber/']) {
      for (const who of ['inv', 'cat', 'mkt', 'fin', 'admin', 'bg', 'eng']) same(await S[who]!.req('GET', `/api/superadmin/generic/${q}`));
    }
  });
  it('invalid filter values → 500 on both', async () => {
    for (const q of ['property_category/?is_active=yes', 'testimonial/?rating=abc', 'testimonial/?rating=4.0']) {
      const r = await S.superadmin!.req('GET', `/api/superadmin/generic/${q}`);
      expect(r.django.status).toBe(500);
      expect(r.express.status).toBe(500);
    }
  });
  it('detail GET for each model', async () => {
    for (const p of ['property_category/1/', 'property_category/2/', 'currency/1/', 'currency/2/', 'testimonial/999999/', 'subscriber/999999/', 'property_category/99999999999999999999/']) {
      same(await S.superadmin!.req('GET', `/api/superadmin/generic/${p}`));
      same(await S.mkt!.req('GET', `/api/superadmin/generic/${p}`));
    }
    const t = (await one('django', 'SELECT id FROM testimonials_testimonial ORDER BY id LIMIT 1'))[0];
    const s = (await one('django', 'SELECT id FROM newsletter_subscriber ORDER BY id LIMIT 1'))[0];
    if (t) same(await S.mkt!.req('GET', `/api/superadmin/generic/testimonial/${t.id}/`));
    if (s) same(await S.mkt!.req('GET', `/api/superadmin/generic/subscriber/${s.id}/`));
  });
});

describe('generic admin — create / update / delete', () => {
  it('property_category: validation, create, rename guard, update, delete permission, delete', async () => {
    const a0 = await maxId('superadmin_adminauditlog');
    const c0 = await maxId('listings_propertycategory');
    const p = S.cat!;
    const bad: unknown[] = [
      [], 'x', null, {}, { name: '', slug: '' }, { name: '   ', slug: 'ok' }, { name: 'x'.repeat(81), slug: 'y'.repeat(101) },
      { name: 'Apartment', slug: 'apartment' }, { name: 'New', slug: 'bad slug!' }, { name: 'New', slug: 'new', sort_order: -1 },
      { name: 'New', slug: 'new', sort_order: 'abc' }, { name: 'New', slug: 'new', sort_order: 1.5 }, { name: 'New', slug: 'new', sort_order: 2147483648 },
      { name: 'New', slug: 'new', is_active: 'maybe' }, { name: 'New', slug: 'new', is_active: null }, { name: null, slug: 7 },
      { name: true, slug: ['a'] }, { name: 'a\u0000b', slug: 'new' }, { name: 'New', slug: 'new', sort_order: null },
    ];
    for (const json of bad) same(await p.req('POST', '/api/superadmin/generic/property_category/', { json }));
    for (const json of [
      { name: '  Villa  ', slug: ' villa ', reason: 'new type' },
      { name: 'Cabin', slug: 'cabin', is_active: 'false', sort_order: '20', id: 5, listings_count: 99 },
      { name: 'Hut', slug: 'hut', is_active: 0, sort_order: 3.0, reason: 7 },
      { name: 'Chalet', slug: 'chalet', sort_order: ' 4 ', is_active: 'on' },
      { name: 'Tent', slug: 'tent', is_active: 'tRuE', extra: { email: 1 } }, { name: 'Yurt', slug: 'yurt', is_active: 'OFF', sort_order: '1_0' },
    ]) {
      const r = await p.req('POST', '/api/superadmin/generic/property_category/', { json });
      expect(r.django.status, r.django.text).toBe(201);
      same(r);
    }
    await sameRows('listings_propertycategory', `id > ${c0}`, { ignore: ['id'] });
    const ids = (await one('django', `SELECT id FROM listings_propertycategory WHERE id > ${c0} ORDER BY id`)).map((x) => Number(x.id));
    const eids = (await one('express', `SELECT id FROM listings_propertycategory WHERE id > ${c0} ORDER BY id`)).map((x) => Number(x.id));
    expect(eids).toEqual(ids);
    // form-encoded create
    const form = new URLSearchParams({ name: 'Bungalow', slug: 'bungalow' }).toString();
    same(await p.req('POST', '/api/superadmin/generic/property_category/', { raw: form, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }));

    // updates: rename guard on a slug used by listings
    for (const json of [
      { slug: 'apartments' }, { slug: 'apartments', force: 'TRUE', name: 'Apartments', reason: 'rename' }, { slug: 'apartment' }, { name: 'Hotels' },
      { sort_order: -5 }, { is_active: false, extra: 1 }, {}, [], { slug: 'x y' }, { slug: 'apartments', force: 'no' },
    ]) same(await p.req('PATCH', '/api/superadmin/generic/property_category/1/', { json }));
    same(await p.req('PATCH', `/api/superadmin/generic/property_category/${ids[0]}/`, { json: { slug: 'villa-2', name: 'Villa 2', force: true } }));
    same(await p.req('PATCH', `/api/superadmin/generic/property_category/${ids[0]}/`, { json: { slug: 'villa-2' } }));
    await sameRows('listings_propertycategory', 'true', { ignore: ['updated_at', 'created_at'] });
    // delete needs listings.categories delete — cat role lacks it
    same(await p.req('DELETE', `/api/superadmin/generic/property_category/${ids[1]}/`));
    same(await S.admin!.req('DELETE', `/api/superadmin/generic/property_category/${ids[1]}/`, { json: { reason: 'dupe' } }));
    same(await S.admin!.req('DELETE', `/api/superadmin/generic/property_category/${ids[1]}/`));
    same(await S.superadmin!.req('DELETE', `/api/superadmin/generic/property_category/${ids[2]}/`));
    await sameRows('listings_propertycategory', 'true', { ignore: ['updated_at', 'created_at'] });
    same(await S.superadmin!.req('GET', '/api/superadmin/generic/property_category/?page_size=50'));
    await sameAudit(a0);
  });

  it('currency is read-only (create/update/delete → 403 even for superadmin)', async () => {
    const a0 = await maxId('superadmin_adminauditlog');
    for (const who of ['superadmin', 'fin', 'mkt', 'admin']) {
      same(await S[who]!.req('POST', '/api/superadmin/generic/currency/', { json: { code: 'EUR', name: 'Euro', symbol: '€', exchange_rate_to_usd: '0.9' } }));
      same(await S[who]!.req('PATCH', '/api/superadmin/generic/currency/1/', { json: { exchange_rate_to_usd: '200' } }));
      same(await S[who]!.req('PATCH', '/api/superadmin/generic/currency/999999/', { json: {} }));
      same(await S[who]!.req('DELETE', '/api/superadmin/generic/currency/2/'));
    }
    await sameRows('payments_currency');
    await sameAudit(a0);
  });

  it('testimonial: validation, create (avatar colour cycling), update, delete', async () => {
    const a0 = await maxId('superadmin_adminauditlog');
    const t0 = await maxId('testimonials_testimonial');
    const p = S.mkt!;
    for (const json of [{}, { name: 'A' }, { name: 'x'.repeat(101), quote: 'q', location: 'l'.repeat(151), rating: 40000, avatar_color: 'c'.repeat(21) },
      { name: 'A', quote: '', rating: -1 }, { name: 'A', quote: 'Q', rating: '5.5' }, { name: 'A', quote: 'Q', location: null }]) {
      same(await p.req('POST', '/api/superadmin/generic/testimonial/', { json }));
    }
    for (const json of [
      { name: 'Ann Lee', quote: 'Great stay', reason: 'from survey' },
      { name: 'Bo', quote: 'Fine', location: 'Monrovia', rating: 4, is_active: false, avatar_color: 'rose', user: 1, created_at: '2020-01-01T00:00:00Z' },
      { name: 'Cy', quote: 'Ok', rating: '3' },
    ]) {
      const r = await p.req('POST', '/api/superadmin/generic/testimonial/', { json });
      expect(r.django.status, r.django.text).toBe(201);
      same(r);
    }
    await sameRows('testimonials_testimonial', `id > ${t0}`, { ignore: ['id', 'created_at'] });
    const ids = (await one('django', `SELECT id FROM testimonials_testimonial WHERE id > ${t0} ORDER BY id`)).map((x) => Number(x.id));
    same(await p.req('PATCH', `/api/superadmin/generic/testimonial/${ids[0]}/`, { json: { rating: 2, avatar_color: '', quote: 'Changed' } }));
    same(await p.req('PATCH', `/api/superadmin/generic/testimonial/${ids[1]}/`, { json: { name: '', rating: 'x' } }));
    same(await p.req('PATCH', `/api/superadmin/generic/testimonial/${ids[1]}/`, { json: { is_active: 'yes', reason: 'publish' } }));
    await sameRows('testimonials_testimonial', `id > ${t0}`, { ignore: ['id', 'created_at'] });
    same(await p.req('DELETE', `/api/superadmin/generic/testimonial/${ids[2]}/`, { json: { reason: 'spam' } }));
    same(await S.cat!.req('DELETE', `/api/superadmin/generic/testimonial/${ids[1]}/`));
    same(await p.req('GET', '/api/superadmin/generic/testimonial/'));
    await sameRows('testimonials_testimonial', `id > ${t0}`, { ignore: ['id', 'created_at'] });
    await sameAudit(a0);
  });

  it('subscriber: email validation/uniqueness, create, update, delete', async () => {
    const a0 = await maxId('superadmin_adminauditlog');
    const s0 = await maxId('newsletter_subscriber');
    const p = S.mkt!;
    const existing = (await one('django', 'SELECT email FROM newsletter_subscriber ORDER BY id LIMIT 1'))[0]?.email as string | undefined;
    for (const json of [{}, { email: 'nope' }, { email: 'a@b' }, { email: 'a@@b.com' }, { email: `${'x'.repeat(250)}@b.com` }, { email: 'a@b.com', interests: null },
      ...(existing ? [{ email: existing }, { email: existing.toUpperCase() }] : []), { email: 'bad@-x.com' }, { email: 'ok@localhost' }, { email: 5 }, { email: ['a@b.com'] }, { email: 'x@[127.0.0.1]', interests: 'str' }, { email: 'a@b.c' }, { email: 'a@xn--p1ai.com' }]) {
      same(await p.req('POST', '/api/superadmin/generic/subscriber/', { json }), { ignore: ['unsubscribe_token', 'subscribed_at'] });
    }
    for (const json of [{ email: ' New.Sub@Example.com ', interests: ['hotels', 'events'] }, { email: 'two@example.org', is_active: false, interests: { a: 1 } }]) {
      const r = await p.req('POST', '/api/superadmin/generic/subscriber/', { json });
      expect(r.django.status, r.django.text).toBe(201);
      same(r, { ignore: ['unsubscribe_token'] });
      expect((r.express.body as { unsubscribe_token: string }).unsubscribe_token).toMatch(/^[\w-]{64}$/);
    }
    await sameRows('newsletter_subscriber', `id > ${s0}`, { ignore: ['id', 'unsubscribe_token', 'subscribed_at'] });
    const ids = (await one('django', `SELECT id FROM newsletter_subscriber WHERE id > ${s0} ORDER BY id`)).map((x) => Number(x.id));
    same(await p.req('PATCH', `/api/superadmin/generic/subscriber/${ids[0]}/`, { json: { is_active: false, interests: [] } }), { ignore: ['unsubscribe_token'] });
    same(await p.req('PATCH', `/api/superadmin/generic/subscriber/${ids[0]}/`, { json: { email: 'two@example.org' } }));
    same(await p.req('PATCH', `/api/superadmin/generic/subscriber/${ids[0]}/`, { json: { unsubscribe_token: 'x', subscribed_at: 'y' } }), { ignore: ['unsubscribe_token'] });
    await sameRows('newsletter_subscriber', `id > ${s0}`, { ignore: ['id', 'unsubscribe_token', 'subscribed_at'] });
    same(await p.req('DELETE', `/api/superadmin/generic/subscriber/${ids[1]}/`));
    await sameRows('newsletter_subscriber', `id > ${s0}`, { ignore: ['id', 'unsubscribe_token', 'subscribed_at'] });
    await sameAudit(a0);
  });
});

// --- MFA ---------------------------------------------------------------------------------------

async function deviceSecret(side: Side, userId: number) {
  return (await one(side, 'SELECT secret FROM superadmin_mfadevice WHERE user_id = $1', [userId]))[0].secret as string;
}
/** setup + confirm on both sides; returns each side's backup codes. */
async function enroll(p: Pair, userId: number) {
  const s = await p.req('POST', '/api/superadmin/mfa/setup/');
  same(s, { ignore: ['secret', 'otpauth_url', 'qr_code_base64'] });
  for (const side of ['django', 'express'] as const) {
    const b = s[side].body as { secret: string; otpauth_url: string; qr_code_base64: string };
    expect(b.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(b.otpauth_url.replace(b.secret, 'S')).toBe((s.django.body as { otpauth_url: string; secret: string }).otpauth_url.replace((s.django.body as { secret: string }).secret, 'S'));
    expect(Buffer.from(b.qr_code_base64, 'base64').subarray(1, 4).toString()).toBe('PNG');
  }
  const [sd, se] = await Promise.all([deviceSecret('django', userId), deviceSecret('express', userId)]);
  expect(sd).toBe((s.django.body as { secret: string }).secret);
  expect(se).toBe((s.express.body as { secret: string }).secret);
  const [cd, ce] = await Promise.all([
    p.django.req('POST', '/api/superadmin/mfa/confirm/', { json: { code: totp(sd) } }),
    p.express.req('POST', '/api/superadmin/mfa/confirm/', { json: { code: ` ${totp(se, -1)} ` } }),
  ]);
  same({ django: cd, express: ce }, { ignore: ['backup_codes'] });
  expect(ce.status).toBe(200);
  const codes = { django: (cd.body as { backup_codes: string[] }).backup_codes, express: (ce.body as { backup_codes: string[] }).backup_codes };
  expect(codes.express).toHaveLength(8);
  expect(codes.express.every((c) => /^[0-9a-f]{8}$/.test(c))).toBe(true);
  return { codes, secrets: { django: sd, express: se } };
}
/** Password step of the login → each side's own mfa_token. */
async function mfaLogin(email: string) {
  const p = new Pair();
  const r = await p.req('POST', '/api/auth/login/', { json: { email, password: PASSWORD }, headers: { 'X-Forwarded-For': `198.51.100.${++ipCounter}` } });
  same(r, { ignore: ['mfa_token'] });
  expect((r.django.body as { mfa_required: boolean }).mfa_required).toBe(true);
  return { p, tokens: { django: (r.django.body as { mfa_token: string }).mfa_token, express: (r.express.body as { mfa_token: string }).mfa_token } };
}
async function verify(p: Pair, tokens: Record<Side, string>, code: Record<Side, string>, headers: Record<string, string> = {}): Promise<Pairish> {
  const [d, e] = await Promise.all([
    p.django.req('POST', '/api/superadmin/mfa/verify-login/', { json: { mfa_token: tokens.django, code: code.django }, headers }),
    p.express.req('POST', '/api/superadmin/mfa/verify-login/', { json: { mfa_token: tokens.express, code: code.express }, headers }),
  ]);
  return { django: d, express: e };
}

describe('mfa', () => {
  it('enroll (setup/confirm errors, audit) → login step-up with TOTP → disable', async () => {
    const id = 920201; await makeUser(id, { is_staff: true });
    const p = await loginPair(emailOf(id));
    const a0 = await maxId('superadmin_adminauditlog');
    same(await p.req('POST', '/api/superadmin/mfa/confirm/', { json: { code: '123456' } }));
    same(await p.req('POST', '/api/superadmin/mfa/disable/', { json: { code: '123456' } }));
    await p.req('POST', '/api/superadmin/mfa/setup/');
    same(await p.req('POST', '/api/superadmin/mfa/setup/'), { ignore: ['secret', 'otpauth_url', 'qr_code_base64'] }); // re-setup while pending
    for (const code of ['000000', '', '12345', 'abcdef', null]) same(await p.req('POST', '/api/superadmin/mfa/confirm/', { json: { code } }));
    const lst = await p.req('POST', '/api/superadmin/mfa/confirm/', { json: [] });
    expect([lst.django.status, lst.express.status]).toEqual([500, 500]);
    same(await p.req('GET', '/api/superadmin/me/'));
    const { secrets } = await enroll(p, id);
    await sameRows('superadmin_mfadevice', `user_id = ${id}`, { ignore: ['secret', 'created_at', 'id', 'backup_codes', 'confirmed_at'] });
    same(await p.req('GET', '/api/superadmin/me/'));
    same(await p.req('POST', '/api/superadmin/mfa/setup/'));
    same(await p.req('POST', '/api/superadmin/mfa/confirm/', { json: { code: '1' } }));
    same(await p.req('POST', '/api/superadmin/mfa/disable/', { json: { code: 'deadbeef' } }));

    // step-up login with TOTP
    const { p: lp, tokens } = await mfaLogin(emailOf(id));
    const ok = await verify(lp, tokens, { django: totp(secrets.django), express: totp(secrets.express, 1) });
    expect(ok.django.status, ok.django.text).toBe(200);
    same(ok);
    sameCookie(ok, 'refresh_token');
    // the access token works on each side
    lp.django.token = (ok.django.body as { access: string }).access; lp.express.token = (ok.express.body as { access: string }).access;
    same(await lp.req('GET', '/api/superadmin/me/'));
    // the refresh cookie was recorded as an outstanding token
    await sameRows('token_blacklist_outstandingtoken', `user_id = ${id}`, { ignore: ['id', 'jti', 'token', 'created_at', 'expires_at'] });
    // replaying the same (still-valid) TOTP code is accepted again (no replay protection in pyotp.verify)
    same(await verify(lp, tokens, { django: totp(secrets.django), express: totp(secrets.express) }));

    // disable with TOTP
    const [dd, de] = await Promise.all([
      p.django.req('POST', '/api/superadmin/mfa/disable/', { json: { code: totp(secrets.django, -1) } }),
      p.express.req('POST', '/api/superadmin/mfa/disable/', { json: { code: totp(secrets.express) } }),
    ]);
    same({ django: dd, express: de });
    await sameRows('superadmin_mfadevice', `user_id = ${id}`);
    same(await p.req('GET', '/api/superadmin/me/'));
    // device gone → verify-login with the old token
    same(await verify(lp, tokens, { django: '123456', express: '123456' }));
    await sameAudit(a0);
  });

  it('backup codes: login, single use, disable; email-code fallback; error paths', async () => {
    const id = 920202; await makeUser(id, { is_staff: true, role: 'admin' });
    const p = await loginPair(emailOf(id));
    const { codes } = await enroll(p, id);
    const { p: lp, tokens } = await mfaLogin(emailOf(id));
    // error paths
    for (const json of [{}, { mfa_token: tokens.django }, { code: '123456' }, { mfa_token: '', code: '1' }, { mfa_token: 'garbage', code: '123456' },
      { mfa_token: 'abc:def', code: '123456' }, { mfa_token: `${tokens.django}x`, code: '123456' }, { mfa_token: ['x'], code: '1' }]) {
      same(await lp.req('POST', '/api/superadmin/mfa/verify-login/', { json }));
    }
    await flushRedis();
    for (const json of [{ mfa_token: 5, code: '1' }, { mfa_token: { ':': 1 }, code: '1' }, [], { mfa_token: true, code: '1' }]) {
      const r = await lp.req('POST', '/api/superadmin/mfa/verify-login/', { json });
      expect([r.django.status, r.express.status], JSON.stringify(json)).toEqual([500, 500]);
    }
    same(await lp.req('POST', '/api/superadmin/mfa/verify-login/', { json: { mfa_token: { a: 1 }, code: '1' } }));
    await flushRedis();
    same(await verify(lp, tokens, { django: '000000', express: '000000' }));
    same(await verify(lp, tokens, { django: ' ', express: ' ' }));
    // backup code #1 logs in and is consumed
    await flushRedis();
    const b1 = await verify(lp, tokens, { django: codes.django[0]!, express: codes.express[0]! });
    expect(b1.django.status, b1.django.text).toBe(200);
    same(b1);
    const left = async (s: Side) => ((await one(s, 'SELECT backup_codes FROM superadmin_mfadevice WHERE user_id = $1', [id]))[0].backup_codes as string[]).length;
    expect(await left('django')).toBe(7);
    expect(await left('express')).toBe(7);
    same(await verify(lp, tokens, { django: codes.django[0]!, express: codes.express[0]! })); // reused → invalid
    // email-code fallback: same planted code in each side's cache
    await flushRedis();
    await plantEmailCode(id, '424242');
    same(await verify(lp, tokens, { django: '424243', express: '424243' }));
    const e1 = await verify(lp, tokens, { django: '424242', express: '424242' });
    expect(e1.django.status, e1.django.text).toBe(200);
    same(e1);
    expect(await emailCodeKeys(id)).toEqual({ django: 0, express: 0 }); // consumed
    same(await verify(lp, tokens, { django: '424242', express: '424242' }));
    // send-email-code: error paths + success message (masked email)
    await flushRedis();
    for (const json of [{}, { mfa_token: '' }, { mfa_token: 'bad' }]) same(await lp.req('POST', '/api/superadmin/mfa/send-email-code/', { json }));
    await flushRedis();
    const [sd, se] = await Promise.all([
      lp.django.req('POST', '/api/superadmin/mfa/send-email-code/', { json: { mfa_token: tokens.django } }),
      lp.express.req('POST', '/api/superadmin/mfa/send-email-code/', { json: { mfa_token: tokens.express } }),
    ]);
    same({ django: sd, express: se });
    expect(await emailCodeKeys(id)).toEqual({ django: 1, express: 1 });
    // disable with a backup code
    const [dd, de] = await Promise.all([
      p.django.req('POST', '/api/superadmin/mfa/disable/', { json: { code: codes.django[3]! } }),
      p.express.req('POST', '/api/superadmin/mfa/disable/', { json: { code: codes.express[3]! } }),
    ]);
    same({ django: dd, express: de });
    await sameRows('superadmin_mfadevice', `user_id = ${id}`);
    // device gone
    await flushRedis();
    same(await lp.req('POST', '/api/superadmin/mfa/send-email-code/', { json: { mfa_token: 'x' } }));
    const [nd, ne] = await Promise.all([
      lp.django.req('POST', '/api/superadmin/mfa/send-email-code/', { json: { mfa_token: tokens.django } }),
      lp.express.req('POST', '/api/superadmin/mfa/send-email-code/', { json: { mfa_token: tokens.express } }),
    ]);
    same({ django: nd, express: ne });
  });

  it('mfa tokens cross-verify (same signing key), unknown user, no email, throttles', async () => {
    const id = 920203; await makeUser(id, { is_staff: true });
    const p = await loginPair(emailOf(id));
    const { secrets } = await enroll(p, id);
    const { p: lp, tokens } = await mfaLogin(emailOf(id));
    // a token signed by one backend is valid on the other
    const x = await verify(lp, { django: tokens.express, express: tokens.django }, { django: totp(secrets.django), express: totp(secrets.express) });
    expect(x.django.status).toBe(200);
    same(x);
    // unknown user id inside a valid signature: forge via the other side's identical signer is impossible here → use a deleted user
    await both('UPDATE users_user SET email = \'\' WHERE id = $1', [id]);
    await flushRedis();
    same(await lp.req('POST', '/api/superadmin/mfa/send-email-code/', { json: { mfa_token: tokens.django } }));
    // throttles: verify-login 10/hour, send-email-code 3/hour (anon, per client IP)
    await flushRedis();
    for (let i = 0; i < 12; i++) same(await lp.req('POST', '/api/superadmin/mfa/verify-login/', { json: { mfa_token: 'x', code: '1' } }), { headers: ['retry-after'] });
    for (let i = 0; i < 5; i++) same(await lp.req('POST', '/api/superadmin/mfa/send-email-code/', { json: {} }), { headers: ['retry-after'] });
    // authenticated callers aren't throttled by the anon throttle
    for (let i = 0; i < 4; i++) same(await S.user!.req('POST', '/api/superadmin/mfa/send-email-code/', { json: {} }));
  });
});

// --- audit log -------------------------------------------------------------------------------

describe('audit log', () => {
  it('filters + paging', async () => {
    // break-glass request rows carry a measured duration_ms (timing-dependent) — drop them first
    await both("DELETE FROM superadmin_adminauditlog WHERE action = 'break_glass.request'");
    const actor = (await one('django', 'SELECT actor_id FROM superadmin_adminauditlog WHERE actor_id IS NOT NULL ORDER BY id LIMIT 1'))[0]?.actor_id;
    const qs = ['', '?page=2', '?page=0', '?page=-3', '?page=abc', '?page=%202%20', '?page=999', '?action=USER', '?action=mfa', '?action=%25', '?target_type=user',
      '?target_type=listing&page=1', `?actor=${actor ?? 1}`, '?actor=999999', '?date_from=2026-01-01', '?date_to=2026-01-01', '?date_from=2026-09-01T00:00:00Z&date_to=2026-12-31T23:59:59Z',
      '?date_from=2026-09-01%2010:00', '?date_from=2026-09-01T10:00:00%2B02:00', '?action=&target_type=', '?action=impersonation&actor=1'];
    for (const q of qs) {
      for (const who of ['superadmin', 'auditor', 'admin']) same(await S[who]!.req('GET', `/api/superadmin/audit-log/${q}`));
    }
    for (const q of ['?actor=abc', '?date_from=garbage']) {
      const r = await S.superadmin!.req('GET', `/api/superadmin/audit-log/${q}`);
      expect([r.django.status, r.express.status]).toEqual([500, 500]);
    }
  });
});

// --- impersonation ---------------------------------------------------------------------------

describe('impersonation', () => {
  it('start (validation, self, admin target) → token works → stop (authorization, idempotent)', async () => {
    const a0 = await maxId('superadmin_adminauditlog');
    const i0 = await maxId('superadmin_impersonationsession');
    const T = ID.TARGET;
    for (const who of ['imper', 'superadmin']) {
      same(await S[who]!.req('POST', `/api/superadmin/impersonate/${T}/start/`, { json: {} }));
      same(await S[who]!.req('POST', `/api/superadmin/impersonate/${T}/start/`, { json: { reason: '   ' } }));
      same(await S[who]!.req('POST', `/api/superadmin/impersonate/${acct.superadmin!.id}/start/`, { json: { reason: 'x' } }));
      same(await S[who]!.req('POST', '/api/superadmin/impersonate/99999999999999999999/start/', { json: { reason: 'x' } }));
    }
    same(await S.superadmin!.req('POST', `/api/superadmin/impersonate/${acct.superadmin!.id}/start/`, { json: { reason: 'self' } }));
    same(await S.imper!.req('POST', `/api/superadmin/impersonate/${ID.IMPER}/start/`, { json: { reason: 'self' } }));
    same(await S.imper!.req('POST', `/api/superadmin/impersonate/${acct.admin!.id}/start/`, { json: { reason: 'lesser admin is impersonable' } }));
    const r = await S.imper!.req('POST', `/api/superadmin/impersonate/${T}/start/`, { json: { reason: '  investigating ticket 42  ' } });
    expect(r.django.status, r.django.text).toBe(200);
    same(r);
    await sameRows('superadmin_impersonationsession', `id > ${i0}`, { ignore: ['id', 'started_at'] });
    // the impersonation token authenticates as the target (claims: imp_by / imp_session)
    const claims = (s: Side) => JSON.parse(Buffer.from(((r[s].body as { access: string }).access).split('.')[1]!, 'base64url').toString());
    const cd = claims('django'); const ce = claims('express');
    expect(Object.keys(ce).sort()).toEqual(Object.keys(cd).sort());
    expect([ce.user_id, ce.imp_by, ce.token_type, ce.exp - ce.iat]).toEqual([cd.user_id, cd.imp_by, cd.token_type, cd.exp - cd.iat]);
    const imp = new Pair();
    imp.django.token = (r.django.body as { access: string }).access; imp.express.token = (r.express.body as { access: string }).access;
    same(await imp.req('GET', '/api/auth/me/'));
    // stop: unrelated user can't end it; session ids per side
    const sid = { django: (r.django.body as { session_id: number }).session_id, express: (r.express.body as { session_id: number }).session_id };
    expect(sid.express).toBe(sid.django);
    for (const json of [{}, { session_id: null }, { session_id: 999999 }, { session_id: String(sid.django) }]) same(await S.user!.req('POST', '/api/superadmin/impersonate/stop/', { json }));
    const bad = await S.user!.req('POST', '/api/superadmin/impersonate/stop/', { json: { session_id: 'abc' } });
    expect([bad.django.status, bad.express.status]).toEqual([500, 500]);
    await sleep(1100);
    same(await imp.req('POST', '/api/superadmin/impersonate/stop/', { json: { session_id: sid.django } }));
    same(await imp.req('POST', '/api/superadmin/impersonate/stop/', { json: { session_id: sid.django } })); // already ended → no-op
    await sameRows('superadmin_impersonationsession', `id > ${i0}`, { ignore: ['id', 'started_at', 'ended_at'] });
    // a second session ended by a full admin (not the starter)
    const r2 = await S.imper!.req('POST', `/api/superadmin/impersonate/${T}/start/`, { json: { reason: 'again' } });
    same(r2);
    same(await S.superadmin!.req('POST', '/api/superadmin/impersonate/stop/', { json: { session_id: (r2.django.body as { session_id: number }).session_id } }));
    await sameRows('superadmin_impersonationsession', `id > ${i0}`, { ignore: ['id', 'started_at', 'ended_at'] });
    await sleep(150);
    await sameRows('superadmin_adminauditlog', `id > ${a0} AND action <> 'break_glass.request'`, { ignore: ['id', 'metadata'], order: 'created_at, action' });
    // duration_seconds is time-dependent: same keys, close values
    const meta = await both(`SELECT metadata FROM superadmin_adminauditlog WHERE id > ${a0} AND action LIKE 'impersonation.%' ORDER BY created_at`);
    expect(meta.express.map((m) => Object.keys(m.metadata).sort())).toEqual(meta.django.map((m) => Object.keys(m.metadata).sort()));
    meta.django.forEach((m, i) => {
      const e = meta.express[i]!.metadata;
      expect(e.session_id).toBe(m.metadata.session_id);
      if ('duration_seconds' in m.metadata) expect(Math.abs(e.duration_seconds - m.metadata.duration_seconds)).toBeLessThan(2);
    });
  });
});

// --- staff onboarding / management / self-service ---------------------------------------------

describe('staff', () => {
  it('onboard (existing + new account), list, detail, update, offboard', async () => {
    const a0 = await maxId('superadmin_adminauditlog');
    const u0 = await maxId('users_user');
    const p = S.hr!;
    for (const json of [{}, { email: '   ' }, { email: null }]) same(await p.req('POST', '/api/superadmin/staff/', { json }));
    const bad = await p.req('POST', '/api/superadmin/staff/', { json: [] });
    expect([bad.django.status, bad.express.status]).toEqual([500, 500]);
    // link an existing (non-staff) account, case-insensitively
    const r1 = await p.req('POST', '/api/superadmin/staff/', { json: { email: `  ${emailOf(ID.TARGET).toUpperCase()} `, position: ' Analyst ', department: 'finance', hire_date: '2026-02-03', phone_number: ' 0880 ' } });
    expect(r1.django.status, r1.django.text).toBe(201);
    same(r1);
    same(await p.req('POST', '/api/superadmin/staff/', { json: { email: emailOf(ID.TARGET) } })); // already onboarded
    // brand-new account (unusable password, reset email)
    const r2 = await p.req('POST', '/api/superadmin/staff/', { json: { email: 'Fresh.Hire+1@Example.com', first_name: ' Fresh ', last_name: 'Hire', hire_date: '' } });
    expect(r2.django.status, r2.django.text).toBe(201);
    same(r2);
    const r3 = await p.req('POST', '/api/superadmin/staff/', { json: { email: 'fresh.hire+1@example.org', position: null } });
    same(r3, { ignore: ['username', 'full_name'] });
    // username collision → random suffix on both sides (values differ)
    const r4 = await p.req('POST', '/api/superadmin/staff/', { json: { email: 'freshhire1@example.net' } });
    same(r4, { ignore: ['username', 'full_name'] });
    await sameRows('users_user', `id > ${u0}`, { ignore: ['id', 'password', 'date_joined', 'password_reset_token', 'password_reset_token_expires_at', 'username'] });
    await sameRows('users_user', `id = ${ID.TARGET}`);
    for (const s of ['django', 'express'] as const) {
      const rows = await one(s, `SELECT password, password_reset_token FROM users_user WHERE id > ${u0} ORDER BY id`);
      expect(rows.every((x) => String(x.password).startsWith('!') && x.password_reset_token)).toBe(true);
    }
    await sameRows('superadmin_staffprofile', 'true', { ignore: ['id', 'user_id', 'created_at', 'updated_at'], order: 'created_at' });
    // invalid hire_date → 500 on both
    const bh = await p.req('POST', '/api/superadmin/staff/', { json: { email: emailOf(ID.STAFF), hire_date: 'soon' } });
    expect([bh.django.status, bh.express.status]).toEqual([500, 500]);
    same(await p.req('GET', '/api/superadmin/staff/'), { ignore: ['username', 'full_name'] });
    for (const who of ['admin', 'superadmin', 'staff', 'user']) same(await S[who]!.req('GET', '/api/superadmin/staff/'), { ignore: ['username', 'full_name'] });

    const sid = (r1.django.body as { id: number }).id;
    expect((r1.express.body as { id: number }).id).toBe(sid);
    same(await p.req('GET', `/api/superadmin/staff/${sid}/`));
    for (const json of [{ position: '  Lead  ', department: 7, phone_number: null }, { hire_date: '2025-12-01', is_active: 'false' }, { hire_date: '' }, { is_active: 0 }, {}, { bio: 'ignored' }]) {
      same(await p.req('PATCH', `/api/superadmin/staff/${sid}/`, { json }));
      await sameRows('superadmin_staffprofile', `id = ${sid}`, { ignore: ['updated_at', 'created_at'] });
    }
    const bp = await p.req('PATCH', `/api/superadmin/staff/${sid}/`, { json: { hire_date: '2025-13-01' } });
    expect([bp.django.status, bp.express.status]).toEqual([500, 500]);
    same(await p.req('DELETE', `/api/superadmin/staff/${sid}/`));
    same(await p.req('GET', `/api/superadmin/staff/${sid}/`));
    await sameRows('superadmin_staffprofile', `id = ${sid}`, { ignore: ['updated_at', 'created_at'] });
    await sameAudit(a0);
  });

  it('self-service: profile, education and legal records (JSON + multipart)', async () => {
    // onboard STAFF so it has a profile
    const r = await S.superadmin!.req('POST', '/api/superadmin/staff/', { json: { email: emailOf(ID.STAFF), position: 'Ops' } });
    expect(r.django.status, r.django.text).toBe(201);
    const p = S.staff!;
    same(await p.req('GET', '/api/superadmin/staff/me/'));
    for (const json of [{ bio: '  Hello  ', phone_number: 777, position: 'CEO' }, { bio: null }, {}]) same(await p.req('PATCH', '/api/superadmin/staff/me/', { json }));
    const sp = (await one('django', 'SELECT id FROM superadmin_staffprofile WHERE user_id = $1', [ID.STAFF]))[0].id;
    await sameRows('superadmin_staffprofile', `id = ${sp}`, { ignore: ['created_at', 'updated_at'] });

    // education
    const e0 = await maxId('superadmin_staffeducation');
    for (const json of [{}, [], { institution: '' }, { institution: 'U', start_year: -1, end_year: 'x' }, { institution: 'x'.repeat(256), degree: 'd'.repeat(151) },
      { institution: 'U', start_year: 2147483648 }]) same(await p.req('POST', '/api/superadmin/staff/me/education/', { json }));
    for (const json of [{ institution: ' Univ of Liberia ', degree: 'BSc', field_of_study: 'CS', start_year: 2010, end_year: 2014 },
      { institution: 'Night School', start_year: '2015', end_year: null, description: 'evening' }, { institution: 'Bootcamp', end_year: 2020.0 }]) {
      const x = await p.req('POST', '/api/superadmin/staff/me/education/', { json });
      expect(x.django.status, x.django.text).toBe(201);
      same(x);
    }
    const fd = new FormData(); fd.append('institution', 'Form U'); fd.append('start_year', ''); fd.append('degree', '');
    same(await p.req('POST', '/api/superadmin/staff/me/education/', { form: fd }));
    same(await p.req('GET', '/api/superadmin/staff/me/education/'));
    const eid = Number((await one('django', `SELECT id FROM superadmin_staffeducation WHERE id > ${e0} ORDER BY id LIMIT 1`))[0].id);
    for (const json of [{ degree: 'MSc', end_year: 2016 }, { institution: '' }, { start_year: null }]) same(await p.req('PATCH', `/api/superadmin/staff/me/education/${eid}/`, { json }));
    same(await S.hr!.req('PATCH', `/api/superadmin/staff/me/education/${eid}/`, { json: {} })); // someone else's entry
    same(await p.req('DELETE', `/api/superadmin/staff/me/education/${eid + 1}/`));
    same(await p.req('DELETE', `/api/superadmin/staff/me/education/${eid + 1}/`));
    await sameRows('superadmin_staffeducation', `id > ${e0}`, { ignore: ['created_at'] });

    // legal records
    const l0 = await maxId('superadmin_stafflegalrecord');
    for (const json of [{}, { title: '' }, { title: 'ID', record_type: 'passport' }, { title: 'ID', issue_date: '2026-02-30', expiry_date: 'tomorrow' },
      { title: 'ID', document: 'not-a-file' }, { title: 'ID', record_type: '' }, { title: 'ID', document_number: 'n'.repeat(101) }]) {
      same(await p.req('POST', '/api/superadmin/staff/me/legal/', { json }));
    }
    for (const json of [{ title: ' National ID ', record_type: 'national_id', issue_date: '2020-01-02', expiry_date: null, document_number: 'A1' },
      { title: 'Contract', record_type: 'contract', document: null, notes: 'signed' }]) {
      const x = await p.req('POST', '/api/superadmin/staff/me/legal/', { json });
      expect(x.django.status, x.django.text).toBe(201);
      same(x);
    }
    const f1 = new FormData();
    f1.append('title', 'Work permit'); f1.append('record_type', 'work_permit'); f1.append('issue_date', ''); f1.append('expiry_date', '2027-01-01');
    f1.append('document', new Blob([Buffer.from('%PDF-1.4 parity')], { type: 'application/pdf' }), 'permit scan.pdf');
    const x1 = await p.req('POST', '/api/superadmin/staff/me/legal/', { form: f1 });
    expect(x1.django.status, x1.django.text).toBe(201);
    same(x1);
    const f2 = new FormData(); f2.append('title', 'Empty'); f2.append('document', new Blob([]), 'empty.pdf');
    same(await p.req('POST', '/api/superadmin/staff/me/legal/', { form: f2 }));
    const f3 = new FormData(); f3.append('title', 'Long'); f3.append('document', new Blob([Buffer.from('x')]), `${'n'.repeat(101)}.pdf`);
    same(await p.req('POST', '/api/superadmin/staff/me/legal/', { form: f3 }));
    same(await p.req('GET', '/api/superadmin/staff/me/legal/'));
    await sameRows('superadmin_stafflegalrecord', `id > ${l0}`, { ignore: ['created_at'] });
    const lid = Number((await one('django', `SELECT id FROM superadmin_stafflegalrecord WHERE id > ${l0} ORDER BY id LIMIT 1`))[0].id);
    for (const json of [{ notes: 'renewed', expiry_date: '2030-05-05' }, { record_type: 'bogus' }, { title: '' }, { issue_date: null }]) {
      same(await p.req('PATCH', `/api/superadmin/staff/me/legal/${lid}/`, { json }));
    }
    const f4 = new FormData(); f4.append('document', new Blob([Buffer.from('new scan')]), 'rescan.png');
    same(await p.req('PATCH', `/api/superadmin/staff/me/legal/${lid}/`, { form: f4 }));
    await sameRows('superadmin_stafflegalrecord', `id > ${l0}`, { ignore: ['created_at'] });
    same(await p.req('DELETE', `/api/superadmin/staff/me/legal/${lid}/`));
    same(await p.req('DELETE', `/api/superadmin/staff/me/legal/${lid}/`));
    same(await S.superadmin!.req('GET', `/api/superadmin/staff/`), { ignore: ['username', 'full_name'] });
    await sameRows('superadmin_stafflegalrecord', `id > ${l0}`, { ignore: ['created_at'] });
    void cookie;
  });
});
