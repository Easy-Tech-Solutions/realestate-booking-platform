// Parity tests for messaging: /api/messaging/ routes (access matrix, validation,
// redaction + anti-bypass escalation, attachments, reply-to, edit window,
// presence, unread counts) and the chat WebSocket consumer over real sockets.
import { Redis } from 'ioredis';
import WebSocket from 'ws';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accounts, dbs, diff, flushRedis, Pair, same, sameRows, type Side } from '../lib.js';

const both = async (sql: string, params: unknown[] = []) => {
  const [d, e] = await Promise.all([dbs.django.query(sql, params), dbs.express.query(sql, params)]);
  return { django: d.rows, express: e.rows };
};
const maxId = async (table: string) => Number((await dbs.django.query(`SELECT coalesce(max(id), 0) AS m FROM ${table}`)).rows[0].m);

/** Tasks queued since the last flush: Django's Celery lists vs Express's BullMQ queues, as sorted "name(args)". */
async function queuedTasks(queues = ['celery', 'ai_scoring']) {
  const r1 = new Redis('redis://parity-redis:6379/1');
  const r2 = new Redis('redis://parity-redis:6379/2');
  try {
    const django: string[] = [];
    const express: string[] = [];
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
  } finally {
    r1.disconnect();
    r2.disconnect();
  }
}

let acct: Awaited<ReturnType<typeof accounts>>;
// Fixture users: 3 (agent) and 4 share conversations 8/12 (listing with a confirmed booking → attachments allowed),
// 1 (superadmin) + 3 share 11 (no listing), 1 + 10 share 13–17.
const U3 = 3, U4 = 4, U1 = 1, U10 = 10;
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

beforeAll(async () => {
  acct = await accounts();
  await both('UPDATE users_user SET password = (SELECT password FROM users_user WHERE id = $1) WHERE id = $2', [acct.agent!.id, U4]);
  const { rows } = await dbs.django.query('SELECT id, email FROM users_user WHERE id = ANY($1)', [[U1, U3, U4, U10, acct.admin!.id, acct.customer!.id]]);
  for (const r of rows) emails[Number(r.id)] = r.email;
  for (const uid of [U1, U3, U4, U10, acct.admin!.id, acct.customer!.id]) { await flushRedis(); await pair(uid); }
});
beforeEach(flushRedis);

const ROUTES: [string, string][] = [
  ['GET', '/api/messaging/conversations/'], ['POST', '/api/messaging/conversations/start/'], ['DELETE', '/api/messaging/conversations/12/'],
  ['GET', '/api/messaging/conversations/12/messages/'], ['POST', '/api/messaging/conversations/12/messages/send/'],
  ['PATCH', '/api/messaging/messages/1/edit/'], ['GET', '/api/messaging/users/3/presence/'], ['GET', '/api/messaging/unread-count/'],
];

describe('access control', () => {
  for (const [m, path] of ROUTES) {
    it(`anonymous ${m} ${path} → 401`, async () => same(await new Pair().req(m, path, { json: {} }), { headers: ['www-authenticate'] }));
  }
  it('bad token → 401', async () => same(await new Pair().req('GET', '/api/messaging/conversations/', { token: 'x.y.z' })));
  it('wrong methods → 405', async () => {
    const p = await pair(U3);
    for (const [m, path] of [['POST', '/api/messaging/conversations/'], ['GET', '/api/messaging/conversations/start/'], ['GET', '/api/messaging/conversations/12/'],
      ['POST', '/api/messaging/conversations/12/messages/'], ['GET', '/api/messaging/conversations/12/messages/send/'], ['POST', '/api/messaging/messages/1/edit/'],
      ['POST', '/api/messaging/users/3/presence/'], ['POST', '/api/messaging/unread-count/']] as const) same(await p.req(m, path));
  });
  it('non-participant gets 404 everywhere and changes nothing', async () => {
    const p = await pair(U10);
    for (const [m, path, json] of [['GET', '/api/messaging/conversations/12/messages/'], ['DELETE', '/api/messaging/conversations/12/'],
      ['POST', '/api/messaging/conversations/12/messages/send/', { content: 'hi' }], ['GET', '/api/messaging/conversations/999999/messages/'],
      ['GET', '/api/messaging/conversations/99999999999999999999/messages/']] as const) {
      same(await p.req(m, path, json ? { json } : {}));
    }
    await sameRows('messaging_message', 'conversation_id = 12');
    await sameRows('messaging_conversation_deleted_by');
  });
  it('other user\'s message can\'t be edited', async () => {
    const { rows } = await dbs.django.query('SELECT id FROM messaging_message WHERE sender_id = $1 ORDER BY id LIMIT 1', [U4]);
    same(await (await pair(U3)).req('PATCH', `/api/messaging/messages/${rows[0].id}/edit/`, { json: { content: 'x' } }));
    same(await (await pair(U3)).req('PATCH', '/api/messaging/messages/99999999999999999999/edit/', { json: { content: 'x' } }));
  });
});

describe('read endpoints', () => {
  it('conversation lists / unread counts / presence for several roles', async () => {
    for (const uid of [U1, U3, U4, U10]) {
      const p = await pair(uid);
      same(await p.req('GET', '/api/messaging/conversations/'));
      same(await p.req('GET', '/api/messaging/unread-count/'));
    }
    for (const who of [acct.admin!.id, acct.customer!.id]) {
      const p = await pair(who);
      same(await p.req('GET', '/api/messaging/conversations/'));
      same(await p.req('GET', '/api/messaging/unread-count/'));
    }
    const p = await pair(U3);
    for (const uid of [U3, U4, U1, 999999, '99999999999999999999']) same(await p.req('GET', `/api/messaging/users/${uid}/presence/`));
    await both("UPDATE users_profile SET last_seen = now() - interval '30 seconds' WHERE user_id = $1", [U4]);
    same(await p.req('GET', `/api/messaging/users/${U4}/presence/`));
  });
  it('message list marks the other side\'s messages read', async () => {
    await both('UPDATE messaging_message SET is_read = false WHERE conversation_id = 12');
    const p4 = await pair(U4);
    same(await p4.req('GET', '/api/messaging/conversations/12/messages/'));
    await sameRows('messaging_message', 'conversation_id = 12');
    same(await (await pair(U3)).req('GET', '/api/messaging/unread-count/'));
    same(await (await pair(U3)).req('GET', '/api/messaging/conversations/12/messages/'));
    await sameRows('messaging_message', 'conversation_id = 12');
    same(await p4.req('GET', '/api/messaging/conversations/8/messages/'));
  });
});

describe('start / delete conversation', () => {
  it('validation', async () => {
    const p = await pair(U3);
    for (const json of [{}, [1], { recipient_id: null }, { recipient_id: 'abc' }, { recipient_id: true }, { recipient_id: 3.5 }, { recipient_id: U3 },
      { recipient_id: '3.0' }, { recipient_id: 999999 }, { recipient_id: '99999999999999999999' }, { recipient_id: U4, listing_id: '' },
      { recipient_id: U4, listing_id: 'x' }, { recipient_id: U4, initial_message: false }, { recipient_id: U4, initial_message: null }]) {
      same(await p.req('POST', '/api/messaging/conversations/start/', { json }));
    }
    same(await p.req('POST', '/api/messaging/conversations/start/'));
    await sameRows('messaging_conversation');
  });
  it('existing conversation is returned and resurfaced after delete', async () => {
    const p = await pair(U3);
    same(await p.req('DELETE', '/api/messaging/conversations/12/'));
    same(await p.req('DELETE', '/api/messaging/conversations/12/')); // ON CONFLICT DO NOTHING burns a sequence value
    await sameRows('messaging_conversation_deleted_by');
    same(await p.req('GET', '/api/messaging/conversations/'));
    same(await p.req('POST', '/api/messaging/conversations/start/', { json: { recipient_id: U4, listing_id: 15 } }));
    await sameRows('messaging_conversation_deleted_by');
    same(await p.req('POST', '/api/messaging/conversations/start/', { json: { recipient_id: `${U1}`, listing_id: null, initial_message: 'again' } }));
    await sameRows('messaging_message', 'conversation_id = 11');
  });
  it('new conversations (participants, initial message, notification)', async () => {
    const mxN = await maxId('notifications_notification');
    const p = await pair(U10);
    same(await p.req('POST', '/api/messaging/conversations/start/', { json: { recipient_id: U3, initial_message: '  Hello there  ' } }));
    same(await p.req('POST', '/api/messaging/conversations/start/', { json: { recipient_id: U4, listing_id: 15 } }));
    const p1 = await pair(U1);
    same(await p1.req('POST', '/api/messaging/conversations/start/', { json: { recipient_id: U4, listing_id: '13', initial_message: 'call me at 0880123456' } }));
    // form-encoded body
    const fd = new FormData(); fd.append('recipient_id', String(U4)); fd.append('listing_id', ''); fd.append('initial_message', 'form hi');
    same(await p1.req('POST', '/api/messaging/conversations/start/', { form: fd }));
    same(await p.req('POST', '/api/messaging/conversations/start/', { json: { recipient_id: U4, listing_id: 999999 } })); // FK violation → 500
    await sameRows('messaging_conversation');
    await sameRows('messaging_conversation_participants');
    await sameRows('messaging_message');
    await sameRows('notifications_notification', `id > ${mxN}`);
    const q = await queuedTasks();
    expect(q.express).toEqual(q.django);
  });
});

describe('send / edit messages', () => {
  it('validation', async () => {
    const p = await pair(U3);
    for (const json of [{}, { content: '' }, { content: '   ' }, { content: null }, { content: true }, { files: 'x' }, { files: ['x'] }, [1], { content: 'a\u0000b' }]) {
      same(await p.req('POST', '/api/messaging/conversations/11/messages/send/', { json }));
    }
    await sameRows('messaging_message', 'conversation_id = 11');
  });
  it('text messages, redaction, reply_to, notifications, broadcast-free rows', async () => {
    const mxN = await maxId('notifications_notification');
    const p = await pair(U3);
    const { rows } = await dbs.django.query('SELECT id FROM messaging_message WHERE conversation_id = 12 ORDER BY id LIMIT 1');
    const { rows: other } = await dbs.django.query('SELECT id FROM messaging_message WHERE conversation_id = 8 ORDER BY id LIMIT 1');
    for (const json of [
      { content: '  plain hello  ' },
      { content: 'reply', reply_to_id: rows[0].id },
      { content: 'reply str', reply_to_id: String(rows[0].id) },
      { content: 'reply elsewhere', reply_to_id: other[0].id },
      { content: 'reply zero', reply_to_id: 0 },
      { content: 'reply huge', reply_to_id: '99999999999999999999' },
      { content: 'dates 2026-10-03 and 2026-1-5 and booking 12345 are fine' },
    ]) same(await p.req('POST', '/api/messaging/conversations/12/messages/send/', { json }));
    same(await p.req('POST', '/api/messaging/conversations/12/messages/send/', { json: { content: 'bad reply', reply_to_id: 'abc' } }));
    same(await p.req('POST', '/api/messaging/conversations/12/messages/send/', { json: { content: 'bad reply', reply_to_id: [1] } }));
    const fd = new FormData(); fd.append('content', 'form message'); fd.append('reply_to_id', String(rows[0].id));
    same(await p.req('POST', '/api/messaging/conversations/12/messages/send/', { form: fd }));
    await sameRows('messaging_message', 'conversation_id = 12');
    await sameRows('messaging_conversation', 'id = 12');
    await sameRows('notifications_notification', `id > ${mxN}`);
    const q = await queuedTasks();
    expect(q.express).toEqual(q.django);
  });
  it('attachments: allowed only after a confirmed booking; types, multiple files, empty file', async () => {
    const p = await pair(U3);
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000050001a5f645400000000049454e44ae426082', 'hex');
    const mk = (parts: [string, Buffer | string, string?, string?][]) => {
      const fd = new FormData();
      for (const [k, v, name, type] of parts) {
        if (typeof v === 'string' && !name) fd.append(k, v);
        else fd.append(k, new Blob([v], { type: type ?? '' }), name);
      }
      return fd;
    };
    same(await p.req('POST', '/api/messaging/conversations/11/messages/send/', { form: mk([['files', png, 'nope.png', 'image/png']]) }));
    const tag = Date.now();
    for (const form of [
      mk([['files', png, `pic-${tag}.png`, 'image/png']]),
      mk([['content', 'see attached'], ['files', 'doc body', `report ${tag}.PDF`, 'application/octet-stream'], ['files', 'v', `clip-${tag}.mov`], ['files', 'z', `x-${tag}.bin`]]),
      mk([['files', 'vid', `movie-${tag}`, 'video/mp4']]),
      mk([['files', '', `empty-${tag}.txt`, 'text/plain']]),
      mk([['files', 'plain text field']]),
      mk([['content', 'email me at a.b@example.com'], ['files', 'x', `héllo wörld ${tag}.txt`, 'text/plain']]),
    ]) same(await p.req('POST', '/api/messaging/conversations/12/messages/send/', { form }));
    await sameRows('messaging_message', 'conversation_id = 12');
    await sameRows('messaging_messageattachment');
    // over-long stored name: FileField(max_length=100) truncates the root and adds a random 7-char suffix (random on both sides)
    const long = await p.req('POST', '/api/messaging/conversations/12/messages/send/', { form: mk([['files', 'x', `${'long'.repeat(30)}-${tag}.txt`, 'text/plain']]) });
    same(long, { ignore: ['file_url'] });
    for (const side of ['django', 'express'] as const) {
      expect((long[side].body as { attachments: { file_url: string }[] }).attachments[0]!.file_url).toMatch(/\/media\/messaging\/attachments\/\d{4}\/\d{2}\/(long){14}lo_[A-Za-z0-9]{7}\.txt$/);
    }
    await sameRows('messaging_messageattachment', 'true', { ignore: ['file'] });
    await both("DELETE FROM messaging_messageattachment WHERE file_name LIKE 'longlong%'");
    // the files really exist on the Express side under the stored names
    const att = await dbs.express.query('SELECT file FROM messaging_messageattachment ORDER BY id DESC LIMIT 1');
    const r = await p.express.req('GET', `/media/${att.rows[0].file}`);
    expect(r.status).toBe(200);
  });
  it('edit window, validation, and broadcast payload', async () => {
    const p = await pair(U3);
    const r = await p.req('POST', '/api/messaging/conversations/12/messages/send/', { json: { content: 'to be edited' } });
    same(r);
    const id = (r.django.body as { id: number }).id;
    for (const json of [{}, { content: '' }, { content: '   ' }, { content: 0 }, { content: null }]) {
      same(await p.req('PATCH', `/api/messaging/messages/${id}/edit/`, { json }));
    }
    same(await p.req('PATCH', `/api/messaging/messages/${id}/edit/`, { json: { content: 5 } })); // int.strip → 500
    same(await p.req('PATCH', `/api/messaging/messages/${id}/edit/`, { json: [1] }));
    same(await p.req('PATCH', `/api/messaging/messages/${id}/edit/`, { json: { content: '  edited text  ' } }));
    await sameRows('messaging_message', `id = ${id}`);
    const { rows } = await dbs.django.query('SELECT id FROM messaging_message WHERE sender_id = $1 AND created_at < now() - interval \'10 minutes\' ORDER BY id LIMIT 1', [U3]);
    same(await p.req('PATCH', `/api/messaging/messages/${rows[0].id}/edit/`, { json: { content: 'too late' } }));
  });
  it('soft-deleted conversation resurfaces for everyone on a new HTTP message', async () => {
    const p4 = await pair(U4);
    same(await p4.req('DELETE', '/api/messaging/conversations/8/'));
    same(await (await pair(U3)).req('POST', '/api/messaging/conversations/8/messages/send/', { json: { content: 'ping' } }));
    await sameRows('messaging_conversation_deleted_by');
    same(await p4.req('GET', '/api/messaging/conversations/'));
  });
  it('anti-bypass: violations recorded, both parties warned, 3rd violation auto-suspends', async () => {
    const mxN = await maxId('notifications_notification');
    const p = await pair(U10);
    for (const content of [
      'whatsapp me please',
      'my number is +231 88 012 3456 and mail x_y@test.org, lets go off-platform and pay me in cash',
      'Call me directly at 0880-012-421',
    ]) same(await p.req('POST', '/api/messaging/conversations/13/messages/send/', { json: { content } }));
    await sameRows('messaging_messageviolation');
    await sameRows('messaging_message', 'conversation_id = 13');
    await sameRows('suspensions_suspension', `user_id = ${U10}`, { order: 'id' });
    await sameRows('notifications_notification', `id > ${mxN}`);
    // suspended now → SuspensionMiddleware answers
    same(await p.req('GET', '/api/messaging/unread-count/'));
    const q = await queuedTasks();
    expect(q.express).toEqual(q.django);
  });
  it('escalates to a permanent ban after two earlier auto-suspensions', async () => {
    await both("UPDATE suspensions_suspension SET status = 'revoked' WHERE user_id = $1", [U4]);
    await both(`INSERT INTO suspensions_suspension (user_id, issued_by_id, suspension_type, reason, started_at, ends_at, status, revoked_by_id, revoked_at,
      revocation_reason, related_report_id, user_notified, updated_at) SELECT $1, NULL, 'temporary', '[auto:anti-bypass] old', now() - interval '30 days',
      now() - interval '20 days', 'expired', NULL, NULL, '', NULL, true, now() FROM generate_series(1, 2)`, [U4]);
    await both(`INSERT INTO messaging_messageviolation (conversation_id, sender_id, recipient_id, violation_type, matched_label, created_at)
      SELECT 12, $1, NULL, 'email', '', now() - interval '40 days' FROM generate_series(1, 5)`, [U4]);
    const mxN = await maxId('notifications_notification');
    same(await (await pair(U4)).req('POST', '/api/messaging/conversations/12/messages/send/', { json: { content: 'reach me: someone@example.com' } }));
    await sameRows('suspensions_suspension', `user_id = ${U4}`);
    await sameRows('notifications_notification', `id > ${mxN}`);
  });
});

// ---- chat WebSocket ------------------------------------------------------------------------------

type WsEvent = [string, ...unknown[]];
interface WsConn { events: WsEvent[]; ws: WebSocket; done: Promise<void>; waitFor(pred: (e: WsEvent) => boolean, ms?: number): Promise<void> }
const H = { Host: 'homekonet.com', Origin: 'https://homekonet.com' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function connect(side: Side, path: string, headers: Record<string, string> = H): WsConn {
  const events: WsEvent[] = [];
  const listeners = new Set<() => void>();
  const push = (e: WsEvent) => { events.push(e); listeners.forEach((l) => l()); };
  const ws = new WebSocket(`ws://parity-${side}:8000${path}`, { headers });
  const done = new Promise<void>((resolve) => {
    ws.on('unexpected-response', (_req, res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => { push(['http', res.statusCode, body]); resolve(); });
    });
    ws.on('open', () => push(['open']));
    ws.on('message', (d, isBinary) => push(['msg', isBinary, JSON.parse(d.toString())]));
    ws.on('close', (code) => { push(['close', code]); resolve(); });
    ws.on('error', () => resolve());
  });
  const waitFor = (pred: (e: WsEvent) => boolean, ms = 5000) => new Promise<void>((resolve) => {
    const check = () => { if (events.some(pred)) { listeners.delete(check); resolve(); } };
    listeners.add(check);
    check();
    setTimeout(() => { listeners.delete(check); resolve(); }, ms);
  });
  return { events, ws, done, waitFor };
}

const sameEvents = (d: WsEvent[], e: WsEvent[]) => expect(diff(d, e), `django=${JSON.stringify(d)}\nexpress=${JSON.stringify(e)}`).toEqual([]);

/** One socket per side; send frames; wait until quiet; compare event logs. */
async function wsScenario(path: string, frames: (side: Side) => (string | Buffer)[], quietMs = 1200, headers = H) {
  const run = async (side: Side) => {
    const c = connect(side, path, headers);
    await c.waitFor((e) => e[0] === 'open' || e[0] === 'http');
    if (c.events[0]?.[0] === 'open') for (const f of frames(side)) { c.ws.send(f, { binary: Buffer.isBuffer(f) }); await sleep(50); }
    await Promise.race([c.done, sleep(quietMs)]);
    const events = [...c.events];
    if (c.ws.readyState === WebSocket.OPEN) c.ws.terminate();
    return events;
  };
  const [d, e] = await Promise.all([run('django'), run('express')]);
  sameEvents(d, e);
  return d;
}

describe('websocket /ws/chat/<id>/', () => {
  const tokens: Record<number, Record<Side, string>> = {};
  beforeAll(async () => {
    await both("UPDATE suspensions_suspension SET status = 'revoked' WHERE user_id = ANY($1)", [[U3, U4, U1]]);
    for (const uid of [U1, U3, U4]) {
      const p = await pair(uid);
      tokens[uid] = { django: p.django.token!, express: p.express.token! };
    }
  });
  const auth = (uid: number) => (side: Side) => JSON.stringify({ type: 'authenticate', token: tokens[uid]![side] });

  it('origin validation and unknown routes', async () => {
    await wsScenario('/ws/chat/12/', () => [], 400, { Host: 'homekonet.com', Origin: 'https://evil.com' } as typeof H);
    await wsScenario('/ws/chat/12/', () => [], 400, { Host: 'homekonet.com' } as typeof H);
  });
  it('unauthenticated messages', async () => {
    await wsScenario('/ws/chat/12/', () => ['{"type":"chat_message","content":"x"}', '{"type":"mark_read"}', '{"type":"typing"}', 'nope', '{}', '{"type":5}', '{"type":"zz"}']);
  });
  for (const [name, frame] of [['list', '[1]'], ['null', 'null'], ['number', '7']] as const) {
    it(`non-object JSON (${name}) crashes the consumer`, async () => { await wsScenario('/ws/chat/12/', () => [frame]); });
  }
  it('binary frame crashes the consumer', async () => { await wsScenario('/ws/chat/12/', () => [Buffer.from('x')]); });
  it('bad / missing token → error + close', async () => {
    for (const f of ['{"type":"authenticate","token":"abc"}', '{"type":"authenticate"}', '{"type":"authenticate","token":null}', '{"type":"authenticate","token":5}']) {
      await wsScenario('/ws/chat/12/', () => [f, '{"type":"typing"}']);
    }
  });
  it('non-participant / missing conversation → error + close', async () => {
    await wsScenario('/ws/chat/12/', (s) => [auth(U1)(s), '{"type":"typing"}']);
    await wsScenario('/ws/chat/999999/', (s) => [auth(U3)(s)]);
    await wsScenario('/ws/chat/99999999999999999999/', (s) => [auth(U3)(s)]);
  });
  it('participant: authenticate, empty/invalid content, mark_read; last_seen updated', async () => {
    await both('UPDATE messaging_message SET is_read = false WHERE conversation_id = 11');
    await wsScenario('/ws/chat/11/', (s) => [auth(U3)(s), '{"type":"chat_message","content":"   "}', '{"type":"chat_message"}', '{"type":"mark_read"}', '{"type":"mark_read"}', '{"type":"typing"}']);
    await sameRows('messaging_message', 'conversation_id = 11');
    const ls = await both('SELECT last_seen FROM users_profile WHERE user_id = $1', [U3]);
    expect(Math.abs(new Date(ls.django[0].last_seen).getTime() - new Date(ls.express[0].last_seen).getTime())).toBeLessThan(10_000);
  });
  it('non-string content crashes the consumer', async () => {
    await wsScenario('/ws/chat/11/', (s) => [auth(U3)(s), '{"type":"chat_message","content":5}']);
  });

  it('two participants: chat_message / typing / read receipts / HTTP sends and edits reach both', async () => {
    const mxN = await maxId('notifications_notification');
    const mxM = await maxId('messaging_message');
    const run = async (side: Side) => {
      const a = connect(side, '/ws/chat/12/');
      const b = connect(side, '/ws/chat/12/');
      await a.waitFor((e) => e[0] === 'open'); await b.waitFor((e) => e[0] === 'open');
      a.ws.send(auth(U3)(side)); b.ws.send(auth(U4)(side));
      await a.waitFor((e) => e[0] === 'msg'); await b.waitFor((e) => e[0] === 'msg');
      a.ws.send(JSON.stringify({ type: 'chat_message', content: '  hi from ws, text me at 0770 123 456  ' }));
      await b.waitFor((e) => e[0] === 'msg' && (e[2] as { type: string }).type === 'chat_message');
      a.ws.send('{"type":"typing"}');
      await b.waitFor((e) => e[0] === 'msg' && (e[2] as { type: string }).type === 'typing');
      b.ws.send('{"type":"mark_read"}');
      await a.waitFor((e) => e[0] === 'msg' && (e[2] as { type: string }).type === 'read_receipt');
      return { a, b };
    };
    const [d, e] = await Promise.all([run('django'), run('express')]);
    // the WS message above was U3's third violation → auto-suspended on both sides; compare, then lift it
    await sameRows('suspensions_suspension', `user_id = ${U3}`);
    await both("UPDATE suspensions_suspension SET status = 'revoked' WHERE user_id = $1", [U3]);
    // HTTP-side broadcasts (send, edit, read receipt from list)
    const p3 = await pair(U3);
    const s = await p3.req('POST', '/api/messaging/conversations/12/messages/send/', { json: { content: 'over http' } });
    same(s);
    expect(s.django.status, s.django.text).toBe(201);
    same(await p3.req('PATCH', `/api/messaging/messages/${(s.django.body as { id: number }).id}/edit/`, { json: { content: 'over http (edited)' } }));
    same(await (await pair(U4)).req('GET', '/api/messaging/conversations/12/messages/'));
    for (const c of [d.a, d.b, e.a, e.b]) await c.waitFor((ev) => ev[0] === 'msg' && (ev[2] as { type: string }).type === 'message_edited');
    await sleep(500);
    for (const c of [d.a, d.b, e.a, e.b]) c.ws.close(); // no code: both servers echo 1000
    await Promise.all([d.a.done, d.b.done, e.a.done, e.b.done]);
    sameEvents(d.a.events, e.a.events);
    sameEvents(d.b.events, e.b.events);
    const types = d.b.events.filter((x) => x[0] === 'msg').map((x) => (x[2] as { type: string }).type);
    for (const t of ['authenticated', 'chat_message', 'typing', 'messages_marked_read', 'message_edited']) expect(types).toContain(t);
    expect(d.a.events.filter((x) => x[0] === 'msg').map((x) => (x[2] as { type: string }).type)).not.toContain('typing');
    await sleep(300);
    await sameRows('messaging_message', `id > ${mxM}`);
    await sameRows('messaging_messageviolation');
    await sameRows('notifications_notification', `id > ${mxN}`);
    await sameRows('messaging_conversation', 'id = 12');
  });
});
