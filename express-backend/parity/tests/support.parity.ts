// Parity tests for support: /api/support/ (contact, tickets, search, AirCover
// claims, admin queue) incl. the department/RBAC access matrix and every table written.
// Ticket numbers are random per backend (HK-YYYYMMDD-######) and are normalised.
import { Redis } from 'ioredis';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accounts, dbs, diff, flushRedis, Pair, same, type Resp } from '../lib.js';

const both = async (sql: string, params: unknown[] = []) => {
  const [d, e] = await Promise.all([dbs.django.query(sql, params), dbs.express.query(sql, params)]);
  return { django: d.rows, express: e.rows };
};
const maxId = async (table: string) => Number((await dbs.django.query(`SELECT coalesce(max(id), 0) AS m FROM ${table}`)).rows[0].m);

const TICKET_RE = /HK-\d{8}-\d{6}/g;
const norm = (v: unknown): unknown => {
  if (typeof v === 'string') return v.replace(TICKET_RE, 'HK-########-######');
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, norm(x)]));
  return v;
};
/** same() with ticket numbers normalised (they're random on each side). */
function sameT(r: { django: Resp; express: Resp }, opts: { ignore?: string[] } = {}) {
  const problems: string[] = [];
  if (r.django.status !== r.express.status) problems.push(`status ${r.django.status} != ${r.express.status}`);
  problems.push(...diff(norm(r.django.body), norm(r.express.body), opts));
  expect(problems, `django=${r.django.text.slice(0, 600)}\nexpress=${r.express.text.slice(0, 600)}`).toEqual([]);
}
/** sameRows() with ticket numbers normalised. */
async function sameRowsT(table: string, where = 'true', ignore: string[] = []) {
  const q = `SELECT * FROM ${table} WHERE ${where} ORDER BY id`;
  const r = await both(q);
  expect(diff(norm(r.django), norm(r.express), { ignore }), `table ${table} where ${where}`).toEqual([]);
}

async function queuedTasks() {
  const r1 = new Redis('redis://parity-redis:6379/1');
  const r2 = new Redis('redis://parity-redis:6379/2');
  try {
    const celery = (await r1.lrange('celery', 0, -1)).map((raw) => {
      const m = JSON.parse(raw);
      const [args] = JSON.parse(Buffer.from(m.body, 'base64').toString('utf8'));
      return `${m.headers.task}(${JSON.stringify(args)})`;
    });
    const ids = [...(await r2.lrange('hk:celery:wait', 0, -1)), ...(await r2.zrange('hk:celery:prioritized', 0, -1))];
    const bull = await Promise.all(ids.map(async (id) => {
      const job = await r2.hgetall(`hk:celery:${id}`);
      return `${job.name}(${JSON.stringify(JSON.parse(job.data).args)})`;
    }));
    return { django: celery.sort(), express: bull.sort() };
  } finally { r1.disconnect(); r2.disconnect(); }
}

let acct: Awaited<ReturnType<typeof accounts>>;
const SUPPORT_STAFF = 4; // is_staff + rbac role "support"
const FINANCE_STAFF = 23; // is_staff + rbac role "finance" (wrong department)
const emails: Record<number, string> = {};
const pairs = new Map<number, Pair>();
/** Logged-in pair per user, cached (login is throttled at 5/min per IP). */
const pair = async (uid: number) => {
  let p = pairs.get(uid);
  if (!p) {
    p = new Pair();
    const r = await p.login(emails[uid]!);
    expect(r.django.status, `login ${uid}: ${r.django.text}`).toBe(200);
    expect(r.express.status, `login ${uid}: ${r.express.text}`).toBe(200);
    pairs.set(uid, p);
  }
  return p;
};
let U: number; let AGENT: number; let ADMIN: number; let SUPER: number; let CUSTOMER: number;

beforeAll(async () => {
  acct = await accounts();
  U = acct.user!.id; AGENT = acct.agent!.id; ADMIN = acct.admin!.id; SUPER = acct.superadmin!.id; CUSTOMER = acct.customer!.id;
  for (const id of [SUPPORT_STAFF, FINANCE_STAFF]) {
    await both('UPDATE users_user SET password = (SELECT password FROM users_user WHERE id = $1), is_staff = true, is_active = true, email_verified = true WHERE id = $2', [AGENT, id]);
  }
  for (const [uid, slug] of [[SUPPORT_STAFF, 'support'], [FINANCE_STAFF, 'finance']] as const) {
    await both(`INSERT INTO rbac_userroleassignment (user_id, role_id, granted_by_id, granted_at)
      SELECT $1, (SELECT id FROM rbac_role WHERE slug = $2), NULL, now() WHERE NOT EXISTS (SELECT 1 FROM rbac_userroleassignment WHERE user_id = $1)`, [uid, slug]);
  }
  const { rows } = await dbs.django.query('SELECT id, email FROM users_user WHERE id = ANY($1)', [[U, AGENT, ADMIN, SUPER, CUSTOMER, SUPPORT_STAFF, FINANCE_STAFF]]);
  for (const r of rows) emails[Number(r.id)] = r.email;
  for (const uid of [U, AGENT, ADMIN, SUPER, CUSTOMER, SUPPORT_STAFF, FINANCE_STAFF]) { await flushRedis(); await pair(uid); }
});
beforeEach(flushRedis);

const ADMIN_ROUTES: [string, string][] = [
  ['GET', '/api/support/admin/tickets/'], ['PATCH', '/api/support/admin/tickets/1/'], ['POST', '/api/support/admin/tickets/1/escalate/'],
  ['GET', '/api/support/admin/contact/'], ['PATCH', '/api/support/admin/contact/1/'], ['GET', '/api/support/admin/stats/'],
  ['GET', '/api/support/admin/aircover-claims/'], ['POST', '/api/support/admin/aircover-claims/1/decide/'], ['GET', '/api/support/aircover-claims/'],
];

describe('access matrix', () => {
  for (const [m, path] of ADMIN_ROUTES) {
    it(`anonymous ${m} ${path}`, async () => same(await new Pair().req(m, path, { json: {} }), { headers: ['www-authenticate'] }));
  }
  it('each role on the admin routes (read-only probes)', async () => {
    for (const uid of [() => U, () => AGENT, () => CUSTOMER, () => ADMIN, () => SUPER, () => SUPPORT_STAFF, () => FINANCE_STAFF]) {
      const p = await pair(uid());
      for (const path of ['/api/support/admin/tickets/', '/api/support/admin/contact/', '/api/support/admin/stats/', '/api/support/admin/aircover-claims/',
        '/api/support/tickets/', '/api/support/tickets/1/', '/api/support/tickets/11/', '/api/support/aircover-claims/']) sameT(await p.req('GET', path));
      sameT(await p.req('PATCH', '/api/support/admin/tickets/999999/', { json: {} }));
      sameT(await p.req('POST', '/api/support/admin/tickets/999999/escalate/', { json: {} }));
      sameT(await p.req('PATCH', '/api/support/admin/contact/999999/', { json: {} }));
      sameT(await p.req('POST', '/api/support/admin/aircover-claims/999999/decide/', { json: {} }));
    }
  });
  it('anonymous on the public routes', async () => {
    const p = new Pair();
    for (const path of ['/api/support/tickets/', '/api/support/tickets/1/', '/api/support/tickets/999999/', '/api/support/search/?q=x']) sameT(await p.req('GET', path));
    sameT(await p.req('POST', '/api/support/tickets/1/messages/', { json: { content: 'hi' } }));
    sameT(await p.req('POST', '/api/support/tickets/999999/messages/', { json: { content: 'hi' } }));
  });
  it('wrong methods', async () => {
    const p = await pair(SUPER);
    for (const [m, path] of [['GET', '/api/support/contact/'], ['PUT', '/api/support/tickets/'], ['POST', '/api/support/tickets/1/'], ['GET', '/api/support/tickets/1/messages/'],
      ['POST', '/api/support/search/'], ['POST', '/api/support/admin/tickets/'], ['GET', '/api/support/admin/tickets/1/escalate/'], ['DELETE', '/api/support/admin/contact/1/'],
      ['GET', '/api/support/admin/aircover-claims/1/decide/'], ['PUT', '/api/support/aircover-claims/']] as const) sameT(await p.req(m, path));
  });
});

describe('contact', () => {
  it('validation', async () => {
    const p = new Pair();
    for (const json of [{}, [1], { name: ' ', email: 'x', subject: '', message: '' }, { name: 'a'.repeat(101), email: 'bad@', subject: 's'.repeat(201), message: 'm', category: 'nope' },
      { name: 'N', email: 'n@example.com', subject: 'S', message: 'M', category: '' }, { name: 5, email: 'n@example.com', subject: true, message: null }]) {
      sameT(await p.req('POST', '/api/support/contact/', { json }));
    }
    await sameRowsT('support_contactinquiry');
  });
  it('anonymous + authenticated (opens a support conversation, notifies the support admin)', async () => {
    const mxN = await maxId('notifications_notification');
    const mxC = await maxId('messaging_conversation');
    sameT(await new Pair().req('POST', '/api/support/contact/', { json: { name: '  Guest  ', email: 'g@example.com', subject: ' Hi ', message: ' Hello ' } }));
    sameT(await (await pair(U)).req('POST', '/api/support/contact/', { json: { name: 'Me', email: 'me@example.com', category: 'payment', subject: 'Refund', message: 'Where is it' } }));
    const fd = new FormData(); fd.append('name', 'Form'); fd.append('email', 'f@example.com'); fd.append('subject', 'Form subj'); fd.append('message', 'Form msg');
    sameT(await (await pair(AGENT)).req('POST', '/api/support/contact/', { form: fd }));
    sameT(await (await pair(SUPER)).req('POST', '/api/support/contact/', { json: { name: 'Admin', email: 'a@example.com', subject: 'Self', message: 'no conv for the support admin itself' } }));
    await sameRowsT('support_contactinquiry');
    await sameRowsT('messaging_conversation', `id > ${mxC}`);
    await sameRowsT('messaging_conversation_participants', `conversation_id > ${mxC}`);
    await sameRowsT('messaging_message', `conversation_id > ${mxC}`);
    await sameRowsT('notifications_notification', `id > ${mxN}`);
    const q = await queuedTasks();
    expect(q.express).toEqual(q.django);
  });
});

describe('tickets', () => {
  it('create: validation (guest + authenticated)', async () => {
    const anon = new Pair();
    for (const json of [{}, [1], { category: 'nope', subject: '', description: 'short' }, { category: 'booking', subject: 'S', description: 'long enough text' },
      { category: 'booking', subject: 'S', description: 'long enough text', guest_name: 'G' }, { category: 'booking', subject: 'S', description: 'long enough text', guest_name: '  ', guest_email: 'g@example.com' },
      { category: 'booking', subject: 'S', description: '   padded   ', guest_name: 'G', guest_email: 'bad' }, { category: 'other', subject: 'x'.repeat(201), description: 'y'.repeat(9) }]) {
      sameT(await anon.req('POST', '/api/support/tickets/', { json }));
    }
    sameT(await (await pair(U)).req('POST', '/api/support/tickets/', { json: { category: 'account' } }));
    await sameRowsT('support_supportticket');
  });
  it('create: guest with attachments, authenticated with conversation, support admin itself', async () => {
    const mxT = await maxId('support_supportticket');
    const mxN = await maxId('notifications_notification');
    const mxC = await maxId('messaging_conversation');
    const tag = Date.now();
    const fd = new FormData();
    fd.append('category', 'technical'); fd.append('subject', '  App crashes  '); fd.append('description', 'It crashes on login every time');
    fd.append('guest_name', 'Guest G'); fd.append('guest_email', 'gg@example.com');
    fd.append('attachments', new Blob(['log data'], { type: 'text/plain' }), `log-${tag}.txt`);
    fd.append('attachments', new Blob(['\x89PNG'], { type: 'image/png' }), `shot ${tag}.png`);
    sameT(await new Pair().req('POST', '/api/support/tickets/', { form: fd }));
    sameT(await (await pair(U)).req('POST', '/api/support/tickets/', { json: { category: 'payment', subject: 'Charged twice', description: 'I was charged twice for booking', guest_name: 'ignored' } }));
    sameT(await (await pair(SUPER)).req('POST', '/api/support/tickets/', { json: { category: 'host', subject: 'Self ticket', description: 'support admin files a ticket' } }));
    await sameRowsT('support_supportticket', `id > ${mxT}`);
    await sameRowsT('support_ticketmessage', `ticket_id > ${mxT}`);
    await sameRowsT('support_ticketattachment', `ticket_id > ${mxT}`);
    await sameRowsT('messaging_message', `conversation_id > ${mxC}`);
    await sameRowsT('notifications_notification', `id > ${mxN}`);
    const q = await queuedTasks();
    expect(q.express).toEqual(q.django);
  });
  it('list (own vs support staff) with status filter; detail access', async () => {
    for (const uid of [U, AGENT, SUPPORT_STAFF, SUPER]) {
      const p = await pair(uid);
      for (const q of ['', '?status=open', '?status=resolved', '?status=']) sameT(await p.req('GET', `/api/support/tickets/${q}`));
    }
    const { rows } = await dbs.django.query('SELECT id FROM support_supportticket WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [U]);
    for (const uid of [U, AGENT, SUPPORT_STAFF, FINANCE_STAFF, ADMIN]) sameT(await (await pair(uid)).req('GET', `/api/support/tickets/${rows[0].id}/`));
  });
  it('messages: owner / support staff / outsiders, status transitions', async () => {
    const { rows } = await dbs.django.query('SELECT id FROM support_supportticket WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [U]);
    const id = rows[0].id;
    const owner = await pair(U);
    for (const json of [{}, { content: '' }, { content: '   ' }, { content: null }, [1]]) sameT(await owner.req('POST', `/api/support/tickets/${id}/messages/`, { json }));
    sameT(await (await pair(AGENT)).req('POST', `/api/support/tickets/${id}/messages/`, { json: { content: 'not mine' } }));
    sameT(await (await pair(SUPPORT_STAFF)).req('POST', `/api/support/tickets/${id}/messages/`, { json: { content: '  We are looking  ' } }));
    await both("UPDATE support_supportticket SET status = 'pending_user' WHERE id = $1", [id]);
    sameT(await owner.req('POST', `/api/support/tickets/${id}/messages/`, { json: { content: 'Here is more info' } }));
    sameT(await (await pair(SUPER)).req('POST', `/api/support/tickets/${id}/messages/`, { json: { content: 'admin note' } }));
    await sameRowsT('support_ticketmessage', `ticket_id = ${id}`);
    await sameRowsT('support_supportticket', `id = ${id}`);
  });
  it('search (resolved only, icontains, LIKE escaping)', async () => {
    await both("UPDATE support_supportticket SET status = 'resolved', resolved_at = now() WHERE id IN (1, 12)");
    const p = new Pair();
    const { rows } = await dbs.django.query('SELECT subject FROM support_supportticket WHERE id = 1');
    const word = String(rows[0].subject).split(/\s+/)[0]!;
    for (const q of ['', '   ', word, word.toUpperCase(), '%', '_', 'zzzz-no-match', `  ${word}  `]) {
      sameT(await p.req('GET', `/api/support/search/?q=${encodeURIComponent(q)}`));
    }
    sameT(await p.req('GET', '/api/support/search/'));
  });
});

describe('admin queue', () => {
  it('list filters + pagination', async () => {
    const p = await pair(SUPPORT_STAFF);
    await both('UPDATE support_supportticket SET assigned_to_id = $1 WHERE id = 2', [SUPPORT_STAFF]);
    for (const q of ['', '?status=open', '?category=booking', '?priority=medium', '?assigned_to=unassigned', `?assigned_to=${SUPPORT_STAFF}`, '?assigned_to=abc',
      '?page_size=2', '?page_size=2&page=2', '?page_size=2&page=99', '?page=abc', '?page=0', '?page_size= 3 ', '?page_size=abc', '?page_size=0', '?page_size=-1',
      '?status=nope&page_size=-1', '?assigned_to=99999999999999999999']) {
      sameT(await p.req('GET', `/api/support/admin/tickets/${q}`));
    }
  });
  it('update ticket: validation, resolved_at, SLA recompute, assignment', async () => {
    const p = await pair(SUPPORT_STAFF);
    for (const json of [{ status: 'nope' }, { priority: 'x' }, { assigned_to: 999999 }, { assigned_to: 'abc' }, { assigned_to: true }, { status: '' }, [1]]) {
      sameT(await p.req('PATCH', '/api/support/admin/tickets/1/', { json }));
    }
    for (const json of [{}, { status: 'resolved' }, { status: 'resolved' }, { priority: 'urgent' }, { priority: 'urgent', assigned_to: SUPPORT_STAFF }, { status: 'open', assigned_to: null }, { priority: 'low' }]) {
      sameT(await p.req('PATCH', '/api/support/admin/tickets/1/', { json }));
      await sameRowsT('support_supportticket', 'id = 1');
    }
  });
  it('escalate writes the audit log', async () => {
    const mxA = await maxId('superadmin_adminauditlog');
    const p = await pair(SUPPORT_STAFF);
    sameT(await p.req('POST', '/api/support/admin/tickets/2/escalate/', { json: { notes: '  needs a supervisor  ' } }));
    sameT(await p.req('POST', '/api/support/admin/tickets/2/escalate/', { json: { notes: 5 } }));
    sameT(await p.req('POST', '/api/support/admin/tickets/11/escalate/'));
    await sameRowsT('support_supportticket', 'id IN (2, 11)');
    await sameRowsT('superadmin_adminauditlog', `id > ${mxA}`);
  });
  it('contact list/update (is_read is read-only), stats', async () => {
    const p = await pair(SUPPORT_STAFF);
    for (const q of ['', '?is_read=true', '?is_read=FALSE', '?is_read=yes', '?is_read=']) sameT(await p.req('GET', `/api/support/admin/contact/${q}`));
    const { rows } = await dbs.django.query('SELECT id FROM support_contactinquiry ORDER BY id DESC LIMIT 1');
    for (const json of [{ is_read: true }, { name: '' }, { email: 'bad' }, { category: 'partnership', subject: ' New subj ' }]) {
      sameT(await p.req('PATCH', `/api/support/admin/contact/${rows[0].id}/`, { json }));
    }
    await sameRowsT('support_contactinquiry');
    await both("UPDATE support_supportticket SET sla_due_at = now() - interval '1 hour' WHERE id = 13");
    sameT(await p.req('GET', '/api/support/admin/stats/'));
  });
});

describe('AirCover claims', () => {
  // booking 37: listing 15 (owner 4), customer 3 (agent account)
  it('file: validation and party check', async () => {
    const p = await pair(AGENT);
    for (const json of [{}, [1], { booking: 'abc', claim_type: 'x', description: '', requested_amount: 'abc' }, { booking: true, claim_type: 'safety', description: 'd', requested_amount: '0' },
      { booking: 999999, claim_type: 'safety', description: 'd', requested_amount: '-5' }, { booking: 66, claim_type: 'safety', description: 'd', requested_amount: '10' },
      { booking: 37, claim_type: 'safety', description: 'd', requested_amount: '1.234' }, { booking: 37, claim_type: 'safety', description: 'd', requested_amount: '123456789' },
      { booking: 37, claim_type: 'safety', description: 'd', requested_amount: '12345678901' }, { booking: 37, claim_type: 'safety', description: 'd', requested_amount: 'NaN' },
      { booking: 37, claim_type: 'safety', description: 'd', requested_amount: null }]) {
      sameT(await p.req('POST', '/api/support/aircover-claims/', { json }));
    }
    await sameRowsT('support_aircoverclaim');
  });
  it('file (guest and host), list mine, admin list, decide', async () => {
    const mxA = await maxId('superadmin_adminauditlog');
    const guest = await pair(AGENT);
    sameT(await guest.req('POST', '/api/support/aircover-claims/', { json: { booking: 37, claim_type: 'safety', description: 'Broken lock '.repeat(30), requested_amount: '150.5' } }));
    sameT(await (await pair(SUPPORT_STAFF)).req('POST', '/api/support/aircover-claims/', { json: { booking: '37', claim_type: 'property_damage', description: 'Damage', requested_amount: 2000 } }));
    sameT(await (await pair(CUSTOMER)).req('POST', '/api/support/aircover-claims/', { json: { booking: 66, claim_type: 'other', description: 'x', requested_amount: '1e2' } }));
    await sameRowsT('support_aircoverclaim');
    for (const uid of [AGENT, SUPPORT_STAFF, CUSTOMER, U]) sameT(await (await pair(uid)).req('GET', '/api/support/aircover-claims/'));
    for (const uid of [SUPPORT_STAFF, FINANCE_STAFF, ADMIN, SUPER]) {
      for (const q of ['', '?status=submitted', '?status=approved']) sameT(await (await pair(uid)).req('GET', `/api/support/admin/aircover-claims/${q}`));
    }
    const { rows } = await dbs.django.query('SELECT id FROM support_aircoverclaim ORDER BY id');
    const [c1, c2, c3] = rows.map((r) => r.id);
    const sup = await pair(SUPER);
    for (const [id, json] of [
      [c1, {}], [c1, { status: 'paid' }], [c1, [1]], [c1, { status: 'approved', approved_amount: 'abc' }], [c1, { status: 'approved', approved_amount: '0' }],
      [c1, { status: 'approved', approved_amount: '1000' }], [c1, { status: 'approved', approved_amount: null }], [c1, { status: 'approved', approved_amount: '-Infinity' }],
      [c1, { status: 'approved', approved_amount: '100.255', notes: 'partial' }], [c2, { status: 'approved' }], [c2, { status: 'denied', notes: 7 }],
      [c3, { status: 'approved', approved_amount: 1e1, notes: '' }], [c3, { status: 'denied' }],
    ] as const) {
      const r = await sup.req('POST', `/api/support/admin/aircover-claims/${id}/decide/`, { json });
      sameT(r);
    }
    sameT(await sup.req('POST', `/api/support/admin/aircover-claims/${c1}/decide/`, { json: { status: 'approved', approved_amount: 'NaN' } })); // NaN comparison → 500
    sameT(await sup.req('POST', `/api/support/admin/aircover-claims/${c1}/decide/`, { json: { status: 'denied', notes: null } })); // NOT NULL → 500
    await sameRowsT('support_aircoverclaim');
    await sameRowsT('superadmin_adminauditlog', `id > ${mxA}`);
  });
});
