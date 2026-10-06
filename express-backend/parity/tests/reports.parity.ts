// Parity tests for the reports app: /api/reports/ (user filing + admin workflow).
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accounts, dbs, flushRedis, Pair, same, sameRows } from '../lib.js';

let acct: Awaited<ReturnType<typeof accounts>>;
const both = async (q: string, params: unknown[] = []) => {
  const [d, e] = await Promise.all([dbs.django.query(q, params), dbs.express.query(q, params)]);
  return { django: d.rows, express: e.rows };
};
const SUPPORT = 92001; const DISPUTES = 92002; const KYC = 92003; const PLAIN = 92004; const R1 = 92010; const R2 = 92011;
const emailOf = (id: number) => `rx${id}@example.com`;
async function makeUser(id: number, staff = false) {
  await both(
    `INSERT INTO users_user (id, password, is_superuser, username, first_name, last_name, email, is_staff, is_active, date_joined, email_verified, role, is_archived)
     VALUES ($1::bigint, (SELECT password FROM users_user WHERE id = $2), false, 'rx' || $1::text, 'Rep', 'Orter', 'rx' || $1::text || '@example.com', $3, true, now(), true, 'user', false)`,
    [id, acct.user!.id, staff]);
  await both(`INSERT INTO users_profile (user_id, image, bio, is_superhost, phone_number) VALUES ($1, '', '', false, '')`, [id]);
}
const assign = (u: number, r: number) => both('INSERT INTO rbac_userroleassignment (user_id, role_id, granted_at) VALUES ($1, $2, now())', [u, r]);
async function as(email: string) { await flushRedis(); const p = new Pair(); const r = await p.login(email); expect(r.django.status, r.django.text).toBe(200); return p; }
const maxId = async (t: string) => Number((await dbs.django.query(`SELECT coalesce(max(id), 0) AS m FROM ${t}`)).rows[0].m);
const REP_IGNORE = { ignore: ['created_at', 'updated_at', 'resolved_at', 'escalated_at'] };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

beforeAll(async () => {
  acct = await accounts();
  await makeUser(SUPPORT, true); await assign(SUPPORT, 3);
  await makeUser(DISPUTES, true);
  await both(`INSERT INTO rbac_role (id, slug, name, description, is_preset, created_at, updated_at) VALUES (9201, 'disputes_only', 'Disputes', '', false, now(), now())`);
  await both(`INSERT INTO rbac_rolepermission (role_id, resource, action) VALUES (9201, 'customer_support.disputes', 'read')`);
  await assign(DISPUTES, 9201);
  await makeUser(KYC, true); await assign(KYC, 10);
  await makeUser(PLAIN, true);
  await makeUser(R1); await makeUser(R2);
});
beforeEach(flushRedis);

describe('access control', () => {
  for (const [m, path] of [['GET', '/api/reports/'], ['POST', '/api/reports/'], ['GET', '/api/reports/1/'], ['GET', '/api/reports/admin/'],
    ['GET', '/api/reports/admin/stats/'], ['POST', '/api/reports/admin/bulk/'], ['PATCH', '/api/reports/admin/1/status/'], ['POST', '/api/reports/admin/1/escalate/']] as const) {
    it(`anonymous ${m} ${path}`, async () => same(await new Pair().req(m, path, { json: {} }), { headers: ['www-authenticate'] }));
  }
  it('admin role matrix', async () => {
    for (const email of [acct.user!.email, emailOf(PLAIN), emailOf(KYC), emailOf(SUPPORT), emailOf(DISPUTES), acct.admin!.email, acct.superadmin!.email]) {
      const p = await as(email);
      same(await p.req('GET', '/api/reports/admin/'));
      same(await p.req('GET', '/api/reports/admin/stats/'));
      same(await p.req('POST', '/api/reports/admin/bulk/', { json: {} }));
      same(await p.req('PATCH', '/api/reports/admin/999/status/', { json: {} }));
      same(await p.req('POST', '/api/reports/admin/999/escalate/', { json: {} }));
    }
  });
});

describe('filing', () => {
  it('validation', async () => {
    const p = await as(emailOf(R1));
    for (const body of [
      {}, ['x'], { content_type: 'planet', report_type: 'scam', description: 'd' }, { content_type: 'user', report_type: 'bad', description: '' },
      { content_type: 'user', report_type: 'scam', description: 'd' }, { content_type: 'user', report_type: 'scam', description: 'd', reported_user: R1 },
      { content_type: 'user', report_type: 'scam', description: 'd', reported_user: 999999 }, { content_type: 'listing', report_type: 'scam', description: 'd', reported_listing: 'x' },
      { content_type: 'review', report_type: 'other', description: 'd', reported_review: 1 }, { content_type: 'user', report_type: 'scam', description: 'd', owner_name: '   ' },
      { content_type: 'user', report_type: 'scam', description: 'd', owner_name: 'x'.repeat(256) }, { content_type: 'user', report_type: 'scam', description: 'd', screenshot: 'nope' },
    ]) same(await p.req('POST', '/api/reports/', { json: body }));
  });
  it('file reports (JSON + multipart screenshot), list, detail', async () => {
    const p = await as(emailOf(R1));
    const notif = await maxId('notifications_notification');
    const ids: number[] = [];
    for (const body of [
      { content_type: 'user', report_type: 'harassment', description: '  rude  ', reported_user: R2, reported_listing: 5 },
      { content_type: 'listing', report_type: 'fake_listing', description: 'fake', reported_listing: 5 },
      { content_type: 'message', report_type: 'scam', description: 'msg', reported_message: 2, owner_name: 'Bob' },
      { content_type: 'listing', report_type: 'wrong_info', description: 'no ref', owner_name: ' Owner Name ' },
    ]) {
      const r = await p.req('POST', '/api/reports/', { json: body });
      expect(r.django.status, r.django.text).toBe(201);
      same(r);
      ids.push((r.django.body as { id: number }).id);
    }
    const fd = new FormData();
    fd.append('content_type', 'listing'); fd.append('report_type', 'other'); fd.append('description', 'see screenshot');
    fd.append('reported_listing', ''); fd.append('screenshot', new Blob([PNG], { type: 'image/png' }), 'shot 1.png');
    const m = await p.req('POST', '/api/reports/', { form: fd });
    expect(m.django.status, m.django.text).toBe(201);
    same(m);
    ids.push((m.django.body as { id: number }).id);
    const bad = new FormData();
    bad.append('content_type', 'listing'); bad.append('report_type', 'other'); bad.append('description', 'x');
    bad.append('screenshot', new Blob([Buffer.from('not an image')]), 'fake.png');
    same(await p.req('POST', '/api/reports/', { form: bad }));
    await sameRows('reports_report', `reporter_id = ${R1}`, REP_IGNORE);
    await sameRows('notifications_notification', `id > ${notif}`, { ignore: ['created_at'] });

    same(await p.req('GET', '/api/reports/'));
    same(await p.req('GET', '/api/reports/?status=pending'));
    same(await p.req('GET', '/api/reports/?status=resolved'));
    for (const id of [...ids, 999999]) same(await p.req('GET', `/api/reports/${id}/`));
    const other = await as(emailOf(R2));
    same(await other.req('GET', `/api/reports/${ids[0]}/`));
    same(await other.req('GET', '/api/reports/'));
    const sup = await as(emailOf(SUPPORT));
    same(await sup.req('GET', `/api/reports/${ids[0]}/`));
  });
});

describe('admin workflow', () => {
  it('list / stats / status / escalate / bulk', async () => {
    const p = await as(emailOf(SUPPORT));
    for (const q of ['', '?status=pending', '?report_type=scam', '?content_type=listing', '?limit=2&offset=1', '?limit=x', '?offset=100']) {
      same(await p.req('GET', `/api/reports/admin/${q}`));
    }
    same(await p.req('GET', '/api/reports/admin/stats/'));
    const ids = (await dbs.django.query(`SELECT id FROM reports_report WHERE reporter_id = ${R1} ORDER BY id`)).rows.map((r) => Number(r.id));
    const notif = await maxId('notifications_notification');
    const audit = await maxId('superadmin_adminauditlog');
    for (const body of [[], { status: 'pending' }, { status: 'nope' }, { admin_notes: null }, { status: 'under_review', admin_notes: 'looking' },
      { status: 'under_review' }, { admin_notes: 'just notes' }, { status: 'resolved', admin_notes: 'done' }, { status: 'resolved' }]) {
      same(await p.req('PATCH', `/api/reports/admin/${ids[0]}/status/`, { json: body }));
      await sameRows('reports_report', `id = ${ids[0]}`, REP_IGNORE);
    }
    same(await p.req('PATCH', `/api/reports/admin/${ids[1]}/status/`, { json: {} })); // pending → pending (save status only)
    same(await p.req('PATCH', `/api/reports/admin/${ids[1]}/status/`, { json: { status: 'dismissed' } }));
    same(await p.req('POST', `/api/reports/admin/${ids[2]}/escalate/`, { json: { notes: '  needs supervisor ' } }));
    same(await p.req('POST', `/api/reports/admin/${ids[3]}/escalate/`, { json: { notes: null } }));
    same(await p.req('POST', `/api/reports/admin/${ids[3]}/escalate/`));
    await sameRows('reports_report', `reporter_id = ${R1}`, REP_IGNORE);
    for (const body of [{}, { status: 'resolved' }, { status: 'resolved', report_ids: 'x' }, { status: 'resolved', report_ids: Array.from({ length: 201 }, (_, i) => i) }]) {
      same(await p.req('POST', '/api/reports/admin/bulk/', { json: body }));
    }
    same(await p.req('POST', '/api/reports/admin/bulk/', { json: { status: 'under_review', report_ids: [999999, ids[2], ids[3], 77777, ids[4]], admin_notes: ' bulk ' } }));
    same(await p.req('POST', '/api/reports/admin/bulk/', { json: { status: 'dismissed', report_ids: [ids[2], String(ids[3])] } }));
    await sameRows('reports_report', `reporter_id = ${R1}`, REP_IGNORE);
    await sameRows('notifications_notification', `id > ${notif}`, { ignore: ['created_at'] });
    await sameRows('superadmin_adminauditlog', `id > ${audit}`, { ignore: ['created_at'] });
    same(await p.req('GET', '/api/reports/admin/stats/'));
    same(await p.req('GET', '/api/reports/admin/?status=dismissed'));
  });
});
