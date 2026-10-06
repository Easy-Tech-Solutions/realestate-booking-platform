// Parity tests for the notifications app: /api/notifications/ routes, the
// notifications WebSocket consumer, and notifications.services side effects
// (rows, real-time pushes, queued Celery/BullMQ tasks).
import { existsSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { execFile } from 'node:child_process';
import { Redis } from 'ioredis';
import WebSocket from 'ws';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accounts, dbs, diff, flushRedis, Pair, same, sameRows, type Side } from '../lib.js';

let acct: Awaited<ReturnType<typeof accounts>>;
let A: { id: number; email: string }; // logs in, owns notifications
let otherNotificationId: number; // belongs to another user
let ownIds: number[]; // A's notification ids, newest first

const both = async (sql: string, params: unknown[] = []) => {
  const [d, e] = await Promise.all([dbs.django.query(sql, params), dbs.express.query(sql, params)]);
  return { django: d.rows, express: e.rows };
};

beforeAll(async () => {
  acct = await accounts();
  A = acct.user!;
  const { rows } = await dbs.django.query('SELECT id FROM notifications_notification WHERE user_id = $1 ORDER BY created_at DESC, id DESC', [A.id]);
  ownIds = rows.map((r) => Number(r.id));
  expect(ownIds.length).toBeGreaterThan(3);
  const o = await dbs.django.query('SELECT id FROM notifications_notification WHERE user_id <> $1 ORDER BY id LIMIT 1', [A.id]);
  otherNotificationId = Number(o.rows[0].id);
});
beforeEach(flushRedis);

/** Raw-body request on both sides (lib.ts' Client only sends JSON/multipart). */
async function rawReq(p: Pair, method: string, path: string, contentType: string, body: string) {
  const one = (side: Side) => new Promise<{ status: number; headers: Headers; body: unknown; text: string; setCookies: string[] }>((resolve, reject) => {
    const headers: Record<string, string> = {
      Host: 'homekonet.com', 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '203.0.113.9',
      'Content-Type': contentType, 'Content-Length': String(Buffer.byteLength(body)),
    };
    if (p[side].token) headers.Authorization = `Bearer ${p[side].token}`;
    const rq = httpRequest({ host: `parity-${side}`, port: 8000, path, method, headers }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => {
        let parsed: unknown = text;
        try { parsed = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
        resolve({ status: res.statusCode ?? 0, headers: new Headers(), body: parsed, text, setCookies: [] });
      });
    });
    rq.on('error', reject);
    rq.end(body);
  });
  const [django, express] = await Promise.all([one('django'), one('express')]);
  return { django, express };
}

const ROUTES: [string, string][] = [
  ['GET', '/api/notifications/'],
  ['GET', '/api/notifications/.json'],
  ['GET', '/api/notifications/unread-count/'],
  ['POST', '/api/notifications/read-all/'],
  ['GET', '/api/notifications/1/'],
  ['DELETE', '/api/notifications/1/'],
  ['POST', '/api/notifications/1/read/'],
  ['PATCH', '/api/notifications/1/unread/'],
  ['GET', '/api/notifications/preferences/'],
  ['PATCH', '/api/notifications/preferences/'],
  ['POST', '/api/notifications/device-token/'],
  ['DELETE', '/api/notifications/device-token/'],
];

describe('access control', () => {
  for (const [m, path] of ROUTES) {
    it(`anonymous ${m} ${path} → 401`, async () => same(await new Pair().req(m, path, { json: {} }), { headers: ['www-authenticate'] }));
  }
  it('garbage token → 401', async () => same(await new Pair().req('GET', '/api/notifications/', { token: 'abc.def.ghi' }), { headers: ['www-authenticate'] }));
  it('vapid public key is public', async () => same(await new Pair().req('GET', '/api/notifications/vapid-public-key/')));
  it('vapid public key with a bad token → 401', async () => same(await new Pair().req('GET', '/api/notifications/vapid-public-key/', { token: 'x.y.z' })));
  it('other user\'s notification → 404 on every detail route', async () => {
    const p = new Pair();
    await p.login(A.email);
    for (const [m, sub] of [['GET', ''], ['DELETE', ''], ['POST', 'read/'], ['PATCH', 'unread/']] as const) {
      same(await p.req(m, `/api/notifications/${otherNotificationId}/${sub}`));
    }
    await sameRows('notifications_notification', `id = ${otherNotificationId}`);
  });
  it('wrong methods → 405', async () => {
    const p = new Pair();
    await p.login(A.email);
    for (const [m, path] of [
      ['POST', '/api/notifications/'], ['PUT', `/api/notifications/${ownIds[0]}/`], ['GET', `/api/notifications/${ownIds[0]}/read/`],
      ['POST', `/api/notifications/${ownIds[0]}/unread/`], ['GET', '/api/notifications/read-all/'], ['POST', '/api/notifications/unread-count/'],
      ['PUT', '/api/notifications/preferences/'], ['GET', '/api/notifications/device-token/'], ['POST', '/api/notifications/vapid-public-key/'],
    ] as const) same(await p.req(m, path));
  });
});

describe('list / filters / formats', () => {
  let p: Pair;
  beforeAll(async () => { p = new Pair(); await p.login(A.email); });
  for (const q of ['', '?is_read=true', '?is_read=false', '?is_read=TRUE', '?is_read=yes', '?is_read=', '?type=booking_requested',
    '?type=', '?type=nope', '?is_read=false&type=new_message', '?page=2', '?is_read=true&is_read=false', '?format=json']) {
    it(`GET list${q}`, async () => same(await p.req('GET', `/api/notifications/${q}`)));
  }
  it('admin list (large)', async () => {
    const a = new Pair();
    await a.login(acct.admin!.email);
    same(await a.req('GET', '/api/notifications/'));
    same(await a.req('GET', '/api/notifications/unread-count/'));
  });
  it('format suffixes & content negotiation', async () => {
    for (const path of ['/api/notifications/.json', '/api/notifications/.json/', '/api/notifications/.xml', '/api/notifications/?format=xml',
      '/api/notifications/unread-count.json', '/api/notifications/unread-count.api', `/api/notifications/${ownIds[0]}.json`,
      `/api/notifications/${ownIds[0]}.xml`, '/api/notifications/preferences/?format=api']) {
      same(await p.req('GET', path));
      same(await new Pair().req('GET', path)); // negotiation runs before authentication
    }
    for (const accept of ['application/xml', 'text/html', 'application/json; q=0.5', 'application/*', 'text/html, */*;q=0.1', 'APPLICATION/JSON']) {
      same(await p.req('GET', '/api/notifications/unread-count/', { headers: { Accept: accept } }));
      same(await new Pair().req('GET', '/api/notifications/unread-count/', { headers: { Accept: accept } }));
    }
  });
  it('APPEND_SLASH redirect', async () => {
    const r = await p.req('GET', `/api/notifications/${ownIds[0]}`);
    expect(r.express.status).toBe(r.django.status);
    expect(r.express.headers.get('location')).toBe(r.django.headers.get('location'));
  });
});

describe('detail / read / unread / delete', () => {
  let p: Pair;
  beforeAll(async () => { p = new Pair(); await p.login(A.email); });
  it('retrieve own, missing, malformed pks', async () => {
    for (const pk of [String(ownIds[0]), '999999999', 'abc', `+${ownIds[0]}`, `0${ownIds[0]}`, '-1', '99999999999999999999', '1e3', `${ownIds[0]}%20`]) {
      same(await p.req('GET', `/api/notifications/${pk}/`));
    }
  });
  it('filters apply to the detail lookup too', async () => {
    const { rows } = await dbs.django.query('SELECT id, is_read FROM notifications_notification WHERE user_id = $1 ORDER BY id LIMIT 1', [A.id]);
    const id = rows[0].id;
    same(await p.req('GET', `/api/notifications/${id}/?is_read=${rows[0].is_read ? 'false' : 'true'}`));
    same(await p.req('GET', `/api/notifications/${id}/?type=zzz`));
  });
  it('read → unread → read cycle writes the same rows', async () => {
    const id = ownIds[1];
    await both('UPDATE notifications_notification SET is_read = false, read_at = NULL WHERE id = $1', [id]);
    same(await p.req('POST', `/api/notifications/${id}/read/`));
    await sameRows('notifications_notification', `id = ${id}`);
    const before = await both('SELECT read_at FROM notifications_notification WHERE id = $1', [id]);
    same(await p.req('POST', `/api/notifications/${id}/read/`)); // already read: read_at untouched
    const after = await both('SELECT read_at FROM notifications_notification WHERE id = $1', [id]);
    expect(after.django[0].read_at).toEqual(before.django[0].read_at);
    expect(after.express[0].read_at).toEqual(before.express[0].read_at);
    same(await p.req('PATCH', `/api/notifications/${id}/unread/`));
    await sameRows('notifications_notification', `id = ${id}`);
    same(await p.req('POST', `/api/notifications/${id}/read.json`));
    same(await p.req('PATCH', `/api/notifications/${id}/unread.json/`));
    await sameRows('notifications_notification', `id = ${id}`);
  });
  it('delete', async () => {
    const id = ownIds[ownIds.length - 1];
    const r = await p.req('DELETE', `/api/notifications/${id}/`);
    expect(r.django.status).toBe(204);
    expect(r.express.status).toBe(204);
    expect(r.express.text).toBe(r.django.text);
    same(await p.req('DELETE', `/api/notifications/${id}/`));
    await sameRows('notifications_notification', `user_id = ${A.id}`);
  });
  it('unread-count and read-all', async () => {
    same(await p.req('GET', '/api/notifications/unread-count/'));
    same(await p.req('GET', '/api/notifications/unread-count.json'));
    const r = await p.req('POST', '/api/notifications/read-all/');
    same(r);
    expect((r.django.body as { marked_read: number }).marked_read).toBeGreaterThan(0);
    await sameRows('notifications_notification', `user_id = ${A.id}`);
    same(await p.req('POST', '/api/notifications/read-all.json'));
    same(await p.req('GET', '/api/notifications/unread-count/'));
    same(await p.req('GET', '/api/notifications/?is_read=false'));
  });
});

describe('in-app notifications disabled', () => {
  it('hides the bell, keeps read-all working', async () => {
    const u = acct.agent ?? acct.customer!;
    const { rows } = await dbs.django.query('SELECT id FROM notifications_notification WHERE user_id = $1 ORDER BY id LIMIT 1', [u.id]);
    await both('UPDATE notifications_notificationpreference SET in_app_enabled = false WHERE user_id = $1', [u.id]);
    const p = new Pair();
    await p.login(u.email);
    same(await p.req('GET', '/api/notifications/'));
    same(await p.req('GET', '/api/notifications/unread-count/'));
    if (rows[0]) {
      for (const [m, sub] of [['GET', ''], ['POST', 'read/'], ['PATCH', 'unread/'], ['DELETE', '']] as const) same(await p.req(m, `/api/notifications/${rows[0].id}/${sub}`));
      same(await p.req('GET', '/api/notifications/abc/'));
    }
    same(await p.req('POST', '/api/notifications/read-all/'));
    await sameRows('notifications_notification', `user_id = ${u.id}`);
    same(await p.req('GET', '/api/notifications/preferences/'));
    same(await p.req('PATCH', '/api/notifications/preferences/', { json: { in_app_enabled: true } }));
    same(await p.req('GET', '/api/notifications/unread-count/'));
    await sameRows('notifications_notificationpreference', `user_id = ${u.id}`);
  });
});

describe('preferences', () => {
  it('GET creates the row when missing', async () => {
    const u = acct.customer ?? acct.superadmin!;
    await both('DELETE FROM notifications_notificationpreference WHERE user_id = $1', [u.id]);
    const p = new Pair();
    await p.login(u.email);
    same(await p.req('GET', '/api/notifications/preferences/'));
    await sameRows('notifications_notificationpreference', `user_id = ${u.id}`);
    same(await p.req('GET', '/api/notifications/preferences.json'));
  });
  it('PATCH validation and updates', async () => {
    const p = new Pair();
    await p.login(A.email);
    const bodies: unknown[] = [
      {}, { booking_requested_email: false }, { new_message_email: 'no', price_changed_email: 'TRUE', search_alert_email: 1, new_review_email: 0 },
      { in_app_enabled: 'maybe' }, { booking_confirmed_email: null }, { booking_declined_email: 2, booking_cancelled_email: '' },
      { booking_completed_email: [true] }, { payment_received_email: 1.0, payment_failed_email: 0.0 },
      { report_submitted_email: false, updated_at: '2020-01-01T00:00:00Z', unknown: 1 }, [1, 2], { listing_available_email: 'off', payment_refunded_email: 'Y' },
    ];
    for (const json of bodies) {
      same(await p.req('PATCH', '/api/notifications/preferences/', { json }));
      await sameRows('notifications_notificationpreference', `user_id = ${A.id}`);
    }
    const form = new URLSearchParams({ booking_requested_email: 'true', new_message_email: 'f' }).toString();
    same(await rawReq(p, 'PATCH', '/api/notifications/preferences/', 'application/x-www-form-urlencoded', form));
    const fd = new FormData();
    fd.append('price_changed_email', 'false');
    same(await p.req('PATCH', '/api/notifications/preferences/', { form: fd }));
    await sameRows('notifications_notificationpreference', `user_id = ${A.id}`);
    same(await rawReq(p, 'PATCH', '/api/notifications/preferences/', 'text/plain', 'hello'));
    same(await p.req('GET', '/api/notifications/preferences/'));
  });
});

describe('device tokens', () => {
  it('register / update / unregister', async () => {
    const p = new Pair();
    await p.login(A.email);
    const ep = `https://push.example.com/${Date.now()}`;
    const cases: unknown[] = [
      {}, { endpoint: '   ' }, { endpoint: ep }, { endpoint: ep, p256dh: 'key' }, { endpoint: ep, auth: 'a' },
      { endpoint: ` ${ep} `, p256dh: ' key1 ', auth: ' auth1 ' },
      { endpoint: ep, p256dh: 'key2', auth: 'auth2', device_type: 'android' },
      { endpoint: ep + '/2', p256dh: 'k', auth: 'a', device_type: 'ios' },
      // str.strip() whitespace set: \x1c/\x85/\u3000 are stripped, \ufeff is not
      { endpoint: `\x1c${ep}/3\u3000`, p256dh: '\x85k3', auth: '\ufeffa3' },
    ];
    for (const json of cases) {
      same(await p.req('POST', '/api/notifications/device-token/', { json }));
      await sameRows('notifications_devicetoken', `user_id = ${A.id}`);
    }
    same(await p.req('POST', '/api/notifications/device-token/', { json: { endpoint: null } }));
    same(await p.req('POST', '/api/notifications/device-token/', { json: { endpoint: ep, p256dh: 5, auth: 'a' } }));
    same(await p.req('POST', '/api/notifications/device-token/', { json: [1] }));
    same(await rawReq(p, 'POST', '/api/notifications/device-token/', 'text/plain', 'x'));
    const form = new URLSearchParams({ endpoint: ep + '/form', p256dh: 'fk', auth: 'fa' }).toString();
    same(await rawReq(p, 'POST', '/api/notifications/device-token/', 'application/x-www-form-urlencoded', form));
    await sameRows('notifications_devicetoken', `user_id = ${A.id}`);
    same(await p.req('DELETE', '/api/notifications/device-token/', { json: {} }));
    same(await p.req('DELETE', '/api/notifications/device-token/'));
    same(await p.req('DELETE', '/api/notifications/device-token/', { json: { endpoint: ep } }));
    same(await p.req('DELETE', '/api/notifications/device-token/', { json: { endpoint: ep } }));
    await sameRows('notifications_devicetoken', `user_id = ${A.id}`);
  });
});

// ---- WebSocket consumer ---------------------------------------------------------------

const WS_HOST: Record<Side, string> = { django: 'parity-django', express: 'parity-express' };
type WsEvent = [string, ...unknown[]];

interface WsConn { events: WsEvent[]; ws: WebSocket; done: Promise<void>; waitFor(pred: (e: WsEvent) => boolean, ms?: number): Promise<void> }

function connect(side: Side, headers: Record<string, string>): WsConn {
  const events: WsEvent[] = [];
  const listeners = new Set<() => void>();
  const push = (e: WsEvent) => { events.push(e); listeners.forEach((l) => l()); };
  const ws = new WebSocket(`ws://${WS_HOST[side]}:8000/ws/notifications/`, { headers });
  const done = new Promise<void>((resolve) => {
    ws.on('unexpected-response', (_req, res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => { push(['http', res.statusCode, res.statusMessage, body]); resolve(); });
    });
    ws.on('open', () => push(['open']));
    ws.on('message', (d, isBinary) => push(['msg', isBinary, d.toString()]));
    ws.on('close', (code, reason) => { push(['close', code, reason.toString()]); resolve(); });
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

const H = { Host: 'homekonet.com', Origin: 'https://homekonet.com' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Opens a socket on each side, sends the frames, waits until quiet, compares the event logs. */
async function wsScenario(headers: Record<string, string>, frames: (string | Buffer)[] | ((side: Side) => (string | Buffer)[]), quietMs = 1200) {
  const run = async (side: Side) => {
    const c = connect(side, headers);
    await c.waitFor((e) => e[0] === 'open' || e[0] === 'http', 5000);
    if (c.events[0]?.[0] === 'open') {
      for (const f of typeof frames === 'function' ? frames(side) : frames) c.ws.send(f, { binary: Buffer.isBuffer(f) });
    }
    await Promise.race([c.done, sleep(quietMs)]);
    const events = [...c.events];
    if (c.ws.readyState === WebSocket.OPEN) c.ws.terminate();
    return events;
  };
  const [d, e] = await Promise.all([run('django'), run('express')]);
  expect(e, `django=${JSON.stringify(d)}`).toEqual(d);
  return d;
}

describe('websocket /ws/notifications/', () => {
  let tokens: Record<Side, string>;
  beforeAll(async () => {
    const p = new Pair();
    await p.login(A.email);
    tokens = { django: p.django.token!, express: p.express.token! };
  });

  it('origin validation (AllowedHostsOriginValidator)', async () => {
    for (const origin of [undefined, 'https://evil.com', 'http://homekonet.com', 'https://www.homekonet.com', 'https://homekonet.com:8443', 'null', '//homekonet.com', 'homekonet.com',
      'https://homekonet.com:abc', 'https://homekonet.com:99999', 'file:///etc', 'HTTPS://HomeKonet.COM', 'https://user@homekonet.com', '']) {
      const h: Record<string, string> = { Host: 'homekonet.com' };
      if (origin !== undefined) h.Origin = origin;
      await wsScenario(h, [], 400);
    }
  });
  it('unauthenticated messages', async () => {
    await wsScenario(H, ['{"type":"get_unread_count"}', 'nonsense', '{"type":"foo"}', '{}', '{"type":5}', '{"type":[1,"a",null,true]}',
      '{"type":{"a":1.5,"b":"it\'s"}}', '{"type":1.0}', '{"type":1e20}', '{"type":"ünï \\"q\\" \\u2028 😀"}', '', '{"type":"authenticat"}']);
  });
  for (const [name, frame] of [['list', '[1]'], ['string', '"abc"'], ['number', '5'], ['null', 'null']] as const) {
    it(`non-object JSON (${name}) crashes the consumer (1011)`, async () => { await wsScenario(H, [frame]); });
  }
  it('binary frame crashes the consumer (1011)', async () => { await wsScenario(H, [Buffer.from('abc')]); });
  for (const [name, frame] of [
    ['bad token', '{"type":"authenticate","token":"abc"}'], ['no token', '{"type":"authenticate"}'], ['null token', '{"type":"authenticate","token":null}'],
    ['numeric token', '{"type":"authenticate","token":123}'], ['empty token', '{"type":"authenticate","token":""}'],
  ] as const) {
    it(`authenticate with ${name} → error + close 1000`, async () => { await wsScenario(H, [frame, '{"type":"get_unread_count"}']); });
  }
  it('refresh token is rejected', async () => {
    const p = new Pair();
    await p.login(A.email);
    const refresh = (side: Side) => p[side].cookies.get('refresh_token')!;
    await wsScenario(H, (side) => [JSON.stringify({ type: 'authenticate', token: refresh(side) })]);
  });
  it('good token → authenticated + unread_count; then counts; then bad re-auth closes', async () => {
    await wsScenario(H, (side) => [JSON.stringify({ type: 'authenticate', token: tokens[side] }), '{"type":"get_unread_count"}',
      '{"type":"ping"}', JSON.stringify({ type: 'authenticate', token: 'x' })]);
  });
  it('cross-backend token (Django-issued token on Express)', async () => {
    await wsScenario(H, () => [JSON.stringify({ type: 'authenticate', token: tokens.django })]);
  });
});

// ---- services: create_notification → rows, WS push, queued tasks ---------------------------

const DIST = process.env.PARITY_DIST ?? process.env.DIST ?? (existsSync('/app/dist/domain/notifications.js') ? 'dist' : 'dist-notifications');

/**
 * Calls a function exported by the Express build's domain/notifications.js in a
 * child process wired to the express copy + its Redis (db 2) — a separate
 * process so its pg type parsers don't leak into this one, and so the
 * real-time push crosses processes through the channel layer like production.
 */
function callExpress(fn: string, args: unknown[]): Promise<unknown> {
  const code = `
    const svc = await import('/app/${DIST}/domain/notifications.js');
    const { redis } = await import('/app/${DIST}/lib/redis.js');
    const { pool } = await import('/app/${DIST}/db/index.js');
    let out = null, err = null;
    try { out = await svc[process.env.FN](...JSON.parse(process.env.ARGS)); } catch (e) { err = String(e); }
    await svc.closeChannelLayer(); redis.disconnect(); await pool.end();
    process.stdout.write('@@RESULT@@' + JSON.stringify({ out, err }));
    process.exit(0);`;
  const env = {
    ...process.env, FN: fn, ARGS: JSON.stringify(args),
    POSTGRES_HOST: 'parity-db', POSTGRES_PORT: '5432', POSTGRES_DB: 'express_copy', POSTGRES_USER: 'parity',
    REDIS_URL: 'redis://parity-redis:6379/2', DJANGO_SECRET_KEY: 'parity-unused', EMAIL_BACKEND_MODE: 'console', VAPID_PRIVATE_KEY: '',
  };
  return new Promise((resolve, reject) => {
    execFile('node', ['--input-type=module', '-e', code], { env, cwd: '/app', maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      const i = stdout.lastIndexOf('@@RESULT@@');
      if (i < 0) return reject(new Error(`express call failed: ${error}\n${stderr}\n${stdout.slice(-2000)}`));
      const { out, err } = JSON.parse(stdout.slice(i + 10));
      if (err) return reject(new Error(err));
      resolve(out);
    });
  });
}

/** Tasks queued since the last FLUSH: Django's Celery list (db 1) vs Express's BullMQ (db 2), as sorted "name(args)". */
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
  } finally {
    r1.disconnect();
    r2.disconnect();
  }
}

describe('services → realtime push, rows and queued tasks', () => {

  it('notify_report_submitted: same rows, same pushed WS message, same queued tasks', async () => {
    const admin = acct.admin!;
    const p = new Pair();
    await p.login(admin.email);
    // An admin with in-app delivery on and email off for this type, another with defaults.
    await both('UPDATE notifications_notificationpreference SET in_app_enabled = true, report_submitted_email = false WHERE user_id = $1', [admin.id]);

    const { rows: [mx] } = await dbs.django.query('SELECT coalesce(max(id), 0) AS id FROM notifications_notification');
    const conns = {
      django: connect('django', H),
      express: connect('express', H),
    };
    for (const side of ['django', 'express'] as const) {
      await conns[side].waitFor((e) => e[0] === 'open');
      conns[side].ws.send(JSON.stringify({ type: 'authenticate', token: p[side].token }));
      await conns[side].waitFor((e) => e[0] === 'msg' && String(e[2]).includes('unread_count'));
    }

    // Django: through its own endpoint. Express: same report row, then the ported service.
    const reporter = new Pair();
    await reporter.login(A.email);
    const r = await reporter.django.req('POST', '/api/reports/', { json: { content_type: 'user', reported_user: admin.id, report_type: 'harassment', description: 'parity test report' } });
    expect(r.status, r.text).toBe(201);
    const reportId = (r.body as { id: number }).id;
    const { rows: [row] } = await dbs.django.query('SELECT * FROM reports_report WHERE id = $1', [reportId]);
    const cols = Object.keys(row).filter((c) => c !== 'id');
    const ins = await dbs.express.query(
      `INSERT INTO reports_report (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
      cols.map((c) => row[c]),
    );
    expect(Number(ins.rows[0].id)).toBe(Number(reportId));
    await callExpress('notifyReportSubmitted', [{ ...ins.rows[0], id: Number(ins.rows[0].id), reporter_id: Number(ins.rows[0].reporter_id) }]);

    for (const side of ['django', 'express'] as const) await conns[side].waitFor((e) => e[0] === 'msg' && String(e[2]).includes('new_notification'));
    await sleep(300);
    const pushed = (side: Side) => conns[side].events.filter((e) => e[0] === 'msg').map((e) => String(e[2]));
    const [pd, pe] = [pushed('django'), pushed('express')];
    expect(pd.some((t) => t.includes('"type": "new_notification"'))).toBe(true);
    expect(pd.length).toBe(pe.length);
    pd.forEach((text, i) => {
      expect(diff(JSON.parse(text), JSON.parse(pe[i]!))).toEqual([]);
      // byte-level shape too (Python json.dumps separators/escaping), ignoring the created_at value
      const strip = (s: string) => s.replace(/"created_at": "[^"]*"/, '"created_at": ""');
      expect(strip(pe[i]!)).toBe(strip(text));
    });
    for (const c of Object.values(conns)) c.ws.terminate();

    await sameRows('notifications_notification', `id > ${mx.id}`);
    const q = await queuedTasks();
    expect(q.django.length).toBeGreaterThan(0);
    expect(q.express).toEqual(q.django);
  });

  it('create_notification for a user with in-app off: row only + email task', async () => {
    const u = acct.superadmin ?? acct.admin!;
    await both('UPDATE notifications_notificationpreference SET in_app_enabled = false WHERE user_id = $1', [u.id]);
    const { rows: [mx] } = await dbs.django.query('SELECT coalesce(max(id), 0) AS id FROM notifications_notification');
    // Django side: a report filed by `u` notifies admins (incl. maybe u); compare via service on Express.
    const reporter = new Pair();
    await reporter.login(u.email);
    const r = await reporter.django.req('POST', '/api/reports/', { json: { content_type: 'user', reported_user: A.id, report_type: 'other', description: 'second parity report' } });
    expect(r.status, r.text).toBe(201);
    const { rows: [row] } = await dbs.django.query('SELECT * FROM reports_report WHERE id = $1', [(r.body as { id: number }).id]);
    const cols = Object.keys(row).filter((c) => c !== 'id');
    const ins = await dbs.express.query(
      `INSERT INTO reports_report (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
      cols.map((c) => row[c]),
    );
    await callExpress('notifyReportSubmitted', [{ ...ins.rows[0], id: Number(ins.rows[0].id), reporter_id: Number(ins.rows[0].reporter_id) }]);
    await sameRows('notifications_notification', `id > ${mx.id}`);
    const q = await queuedTasks();
    expect(q.django.length).toBeGreaterThan(0);
    expect(q.express).toEqual(q.django);
    await both('UPDATE notifications_notificationpreference SET in_app_enabled = true WHERE user_id = $1', [u.id]);
  });
});
