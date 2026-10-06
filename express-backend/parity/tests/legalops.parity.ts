// legalops — /api/legal/ parity (public current versions + Finance & Legal document registry).
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accounts, dbs, flushRedis, Pair, PASSWORD, same, sameRows } from '../lib.js';

let ipCounter = 0;
async function loginPair(email: string): Promise<Pair> {
  const p = new Pair();
  const r = await p.req('POST', '/api/auth/login/', { json: { email, password: PASSWORD }, headers: { 'X-Forwarded-For': `198.51.102.${++ipCounter}` } });
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

let acct: Awaited<ReturnType<typeof accounts>>;
const S: Record<string, Pair> = {};
const STAFF = 930001; // is_staff, no roles
const FINANCE = 930002; // finance preset role
const LEGAL = 930003; // custom role: finances.legal_documents read only

beforeAll(async () => {
  acct = await accounts();
  await cloneUser(STAFF, acct.user!.id, { is_staff: 'true' });
  await cloneUser(FINANCE, acct.user!.id, { is_staff: 'true' });
  await cloneUser(LEGAL, acct.user!.id, { is_staff: 'true' });
  await both(`INSERT INTO rbac_userroleassignment (id, user_id, role_id, granted_by_id, granted_at) VALUES (930001, ${FINANCE}, (SELECT id FROM rbac_role WHERE slug='finance'), NULL, '2026-01-01T00:00:00Z')`);
  await both(`INSERT INTO rbac_role (id, name, slug, description, is_preset, created_by_id, created_at, updated_at) VALUES (930001, 'Parity Legal Reader', 'parity-legal-reader', '', false, NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`);
  await both(`INSERT INTO rbac_rolepermission (id, role_id, resource, action) VALUES (930001, 930001, 'finances.legal_documents', 'read')`);
  await both(`INSERT INTO rbac_userroleassignment (id, user_id, role_id, granted_by_id, granted_at) VALUES (930002, ${LEGAL}, 930001, NULL, '2026-01-01T00:00:00Z')`);
  // older + same-date versions to exercise "latest per key" and ordering
  await both(`INSERT INTO legalops_legaldocument (id, document_key, version, effective_date, summary_of_changes, body_sections, published_by_id, created_at) VALUES
    (930001, 'terms_of_service', 'v0', '2025-01-01', 'old', '[]', NULL, '2025-01-01T00:00:00Z'),
    (930002, 'privacy_policy', 'v-later', '2030-01-01', 'future', '[{"title": "T", "content": ["a", "b"]}]', ${acct.superadmin!.id}, '2025-06-01T00:00:00Z')`);
  for (const role of ['user', 'admin', 'superadmin'] as const) S[role] = await loginPair(acct[role]!.email);
  S.staff = await loginPair(`parity_${STAFF}@example.com`);
  S.finance = await loginPair(`parity_${FINANCE}@example.com`);
  S.legal = await loginPair(`parity_${LEGAL}@example.com`);
  S.anon = new Pair();
});
beforeEach(flushRedis);

describe('current documents (public)', () => {
  it('anyone, incl. anonymous', async () => {
    for (const who of ['anon', 'user', 'superadmin']) same(await S[who]!.req('GET', '/api/legal/documents/current/'));
    same(await S.anon!.req('POST', '/api/legal/documents/current/'));
  });
});

describe('documents collection', () => {
  it('access', async () => {
    for (const who of ['anon', 'user', 'staff']) {
      same(await S[who]!.req('GET', '/api/legal/documents/'), { headers: ['www-authenticate'] });
      same(await S[who]!.req('POST', '/api/legal/documents/', { json: {} }), { headers: ['www-authenticate'] });
    }
    same(await S.superadmin!.req('DELETE', '/api/legal/documents/'));
  });

  it('list + document_key filter', async () => {
    for (const who of ['legal', 'finance', 'admin', 'superadmin']) {
      for (const q of ['', '?document_key=privacy_policy', '?document_key=nope', '?document_key=']) {
        same(await S[who]!.req('GET', `/api/legal/documents/${q}`));
      }
    }
  });

  it('publish validation', async () => {
    for (const json of [
      {},
      { document_key: 'eula', version: '', effective_date: 'yesterday' },
      { document_key: 'privacy_policy', version: 'x'.repeat(31), effective_date: '2026-02-30' },
      { document_key: 'privacy_policy', version: 'v9', effective_date: '2026-1-5', body_sections: null },
      { document_key: 'terms_of_service', version: '2026-07-12', effective_date: '2026-07-12' },
      { document_key: null, version: 5, effective_date: 20260101 },
      { document_key: ['terms_of_service'], version: 'ok', effective_date: '2026-10-03T00:00:00' },
      // date.fromisoformat week dates / bad weeks, float choice repr
      { document_key: 1.5e-7, version: '\x1c', effective_date: '2026-W53-1' },
      { document_key: 'eula', version: 'x', effective_date: '2026W017' },
      { document_key: 'eula', version: 'x', effective_date: '2026-W01-8' },
      { document_key: 'eula', version: 'x', effective_date: '2026-W01' },
    ]) same(await S.superadmin!.req('POST', '/api/legal/documents/', { json }));
  });

  it('publish → rows, audit, current', async () => {
    const audit0 = await maxId('superadmin_adminauditlog');
    const doc0 = await maxId('legalops_legaldocument');
    const a = await S.legal!.req('POST', '/api/legal/documents/', { json: { document_key: 'terms_of_service', version: ' v-parity ', effective_date: '2026-10-01', summary_of_changes: 'parity change', body_sections: [{ title: 'One', content: 'x' }] } });
    expect(a.django.status).toBe(201);
    same(a);
    const b = await S.finance!.req('POST', '/api/legal/documents/', { json: { document_key: 'privacy_policy', version: 'v-min', effective_date: '20261002' } });
    same(b);
    await sameRows('legalops_legaldocument', `id > ${doc0}`);
    same(await S.anon!.req('GET', '/api/legal/documents/current/'));
    same(await S.admin!.req('GET', '/api/legal/documents/'));
    await sleep(200);
    await sameRows('superadmin_adminauditlog', `id > ${audit0}`, { ignore: ['id'], order: 'created_at, id' });
  });
});
