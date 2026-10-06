// Parity tests for hostapplications: /api/host-applications/ (submit with image
// uploads, me, agreement status/accept, reviewer queue + 3-stage review with
// Django group permissions and the trust_safety.background_checks RBAC grant).
import zlib from 'node:zlib';
import { Redis } from 'ioredis';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accounts, dbs, flushRedis, Pair, same, sameRows } from '../lib.js';

const both = async (sql: string, params: unknown[] = []) => {
  const [d, e] = await Promise.all([dbs.django.query(sql, params), dbs.express.query(sql, params)]);
  return { django: d.rows, express: e.rows };
};
const maxId = async (table: string) => Number((await dbs.django.query(`SELECT coalesce(max(id), 0) AS m FROM ${table}`)).rows[0].m);

async function queuedTasks(queues = ['celery', 'ai_scoring']) {
  const r1 = new Redis('redis://parity-redis:6379/1');
  const r2 = new Redis('redis://parity-redis:6379/2');
  try {
    const django: string[] = []; const express: string[] = [];
    for (const qn of queues) {
      for (const raw of await r1.lrange(qn, 0, -1)) {
        const m = JSON.parse(raw);
        const [args] = JSON.parse(Buffer.from(m.body, 'base64').toString('utf8'));
        django.push(`${qn}:${m.headers.task}(${JSON.stringify(args)})`);
      }
      const ids = [...(await r2.lrange(`hk:${qn}:wait`, 0, -1)), ...(await r2.zrange(`hk:${qn}:prioritized`, 0, -1))];
      for (const id of ids) {
        const job = await r2.hgetall(`hk:${qn}:${id}`);
        express.push(`${qn}:${job.name}(${JSON.stringify(JSON.parse(job.data).args)})`);
      }
    }
    return { django: django.sort(), express: express.sort() };
  } finally { r1.disconnect(); r2.disconnect(); }
}

// Reviewers: 23 → Product Support Officers group, 4 → Compliance Officers (fixture), 38 → Supervisors group,
// 12 → rbac "trust_safety" role (background_checks: every stage). 1 = superuser.
const PS = 23, COMP = 4, SUP = 38, TS = 12, SUPERUSER = 1, DECLINED_APPLICANT = 396;
let U: number; let CUSTOMER: number; let AGENT: number;
const emails: Record<number, string> = {};
const pairs = new Map<number, Pair>();
const pair = async (uid: number) => {
  let p = pairs.get(uid);
  if (!p) {
    p = new Pair();
    const r = await p.login(emails[uid]!);
    expect(r.django.status, `login ${uid}: ${r.django.text}`).toBe(200);
    pairs.set(uid, p);
  }
  return p;
};

/** A valid 2×2 RGB PNG (real CRCs, so Pillow's verify() accepts it). */
function makePng(): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.from([0, 255, 0, 0, 0, 255, 0, 0, 0, 0, 255, 255, 255, 255]);
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const PNG = makePng();
let tag = 0;
function form(fields: Record<string, string>, files: Record<string, [Buffer | string, string, string?]> = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  for (const [k, [data, name, type]] of Object.entries(files)) fd.append(k, new Blob([data], { type: type ?? 'image/png' }), name);
  return fd;
}
const good = () => {
  tag++;
  return form({ full_name: '  Jane Host  ', address: '12 Broad St, Monrovia', momo_number: '0880-123-456', agreement_accepted: 'true' },
    { headshot: [PNG, `head-${tag}-${Date.now()}.png`], id_document: [PNG, `id ${tag} ${Date.now()}.PNG`] });
};

beforeAll(async () => {
  const acct = await accounts();
  U = acct.user!.id; CUSTOMER = acct.customer!.id; AGENT = acct.agent!.id;
  for (const id of [PS, COMP, SUP, TS, DECLINED_APPLICANT]) {
    await both('UPDATE users_user SET password = (SELECT password FROM users_user WHERE id = $1), is_active = true, email_verified = true WHERE id = $2', [AGENT, id]);
  }
  await both("UPDATE users_user SET role = 'user', is_staff = false, is_superuser = false WHERE id = ANY($1)", [[PS, SUP, TS]]);
  for (const [uid, g] of [[PS, 'Product Support Officers'], [SUP, 'Supervisors']] as const) {
    await both(`INSERT INTO users_user_groups (user_id, group_id) SELECT $1, id FROM auth_group WHERE name = $2 ON CONFLICT DO NOTHING`, [uid, g]);
  }
  await both(`INSERT INTO rbac_userroleassignment (user_id, role_id, granted_by_id, granted_at) SELECT $1, id, NULL, now() FROM rbac_role WHERE slug = 'trust_safety'
    AND NOT EXISTS (SELECT 1 FROM rbac_userroleassignment WHERE user_id = $1)`, [TS]);
  const { rows } = await dbs.django.query('SELECT id, email FROM users_user WHERE id = ANY($1)', [[U, CUSTOMER, AGENT, PS, COMP, SUP, TS, SUPERUSER, DECLINED_APPLICANT]]);
  for (const r of rows) emails[Number(r.id)] = r.email;
  for (const uid of [U, CUSTOMER, AGENT, PS, COMP, SUP, TS, SUPERUSER, DECLINED_APPLICANT]) { await flushRedis(); await pair(uid); }
});
beforeEach(flushRedis);

describe('access', () => {
  for (const [m, path] of [['POST', '/api/host-applications/'], ['GET', '/api/host-applications/me/'], ['GET', '/api/host-applications/agreement/'],
    ['POST', '/api/host-applications/agreement/accept/'], ['GET', '/api/host-applications/review-queue/'], ['POST', '/api/host-applications/1/review/']] as const) {
    it(`anonymous ${m} ${path}`, async () => same(await new Pair().req(m, path, { json: {} }), { headers: ['www-authenticate'] }));
  }
  it('wrong methods', async () => {
    const p = await pair(U);
    for (const [m, path] of [['GET', '/api/host-applications/'], ['POST', '/api/host-applications/me/'], ['POST', '/api/host-applications/agreement/'],
      ['GET', '/api/host-applications/agreement/accept/'], ['POST', '/api/host-applications/review-queue/'], ['GET', '/api/host-applications/1/review/']] as const) same(await p.req(m, path));
  });
  it('review queue per reviewer', async () => {
    for (const uid of [U, AGENT, PS, COMP, SUP, TS, SUPERUSER]) same(await (await pair(uid)).req('GET', '/api/host-applications/review-queue/'));
  });
});

describe('me / agreement', () => {
  it('me (none / declined), agreement status, accept (idempotent)', async () => {
    for (const uid of [U, DECLINED_APPLICANT, COMP]) {
      const p = await pair(uid);
      const r = await p.req('GET', '/api/host-applications/me/');
      expect(r.express.status).toBe(r.django.status);
      if (r.django.status !== 204) same(r); else expect(r.express.text).toBe(r.django.text);
      same(await p.req('GET', '/api/host-applications/agreement/'));
    }
    const p = await pair(U);
    same(await p.req('POST', '/api/host-applications/agreement/accept/'));
    same(await p.req('POST', '/api/host-applications/agreement/accept/', { headers: { 'X-Forwarded-For': '198.51.100.7, 10.0.0.1' } }));
    same(await (await pair(DECLINED_APPLICANT)).req('POST', '/api/host-applications/agreement/accept/', { headers: { 'X-Forwarded-For': '198.51.100.8' } }));
    await sameRows('hostapplications_agreementacceptance');
    same(await p.req('GET', '/api/host-applications/agreement/'));
  });
});

describe('submit', () => {
  it('validation', async () => {
    const p = await pair(CUSTOMER);
    for (const json of [{}, [1], { full_name: 'X', address: 'A', momo_number: '123', headshot: 'x', id_document: null, agreement_accepted: false }]) {
      same(await p.req('POST', '/api/host-applications/', { json }));
    }
    const t = Date.now();
    for (const fd of [
      form({ full_name: 'X' }),
      form({ full_name: '', address: 'a'.repeat(501), momo_number: '0770123456', agreement_accepted: 'false' }, { headshot: [PNG, `h${t}.png`], id_document: [PNG, `i${t}.png`] }),
      form({ full_name: 'X', address: 'A', momo_number: '+231 77 012 3456' }, { headshot: ['not an image', `h${t}.png`, 'image/png'], id_document: [PNG, `i${t}.txt`] }),
      form({ full_name: 'X', address: 'A', momo_number: '0550123456', agreement_accepted: 'yes' }, { headshot: [PNG, `${'n'.repeat(101)}.png`], id_document: ['', `e${t}.png`] }),
      form({ full_name: 'X', address: 'A', momo_number: '0880123456', agreement_accepted: 'maybe', headshot: 'text' }, { id_document: [PNG, `noext${t}`] }),
    ]) same(await p.req('POST', '/api/host-applications/', { form: fd }));
    await sameRows('hostapplications_hostapplication');
  });
  it('success → row, files, acceptance, ai_scoring task, PS group + applicant notifications; then "already under review"', async () => {
    const mxN = await maxId('notifications_notification');
    const mxH = await maxId('hostapplications_hostapplication');
    const p = await pair(U);
    same(await p.req('POST', '/api/host-applications/', { form: good() }));
    same(await p.req('POST', '/api/host-applications/', { form: good() }));
    same(await (await pair(CUSTOMER)).req('POST', '/api/host-applications/', { form: good(), headers: { 'X-Forwarded-For': '192.0.2.44' } }));
    same(await (await pair(DECLINED_APPLICANT)).req('POST', '/api/host-applications/', { form: good() }));
    await sameRows('hostapplications_hostapplication', `id > ${mxH}`);
    await sameRows('hostapplications_agreementacceptance');
    await sameRows('notifications_notification', `id > ${mxN}`);
    const q = await queuedTasks();
    expect(q.django.some((t) => t.startsWith('ai_scoring:aiscoring.tasks.score_host_application_task'))).toBe(true);
    expect(q.express).toEqual(q.django);
    same(await p.req('GET', '/api/host-applications/me/'));
    const { rows } = await dbs.express.query('SELECT headshot FROM hostapplications_hostapplication ORDER BY id DESC LIMIT 1');
    expect((await p.express.req('GET', `/media/${rows[0].headshot}`)).status).toBe(200);
  });
});

describe('review', () => {
  const appOf = async (uid: number) => Number((await dbs.django.query('SELECT id FROM hostapplications_hostapplication WHERE applicant_id = $1 ORDER BY id DESC LIMIT 1', [uid])).rows[0].id);
  const checkAll = async (mxN: number, mxA: number) => {
    await sameRows('hostapplications_hostapplication');
    await sameRows('notifications_notification', `id > ${mxN}`);
    await sameRows('superadmin_adminauditlog', `id > ${mxA}`);
  };
  it('full approval path: PS → Compliance → Supervisor (role promoted, agreement PDF stored)', async () => {
    const mxN = await maxId('notifications_notification');
    const mxA = await maxId('superadmin_adminauditlog');
    const id = await appOf(U);
    same(await (await pair(U)).req('POST', `/api/host-applications/${id}/review/`, { json: { approve: true } }));
    same(await (await pair(COMP)).req('POST', `/api/host-applications/${id}/review/`, { json: { approve: true } })); // wrong stage
    const ps = await pair(PS);
    for (const json of [{}, { approve: false }, { approve: false, reason: '   ' }, [1]]) same(await ps.req('POST', `/api/host-applications/${id}/review/`, { json }));
    same(await ps.req('POST', '/api/host-applications/999999/review/', { json: { approve: true } }));
    same(await ps.req('POST', `/api/host-applications/${id}/review/`, { json: { approve: 'yes' } }));
    same(await ps.req('POST', `/api/host-applications/${id}/review/`, { json: { approve: true } })); // now wrong stage for PS
    same(await (await pair(COMP)).req('POST', `/api/host-applications/${id}/review/`, { json: { approve: 1, reason: 'docs ok' } }));
    for (const uid of [PS, COMP, SUP, TS]) same(await (await pair(uid)).req('GET', '/api/host-applications/review-queue/'));
    same(await (await pair(SUP)).req('POST', `/api/host-applications/${id}/review/`, { json: { approve: true } }));
    same(await (await pair(SUP)).req('POST', `/api/host-applications/${id}/review/`, { json: { approve: true } })); // terminal
    await checkAll(mxN, mxA);
    await sameRows('users_user', `id = ${U}`, { ignore: ['last_login'] });
    same(await (await pair(U)).req('GET', '/api/host-applications/me/'));
  });
  it('declines at each stage (reason coercion, "false" is truthy), trust_safety reviewer', async () => {
    const mxN = await maxId('notifications_notification');
    const mxA = await maxId('superadmin_adminauditlog');
    const c = await appOf(CUSTOMER);
    same(await (await pair(TS)).req('POST', `/api/host-applications/${c}/review/`, { json: { approve: 0, reason: 42 } }));
    const d = await appOf(DECLINED_APPLICANT);
    same(await (await pair(TS)).req('POST', `/api/host-applications/${d}/review/`, { json: { approve: 'false' } })); // truthy → approved
    const fd = new FormData(); fd.append('approve', ''); fd.append('reason', '  Blurry ID  ');
    same(await (await pair(COMP)).req('POST', `/api/host-applications/${d}/review/`, { form: fd }));
    await checkAll(mxN, mxA);
  });
});
