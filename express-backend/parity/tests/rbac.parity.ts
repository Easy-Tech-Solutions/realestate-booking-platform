// rbac — /api/rbac/ parity (roles, grants, user-role assignments, break-glass, dual-auth approvals).
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accounts, dbs, flushRedis, Pair, PASSWORD, same, sameRows } from '../lib.js';

// --- helpers (each test file is self-contained) ---------------------------------------

let ipCounter = 0;
/** Logs both sides in from a fresh client IP (the login throttle is 5/min per IP). */
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
  await dbs.django.query(q, params);
  await dbs.express.query(q, params);
}

/** Copies an existing account (same password) into a new user with explicit id + overrides, identically on both copies. */
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- fixtures ---------------------------------------------------------------------------

let acct: Awaited<ReturnType<typeof accounts>>;
const S: Record<string, Pair> = {};
const STAFF = 910001; // is_staff, no roles
const ENGINEER = 910002; // is_staff + engineering preset role
const PLAIN = 910003; // role assignment target
const RBAC_READER = 910004; // is_staff + custom role with rbac_engine.read only

beforeAll(async () => {
  acct = await accounts();
  await cloneUser(STAFF, acct.user!.id, { is_staff: 'true' });
  await cloneUser(ENGINEER, acct.user!.id, { is_staff: 'true' });
  await cloneUser(PLAIN, acct.user!.id);
  await cloneUser(RBAC_READER, acct.user!.id, { is_staff: 'true' });
  await both(`INSERT INTO rbac_userroleassignment (id, user_id, role_id, granted_by_id, granted_at) VALUES (910001, ${ENGINEER}, (SELECT id FROM rbac_role WHERE slug='engineering'), NULL, '2026-01-01T00:00:00Z')`);
  await both(`INSERT INTO rbac_role (id, name, slug, description, is_preset, created_by_id, created_at, updated_at) VALUES (910001, 'Parity RBAC Reader', 'parity-rbac-reader', '', false, NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`);
  await both(`INSERT INTO rbac_rolepermission (id, role_id, resource, action) VALUES (910001, 910001, 'rbac_engine', 'read')`);
  await both(`INSERT INTO rbac_userroleassignment (id, user_id, role_id, granted_by_id, granted_at) VALUES (910002, ${RBAC_READER}, 910001, NULL, '2026-01-01T00:00:00Z')`);

  for (const role of ['user', 'admin', 'superadmin'] as const) S[role] = await loginPair(acct[role]!.email);
  S.staff = await loginPair(`parity_${STAFF}@example.com`);
  S.engineer = await loginPair(`parity_${ENGINEER}@example.com`);
  S.reader = await loginPair(`parity_${RBAC_READER}@example.com`);
  S.anon = new Pair();
});
beforeEach(flushRedis);

const WHO = ['anon', 'user', 'staff', 'engineer', 'reader', 'admin', 'superadmin'];

describe('access matrix (every route, every kind of caller)', () => {
  const routes: [string, string, unknown?][] = [
    ['GET', '/api/rbac/resource-tree/'],
    ['GET', '/api/rbac/my-permissions/'],
    ['GET', '/api/rbac/roles/'],
    ['POST', '/api/rbac/roles/', {}],
    ['PATCH', '/api/rbac/roles/999999/', {}],
    ['DELETE', '/api/rbac/roles/999999/'],
    ['POST', '/api/rbac/roles/999999/permissions/', {}],
    ['DELETE', '/api/rbac/roles/999999/permissions/1/'],
    ['GET', '/api/rbac/user-roles/'],
    ['POST', '/api/rbac/user-roles/', {}],
    ['DELETE', '/api/rbac/user-roles/999999/'],
    ['GET', '/api/rbac/break-glass/'],
    ['POST', '/api/rbac/break-glass/', {}],
    ['POST', '/api/rbac/break-glass/999999/revoke/'],
    ['GET', '/api/rbac/approvals/'],
    ['POST', '/api/rbac/approvals/999999/approve/'],
    ['POST', '/api/rbac/approvals/999999/reject/'],
  ];
  for (const [method, path, json] of routes) {
    it(`${method} ${path}`, async () => {
      for (const who of WHO) {
        const r = await S[who]!.req(method, path, json === undefined ? {} : { json });
        same(r, { headers: ['www-authenticate'] });
      }
    });
  }
  it('wrong methods → 405', async () => {
    same(await S.superadmin!.req('PUT', '/api/rbac/roles/'));
    same(await S.superadmin!.req('GET', '/api/rbac/roles/1/'));
    same(await S.superadmin!.req('GET', '/api/rbac/approvals/1/approve/'));
    same(await S.anon!.req('PUT', '/api/rbac/roles/'), { headers: ['www-authenticate'] });
  });
});

describe('resource tree & my permissions', () => {
  it('resource tree', async () => {
    const r = await S.superadmin!.req('GET', '/api/rbac/resource-tree/');
    expect(r.django.status).toBe(200);
    same(r);
  });
  it('my-permissions for each staff kind', async () => {
    for (const who of ['staff', 'engineer', 'reader', 'admin', 'superadmin']) {
      const r = await S[who]!.req('GET', '/api/rbac/my-permissions/');
      expect(r.django.status).toBe(200);
      same(r);
    }
  });
});

describe('roles', () => {
  it('list (superadmin) and reader (read only)', async () => {
    same(await S.superadmin!.req('GET', '/api/rbac/roles/'));
    same(await S.reader!.req('GET', '/api/rbac/roles/'));
    same(await S.reader!.req('POST', '/api/rbac/roles/', { json: { name: 'x', slug: 'x' } })); // read-only → 403
  });

  it('create validation errors', async () => {
    const p = S.superadmin!;
    const cases: unknown[] = [
      {},
      { name: '', slug: '' },
      { name: '   ', slug: 'ok-slug' },
      { name: 'x'.repeat(101), slug: 'y'.repeat(101) },
      { name: 'Valid', slug: 'bad slug!' },
      { name: 'Admin', slug: 'admin' },
      { name: true, slug: ['a'] },
      { name: null, slug: 'abc' },
      { name: 'Ok', slug: 'z'.repeat(101) + '!' },
      [1, 2],
      // Python str.strip() / DRF CharField edge cases (shared lib/fields.ts engine)
      { name: '\x1c', slug: 'ws-1c' }, { name: '\x85\u3000', slug: 'ws-85' }, { name: '\ufeffBom', slug: 'x y' },
      { name: 'a\u0000b', slug: 'nul' }, { name: 'lone \ud800 surrogate', slug: 'sur' }, { name: 'Ok', slug: 'ok', description: 1.5e-7 },
      { name: 1e-5, slug: 7 },
    ];
    for (const json of cases) same(await p.req('POST', '/api/rbac/roles/', { json }));
    // a JSON `null` body → {"non_field_errors": ["No data provided"]}
    same(await p.req('POST', '/api/rbac/roles/', { raw: 'null', headers: { 'Content-Type': 'application/json' } }));
  });

  it('create → patch → grant/revoke → delete, with DB rows and audit log', async () => {
    const p = S.superadmin!;
    const audit0 = await maxId('superadmin_adminauditlog');
    const c = await p.req('POST', '/api/rbac/roles/', { json: { name: '  Parity Role  ', slug: 'parity-role', description: 'made by parity', is_preset: true, created_by: 5 } });
    expect(c.django.status).toBe(201);
    same(c);
    const id = (c.django.body as { id: number }).id;
    expect((c.express.body as { id: number }).id).toBe(id);
    await sameRows('rbac_role', `id = ${id}`);

    same(await p.req('PATCH', `/api/rbac/roles/${id}/`, { json: { slug: 'admin' } })); // unique (other instance)
    same(await p.req('PATCH', `/api/rbac/roles/${id}/`, { json: { slug: 'parity-role' } })); // own value is fine
    same(await p.req('PATCH', `/api/rbac/roles/${id}/`, { json: { name: 'Parity Role 2', description: '' } }));
    same(await p.req('PATCH', '/api/rbac/roles/999999/', { json: { name: 'nope' } }));
    await sameRows('rbac_role', `id = ${id}`);

    // grants
    same(await p.req('POST', `/api/rbac/roles/${id}/permissions/`, { json: {} }));
    same(await p.req('POST', `/api/rbac/roles/${id}/permissions/`, { json: { resource: 'nope.nope', action: 'fly' } }));
    same(await p.req('POST', `/api/rbac/roles/${id}/permissions/`, { json: { resource: '', action: 'x'.repeat(21) } }));
    const g1 = await p.req('POST', `/api/rbac/roles/${id}/permissions/`, { json: { resource: 'listings.content', action: 'read' } });
    expect(g1.django.status).toBe(201);
    same(g1);
    const g2 = await p.req('POST', `/api/rbac/roles/${id}/permissions/`, { json: { resource: 'listings.content', action: 'read' } });
    expect(g2.django.status).toBe(200);
    same(g2);
    same(await p.req('POST', `/api/rbac/roles/${id}/permissions/`, { json: { resource: 'finances', action: 'execute' } }));
    same(await p.req('GET', '/api/rbac/roles/'));
    await sameRows('rbac_rolepermission', `role_id = ${id}`);

    const permId = (g1.django.body as { id: number }).id;
    same(await p.req('DELETE', `/api/rbac/roles/1/permissions/${permId}/`)); // perm belongs to another role → 404
    same(await p.req('DELETE', `/api/rbac/roles/${id}/permissions/999999/`));
    same(await p.req('DELETE', `/api/rbac/roles/${id}/permissions/${permId}/`));
    await sameRows('rbac_rolepermission', `role_id = ${id}`);

    // assign to someone then delete the role (cascades)
    same(await p.req('POST', '/api/rbac/user-roles/', { json: { user: PLAIN, role: id } }), { ignore: ['id'] });
    same(await p.req('DELETE', '/api/rbac/roles/1/')); // preset → 400
    const d = await p.req('DELETE', `/api/rbac/roles/${id}/`);
    expect(d.django.status).toBe(204);
    same(d);
    await sameRows('rbac_role', `id = ${id}`);
    await sameRows('rbac_rolepermission', `role_id = ${id}`);
    await sameRows('rbac_userroleassignment', `role_id = ${id}`);
    await sameRows('users_user', `id = ${PLAIN}`, { ignore: ['last_login'] });
    await sleep(300);
    await sameRows('superadmin_adminauditlog', `id > ${audit0}`, { ignore: ['id'], order: 'created_at, id' });
  });
});

describe('user-role assignments', () => {
  it('list + user_id filter', async () => {
    same(await S.superadmin!.req('GET', '/api/rbac/user-roles/'));
    same(await S.superadmin!.req('GET', `/api/rbac/user-roles/?user_id=${acct.admin!.id}`));
    same(await S.superadmin!.req('GET', '/api/rbac/user-roles/?user_id='));
    same(await S.reader!.req('GET', '/api/rbac/user-roles/?user_id=1'));
    same(await S.superadmin!.req('GET', '/api/rbac/user-roles/?user_id=abc')); // ValueError → 500
  });

  it('assign validation', async () => {
    const p = S.superadmin!;
    same(await p.req('POST', '/api/rbac/user-roles/', { json: {} }));
    same(await p.req('POST', '/api/rbac/user-roles/', { json: { user: 0, role: 1 } }));
    same(await p.req('POST', '/api/rbac/user-roles/', { json: { user: 999999, role: 1 } }));
    same(await p.req('POST', '/api/rbac/user-roles/', { json: { user: PLAIN, role: 999999 } }));
    same(await p.req('POST', '/api/rbac/user-roles/', { json: { user: PLAIN, role: (await dbs.django.query(`SELECT id FROM rbac_role WHERE slug='superadmin'`)).rows[0].id } }));
    same(await p.req('POST', '/api/rbac/user-roles/', { json: { user: 'abc', role: 1 } })); // → 500
  });

  it('assign admin role promotes; revoke demotes; reassign is 200', async () => {
    const p = S.superadmin!;
    const audit0 = await maxId('superadmin_adminauditlog');
    const adminRole = Number((await dbs.django.query(`SELECT id FROM rbac_role WHERE slug='admin'`)).rows[0].id);
    const a1 = await p.req('POST', '/api/rbac/user-roles/', { json: { user: PLAIN, role: adminRole } });
    expect(a1.django.status).toBe(201);
    same(a1);
    await sameRows('users_user', `id = ${PLAIN}`, { ignore: ['last_login'] });
    const a2 = await p.req('POST', '/api/rbac/user-roles/', { json: { user: String(PLAIN), role: adminRole } });
    expect(a2.django.status).toBe(200);
    same(a2);
    // non-admin role on the same (now staff) user
    same(await p.req('POST', '/api/rbac/user-roles/', { json: { user: PLAIN, role: 1 } }));
    await sameRows('rbac_userroleassignment', `user_id = ${PLAIN}`);
    same(await p.req('GET', `/api/rbac/user-roles/?user_id=${PLAIN}`));

    const aid = (a1.django.body as { id: number }).id;
    same(await p.req('DELETE', `/api/rbac/user-roles/${aid}/`));
    same(await p.req('DELETE', `/api/rbac/user-roles/${aid}/`)); // gone → 404
    await sameRows('users_user', `id = ${PLAIN}`, { ignore: ['last_login'] });
    await sameRows('rbac_userroleassignment', `user_id = ${PLAIN}`);
    await sleep(300);
    await sameRows('superadmin_adminauditlog', `id > ${audit0}`, { ignore: ['id'], order: 'created_at, id' });
  });
});

describe('break-glass', () => {
  it('request validation and eligibility', async () => {
    same(await S.staff!.req('POST', '/api/rbac/break-glass/', { json: { reason: 'x' } })); // not engineering → 403
    same(await S.admin!.req('POST', '/api/rbac/break-glass/', { json: { reason: 'x' } }));
    same(await S.engineer!.req('POST', '/api/rbac/break-glass/', { json: {} }));
    same(await S.engineer!.req('POST', '/api/rbac/break-glass/', { json: { reason: '   ' } }));
    same(await S.engineer!.req('GET', '/api/rbac/break-glass/'));
  });

  it('grant → active session audit trail → revoke', async () => {
    const audit0 = await maxId('superadmin_adminauditlog');
    const bg0 = await maxId('rbac_breakglasssession');
    const g = await S.engineer!.req('POST', '/api/rbac/break-glass/', { json: { reason: ' incident 42 ', hours: 'not-a-number' } });
    expect(g.django.status).toBe(201);
    same(g);
    const sid = (g.django.body as { id: number }).id;
    await sameRows('rbac_breakglasssession', `id > ${bg0}`);
    same(await S.engineer!.req('POST', '/api/rbac/break-glass/', { json: { reason: 'again' } })); // already active
    same(await S.engineer!.req('GET', '/api/rbac/break-glass/')); // own sessions only
    same(await S.superadmin!.req('GET', '/api/rbac/break-glass/'));
    // break-glass makes the engineer a full admin in permission checks
    same(await S.engineer!.req('GET', '/api/rbac/roles/'));
    same(await S.engineer!.req('GET', '/api/rbac/my-permissions/'));
    same(await S.staff!.req('POST', `/api/rbac/break-glass/${sid}/revoke/`)); // not holder, no rbac_engine → 403
    same(await S.reader!.req('POST', `/api/rbac/break-glass/${sid}/revoke/`)); // read-only rbac → 403
    const rv = await S.engineer!.req('POST', `/api/rbac/break-glass/${sid}/revoke/`);
    expect(rv.django.status).toBe(200);
    same(rv);
    same(await S.engineer!.req('POST', `/api/rbac/break-glass/${sid}/revoke/`)); // not active
    await sameRows('rbac_breakglasssession', `id > ${bg0}`);
    await sleep(500);
    // target_repr embeds expires_at with microseconds (created "now" on each side)
    await sameRows('superadmin_adminauditlog', `id > ${audit0}`, { ignore: ['id', 'target_repr', 'duration_ms'], order: 'created_at, id' });
  });

  it('hours capping + superadmin revoking someone else', async () => {
    const bg0 = await maxId('rbac_breakglasssession');
    const g = await S.superadmin!.req('POST', '/api/rbac/break-glass/', { json: { reason: 'cap', hours: 100 } });
    expect(g.django.status).toBe(201);
    same(g);
    await sameRows('rbac_breakglasssession', `id > ${bg0}`);
    const sid = (g.django.body as { id: number }).id;
    same(await S.superadmin!.req('POST', `/api/rbac/break-glass/${sid}/revoke/`));
    const g2 = await S.engineer!.req('POST', '/api/rbac/break-glass/', { json: { reason: 'short', hours: '0.5' } });
    same(g2);
    const sid2 = (g2.django.body as { id: number }).id;
    same(await S.superadmin!.req('POST', `/api/rbac/break-glass/${sid2}/revoke/`));
    const g3 = await S.engineer!.req('POST', '/api/rbac/break-glass/', { json: { reason: 'past', hours: -1 } }); // already expired
    same(g3);
    same(await S.engineer!.req('POST', `/api/rbac/break-glass/${(g3.django.body as { id: number }).id}/revoke/`));
    await sameRows('rbac_breakglasssession', `id > ${bg0}`);
  });
});

describe('dual-authorization approvals', () => {
  beforeAll(async () => {
    const ins = (id: number, key: string, by: number, status = 'pending', payload = '{"x": 1}') =>
      both(`INSERT INTO rbac_pendingapproval (id, action_key, payload, request_reason, requested_by_id, status, decided_by_id, decision_reason, decided_at, execution_result, execution_error, created_at)
            VALUES (${id}, '${key}', '${payload}', 'because ${id}', ${by}, '${status}', NULL, '', NULL, NULL, '', '2026-02-0${id - 910000}T00:00:00Z')`);
    await ins(910001, 'parity.noexec', acct.admin!.id);
    await ins(910002, 'parity.noexec', acct.superadmin!.id);
    await ins(910003, 'user.suspend', acct.superadmin!.id, 'pending', '{"user_id": 1}');
    await ins(910004, 'payment.refund', acct.admin!.id, 'approved');
    await ins(910005, 'parity.noexec', acct.admin!.id);
  });

  it('list filters and visibility', async () => {
    for (const who of ['superadmin', 'admin', 'staff', 'reader']) {
      for (const q of ['', '?status=all', '?status=approved', '?status=', '?status=rejected']) {
        same(await S[who]!.req('GET', `/api/rbac/approvals/${q}`));
      }
    }
  });

  it('approve / reject rules', async () => {
    const audit0 = await maxId('superadmin_adminauditlog');
    same(await S.admin!.req('POST', '/api/rbac/approvals/910001/approve/')); // admin lacks rbac_engine → 403
    same(await S.superadmin!.req('POST', '/api/rbac/approvals/910002/approve/')); // own request → 403
    same(await S.superadmin!.req('POST', '/api/rbac/approvals/910001/approve/')); // no executor → 400
    same(await S.superadmin!.req('POST', '/api/rbac/approvals/910004/approve/')); // already decided → 400
    same(await S.admin!.req('POST', '/api/rbac/approvals/910003/reject/', { json: { reason: '  not justified ' } }));
    same(await S.admin!.req('POST', '/api/rbac/approvals/910003/reject/', { json: { reason: 'again' } })); // decided
    same(await S.superadmin!.req('POST', '/api/rbac/approvals/910002/reject/')); // own → 403
    same(await S.superadmin!.req('POST', '/api/rbac/approvals/910005/reject/', { json: { reason: null } }));
    same(await S.superadmin!.req('POST', '/api/rbac/approvals/910001/reject/'));
    await sameRows('rbac_pendingapproval', 'id >= 910001', { ignore: ['decided_at'] });
    same(await S.superadmin!.req('GET', '/api/rbac/approvals/?status=all'));
    await sleep(300);
    await sameRows('superadmin_adminauditlog', `id > ${audit0}`, { ignore: ['id'], order: 'created_at, id' });
  });
});
