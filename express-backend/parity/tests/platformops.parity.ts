// platformops — /api/platform-ops/ parity (feature flags, health, logs, cache, metrics, docs).
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accounts, dbs, flushRedis, Pair, PASSWORD, same, sameRows, type Resp } from '../lib.js';

let ipCounter = 0;
async function loginPair(email: string): Promise<Pair> {
  const p = new Pair();
  const r = await p.req('POST', '/api/auth/login/', { json: { email, password: PASSWORD }, headers: { 'X-Forwarded-For': `198.51.101.${++ipCounter}` } });
  expect(r.django.status, `login ${email}: ${r.django.text}`).toBe(200);
  expect(r.express.status, `login ${email}: ${r.express.text}`).toBe(200);
  p.django.token = (r.django.body as { access: string }).access;
  p.express.token = (r.express.body as { access: string }).access;
  return p;
}
async function both(q: string) { await dbs.django.query(q); await dbs.express.query(q); }
async function cloneUser(newId: number, fromId: number, set: Record<string, string> = {}) {
  const cols: string[] = (await dbs.django.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='users_user' ORDER BY ordinal_position`,
  )).rows.map((r) => r.column_name);
  const exprs = cols.map((c) => (c === 'id' ? String(newId) : c === 'username' ? `'parity_${newId}'` : c === 'email' ? `'parity_${newId}@example.com'` : set[c] ?? `"${c}"`));
  await both(`INSERT INTO users_user (${cols.map((c) => `"${c}"`).join(',')}) SELECT ${exprs.join(',')} FROM users_user WHERE id = ${fromId}`);
  await both(`INSERT INTO users_profile (id, user_id, bio, is_superhost, phone_number, image) VALUES (${newId}, ${newId}, '', false, '', '')`);
}
async function maxId(table: string) { return Number((await dbs.django.query(`SELECT coalesce(max(id), 0) m FROM ${table}`)).rows[0].m); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Same status, and both bodies have the same shape (keys + value types) — for live server values. */
function sameShape(r: { django: Resp; express: Resp }) {
  const shape = (v: unknown): unknown => (Array.isArray(v) ? 'array' : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)])) : typeof v);
  expect(r.express.status, r.express.text.slice(0, 300)).toBe(r.django.status);
  expect(shape(r.express.body)).toEqual(shape(r.django.body));
}

let acct: Awaited<ReturnType<typeof accounts>>;
const S: Record<string, Pair> = {};
const STAFF = 920001; // is_staff, no roles
const ENGINEER = 920002; // engineering preset role
const FLAGGER = 920003; // custom role with only infrastructure.system_caches.read

beforeAll(async () => {
  acct = await accounts();
  await cloneUser(STAFF, acct.user!.id, { is_staff: 'true' });
  await cloneUser(ENGINEER, acct.user!.id, { is_staff: 'true' });
  await cloneUser(FLAGGER, acct.user!.id, { is_staff: 'true' });
  await both(`INSERT INTO rbac_userroleassignment (id, user_id, role_id, granted_by_id, granted_at) VALUES (920001, ${ENGINEER}, (SELECT id FROM rbac_role WHERE slug='engineering'), NULL, '2026-01-01T00:00:00Z')`);
  await both(`INSERT INTO rbac_role (id, name, slug, description, is_preset, created_by_id, created_at, updated_at) VALUES (920001, 'Parity Cache Reader', 'parity-cache-reader', '', false, NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`);
  await both(`INSERT INTO rbac_rolepermission (id, role_id, resource, action) VALUES (920001, 920001, 'infrastructure.system_caches', 'read')`);
  await both(`INSERT INTO rbac_userroleassignment (id, user_id, role_id, granted_by_id, granted_at) VALUES (920002, ${FLAGGER}, 920001, NULL, '2026-01-01T00:00:00Z')`);
  // a couple of stored metric snapshots (history is compared exactly)
  await both(`INSERT INTO platformops_servermetricsnapshot (id, recorded_at, cpu_percent, memory_percent, memory_used_mb, memory_total_mb, disk_used_percent, disk_free_gb, net_bytes_sent_mb, net_bytes_recv_mb)
              VALUES (920001, '2030-01-01T00:02:00.5Z', 12.5, 40.0, 6400.1, 16000.0, 55.5, 120.3, 10.0, 20.25),
                     (920002, '2030-01-01T00:01:00Z', 3, 41.2, 6500, 16000, 55.6, 120.2, 9.5, 19)`);
  for (const role of ['user', 'admin', 'superadmin'] as const) S[role] = await loginPair(acct[role]!.email);
  S.staff = await loginPair(`parity_${STAFF}@example.com`);
  S.engineer = await loginPair(`parity_${ENGINEER}@example.com`);
  S.flagger = await loginPair(`parity_${FLAGGER}@example.com`);
  S.anon = new Pair();
});
beforeEach(flushRedis);

const DENIED = ['anon', 'user', 'staff'];
const ALLOWED = ['flagger', 'engineer', 'admin', 'superadmin'];

describe('access matrix', () => {
  const routes: [string, string, unknown?][] = [
    ['GET', '/api/platform-ops/feature-flags/'],
    ['POST', '/api/platform-ops/feature-flags/', {}],
    ['PATCH', '/api/platform-ops/feature-flags/999999/', {}],
    ['DELETE', '/api/platform-ops/feature-flags/999999/'],
    ['GET', '/api/platform-ops/system-health/'],
    ['GET', '/api/platform-ops/recent-errors/'],
    ['POST', '/api/platform-ops/flush-cache/'],
    ['GET', '/api/platform-ops/server-metrics/'],
    ['GET', '/api/platform-ops/log-viewer/?file=nope'],
    ['GET', '/api/platform-ops/docs/user-guide/'],
  ];
  for (const [method, path, json] of routes) {
    it(`${method} ${path} denied`, async () => {
      for (const who of DENIED) same(await S[who]!.req(method, path, json === undefined ? {} : { json }), { headers: ['www-authenticate'] });
    });
  }
  it('docs: non-staff gets a plain-text 403', async () => {
    const r = await S.user!.req('GET', '/api/platform-ops/docs/developer-guide/');
    expect(r.express.status).toBe(403);
    expect(r.express.text).toBe(r.django.text);
    expect(r.express.headers.get('content-type')).toBe(r.django.headers.get('content-type'));
  });
  it('405', async () => {
    same(await S.superadmin!.req('GET', '/api/platform-ops/flush-cache/'));
    same(await S.superadmin!.req('PUT', '/api/platform-ops/feature-flags/'));
    same(await S.superadmin!.req('GET', '/api/platform-ops/feature-flags/1/'));
  });
});

describe('feature flags', () => {
  it('list for every allowed caller', async () => {
    for (const who of ALLOWED) same(await S[who]!.req('GET', '/api/platform-ops/feature-flags/'));
  });

  it('create validation', async () => {
    const p = S.superadmin!;
    for (const json of [
      {},
      { key: '', name: '' },
      { key: 'has space', name: 'x' },
      { key: 'k'.repeat(61), name: 'n'.repeat(121) },
      { key: 'maintenance_mode', name: 'dup' },
      { key: 'parity_bad_bool', name: 'x', is_enabled: 'maybe' },
      { key: 'parity_null_bool', name: 'x', is_enabled: null },
      { key: 12, name: 34, description: ['x'] },
      { key: 'bad key', name: '\x1c', is_enabled: 'TrUe', description: '\x1c' }, // \x1c is whitespace to str.strip()
      { key: 'parity_sur', name: '\udfff' },
    ]) same(await p.req('POST', '/api/platform-ops/feature-flags/', { json }));
  });

  it('create upper-case duplicate key → IntegrityError 500 on both', async () => {
    same(await S.superadmin!.req('POST', '/api/platform-ops/feature-flags/', { json: { key: 'MAINTENANCE_MODE', name: 'x' } }));
  });

  it('create → patch → delete with rows + audit', async () => {
    const audit0 = await maxId('superadmin_adminauditlog');
    const c = await S.engineer!.req('POST', '/api/platform-ops/feature-flags/', { json: { key: '  Parity_Flag ', name: ' Parity flag ', description: 'desc', is_enabled: 'yes' } });
    expect(c.django.status).toBe(201);
    same(c);
    const id = (c.django.body as { id: number }).id;
    await sameRows('platformops_featureflag', `id = ${id}`);
    same(await S.admin!.req('PATCH', `/api/platform-ops/feature-flags/${id}/`, { json: { is_enabled: 'nah' } }));
    same(await S.admin!.req('PATCH', `/api/platform-ops/feature-flags/${id}/`, { json: { key: 'maintenance_mode' } }));
    same(await S.admin!.req('PATCH', `/api/platform-ops/feature-flags/${id}/`, { json: { is_enabled: 0, description: '' } }));
    same(await S.flagger!.req('PATCH', `/api/platform-ops/feature-flags/${id}/`, { json: { name: 'Renamed', key: 'parity_flag' } }));
    await sameRows('platformops_featureflag', `id = ${id}`);
    same(await S.superadmin!.req('GET', '/api/platform-ops/feature-flags/'));
    const d = await S.superadmin!.req('DELETE', `/api/platform-ops/feature-flags/${id}/`);
    expect(d.django.status).toBe(204);
    same(d);
    same(await S.superadmin!.req('DELETE', `/api/platform-ops/feature-flags/${id}/`));
    await sameRows('platformops_featureflag', `id = ${id}`);
    await sleep(200);
    await sameRows('superadmin_adminauditlog', `id > ${audit0}`, { ignore: ['id'], order: 'created_at, id' });
  });
});

describe('system health / metrics / logs / cache / docs', () => {
  it('system-health', async () => {
    const r = await S.engineer!.req('GET', '/api/platform-ops/system-health/');
    expect(r.django.status).toBe(200);
    sameShape(r);
    // deterministic parts compared exactly; disk + error counts are per-host live values
    same(r, { ignore: ['$.disk', '$.recent_errors_last_hour', 'total_gb', 'free_gb', 'used_percent'] });
  });

  it('server-metrics: stored history exact, live snapshot shape', async () => {
    const r = await S.superadmin!.req('GET', '/api/platform-ops/server-metrics/');
    expect(r.django.status).toBe(200);
    sameShape(r);
    expect((r.express.body as { history: unknown }).history).toEqual((r.django.body as { history: unknown }).history);
  });

  it('recent-errors + log-viewer (server-local files: shape only)', async () => {
    for (const q of ['', '?limit=5', '?limit=0']) sameShape(await S.superadmin!.req('GET', `/api/platform-ops/recent-errors/${q}`));
    same(await S.superadmin!.req('GET', '/api/platform-ops/recent-errors/?limit=abc')); // int() ValueError → 500
    same(await S.superadmin!.req('GET', '/api/platform-ops/log-viewer/?file=bogus'));
    same(await S.superadmin!.req('GET', '/api/platform-ops/log-viewer/?file=errors&limit=x'));
    for (const q of ['', '?file=activity', '?file=transactions&level=error&search=x']) {
      sameShape(await S.superadmin!.req('GET', `/api/platform-ops/log-viewer/${q}`));
    }
  });

  it('flush-cache clears the cache and is audited', async () => {
    const audit0 = await maxId('superadmin_adminauditlog');
    same(await S.flagger!.req('POST', '/api/platform-ops/flush-cache/'));
    await sleep(200);
    await sameRows('superadmin_adminauditlog', `id > ${audit0}`, { ignore: ['id'], order: 'created_at, id' });
  });

  it('docs: unknown slug and missing file are 404 for staff', async () => {
    same(await S.staff!.req('GET', '/api/platform-ops/docs/nope/'));
    const r = await S.staff!.req('GET', '/api/platform-ops/docs/developer-guide/');
    expect(r.express.status).toBe(r.django.status);
    if (r.django.status === 200) expect(r.express.text).toBe(r.django.text);
    else same(r);
  });
});
