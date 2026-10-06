// propertyverifications — /api/property-verifications/ parity: submission (JSON + multipart MOU), the
// three-stage review pipeline (Django group permissions via user.has_perm and the RBAC
// background-checks grant), compliance inspection data, corrections/resubmission, listing
// publish-state sync, notifications, audit rows and queued AI-scoring tasks.
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
const HOST = 950001;
const PS = 950002; // Product Support Officers group
const COMP = 950003; // Compliance Officers group
const SUP = 950004; // Supervisors group
const BG = 950005; // trust_safety.background_checks via RBAC
const FAN = 950006; // favourites the listings
const L = [950001, 950002, 950003, 950004];

async function insertListing(id: number, owner: number, status = 'draft') {
  await both(`INSERT INTO listings_listing (id, title, description, price, bedrooms, beds, bathrooms, max_guests, property_type, privacy_type, booking_mode, owner_id,
    address, city, state, country, check_in_time, check_out_time, self_checkin, square_footage, amenities, highlights, weekend_premium_percent,
    new_listing_promo, last_minute_discount_enabled, last_minute_discount_percent, weekly_discount_enabled, weekly_discount_percent, monthly_discount_enabled,
    monthly_discount_percent, exterior_camera, noise_monitor, weapons_on_property, pricing_type, cancellation_policy, is_available, status, main_image,
    agent_owner_name, agent_owner_phone, agent_owner_email, agent_owner_payout_number, agent_owner_payout_network, created_at, updated_at, suspension_reason,
    local_registration_number)
    VALUES ($1, $2, '', 50, 1, 1, 1, 2, 'apartment', 'entire_place', 'instant', $3, 'PV Rd', 'Monrovia', '', '', '15:00', '11:00', false, 0, '[]', '[]', 0,
    false, false, 0, false, 0, false, 0, false, false, false, 'nightly', 'flexible', false, $4, '', '', '', '', '', '', now(), now(), '', '')`, [id, `PV listing ${id}`, owner, status]);
}

beforeAll(async () => {
  acct = await accounts();
  await cloneUser(HOST, acct.agent!.id);
  for (const id of [PS, COMP, SUP, BG, FAN]) await cloneUser(id, acct.user!.id, { is_staff: 'true' });
  await both(`INSERT INTO users_user_groups (user_id, group_id) VALUES (${PS}, 1), (${COMP}, 2), (${SUP}, 3)`);
  await both(`INSERT INTO rbac_userroleassignment (id, user_id, role_id, granted_by_id, granted_at) VALUES
    (950001, ${BG}, (SELECT id FROM rbac_role WHERE slug='trust_safety'), NULL, '2026-01-01T00:00:00Z')`);
  for (const id of L) await insertListing(id, HOST);
  await insertListing(950009, acct.agent!.id);
  for (const id of L) await both(`INSERT INTO listings_favorite (user_id, listing_id, created_at) VALUES (${FAN}, ${id}, now())`);
  for (const role of ['user', 'agent', 'admin', 'superadmin'] as const) S[role] = await loginPair(acct[role]!.email);
  S.host = await loginPair(`parity_${HOST}@example.com`);
  S.ps = await loginPair(`parity_${PS}@example.com`);
  S.comp = await loginPair(`parity_${COMP}@example.com`);
  S.sup = await loginPair(`parity_${SUP}@example.com`);
  S.bg = await loginPair(`parity_${BG}@example.com`);
  S.anon = new Pair();
});
beforeEach(flushRedis);

const VERIF = 'propertyverifications_propertyverification';
let V: number[] = [];
const snapshot = async (n0: number, a0: number) => {
  await sameRows(VERIF, `listing_id IN (${L.join(',')})`, { ignore: ['created_at', 'updated_at', 'ps_reviewed_at', 'compliance_reviewed_at', 'supervisor_reviewed_at'] });
  await sameRows('listings_listing', `id IN (${L.join(',')})`, { ignore: ['updated_at'] });
  await sameRows('notifications_notification', `id > ${n0}`, { ignore: ['created_at'] });
  await sameRows('superadmin_adminauditlog', `id > ${a0}`, AUDIT_IGNORE);
};

describe('access', () => {
  it('anonymous → 401 everywhere', async () => {
    for (const [m, path] of [['POST', '/api/property-verifications/'], ['GET', '/api/property-verifications/for-listing/1/'], ['POST', '/api/property-verifications/1/resubmit/'],
      ['GET', '/api/property-verifications/review-queue/'], ['POST', '/api/property-verifications/1/review/']] as const) {
      same(await S.anon!.req(m, path, { json: {} }), { headers: ['www-authenticate'] });
    }
  });
  it('review queue per reviewer', async () => {
    for (const who of ['user', 'admin', 'ps', 'comp', 'sup', 'bg', 'superadmin']) same(await S[who]!.req('GET', '/api/property-verifications/review-queue/'));
  });
});

describe('submit', () => {
  it('validation', async () => {
    const cases: unknown[] = [
      {}, { listing: 999999, ownership_type: 'owner', owner_name: 'O', property_location: 'P', deed_volume_number: 'D', page_number: '1' },
      { listing: 950009, ownership_type: 'owner', owner_name: 'O', property_location: 'P', deed_volume_number: 'D', page_number: '1' },
      { listing: L[0], ownership_type: 'tenant', owner_name: '', property_location: 'P', deed_volume_number: 'D', page_number: '' },
      { listing: L[0], ownership_type: 'non_owner', owner_name: 'O', property_location: 'P', deed_volume_number: 'D', page_number: '1' },
      { listing: 'abc', ownership_type: 'owner' }, [1],
    ];
    for (const json of cases) same(await S.host!.req('POST', '/api/property-verifications/', { json }));
    same(await S.host!.req('POST', '/api/property-verifications/', {
      form: form({ listing: String(L[0]), ownership_type: 'non_owner', owner_name: 'O', property_location: 'P', deed_volume_number: 'D', page_number: '1' }, { mou_document: [[PNG, uniq('exe')]] }),
    }));
  });
  it('success (owner, non-owner with MOU, agent) + duplicate', async () => {
    const n0 = await maxId('notifications_notification');
    const a0 = await maxId('superadmin_adminauditlog');
    const base = { owner_name: 'Owner', property_location: 'PV Rd', deed_volume_number: 'Vol 1', page_number: '12' };
    let r = await S.host!.req('POST', '/api/property-verifications/', { json: { listing: L[0], ownership_type: 'owner', ...base } });
    same(r); V.push((r.django.body as { id: number }).id);
    r = await S.host!.req('POST', '/api/property-verifications/', { form: form({ listing: String(L[1]), ownership_type: 'non_owner', ...base }, { mou_document: [[PNG, uniq('pdf')]] }) });
    same(r); V.push((r.django.body as { id: number }).id);
    r = await S.host!.req('POST', '/api/property-verifications/', { json: { listing: L[2], ownership_type: 'agent', ...base } });
    same(r); V.push((r.django.body as { id: number }).id);
    r = await S.host!.req('POST', '/api/property-verifications/', { json: { listing: L[3], ownership_type: 'owner', ...base } });
    same(r); V.push((r.django.body as { id: number }).id);
    same(await S.host!.req('POST', '/api/property-verifications/', { json: { listing: L[0], ownership_type: 'owner', ...base } }));
    await snapshot(n0, a0);
    const q = await aiQueue();
    expect(q.django.length).toBe(4);
    expect(q.express).toEqual(q.django);
  });
  it('for-listing', async () => {
    same(await S.host!.req('GET', `/api/property-verifications/for-listing/${L[1]}/`));
    same(await S.host!.req('GET', '/api/property-verifications/for-listing/950009/'));
    same(await S.agent!.req('GET', `/api/property-verifications/for-listing/${L[1]}/`));
    for (const who of ['ps', 'bg', 'superadmin']) same(await S[who]!.req('GET', '/api/property-verifications/review-queue/'));
  });
});

describe('review pipeline', () => {
  it('stage permissions + decision validation', async () => {
    same(await S.ps!.req('POST', '/api/property-verifications/999999/review/', { json: {} }));
    same(await S.comp!.req('POST', `/api/property-verifications/${V[0]}/review/`, { json: { decision: 'approve' } }));
    same(await S.user!.req('POST', `/api/property-verifications/${V[0]}/review/`, { json: { decision: 'approve' } }));
    for (const body of [{}, { decision: 'maybe' }, { decision: 'reject' }, { decision: 'request_correction', notes: '  ' }]) {
      same(await S.ps!.req('POST', `/api/property-verifications/${V[0]}/review/`, { json: body }));
    }
  });
  it('happy path to publication', async () => {
    const n0 = await maxId('notifications_notification');
    const a0 = await maxId('superadmin_adminauditlog');
    same(await S.ps!.req('POST', `/api/property-verifications/${V[0]}/review/`, { json: { decision: 'approve' } }));
    same(await S.ps!.req('POST', `/api/property-verifications/${V[0]}/review/`, { json: { decision: 'approve' } }));
    // compliance: missing inspection → 400, but submitted inspection fields are kept
    same(await S.comp!.req('POST', `/api/property-verifications/${V[0]}/review/`, { json: { decision: 'approve', due_diligence_done: 'yes', inspection_latitude: 'abc' } }));
    same(await S.comp!.req('POST', `/api/property-verifications/${V[0]}/review/`, { json: { decision: 'approve', due_diligence_done: true, inspection_latitude: 6.3001234567 } }));
    same(await S.comp!.req('POST', `/api/property-verifications/${V[0]}/review/`, {
      form: form({ decision: 'approve', inspection_longitude: '-10.7001235', notes: 'site ok' }, { inspection_report: [[PNG, uniq('pdf')]] }),
    }));
    same(await S.sup!.req('POST', `/api/property-verifications/${V[0]}/review/`, { json: { decision: 'approve', notes: 'final' } }));
    same(await S.sup!.req('POST', `/api/property-verifications/${V[0]}/review/`, { json: { decision: 'approve' } }));
    await snapshot(n0, a0);
    same(await S.anon!.req('GET', `/api/listings/${L[0]}/`));
  });
  it('agent-sourced needs owner authorization; background-check reviewer', async () => {
    const n0 = await maxId('notifications_notification');
    const a0 = await maxId('superadmin_adminauditlog');
    same(await S.bg!.req('POST', `/api/property-verifications/${V[2]}/review/`, { json: { decision: 'approve' } }));
    same(await S.bg!.req('POST', `/api/property-verifications/${V[2]}/review/`, { form: form({ decision: 'approve', due_diligence_done: 'true' }, { inspection_report: [[PNG, uniq('pdf')]] }) }));
    same(await S.bg!.req('POST', `/api/property-verifications/${V[2]}/review/`, { json: { decision: 'approve', owner_authorization_confirmed: 1 } }));
    same(await S.superadmin!.req('POST', `/api/property-verifications/${V[2]}/review/`, { json: { decision: 'reject', notes: 'fraud' } }));
    await snapshot(n0, a0);
  });
  it('correction → resubmit → reject', async () => {
    const n0 = await maxId('notifications_notification');
    const a0 = await maxId('superadmin_adminauditlog');
    same(await S.host!.req('POST', `/api/property-verifications/${V[1]}/resubmit/`, { json: {} }));
    same(await S.ps!.req('POST', `/api/property-verifications/${V[1]}/review/`, { json: { decision: 'request_correction', notes: 'Upload a clearer MOU' } }));
    same(await S.host!.req('GET', `/api/property-verifications/for-listing/${L[1]}/`));
    same(await S.agent!.req('POST', `/api/property-verifications/${V[1]}/resubmit/`, { json: {} }));
    same(await S.host!.req('POST', '/api/property-verifications/999999/resubmit/', { json: {} }));
    for (const json of [{ owner_name: '' }, { mou_document: 'x' }, [1]]) same(await S.host!.req('POST', `/api/property-verifications/${V[1]}/resubmit/`, { json }));
    same(await S.host!.req('POST', `/api/property-verifications/${V[1]}/resubmit/`, { form: form({ owner_name: 'New Owner', page_number: '' }, { mou_document: [[PNG, uniq('jpg')]] }) }));
    same(await S.host!.req('POST', `/api/property-verifications/${V[1]}/resubmit/`, { json: {} }));
    same(await S.ps!.req('POST', `/api/property-verifications/${V[1]}/review/`, { json: { decision: 'reject', notes: 'Still unreadable' } }));
    same(await S.ps!.req('POST', `/api/property-verifications/${V[1]}/review/`, { json: { decision: 'approve' } }));
    await snapshot(n0, a0);
    const q = await aiQueue();
    expect(q.express).toEqual(q.django);
    same(await S.host!.req('GET', `/api/property-verifications/for-listing/${L[1]}/`));
  });
  it('compliance correction & rejection with listing status sync', async () => {
    const n0 = await maxId('notifications_notification');
    const a0 = await maxId('superadmin_adminauditlog');
    same(await S.ps!.req('POST', `/api/property-verifications/${V[3]}/review/`, { form: form({ decision: 'approve' }) }));
    same(await S.comp!.req('POST', `/api/property-verifications/${V[3]}/review/`, { json: { decision: 'request_correction', notes: ['photos', 'deed'], inspection_latitude: '1' } }));
    same(await S.host!.req('POST', `/api/property-verifications/${V[3]}/resubmit/`, { json: { deed_volume_number: 'Vol 2' } }));
    for (const who of ['ps', 'comp', 'sup', 'bg']) same(await S[who]!.req('GET', '/api/property-verifications/review-queue/'));
    await snapshot(n0, a0);
  });
});
