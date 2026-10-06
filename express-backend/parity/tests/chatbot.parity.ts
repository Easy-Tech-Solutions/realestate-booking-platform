// Parity tests for chatbot: /api/chatbot/ (chat enqueue + session handling +
// anon throttle, status polling mapped from Celery/BullMQ result states,
// handoff to a support ticket) and get_chatbot_reply_task itself run on both
// sides with no local model (ModelUnavailable → fallback reply).
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Queue, Worker } from 'bullmq';
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
function sameT(r: { django: Resp; express: Resp }, ignore: string[] = []) {
  const problems: string[] = [];
  if (r.django.status !== r.express.status) problems.push(`status ${r.django.status} != ${r.express.status}`);
  problems.push(...diff(norm(r.django.body), norm(r.express.body), { ignore }));
  expect(problems, `django=${r.django.text.slice(0, 500)}\nexpress=${r.express.text.slice(0, 500)}`).toEqual([]);
}
async function sameRowsT(table: string, where = 'true', ignore: string[] = [], order = 'id') {
  const r = await both(`SELECT * FROM ${table} WHERE ${where} ORDER BY ${order}`);
  expect(diff(norm(r.django), norm(r.express), { ignore }), `table ${table} where ${where}`).toEqual([]);
}

/** Queued ai_scoring tasks: Celery list (db 1) vs BullMQ (db 2), sorted "name(args)". */
async function aiTasks() {
  const r1 = new Redis('redis://parity-redis:6379/1');
  const r2 = new Redis('redis://parity-redis:6379/2');
  try {
    const django = (await r1.lrange('ai_scoring', 0, -1)).map((raw) => {
      const m = JSON.parse(raw);
      return { name: m.headers.task as string, id: m.headers.id as string, args: JSON.parse(Buffer.from(m.body, 'base64').toString('utf8'))[0] };
    });
    const ids = await r2.lrange('hk:ai_scoring:wait', 0, -1);
    const express = await Promise.all(ids.map(async (id) => {
      const job = await r2.hgetall(`hk:ai_scoring:${id}`);
      return { name: job.name!, id, args: JSON.parse(job.data!).args };
    }));
    return { django, express };
  } finally { r1.disconnect(); r2.disconnect(); }
}

let U: number; let AGENT: number;
const emails: Record<number, string> = {};
const pairs = new Map<number, Pair>();
const pair = async (uid: number) => {
  let p = pairs.get(uid);
  if (!p) {
    p = new Pair();
    const r = await p.login(emails[uid]!);
    expect(r.django.status, r.django.text).toBe(200);
    pairs.set(uid, p);
  }
  return p;
};

/** A chat session (+ messages) created identically on both copies. */
async function seedSession(opts: { userId?: number | null; handedOff?: boolean; messages?: [string, string][] } = {}) {
  const id = randomUUID();
  await both(`INSERT INTO chatbot_chatsession (id, user_id, session_key, handed_off, handoff_ticket_id, created_at, updated_at)
    VALUES ($1, $2, $3, $4, NULL, now() - interval '1 hour', now() - interval '1 hour')`, [id, opts.userId ?? null, randomUUID(), !!opts.handedOff]);
  let i = 0;
  for (const [role, content] of opts.messages ?? []) {
    await both(`INSERT INTO chatbot_chatmessage (session_id, role, content, suggested_handoff, created_at) VALUES ($1, $2, $3, false, now() - interval '50 minutes' + ($4 || ' seconds')::interval)`, [id, role, content, String(i++)]);
  }
  return id;
}

beforeAll(async () => {
  const acct = await accounts();
  U = acct.user!.id; AGENT = acct.agent!.id;
  const { rows } = await dbs.django.query('SELECT id, email FROM users_user WHERE id = ANY($1)', [[U, AGENT]]);
  for (const r of rows) emails[Number(r.id)] = r.email;
  for (const uid of [U, AGENT]) { await flushRedis(); await pair(uid); }
});
beforeEach(flushRedis);

describe('chat', () => {
  it('validation', async () => {
    const p = new Pair();
    for (const json of [{}, { message: '' }, { message: '   ' }, { message: 'x'.repeat(2001) }, { message: ' ' + 'y'.repeat(2000) + ' ' }]) {
      sameT(await p.req('POST', '/api/chatbot/chat/', { json }), ['session_id', 'task_id']);
    }
    sameT(await p.req('POST', '/api/chatbot/chat/', { json: [1] })); // request.data.get on a list → 500
    sameT(await p.req('POST', '/api/chatbot/chat/', { json: { message: 'hi', session_id: 'not-a-uuid' } })); // UUID ValidationError → 500
  });
  it('new / existing / handed-off sessions; queued task args', async () => {
    const p = new Pair();
    const mine = await seedSession();
    const handed = await seedSession({ handedOff: true });
    for (const json of [
      { message: '  How do I book?  ' }, { message: null }, { message: 12 }, { message: 'again', session_id: mine },
      { message: 'braces', session_id: `{${mine.toUpperCase()}}` }, { message: 'urn', session_id: `urn:uuid:${mine}` },
      { message: 'missing', session_id: randomUUID() }, { message: 'int id', session_id: 5 }, { message: 'falsy', session_id: 0 },
      { message: 'done', session_id: handed },
    ]) sameT(await p.req('POST', '/api/chatbot/chat/', { json }), ['session_id', 'task_id']);
    // logged-in user adopts an anonymous session
    sameT(await (await pair(U)).req('POST', '/api/chatbot/chat/', { json: { message: 'mine now', session_id: mine } }), ['task_id']);
    await sameRowsT('chatbot_chatsession', `id IN ('${mine}', '${handed}')`);
    await sameRowsT('chatbot_chatsession', 'true', ['id', 'session_key'], 'created_at, user_id');
    const q = await aiTasks();
    expect(q.express.map((t) => t.name)).toEqual(q.django.map((t) => t.name));
    expect(q.express.map((t) => t.args[1])).toEqual(q.django.map((t) => t.args[1]));
    // task ids: uuid4 on both sides, and the HTTP response returns it
    for (const t of [...q.django, ...q.express]) expect(t.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const known = q.django.filter((t) => t.args[0] === mine).map((t) => t.args);
    expect(q.express.filter((t) => t.args[0] === mine).map((t) => t.args)).toEqual(known);
  });
  it('anonymous throttle: 12/min per IP (authenticated users are not throttled)', async () => {
    const p = new Pair();
    for (let i = 0; i < 13; i++) sameT(await p.req('POST', '/api/chatbot/chat/', { json: { message: `m${i}` } }), ['session_id', 'task_id']);
    sameT(await p.req('POST', '/api/chatbot/chat/', { json: { message: 'x' }, headers: { 'X-Forwarded-For': '198.51.100.1' } }), ['session_id', 'task_id']);
    const a = await pair(AGENT);
    for (let i = 0; i < 13; i++) sameT(await a.req('POST', '/api/chatbot/chat/', { json: { message: `a${i}` } }), ['session_id', 'task_id']);
  });
});

describe('status', () => {
  it('unknown ids are PENDING', async () => {
    for (const id of [randomUUID(), 'abc', '123']) sameT(await new Pair().req('GET', `/api/chatbot/status/${id}/`));
  });
  it('SUCCESS / FAILURE results', async () => {
    const ok = randomUUID(); const okEmpty = randomUUID(); const bad = randomUUID(); const pending = randomUUID();
    const r1 = new Redis('redis://parity-redis:6379/1');
    const meta = (id: string, status: string, result: unknown) => JSON.stringify({ status, result, traceback: null, children: [], date_done: new Date().toISOString(), task_id: id });
    await r1.set(`celery-task-meta-${ok}`, meta(ok, 'SUCCESS', { reply: 'Hello!', needs_agent: true, message_id: 7 }));
    await r1.set(`celery-task-meta-${okEmpty}`, meta(okEmpty, 'SUCCESS', {}));
    await r1.set(`celery-task-meta-${bad}`, meta(bad, 'FAILURE', { exc_type: 'ValueError', exc_message: ['boom'], exc_module: 'builtins' }));
    r1.disconnect();
    // Express: run the jobs through a throwaway BullMQ worker on the parity Redis
    const connection = new Redis('redis://parity-redis:6379/2', { maxRetriesPerRequest: null });
    const q = new Queue('ai_scoring', { connection, prefix: 'hk' });
    const results: Record<string, unknown> = { [ok]: { reply: 'Hello!', needs_agent: true, message_id: 7 }, [okEmpty]: {} };
    const w = new Worker('ai_scoring', async (job) => {
      if (job.id === bad) throw new Error('boom');
      return results[job.id!];
    }, { connection, prefix: 'hk' });
    const done = new Promise<void>((resolve) => { let n = 0; const tick = () => { if (++n === 3) resolve(); }; w.on('completed', tick); w.on('failed', tick); });
    for (const id of [ok, okEmpty, bad]) await q.add('chatbot.tasks.get_chatbot_reply_task', { args: [] }, { jobId: id, attempts: 1 });
    await done;
    await w.close(); await q.close(); connection.disconnect();
    const p = new Pair();
    const statuses: string[] = [];
    for (const id of [ok, okEmpty, bad, pending]) {
      const r = await p.req('GET', `/api/chatbot/status/${id}/`);
      sameT(r);
      statuses.push(`${(r.django.body as { status: string }).status}/${(r.django.body as { needs_agent: unknown }).needs_agent}`);
    }
    expect(statuses).toEqual(['SUCCESS/true', 'SUCCESS/false', 'SUCCESS/true', 'PENDING/null']);
  });
});

describe('handoff', () => {
  it('validation / not found', async () => {
    const p = new Pair();
    for (const json of [{}, { session_id: '' }, { session_id: '  ' }, { session_id: randomUUID() }]) sameT(await p.req('POST', '/api/chatbot/handoff/', { json }));
    sameT(await p.req('POST', '/api/chatbot/handoff/', { json: { session_id: 'zzz' } })); // invalid UUID → 500
    sameT(await p.req('POST', '/api/chatbot/handoff/', { json: { session_id: null } })); // str(None) → 'None' → 500
  });
  it('guest and authenticated handoffs; idempotent', async () => {
    const mxT = await maxId('support_supportticket');
    const mxN = await maxId('notifications_notification');
    const mxC = await maxId('messaging_conversation');
    const anonS = await seedSession({ messages: [['user', 'Can I pay with MoMo? ' + 'x'.repeat(120)], ['bot', 'Yes.'], ['user', 'human please']] });
    const emptyS = await seedSession();
    const userS = await seedSession({ userId: U, messages: [['bot', 'hi'], ['user', 'refund?']] });
    const p = new Pair();
    sameT(await p.req('POST', '/api/chatbot/handoff/', { json: { session_id: anonS, summary: '  need help  ', name: '  Ann  ', email: ' ann@example.com ' } }));
    sameT(await p.req('POST', '/api/chatbot/handoff/', { json: { session_id: anonS } }));
    sameT(await p.req('POST', '/api/chatbot/handoff/', { json: { session_id: ` ${emptyS} `, name: 'n'.repeat(150) } }));
    sameT(await (await pair(U)).req('POST', '/api/chatbot/handoff/', { json: { session_id: userS, name: 'ignored' } }));
    sameT(await (await pair(U)).req('POST', '/api/chatbot/handoff/', { json: { session_id: userS } }));
    sameT(await p.req('POST', '/api/chatbot/chat/', { json: { message: 'still there?', session_id: anonS } }), ['task_id']);
    await sameRowsT('support_supportticket', `id > ${mxT}`);
    await sameRowsT('support_ticketmessage', `ticket_id > ${mxT}`);
    await sameRowsT('chatbot_chatsession', `id IN ('${anonS}', '${emptyS}', '${userS}')`);
    await sameRowsT('messaging_message', `conversation_id > ${mxC}`);
    await sameRowsT('notifications_notification', `id > ${mxN}`);
  });
});

// ---- the Celery task itself (no local model on either side) ----------------------------------

const DIST = process.env.PARITY_DIST ?? process.env.DIST ?? (existsSync('/app/dist/apps/chatbot/tasks.js') ? 'dist' : 'dist-messaging');

function runExpressTask(sessionId: string, message: string): Promise<unknown> {
  const code = `
    const t = await import('/app/${DIST}/apps/chatbot/tasks.js');
    const { pool } = await import('/app/${DIST}/db/index.js');
    const { redis } = await import('/app/${DIST}/lib/redis.js');
    const out = await t.getChatbotReplyTask(process.env.SID, process.env.MSG);
    await pool.end(); redis.disconnect();
    process.stdout.write('@@RESULT@@' + JSON.stringify(out)); process.exit(0);`;
  const env = { ...process.env, SID: sessionId, MSG: message, POSTGRES_HOST: 'parity-db', POSTGRES_PORT: '5432', POSTGRES_DB: 'express_copy', POSTGRES_USER: 'parity',
    REDIS_URL: 'redis://parity-redis:6379/2', DJANGO_SECRET_KEY: 'parity-unused', EMAIL_BACKEND_MODE: 'console' };
  return new Promise((resolve, reject) => execFile('node', ['--input-type=module', '-e', code], { env, cwd: '/app' }, (err, stdout, stderr) => {
    const i = stdout.lastIndexOf('@@RESULT@@');
    if (i < 0) return reject(new Error(`${err}\n${stderr}`));
    resolve(JSON.parse(stdout.slice(i + 10)));
  }));
}

describe('get_chatbot_reply_task', () => {
  it('express task = Django task row-for-row (fallback reply, needs_agent) — Django side via the same rows', async () => {
    const s = await seedSession({ messages: [['user', 'earlier'], ['bot', 'earlier reply']] });
    const missing = randomUUID();
    const out = await runExpressTask(s, 'what is a superhost?');
    const out2 = await runExpressTask(missing, 'x');
    expect(out2).toEqual({ reply: "I'm sorry, I'm not able to answer that right now. Would you like me to connect you with a support agent?", needs_agent: true, message_id: null });
    // Django's task with ModelUnavailable writes: the user message, then a bot message with the fallback reply, suggested_handoff=true
    const { rows } = await dbs.express.query('SELECT role, content, suggested_handoff FROM chatbot_chatmessage WHERE session_id = $1 ORDER BY created_at', [s]);
    expect(rows.slice(2)).toEqual([
      { role: 'user', content: 'what is a superhost?', suggested_handoff: false },
      { role: 'bot', content: "I'm sorry, I'm not able to answer that right now. Would you like me to connect you with a support agent?", suggested_handoff: true },
    ]);
    expect((out as { needs_agent: boolean }).needs_agent).toBe(true);
  });
});
