// Parity tests for the users app: /api/users/ (self-service, admin user
// management, phone/MoMo OTP change flows, account deletion, MFA).
import { createHmac } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accounts, dbs, flushRedis, Pair, PASSWORD, same, sameRows, type Side } from '../lib.js';

let acct: Awaited<ReturnType<typeof accounts>>;
const both = async (q: string, params: unknown[] = []) => {
  const [d, e] = await Promise.all([dbs.django.query(q, params), dbs.express.query(q, params)]);
  return { django: d.rows, express: e.rows };
};
const one = async (side: Side, q: string, params: unknown[] = []) => (await dbs[side].query(q, params)).rows;

// Fixture users (identical ids in both copies).
const SUPPORT = 90001; const TS = 90002; const KYC = 90003; const READER = 90004; const PLAINSTAFF = 90005;
const T1 = 90010; const T2 = 90011; const T3 = 90012; const T4 = 90013; const T5 = 90014; const T6 = 90015;

async function makeUser(id: number, f: Record<string, unknown> = {}) {
  const v = {
    username: `fx${id}`, email: `fx${id}@example.com`, first_name: `First${id}`, last_name: `Last${id}`, role: 'user',
    is_staff: false, is_superuser: false, is_active: true, email_verified: true, ...f,
  };
  await both(
    `INSERT INTO users_user (id, password, is_superuser, username, first_name, last_name, email, is_staff, is_active, date_joined,
       email_verified, role, is_archived) VALUES ($1::bigint, (SELECT password FROM users_user WHERE id = $2), $3, $4, $5, $6, $7, $8, $9,
       '2026-01-01T00:00:00Z'::timestamptz + ($1::bigint - 90000) * interval '1 minute', $10, $11, false)`,
    [id, acct.user!.id, v.is_superuser, v.username, v.first_name, v.last_name, v.email, v.is_staff, v.is_active, v.email_verified, v.role]);
  await both(`INSERT INTO users_profile (user_id, image, bio, is_superhost, phone_number) VALUES ($1, '', 'bio', false, $2)`, [id, `08800000${id % 100}`]);
}
const assign = (userId: number, roleId: number) => both('INSERT INTO rbac_userroleassignment (user_id, role_id, granted_at) VALUES ($1, $2, now())', [userId, roleId]);
const emailOf = (id: number) => `fx${id}@example.com`;
async function loginable(id: number) {
  await both('UPDATE users_user SET password = (SELECT password FROM users_user WHERE id = $2), is_active = true, email_verified = true WHERE id = $1', [id, acct.user!.id]);
  await both('DELETE FROM superadmin_mfadevice WHERE user_id = $1', [id]);
  return (await one('django', 'SELECT email FROM users_user WHERE id = $1', [id]))[0].email as string;
}
async function as(email: string) { await flushRedis(); const p = new Pair(); const r = await p.login(email); expect(r.django.status, r.django.text).toBe(200); same(r); return p; }
const maxId = async (table: string) => Number((await one('django', `SELECT coalesce(max(id), 0) AS m FROM ${table}`))[0].m);
const AUDIT_IGNORE = { ignore: ['created_at'] };
/** Row count of every table (both copies). */
async function tableCounts() {
  const tables = (await one('django', "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1")).map((r) => r.tablename as string);
  const q = tables.map((t) => `SELECT '${t}' AS t, count(*)::int AS n FROM "${t}"`).join(' UNION ALL ');
  const r = await both(q);
  const m = (rows: { t: string; n: number }[]) => Object.fromEntries(rows.map((x) => [x.t, x.n])) as Record<string, number>;
  return { django: m(r.django as never), express: m(r.express as never) };
}

beforeAll(async () => {
  acct = await accounts();
  await makeUser(SUPPORT, { is_staff: true }); await assign(SUPPORT, 3);
  await makeUser(TS, { is_staff: true }); await assign(TS, 1);
  await makeUser(KYC, { is_staff: true }); await assign(KYC, 10);
  await makeUser(READER, { is_staff: true });
  await both(`INSERT INTO rbac_role (id, slug, name, description, is_preset, created_at, updated_at) VALUES (9001, 'users_reader', 'Users reader', '', false, now(), now())`);
  await both(`INSERT INTO rbac_rolepermission (role_id, resource, action) VALUES (9001, 'users.profiles', 'read')`);
  await assign(READER, 9001);
  await makeUser(PLAINSTAFF, { is_staff: true });
  for (const id of [T1, T2, T3, T4, T5, T6]) await makeUser(id);
});
beforeEach(flushRedis);

const AUTH_ROUTES: [string, string][] = [
  ['GET', '/api/users/'], ['GET', '/api/users/admin/stats/'], ['GET', '/api/users/admin/list/'], ['POST', '/api/users/admin/create/'],
  ['POST', '/api/users/admin/bulk/'], ['GET', '/api/users/admin/1/'], ['PATCH', '/api/users/admin/1/update/'],
  ['PATCH', '/api/users/admin/1/email/'], ['POST', '/api/users/admin/1/reset-password/'], ['POST', '/api/users/admin/1/toggle-active/'],
  ['POST', '/api/users/admin/1/soft-delete/'], ['POST', '/api/users/admin/1/hard-delete/'], ['GET', '/api/users/me/dashboard/'],
  ['PATCH', '/api/users/me/profile/'], ['PUT', '/api/users/me/profile/'], ['DELETE', '/api/users/me/delete/'],
  ['POST', '/api/users/phone-change/initiate/'], ['POST', '/api/users/phone-change/verify/'], ['DELETE', '/api/users/phone-change/cancel/'],
  ['POST', '/api/users/momo-change/initiate/'], ['POST', '/api/users/momo-change/verify/'], ['DELETE', '/api/users/momo-change/cancel/'],
  ['GET', '/api/users/mfa/status/'], ['POST', '/api/users/mfa/setup/'], ['POST', '/api/users/mfa/confirm/'], ['POST', '/api/users/mfa/disable/'],
];

describe('access control', () => {
  for (const [m, path] of AUTH_ROUTES) {
    it(`anonymous ${m} ${path} → 401`, async () => same(await new Pair().req(m, path, { json: {} }), { headers: ['www-authenticate'] }));
  }
  it('wrong methods → 405', async () => {
    const p = await as(acct.user!.email);
    for (const [m, path] of [['POST', '/api/users/'], ['GET', '/api/users/me/profile/'], ['GET', '/api/users/phone-change/initiate/'],
      ['POST', '/api/users/phone-change/cancel/'], ['GET', '/api/users/admin/create/'], ['POST', '/api/users/1/'], ['GET', '/api/users/mfa/setup/']] as const) {
      same(await p.req(m, path, { json: {} }));
    }
  });
  it('admin endpoints: role matrix', async () => {
    const emails = [acct.user!.email, acct.agent!.email, emailOf(PLAINSTAFF), emailOf(SUPPORT), emailOf(KYC), emailOf(READER), acct.admin!.email, acct.superadmin!.email];
    for (const email of emails) {
      const p = await as(email);
      same(await p.req('GET', '/api/users/'));
      same(await p.req('GET', `/api/users/admin/list/?page_size=3`));
      same(await p.req('GET', `/api/users/admin/${T1}/`));
      same(await p.req('POST', '/api/users/admin/create/', { json: {} }));
      same(await p.req('PATCH', `/api/users/admin/${T1}/update/`, { json: {} }));
      same(await p.req('PATCH', `/api/users/admin/${T1}/email/`, { json: {} }));
      same(await p.req('POST', `/api/users/admin/${T1}/reset-password/`, { json: {} }));
      same(await p.req('POST', `/api/users/admin/${T1}/toggle-active/`, { json: {} }));
      same(await p.req('POST', `/api/users/admin/${T1}/soft-delete/`, { json: {} }));
      same(await p.req('POST', `/api/users/admin/${T1}/hard-delete/`, { json: {} }));
      same(await p.req('POST', '/api/users/admin/bulk/', { json: { action: 'deactivate', user_ids: [T1] } }));
    }
  });
});

describe('public / stats', () => {
  it('user_detail', async () => {
    const p = new Pair();
    for (const id of [acct.user!.id, acct.agent!.id, T1, 999999, '99999999999999999999']) same(await p.req('GET', `/api/users/${id}/`));
    same(await p.req('GET', '/api/users/abc/'));
  });
  it('users_collection (superadmin)', async () => same(await (await as(acct.superadmin!.email)).req('GET', '/api/users/')));
  it('admin stats', async () => {
    for (const email of [acct.admin!.email, emailOf(PLAINSTAFF), acct.superadmin!.email]) same(await (await as(email)).req('GET', '/api/users/admin/stats/'));
  });
});

describe('admin list / detail', () => {
  let p: Pair;
  beforeAll(async () => { p = await as(acct.superadmin!.email); });
  for (const q of ['', '?page=2', '?page=last', '?page=', '?page=99', '?page=abc', '?page_size=5', '?page_size=500', '?page_size=0', '?page_size=x&page=2',
    '?search=fx9001', '?search=FX900', '?search=%25', '?search=_', '?role=agent', '?role=admin&is_staff=true', '?is_active=false',
    '?is_active=yes', '?is_staff=false&page_size=10&page=2', '?search=%20%20']) {
    it(`list${q}`, async () => same(await p.req('GET', `/api/users/admin/list/${q}`)));
  }
  it('detail', async () => {
    for (const id of [T1, acct.admin!.id, 110, 403, 999999]) same(await p.req('GET', `/api/users/admin/${id}/`));
  });
  it('users.profiles read role can list but not create', async () => {
    const r = await as(emailOf(READER));
    same(await r.req('GET', '/api/users/admin/list/?search=fx'));
    same(await r.req('POST', '/api/users/admin/create/', { json: { username: 'x', email: 'x@example.com' } }));
  });
});

describe('admin create', () => {
  let p: Pair;
  beforeAll(async () => { p = await as(acct.admin!.email); });
  const base = { first_name: ' New ', last_name: 'Person', reason: 'phone call' };
  for (const [name, body] of [
    ['missing', {}], ['no email', { username: 'abc' }], ['bad role', { username: 'abc', email: 'a@example.com', role: 'admin' }],
    ['role list', { username: 'abc', email: 'a@example.com', role: ['user'] }],
    ['dup username', { username: 'fx90010', email: 'zz@example.com' }], ['invalid email', { username: 'abc9', email: 'not-an-email' }],
    ['dup email', { username: 'abc9', email: 'FX90010@example.com' }], ['common password', { username: 'abc9', email: 'abc9@example.com', password: 'password' }],
    ['numeric short', { username: 'abc9', email: 'abc9@example.com', password: '1234' }],
    ['numeric', { username: 'abc9', email: 'abc9@example.com', password: '98127364519' }],
    ['non-dict', ['a']],
  ] as const) {
    it(`validation: ${name}`, async () => same(await p.req('POST', '/api/users/admin/create/', { json: body })));
  }
  it('success with password', async () => {
    const audit = await maxId('superadmin_adminauditlog');
    const r = await p.req('POST', '/api/users/admin/create/', { json: { ...base, username: 'created1', email: ' Created1@Example.com ', password: 'Sturdy-pass-91', role: 'agent' } });
    expect(r.django.status, r.django.text).toBe(201);
    same(r);
    await sameRows('users_user', "username = 'created1'", { ignore: ['password', 'date_joined'] });
    await sameRows('users_profile', "user_id = (SELECT id FROM users_user WHERE username = 'created1')");
    await sameRows('notifications_notificationpreference', "user_id = (SELECT id FROM users_user WHERE username = 'created1')", { ignore: ['created_at', 'updated_at'] });
    await sameRows('superadmin_adminauditlog', `id > ${audit}`, AUDIT_IGNORE);
    // the new account can log in with that password on both sides
    const l = await new Pair().login('created1@example.com', 'Sturdy-pass-91');
    expect(l.django.status).toBe(200);
    same(l);
  });
  it('success with generated password', async () => {
    const r = await p.req('POST', '/api/users/admin/create/', { json: { username: 'created2', email: 'created2@example.com', password: '   ' } });
    expect(r.django.status).toBe(201);
    same(r, { ignore: ['generated_password'] });
    for (const s of ['django', 'express'] as const) expect(String((r[s].body as { generated_password: string }).generated_password)).toMatch(/^[\w-]{16}$/);
    await sameRows('users_user', "username = 'created2'", { ignore: ['password', 'date_joined'] });
  });
});

describe('admin update / email / password / toggle', () => {
  it('update', async () => {
    const admin = await as(acct.admin!.email);
    const sa = await as(acct.superadmin!.email);
    const audit = await maxId('superadmin_adminauditlog');
    same(await admin.req('PATCH', `/api/users/admin/${T1}/update/`, { json: { foo: 1 } }));
    same(await admin.req('PATCH', `/api/users/admin/${T1}/update/`, { json: { role: 'superadmin' } }));
    same(await admin.req('PATCH', `/api/users/admin/${acct.superadmin!.id}/update/`, { json: { role: 'user' } }));
    same(await admin.req('PATCH', `/api/users/admin/${T1}/update/`, { json: { role: 'boss' } }));
    same(await admin.req('PATCH', `/api/users/admin/${T1}/update/`, { json: { role: 'admin' } }));
    same(await admin.req('PATCH', `/api/users/admin/999999/update/`, { json: { role: 'admin' } }));
    same(await admin.req('PATCH', `/api/users/admin/${T1}/update/`, { json: { first_name: 'X'.repeat(200), last_name: null, reason: 7 } }));
    same(await admin.req('PATCH', `/api/users/admin/${T1}/update/`, { json: { role: 'agent' } }));
    same(await admin.req('PATCH', `/api/users/admin/${T1}/update/`, { json: { role: 'agent' } })); // unchanged role → no fields
    same(await sa.req('PATCH', `/api/users/admin/${T1}/update/`, { json: { role: 'admin', first_name: 'Promoted' } }));
    await sameRows('users_user', `id = ${T1}`, { ignore: ['password', 'date_joined'] });
    await sameRows('rbac_userroleassignment', `user_id = ${T1}`, { ignore: ['granted_at'] });
    same(await sa.req('PATCH', `/api/users/admin/${T1}/update/`, { json: { role: 'user' } }));
    await sameRows('users_user', `id = ${T1}`, { ignore: ['password', 'date_joined'] });
    await sameRows('rbac_userroleassignment', `user_id = ${T1}`, { ignore: ['granted_at'] });
    await sameRows('superadmin_adminauditlog', `id > ${audit}`, AUDIT_IGNORE);
  });
  it('change email', async () => {
    const p = await as(acct.admin!.email);
    const supportPii = await as(emailOf(TS)); // trust_safety preset has users.pii read only
    same(await supportPii.req('PATCH', `/api/users/admin/${T2}/email/`, { json: { email: 'x@example.com' } }));
    const audit = await maxId('superadmin_adminauditlog');
    for (const body of [{}, { email: '  ' }, { email: 'bad' }, { email: 'FX90011@example.com', reason: 'same' }, { email: emailOf(T3) }, { email: ' New.Mail@Example.COM ', reason: 'lost inbox' }]) {
      same(await p.req('PATCH', `/api/users/admin/${T2}/email/`, { json: body }));
    }
    await sameRows('users_user', `id = ${T2}`, { ignore: ['password', 'date_joined'] });
    await sameRows('superadmin_adminauditlog', `id > ${audit}`, AUDIT_IGNORE);
  });
  it('reset password', async () => {
    const target = await as(emailOf(T3)); // creates outstanding tokens on both sides
    const p = await as(acct.admin!.email);
    const audit = await maxId('superadmin_adminauditlog');
    for (const body of [{}, { password: '' }, { password: 'short' }, { password: 'fx90012abc' }, { password: 'First90012' }, { password: 'password1' }, { password: 123456789 }]) {
      same(await p.req('POST', `/api/users/admin/${T3}/reset-password/`, { json: body }));
    }
    same(await p.req('POST', `/api/users/admin/${T3}/reset-password/`, { json: { password: 'Brand-new-pass-7', reason: 'locked out' } }));
    await sameRows('superadmin_adminauditlog', `id > ${audit}`, AUDIT_IGNORE);
    await sameRows('token_blacklist_blacklistedtoken', `token_id IN (SELECT id FROM token_blacklist_outstandingtoken WHERE user_id = ${T3})`, { ignore: ['blacklisted_at', 'id', 'token_id'] });
    // old refresh token is now rejected; new password works
    same(await target.req('POST', '/api/auth/refresh-token/'));
    const l = await new Pair().login(emailOf(T3), 'Brand-new-pass-7');
    expect(l.django.status).toBe(200);
    same(l);
  });
  it('toggle active', async () => {
    const p = await as(acct.admin!.email);
    const audit = await maxId('superadmin_adminauditlog');
    same(await p.req('POST', `/api/users/admin/${acct.admin!.id}/toggle-active/`, { json: { is_active: false } }));
    for (const body of [{}, { is_active: null }, { is_active: 'false' }, { is_active: 0 }, { is_active: [] }, { is_active: true, reason: 'ok' }]) {
      same(await p.req('POST', `/api/users/admin/${T4}/toggle-active/`, { json: body }));
      await sameRows('users_user', `id = ${T4}`, { ignore: ['password', 'date_joined'] });
    }
    same(await p.req('POST', `/api/users/admin/${acct.superadmin!.id}/toggle-active/`, { json: { is_active: false } }));
    same(await p.req('POST', `/api/users/admin/${acct.superadmin!.id}/toggle-active/`, { json: { is_active: true } }));
    await sameRows('superadmin_adminauditlog', `id > ${audit}`, AUDIT_IGNORE);
  });
});

describe('deletion', () => {
  it('admin soft delete', async () => {
    const p = await as(acct.admin!.email);
    const audit = await maxId('superadmin_adminauditlog');
    same(await p.req('POST', `/api/users/admin/${acct.admin!.id}/soft-delete/`, { json: { reason: 'x' } }));
    same(await p.req('POST', `/api/users/admin/${acct.superadmin!.id}/soft-delete/`, { json: { reason: 'x' } }));
    same(await p.req('POST', `/api/users/admin/${T5}/soft-delete/`, { json: { reason: '  ' } }));
    same(await p.req('POST', `/api/users/admin/${acct.customer!.id}/soft-delete/`, { json: { reason: 'spam' } })); // has an upcoming booking
    await new Pair().login(emailOf(T5)); // outstanding tokens to blacklist
    same(await p.req('POST', `/api/users/admin/${T5}/soft-delete/`, { json: { reason: 'spam account' } }));
    await sameRows('users_user', `id = ${T5}`, { ignore: ['password', 'date_joined'] });
    await sameRows('users_profile', `user_id = ${T5}`);
    await sameRows('superadmin_adminauditlog', `id > ${audit}`, AUDIT_IGNORE);
    const bl = await both(`SELECT count(*)::int n FROM token_blacklist_blacklistedtoken WHERE token_id IN (SELECT id FROM token_blacklist_outstandingtoken WHERE user_id = ${T5})`);
    expect(bl.express[0].n).toBe(bl.django[0].n);
    expect(bl.django[0].n).toBeGreaterThan(0);
  });
  it('admin soft delete: host with listings', async () => {
    const p = await as(acct.superadmin!.email);
    await both("UPDATE bookings_booking SET status = 'completed' WHERE listing_id IN (SELECT id FROM listings_listing WHERE owner_id = 402)");
    same(await p.req('POST', `/api/users/admin/402/soft-delete/`, { json: { reason: 'closed' } }));
    await sameRows('users_user', 'id = 402', { ignore: ['password'] });
    await sameRows('listings_listing', 'owner_id = 402', { ignore: ['deleted_at'] });
    const d = await both('SELECT count(*)::int n FROM listings_listing WHERE owner_id = 402 AND deleted_at IS NOT NULL');
    expect(d.express[0].n).toBe(d.django[0].n);
  });
  it('self delete', async () => {
    const blocked = await as(acct.customer!.email);
    same(await blocked.req('DELETE', '/api/users/me/delete/'));
    const host = await as(await loginable(403));
    same(await host.req('DELETE', '/api/users/me/delete/'));
    await sameRows('users_user', 'id = 403', { ignore: ['password'] });
    await sameRows('users_profile', 'user_id = 403');
    await sameRows('hostapplications_hostapplication', 'applicant_id = 403');
    // the account is now inactive: the old access token is rejected
    same(await host.req('GET', '/api/users/me/dashboard/'), { headers: ['www-authenticate'] });
  });
  it('hard delete', async () => {
    const p = await as(acct.superadmin!.email);
    const audit = await maxId('superadmin_adminauditlog');
    same(await p.req('POST', `/api/users/admin/${acct.superadmin!.id}/hard-delete/`, { json: { reason: 'x' } }));
    same(await p.req('POST', `/api/users/admin/${T6}/hard-delete/`, { json: {} }));
    same(await p.req('POST', `/api/users/admin/${acct.user!.id}/hard-delete/`, { json: { reason: 'x' } }));
    same(await p.req('POST', `/api/users/admin/12/hard-delete/`, { json: { reason: 'history', force: 'yes' } }));
    await sameRows('rbac_pendingapproval', "action_key = 'user.hard_delete'", { ignore: ['created_at'] });
    await new Pair().login(emailOf(T6)); // outstanding token (SET_NULL), notification prefs (CASCADE)
    same(await p.req('POST', `/api/users/admin/${T6}/hard-delete/`, { json: { reason: 'spam' } }));
    for (const t of ['users_user', 'users_profile', 'notifications_notificationpreference']) {
      const c = await both(`SELECT count(*)::int n FROM ${t} WHERE ${t === 'users_user' ? 'id' : 'user_id'} = ${T6}`);
      expect(c.django[0].n).toBe(0);
      expect(c.express[0].n).toBe(0);
    }
    // second admin approves the forced delete of user 12 (deep CASCADE / SET_NULL through bookings, payments, ...)
    const approvalId = Number((await one('django', "SELECT id FROM rbac_pendingapproval WHERE action_key = 'user.hard_delete' ORDER BY id DESC LIMIT 1"))[0].id);
    const before = await tableCounts();
    expect(before.express).toEqual(before.django);
    const ap = await (await as(await loginable(4))).req('POST', `/api/rbac/approvals/${approvalId}/approve/`, { json: {} });
    same(ap, { ignore: ['decided_at'] });
    expect((ap.django.body as { status: string }).status, ap.django.text).toBe('approved');
    const after = await tableCounts();
    expect(after.express).toEqual(after.django);
    expect(after.django.users_user).toBe(before.django.users_user! - 1);
    await sameRows('rbac_pendingapproval', `id = ${approvalId}`, { ignore: ['created_at', 'decided_at'] });
    for (const [t, col] of [['reports_report', 'reported_user_id'], ['suspensions_suspension', 'issued_by_id'], ['listings_listing', 'claimed_by_user_id']]) {
      const c = await both(`SELECT count(*)::int n FROM ${t} WHERE ${col} IS NULL`);
      expect(c.express[0].n).toBe(c.django[0].n);
    }
    await sameRows('token_blacklist_outstandingtoken', 'user_id IS NULL', { ignore: ['id', 'token', 'jti', 'created_at', 'expires_at'] });
    await sameRows('superadmin_adminauditlog', `id > ${audit}`, AUDIT_IGNORE);
  });
});

describe('bulk', () => {
  let p: Pair;
  beforeAll(async () => { p = await as(acct.superadmin!.email); });
  const B = [90020, 90021, 90022, 90023];
  beforeAll(async () => { for (const id of B) await makeUser(id); });
  it('validation', async () => {
    for (const body of [{}, { action: 'nope', user_ids: [1] }, { action: 'deactivate' }, { action: 'deactivate', user_ids: 'x' },
      { action: 'deactivate', user_ids: Array.from({ length: 201 }, (_, i) => i) }, { action: 'assign_role', user_ids: [1] },
      { action: ['x'], user_ids: [1] }]) {
      same(await p.req('POST', '/api/users/admin/bulk/', { json: body }));
    }
    const s = await as(emailOf(SUPPORT));
    same(await s.req('POST', '/api/users/admin/bulk/', { json: { action: 'assign_role', user_ids: [1], role_id: 3 } }));
  });
  it('deactivate / reactivate with missing and own ids', async () => {
    const audit = await maxId('superadmin_adminauditlog');
    same(await p.req('POST', '/api/users/admin/bulk/', { json: { action: 'deactivate', user_ids: [999998, B[0], 999997, acct.superadmin!.id, 4, B[1], 17, 999999, 33333], reason: 'bulk' } }));
    await sameRows('users_user', `id IN (${B.join(',')})`, { ignore: ['password', 'date_joined'] });
    // str elements hash randomly in CPython, so only one non-int missing value per request (order would be nondeterministic in Django itself)
    same(await p.req('POST', '/api/users/admin/bulk/', { json: { action: 'reactivate', user_ids: [B[0], String(B[1]), true] } }));
    same(await p.req('POST', '/api/users/admin/bulk/', { json: { action: 'reactivate', user_ids: [null, B[1]] } }));
    await sameRows('users_user', `id IN (${B.join(',')}, 1)`, { ignore: ['password', 'date_joined', 'last_login'] });
    await sameRows('superadmin_adminauditlog', `id > ${audit}`, AUDIT_IGNORE);
  });
  it('assign / remove role', async () => {
    for (const body of [
      { action: 'assign_role', user_ids: [B[2], B[3]], role_id: 99 }, { action: 'assign_role', user_ids: [B[2]], role_id: 100 },
      { action: 'assign_role', user_ids: [B[2]], role_id: 424242 }, { action: 'assign_role', user_ids: [B[2]], role_id: 'abc' },
      { action: 'assign_role', user_ids: [B[3]], role_id: 3 }, { action: 'remove_role', user_ids: [B[2], B[3]], role_id: 99 },
    ]) {
      same(await p.req('POST', '/api/users/admin/bulk/', { json: body }));
      await sameRows('users_user', `id IN (${B.join(',')})`, { ignore: ['password', 'date_joined'] });
      await sameRows('rbac_userroleassignment', `user_id IN (${B.join(',')})`, { ignore: ['granted_at', 'id'] });
    }
  });
  it('soft / hard delete', async () => {
    same(await p.req('POST', '/api/users/admin/bulk/', { json: { action: 'soft_delete', user_ids: [B[0], acct.customer!.id, 1] } }));
    await sameRows('users_user', `id = ${B[0]}`, { ignore: ['password', 'date_joined'] });
    same(await p.req('POST', '/api/users/admin/bulk/', { json: { action: 'hard_delete', user_ids: [B[1], acct.user!.id, 4] } }));
    const c = await both(`SELECT count(*)::int n FROM users_user WHERE id = ${B[1]}`);
    expect([c.django[0].n, c.express[0].n]).toEqual([0, 0]);
  });
  it('non-numeric id → 500 on both', async () => same(await p.req('POST', '/api/users/admin/bulk/', { json: { action: 'deactivate', user_ids: ['abc'] } })));
});

describe('dashboard / profile', () => {
  it('dashboard for several users', async () => {
    for (const id of [3, 27, 33, 60, 110, 4]) {
      const p = await as(await loginable(id));
      same(await p.req('GET', '/api/users/me/dashboard/'));
    }
  });
  it('profile update (JSON)', async () => {
    const p = await as(emailOf(T4));
    for (const body of [{}, { first_name: '', last_name: 'Changed', bio: 'New bio' }, { first_name: 12, role: 'agent' }, { role: 'admin' },
      { role: 'user', email: ' Mixed.Case@Example.com ' }, { bio: '' }]) {
      same(await p.req('PATCH', '/api/users/me/profile/', { json: body }));
      await sameRows('users_user', `id = ${T4}`, { ignore: ['password', 'date_joined'] });
      await sameRows('users_profile', `user_id = ${T4}`);
    }
    same(await p.req('PUT', '/api/users/me/profile/', { json: { first_name: null } }));
    same(await p.req('PUT', '/api/users/me/profile/', { json: { email: emailOf(T1) } }));
  });
  it('admin cannot self-demote; image upload; too large', async () => {
    const a = await as(acct.admin!.email);
    same(await a.req('PATCH', '/api/users/me/profile/', { json: { role: 'user' } }));
    const p = await as(await loginable(T4));
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    const fd = () => { const f = new FormData(); f.append('bio', 'multipart bio'); f.append('first_name', 'Multi'); f.append('image', new Blob([png], { type: 'image/png' }), 'my avatar.png'); return f; };
    same(await p.req('PATCH', '/api/users/me/profile/', { form: fd() }));
    await sameRows('users_profile', `user_id = ${T4}`);
    same(await p.req('PATCH', '/api/users/me/profile/', { form: fd() }), { ignore: ['image'] }); // collision suffix is random
    const big = new FormData(); big.append('image', new Blob([Buffer.alloc(10 * 1024 * 1024 + 1)]), 'big.png');
    same(await p.req('PATCH', '/api/users/me/profile/', { form: big }));
  });
});

describe('phone change', () => {
  it('validation + full OTP flow', async () => {
    const id = 90030; await makeUser(id);
    const p = await as(emailOf(id));
    same(await p.req('POST', '/api/users/phone-change/initiate/', { json: { new_phone_number: '0880000111' } }));
    same(await p.req('POST', '/api/users/phone-change/initiate/', { json: { new_phone_number: '0880000111', network_provider: 'vodafone' } }));
    same(await p.req('POST', '/api/users/phone-change/initiate/', { json: { new_phone_number: '0880000111', network_provider: 'MTN' } }));
    same(await p.req('POST', '/api/users/phone-change/initiate/', { json: { password: 'wrong', new_phone_number: '0880000111', network_provider: 'mtn' } }));
    same(await p.req('POST', '/api/users/phone-change/initiate/', { json: { password: PASSWORD, new_phone_number: '0880000030', network_provider: 'mtn' } }));
    // 6th request this hour → throttled (phone_change 5/hour)
    same(await p.req('POST', '/api/users/phone-change/verify/', { json: { otp: '1' } }), { headers: ['retry-after'] });
    await flushRedis();
    same(await p.req('POST', '/api/users/phone-change/verify/', { json: { otp: '' } }));
    same(await p.req('POST', '/api/users/phone-change/verify/', { json: { otp: '123456' } }));
    same(await p.req('POST', '/api/users/phone-change/initiate/', { json: { password: PASSWORD, new_phone_number: ' 0770123456 ', network_provider: ' Orange ' } }));
    await sameRows('users_phonechangerequest', `user_id = ${id}`, { ignore: ['email_otp', 'sms_otp', 'email_otp_expiry', 'sms_otp_expiry', 'created_at', 'id'] });
    same(await p.req('POST', '/api/users/phone-change/verify/', { json: { otp: 'nope00' } }));
    const notif = await maxId('notifications_notification');
    const otp = async (s: Side) => (await one(s, 'SELECT email_otp FROM users_phonechangerequest WHERE user_id = $1', [id]))[0].email_otp as string;
    const [od, oe] = await Promise.all([otp('django'), otp('express')]);
    expect(od).toMatch(/^\d{6}$/);
    const [vd, ve] = await Promise.all([p.django.req('POST', '/api/users/phone-change/verify/', { json: { otp: ` ${od} ` } }), p.express.req('POST', '/api/users/phone-change/verify/', { json: { otp: ` ${oe} ` } })]);
    same({ django: vd, express: ve });
    await sameRows('users_profile', `user_id = ${id}`);
    await sameRows('users_phonechangerequest', `user_id = ${id}`);
    await sameRows('notifications_notification', `id > ${notif} AND user_id = ${id}`, { ignore: ['created_at'] });
    await flushRedis();
    same(await p.req('POST', '/api/users/phone-change/initiate/', { json: { password: PASSWORD, new_phone_number: '0770123456', network_provider: 'mtn' } }));
    same(await p.req('DELETE', '/api/users/phone-change/cancel/'));
    same(await p.req('DELETE', '/api/users/phone-change/cancel/'));
  });
  it('expired code, non-string body values, SSO account without password', async () => {
    const id = 90031; await makeUser(id);
    const p = await as(emailOf(id));
    same(await p.req('POST', '/api/users/phone-change/initiate/', { json: { password: PASSWORD, new_phone_number: '0880000999', network_provider: 'mtn' } }));
    await both("UPDATE users_phonechangerequest SET email_otp_expiry = now() - interval '1 minute' WHERE user_id = $1", [id]);
    same(await p.req('POST', '/api/users/phone-change/verify/', { json: { otp: '000000' } }));
    await sameRows('users_phonechangerequest', `user_id = ${id}`);
    same(await p.req('POST', '/api/users/phone-change/verify/', { json: { otp: 5 } }));
    await both("UPDATE users_user SET password = '!unusable' WHERE id = $1", [id]);
    same(await p.req('POST', '/api/users/phone-change/initiate/', { form: (() => { const f = new FormData(); f.append('new_phone_number', '0880000777'); f.append('network_provider', 'orange'); return f; })() }));
    await sameRows('users_phonechangerequest', `user_id = ${id}`, { ignore: ['email_otp', 'sms_otp', 'email_otp_expiry', 'sms_otp_expiry', 'created_at', 'id'] });
  });
});

describe('momo change', () => {
  it('non-host → 403', async () => {
    const p = await as(acct.user!.email);
    same(await p.req('POST', '/api/users/momo-change/initiate/', { json: { new_momo_number: '0880000111' } }));
    same(await p.req('POST', '/api/users/momo-change/verify/', { json: { otp: '1' } }));
    same(await p.req('DELETE', '/api/users/momo-change/cancel/'));
  });
  it('approved host flow', async () => {
    const p = await as(await loginable(110));
    for (const body of [{}, { new_momo_number: '0550000111' }, { new_momo_number: '0880501732' }, { new_momo_number: '0880501733' },
      { new_momo_number: '0880501733', password: 'bad' }]) {
      same(await p.req('POST', '/api/users/momo-change/initiate/', { json: body }));
    }
    await flushRedis();
    same(await p.req('POST', '/api/users/momo-change/initiate/', { json: { new_momo_number: '0880501732', password: PASSWORD } }));
    same(await p.req('POST', '/api/users/momo-change/initiate/', { json: { new_momo_number: '+231 77 123 4567', password: PASSWORD } }));
    await sameRows('users_momochangerequest', 'user_id = 110', { ignore: ['email_otp', 'sms_otp', 'email_otp_expiry', 'sms_otp_expiry', 'created_at', 'id'] });
    same(await p.req('POST', '/api/users/momo-change/verify/', { json: { otp: '000000x' } }));
    const notif = await maxId('notifications_notification');
    const otp = async (s: Side) => (await one(s, 'SELECT email_otp FROM users_momochangerequest WHERE user_id = 110'))[0].email_otp as string;
    const [od, oe] = await Promise.all([otp('django'), otp('express')]);
    const [vd, ve] = await Promise.all([p.django.req('POST', '/api/users/momo-change/verify/', { json: { otp: od } }), p.express.req('POST', '/api/users/momo-change/verify/', { json: { otp: oe } })]);
    same({ django: vd, express: ve });
    await sameRows('hostapplications_hostapplication', 'applicant_id = 110', { ignore: ['updated_at'] });
    await sameRows('users_momochangerequest', 'user_id = 110');
    await sameRows('notifications_notification', `id > ${notif} AND user_id = 110`, { ignore: ['created_at'] });
    await flushRedis();
    same(await p.req('GET', `/api/users/admin/110/`)); // not staff → 403
    const sa = await as(acct.superadmin!.email);
    same(await sa.req('GET', `/api/users/admin/110/`)); // momo_number from the approved application
  });
});

// ---- MFA ----------------------------------------------------------------------------------

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function totp(secret: string, offset = 0): string {
  let bits = 0; let value = 0; const bytes: number[] = [];
  for (const ch of secret) { value = (value << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 0xff); bits -= 8; } }
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
  const h = createHmac('sha1', Buffer.from(bytes)).update(msg).digest();
  const o = h[19]! & 0xf;
  return String((((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!) % 1_000_000).padStart(6, '0');
}

describe('mfa', () => {
  it('setup → confirm → disable (TOTP and backup code)', async () => {
    const id = 90040; await makeUser(id);
    const p = await as(emailOf(id));
    same(await p.req('GET', '/api/users/mfa/status/'));
    same(await p.req('POST', '/api/users/mfa/confirm/', { json: { code: '123456' } }));
    same(await p.req('POST', '/api/users/mfa/disable/', { json: { code: '123456' } }));
    const s1 = await p.req('POST', '/api/users/mfa/setup/');
    same(s1, { ignore: ['secret', 'otpauth_url', 'qr_code_base64'] });
    for (const side of ['django', 'express'] as const) {
      const b = s1[side].body as { secret: string; otpauth_url: string; qr_code_base64: string };
      expect(b.secret).toMatch(/^[A-Z2-7]{32}$/);
      expect(b.otpauth_url.replace(b.secret, 'S')).toBe((s1.django.body as { otpauth_url: string; secret: string }).otpauth_url.replace((s1.django.body as { secret: string }).secret, 'S'));
      const png = Buffer.from(b.qr_code_base64, 'base64');
      expect(png.subarray(1, 4).toString()).toBe('PNG');
    }
    // same image dimensions (version / box size / border)
    const dims = (side: Side) => { const png = Buffer.from((s1[side].body as { qr_code_base64: string }).qr_code_base64, 'base64'); return [png.readUInt32BE(16), png.readUInt32BE(20)]; };
    expect(dims('express')).toEqual(dims('django'));
    await sameRows('superadmin_mfadevice', `user_id = ${id}`, { ignore: ['secret', 'created_at', 'id'] });
    same(await p.req('POST', '/api/users/mfa/setup/'), { ignore: ['secret', 'otpauth_url', 'qr_code_base64'] }); // re-setup while pending
    same(await p.req('POST', '/api/users/mfa/confirm/', { json: { code: '000000' } }));
    const secret = async (s: Side) => (await one(s, 'SELECT secret FROM superadmin_mfadevice WHERE user_id = $1', [id]))[0].secret as string;
    const [sd, se] = await Promise.all([secret('django'), secret('express')]);
    const [cd, ce] = await Promise.all([
      p.django.req('POST', '/api/users/mfa/confirm/', { json: { code: totp(sd) } }), p.express.req('POST', '/api/users/mfa/confirm/', { json: { code: ` ${totp(se, -1)}` } })]);
    same({ django: cd, express: ce }, { ignore: ['backup_codes'] });
    expect((cd.body as { backup_codes: string[] }).backup_codes).toHaveLength(8);
    expect((ce.body as { backup_codes: string[] }).backup_codes.every((c) => /^[0-9a-f]{8}$/.test(c))).toBe(true);
    await sameRows('superadmin_mfadevice', `user_id = ${id}`, { ignore: ['secret', 'created_at', 'id', 'backup_codes', 'confirmed_at'] });
    same(await p.req('GET', '/api/users/mfa/status/'));
    same(await p.req('POST', '/api/users/mfa/setup/'));
    same(await p.req('POST', '/api/users/mfa/confirm/', { json: { code: '1' } }));
    same(await p.req('POST', '/api/users/mfa/disable/', { json: { code: 'deadbeef' } }));
    // login now requires MFA on both sides
    same(await new Pair().login(emailOf(id)), { ignore: ['mfa_token'] });
    // disable with a backup code
    const bd = (cd.body as { backup_codes: string[] }).backup_codes[2]!; const be = (ce.body as { backup_codes: string[] }).backup_codes[2]!;
    const [dd, de] = await Promise.all([p.django.req('POST', '/api/users/mfa/disable/', { json: { code: bd } }), p.express.req('POST', '/api/users/mfa/disable/', { json: { code: be } })]);
    same({ django: dd, express: de });
    await sameRows('superadmin_mfadevice', `user_id = ${id}`);
  });
  it('disable with TOTP; backup code consumed on failure path', async () => {
    const id = 90041; await makeUser(id);
    const p = await as(emailOf(id));
    await p.req('POST', '/api/users/mfa/setup/');
    const secret = async (s: Side) => (await one(s, 'SELECT secret FROM superadmin_mfadevice WHERE user_id = $1', [id]))[0].secret as string;
    const [sd, se] = await Promise.all([secret('django'), secret('express')]);
    await Promise.all([p.django.req('POST', '/api/users/mfa/confirm/', { json: { code: totp(sd) } }), p.express.req('POST', '/api/users/mfa/confirm/', { json: { code: totp(se) } })]);
    const [dd, de] = await Promise.all([p.django.req('POST', '/api/users/mfa/disable/', { json: { code: totp(sd, 1) } }), p.express.req('POST', '/api/users/mfa/disable/', { json: { code: totp(se, 1) } })]);
    same({ django: dd, express: de });
    same(await p.req('GET', '/api/users/mfa/status/'));
  });
});
