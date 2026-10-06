// Parity tests for the suspensions app: /api/suspensions/ (+ the user.suspend dual-auth executor
// via /api/rbac/ approvals, and the SuspensionMiddleware effect on the suspended account).
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accounts, dbs, flushRedis, Pair, same, sameRows } from '../lib.js';

let acct: Awaited<ReturnType<typeof accounts>>;
const both = async (q: string, params: unknown[] = []) => {
  const [d, e] = await Promise.all([dbs.django.query(q, params), dbs.express.query(q, params)]);
  return { django: d.rows, express: e.rows };
};
const SUPPORT = 91001; const TS = 91002; const KYC = 91003; const BANS = 91004; const PLAIN = 91005;
const V1 = 91010; const V2 = 91011; const V3 = 91012; const HOST = 91013;
const emailOf = (id: number) => `sx${id}@example.com`;

async function makeUser(id: number, f: { is_staff?: boolean } = {}) {
  await both(
    `INSERT INTO users_user (id, password, is_superuser, username, first_name, last_name, email, is_staff, is_active, date_joined, email_verified, role, is_archived)
     VALUES ($1::bigint, (SELECT password FROM users_user WHERE id = $2), false, 'sx' || $1::text, 'S', 'X', 'sx' || $1::text || '@example.com', $3, true, now(), true, 'user', false)`,
    [id, acct.user!.id, f.is_staff ?? false]);
  await both(`INSERT INTO users_profile (user_id, image, bio, is_superhost, phone_number) VALUES ($1, '', '', false, '')`, [id]);
}
const assign = (u: number, r: number) => both('INSERT INTO rbac_userroleassignment (user_id, role_id, granted_at) VALUES ($1, $2, now())', [u, r]);
async function as(email: string) { await flushRedis(); const p = new Pair(); const r = await p.login(email); expect(r.django.status, r.django.text).toBe(200); return p; }
const maxId = async (t: string) => Number((await dbs.django.query(`SELECT coalesce(max(id), 0) AS m FROM ${t}`)).rows[0].m);
const SUSP_IGNORE = { ignore: ['started_at', 'updated_at', 'revoked_at'] };
const future = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

beforeAll(async () => {
  acct = await accounts();
  await makeUser(SUPPORT, { is_staff: true }); await assign(SUPPORT, 3);
  await makeUser(TS, { is_staff: true }); await assign(TS, 1);
  await makeUser(KYC, { is_staff: true }); await assign(KYC, 10);
  await makeUser(BANS, { is_staff: true });
  await both(`INSERT INTO rbac_role (id, slug, name, description, is_preset, created_at, updated_at) VALUES (9101, 'bans_reader', 'Bans', '', false, now(), now())`);
  await both(`INSERT INTO rbac_rolepermission (role_id, resource, action) VALUES (9101, 'trust_safety.bans', 'read')`);
  await assign(BANS, 9101);
  await makeUser(PLAIN, { is_staff: true });
  for (const id of [V1, V2, V3, HOST]) await makeUser(id);
  // HOST owns 4 published listings → suspension needs dual authorization
  await both(`INSERT INTO listings_listing (title, description, price, bedrooms, beds, bathrooms, max_guests, property_type, privacy_type, booking_mode, owner_id,
      address, city, state, country, check_in_time, check_out_time, self_checkin, square_footage, amenities, highlights, weekend_premium_percent, new_listing_promo,
      last_minute_discount_enabled, last_minute_discount_percent, weekly_discount_enabled, weekly_discount_percent, monthly_discount_enabled, monthly_discount_percent,
      exterior_camera, noise_monitor, weapons_on_property, pricing_type, cancellation_policy, is_available, status, created_at, updated_at, agent_owner_name,
      agent_owner_phone, agent_owner_email, agent_owner_payout_number, agent_owner_payout_network, suspension_reason, local_registration_number)
    SELECT 'L' || g, '', 100, 1, 1, 1, 1, 'apartment', 'entire_place', 'instant', $1, 'addr', '', '', '', '15:00', '11:00', false, 0, '[]', '[]', 0, false,
      false, 0, false, 0, false, 0, false, false, false, 'nightly', 'flexible', true, 'published', now(), now(), '', '', '', '', 'mtn', '', ''
    FROM generate_series(1, 4) g`, [HOST]);
});
beforeEach(flushRedis);

describe('access control', () => {
  for (const [m, path] of [['GET', '/api/suspensions/'], ['POST', '/api/suspensions/'], ['GET', '/api/suspensions/1/'], ['POST', '/api/suspensions/1/revoke/'],
    ['GET', '/api/suspensions/user/1/'], ['GET', '/api/suspensions/stats/']] as const) {
    it(`anonymous ${m} ${path}`, async () => same(await new Pair().req(m, path, { json: {} }), { headers: ['www-authenticate'] }));
  }
  it('role matrix', async () => {
    for (const email of [acct.user!.email, emailOf(PLAIN), emailOf(KYC), emailOf(SUPPORT), emailOf(TS), emailOf(BANS), acct.admin!.email, acct.superadmin!.email]) {
      const p = await as(email);
      same(await p.req('GET', '/api/suspensions/'));
      same(await p.req('GET', '/api/suspensions/stats/'));
      same(await p.req('GET', '/api/suspensions/999/'));
      same(await p.req('POST', '/api/suspensions/999/revoke/', { json: {} }));
      same(await p.req('GET', `/api/suspensions/user/${V1}/`));
      same(await p.req('POST', '/api/suspensions/', { json: {} }));
    }
  });
  it('wrong methods', async () => {
    const p = await as(acct.admin!.email);
    same(await p.req('PUT', '/api/suspensions/', { json: {} }));
    same(await p.req('GET', '/api/suspensions/1/revoke/'));
    same(await p.req('POST', '/api/suspensions/stats/'));
  });
});

describe('create / list / detail / revoke', () => {
  it('validation', async () => {
    const p = await as(emailOf(SUPPORT));
    for (const body of [
      {}, [], { user: 'abc', suspension_type: 'x', reason: '' }, { user: true, suspension_type: null, reason: 5 }, { user: '', suspension_type: 'temporary', reason: ' ' },
      { user: 999999, suspension_type: 'temporary', reason: 'r' }, { user: acct.admin!.id, suspension_type: 'permanent', reason: 'r' },
      { user: V1, suspension_type: 'temporary', reason: 'r' }, { user: V1, suspension_type: 'temporary', reason: 'r', ends_at: 'tomorrow' },
      { user: V1, suspension_type: 'temporary', reason: 'r', ends_at: '2020-01-01T00:00:00Z' }, { user: V1, suspension_type: 'permanent', reason: 'r', ends_at: future(5) },
      { user: V1, suspension_type: 'indefinite', reason: 'r', related_report: 999999 }, { user: V1, suspension_type: 'temporary', reason: 'r', ends_at: '2099-02-30' },
      { user: V1, suspension_type: 'temporary', reason: 'r', ends_at: '' }, { user: [1], suspension_type: 'temporary', reason: ['x'] },
    ]) same(await p.req('POST', '/api/suspensions/', { json: body }));
  });
  it('issue, list, detail, history, stats, revoke', async () => {
    const p = await as(emailOf(SUPPORT));
    const notif = await maxId('notifications_notification');
    const audit = await maxId('superadmin_adminauditlog');
    const r1 = await p.req('POST', '/api/suspensions/', { json: { user: V1, suspension_type: 'temporary', reason: '  Spamming hosts  ', ends_at: '2099-06-01T12:30:00+02:00' } });
    expect(r1.django.status, r1.django.text).toBe(201);
    same(r1);
    const r2 = await p.req('POST', '/api/suspensions/', { json: { user: String(V2), suspension_type: 'permanent', reason: 'Fraud', related_report: null, ends_at: null } });
    same(r2);
    const r3 = await p.req('POST', '/api/suspensions/', { json: { user: V3, suspension_type: 'temporary', reason: 'naive', ends_at: '2099-01-01 08:00' } });
    same(r3);
    same(await p.req('POST', '/api/suspensions/', { json: { user: V1, suspension_type: 'permanent', reason: 'again' } })); // already active
    await sameRows('suspensions_suspension', 'true', SUSP_IGNORE);
    await sameRows('notifications_notification', `id > ${notif}`, { ignore: ['created_at'] });
    await sameRows('superadmin_adminauditlog', `id > ${audit}`, { ignore: ['created_at'] });

    for (const q of ['', '?status=active', '?suspension_type=permanent', `?user_id=${V1}`, '?limit=1', '?limit=1&offset=1', '?limit=abc', '?limit=0&offset=-5',
      '?limit=1000', '?offset=2', '?status=nope', '?limit=%202%20']) same(await p.req('GET', `/api/suspensions/${q}`));
    same(await p.req('GET', '/api/suspensions/?user_id=abc'));
    const id1 = (r1.django.body as { id: number }).id;
    same(await p.req('GET', `/api/suspensions/${id1}/`));
    same(await p.req('GET', `/api/suspensions/user/${V1}/`));
    same(await p.req('GET', `/api/suspensions/user/999999/`));
    same(await p.req('GET', '/api/suspensions/stats/'));

    // the suspended account is blocked by the middleware on both sides
    const blocked = new Pair();
    same(await blocked.login(emailOf(V1)));

    const notif2 = await maxId('notifications_notification');
    same(await p.req('POST', `/api/suspensions/${id1}/revoke/`, { json: { revocation_reason: 5 } }));
    same(await p.req('POST', `/api/suspensions/${id1}/revoke/`, { json: ['x'] }));
    same(await p.req('POST', `/api/suspensions/${id1}/revoke/`, { json: { revocation_reason: '  appeal accepted ' } }));
    same(await p.req('POST', `/api/suspensions/${id1}/revoke/`, { json: {} })); // no longer active
    await sameRows('suspensions_suspension', `id = ${id1}`, SUSP_IGNORE);
    await sameRows('notifications_notification', `id > ${notif2}`, { ignore: ['created_at'] });
    await sameRows('superadmin_adminauditlog', `id > ${audit}`, { ignore: ['created_at'] });
    // revoke without a body (empty reason)
    const id2 = (r2.django.body as { id: number }).id;
    same(await p.req('POST', `/api/suspensions/${id2}/revoke/`));
    await sameRows('suspensions_suspension', `id = ${id2}`, SUSP_IGNORE);
    same(await p.req('GET', '/api/suspensions/stats/'));
    // an expired-by-time suspension isn't revocable and isn't "currently active"
    const id3 = (r3.django.body as { id: number }).id;
    await both("UPDATE suspensions_suspension SET ends_at = now() - interval '1 hour' WHERE id = $1", [id3]);
    same(await p.req('POST', `/api/suspensions/${id3}/revoke/`, { json: {} }));
    same(await p.req('GET', `/api/suspensions/user/${V3}/`));
  });
  it('host with many listings → dual authorization, approved via rbac', async () => {
    const p = await as(emailOf(TS));
    const audit = await maxId('superadmin_adminauditlog');
    const r = await p.req('POST', '/api/suspensions/', { json: { user: HOST, suspension_type: 'temporary', reason: 'Fake listings', ends_at: '2099-03-03T03:03:03.123456Z' } });
    expect(r.django.status, r.django.text).toBe(202);
    same(r);
    await sameRows('rbac_pendingapproval', "action_key = 'user.suspend'", { ignore: ['created_at'] });
    await sameRows('superadmin_adminauditlog', `id > ${audit}`, { ignore: ['created_at'] });
    const approvalId = (r.django.body as { approval_id: number }).approval_id;
    const sa = await as(acct.superadmin!.email);
    const notif = await maxId('notifications_notification');
    const ap = await sa.req('POST', `/api/rbac/approvals/${approvalId}/approve/`, { json: { reason: 'ok' } });
    same(ap, { ignore: ['decided_at'] });
    await sameRows('rbac_pendingapproval', `id = ${approvalId}`, { ignore: ['created_at', 'decided_at'] });
    await sameRows('suspensions_suspension', `user_id = ${HOST}`, SUSP_IGNORE);
    await sameRows('notifications_notification', `id > ${notif}`, { ignore: ['created_at'] });
  });
});
