// Parity harness: replays one request against both backends and compares.
import { request as httpRequest } from 'node:http';
import { Redis } from 'ioredis';
import pg from 'pg';
import { describe as _d, expect } from 'vitest';
void _d;

export type Side = 'django' | 'express';
const BASE: Record<Side, string> = {
  django: process.env.PARITY_DJANGO ?? 'http://parity-django:8000',
  express: process.env.PARITY_EXPRESS ?? 'http://parity-express:8000',
};
export const PASSWORD = process.env.PARITY_PASSWORD ?? '';

export interface Resp { status: number; headers: Headers; body: unknown; text: string; setCookies: string[] }

/** Per-side HTTP client with a cookie jar (the refresh token lives in a cookie). */
export class Client {
  cookies = new Map<string, string>();
  token: string | null = null;
  constructor(public side: Side) {}

  async req(method: string, path: string, opts: { json?: unknown; form?: FormData; raw?: string; headers?: Record<string, string>; token?: string | null } = {}): Promise<Resp> {
    const headers: Record<string, string> = {
      Host: 'homekonet.com',
      'X-Forwarded-Proto': 'https',
      'X-Forwarded-For': '203.0.113.9',
      ...opts.headers,
    };
    const tok = opts.token === undefined ? this.token : opts.token;
    if (tok) headers.Authorization = `Bearer ${tok}`;
    if (this.cookies.size) headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    let body: Buffer | undefined;
    if (opts.raw !== undefined) body = Buffer.from(opts.raw);
    else if (opts.json !== undefined) { headers['Content-Type'] = 'application/json'; body = Buffer.from(JSON.stringify(opts.json)); }
    else if (opts.form) {
      // Serialise multipart via Request so the boundary/content-type are right.
      const r = new Request('http://x/', { method: 'POST', body: opts.form });
      headers['Content-Type'] = r.headers.get('content-type')!;
      body = Buffer.from(await r.arrayBuffer());
    }
    // node:http rather than fetch — fetch silently drops a custom Host header.
    const r = await new Promise<{ status: number; headers: Headers; text: string; setCookies: string[] }>((resolve, reject) => {
      const u = new URL(BASE[this.side] + path);
      const rq = httpRequest({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: body ? { ...headers, 'Content-Length': String(body.length) } : headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const h = new Headers();
          for (const [k, v] of Object.entries(res.headers)) if (v !== undefined && k !== 'set-cookie') h.set(k, Array.isArray(v) ? v.join(', ') : v);
          resolve({ status: res.statusCode ?? 0, headers: h, text: Buffer.concat(chunks).toString('utf8'), setCookies: res.headers['set-cookie'] ?? [] });
        });
      });
      rq.on('error', reject);
      if (body) rq.write(body);
      rq.end();
    });
    for (const c of r.setCookies) {
      const [kv] = c.split(';'); const i = kv!.indexOf('=');
      const k = kv!.slice(0, i); const v = kv!.slice(i + 1);
      if (v === '' || v === '""' || /max-age=0/i.test(c)) this.cookies.delete(k); else this.cookies.set(k, v);
    }
    const text = r.text;
    let parsed: unknown = text;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    return { status: r.status, headers: r.headers, body: parsed, text, setCookies: r.setCookies };
  }
}

export class Pair {
  django = new Client('django');
  express = new Client('express');
  async req(method: string, path: string, opts: Parameters<Client['req']>[2] = {}) {
    const [d, e] = await Promise.all([this.django.req(method, path, opts), this.express.req(method, path, opts)]);
    return { django: d, express: e };
  }
  /** Log both sides in with the same credentials (through each backend's own login endpoint). */
  async login(email: string, password = PASSWORD) {
    const r = await this.req('POST', '/api/auth/login/', { json: { email, password } });
    for (const s of ['django', 'express'] as const) {
      const b = r[s].body as { access?: string };
      if (b?.access) this[s].token = b.access;
    }
    return r;
  }
}

// --- comparison --------------------------------------------------------------

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const JWT = /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/;

/**
 * Normalises values that legitimately differ between two runs of the same
 * scenario: timestamps created "now" (within `toleranceMs` of each other) and
 * JWTs. Everything else must match exactly.
 */
function equalish(a: unknown, b: unknown, path: string, diffs: string[], ignore: Set<string>, toleranceMs: number) {
  const key = path.replace(/\[\d+\]/g, '[]');
  if (ignore.has(key) || ignore.has(path.split('.').pop()!)) return;
  if (typeof a === 'string' && typeof b === 'string') {
    if (a === b) return;
    if (ISO.test(a) && ISO.test(b) && Math.abs(Date.parse(a) - Date.parse(b)) <= toleranceMs) return;
    if (JWT.test(a) && JWT.test(b)) return;
    diffs.push(`${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) { diffs.push(`${path}: length ${a.length} != ${b.length}`); return; }
    a.forEach((v, i) => equalish(v, b[i], `${path}[${i}]`, diffs, ignore, toleranceMs)); return;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as object); const kb = Object.keys(b as object);
    for (const k of new Set([...ka, ...kb])) {
      if (!(k in (a as object))) { diffs.push(`${path}.${k}: missing in django`); continue; }
      if (!(k in (b as object))) { diffs.push(`${path}.${k}: missing in express`); continue; }
      equalish((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`, diffs, ignore, toleranceMs);
    }
    // key order matters to some clients only cosmetically; not compared.
    return;
  }
  if (a !== b) diffs.push(`${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
}

export function diff(a: unknown, b: unknown, opts: { ignore?: string[]; toleranceMs?: number } = {}): string[] {
  const diffs: string[] = [];
  equalish(a, b, '$', diffs, new Set(opts.ignore ?? []), opts.toleranceMs ?? 10_000);
  return diffs;
}

/** Assert both sides returned the same status and equivalent JSON. */
export function same(r: { django: Resp; express: Resp }, opts: { ignore?: string[]; toleranceMs?: number; headers?: string[] } = {}) {
  const problems: string[] = [];
  if (r.django.status !== r.express.status) problems.push(`status ${r.django.status} != ${r.express.status}`);
  problems.push(...diff(r.django.body, r.express.body, opts));
  for (const h of opts.headers ?? []) {
    if (r.django.headers.get(h) !== r.express.headers.get(h)) problems.push(`header ${h}: ${r.django.headers.get(h)} != ${r.express.headers.get(h)}`);
  }
  expect(problems, `django=${r.django.text.slice(0, 400)}\nexpress=${r.express.text.slice(0, 400)}`).toEqual([]);
}

// --- database state ---------------------------------------------------------

function pool(database: string) {
  return new pg.Pool({ host: 'parity-db', user: 'parity', password: process.env.POSTGRES_PASSWORD, database, max: 2, options: '-c TimeZone=UTC' });
}
export const dbs = { django: pool('django_copy'), express: pool('express_copy') };

/** Compare rows of a table (optionally filtered) between the two copies. */
export async function sameRows(table: string, where = 'true', opts: { ignore?: string[]; order?: string } = {}) {
  const q = `SELECT * FROM ${table} WHERE ${where} ORDER BY ${opts.order ?? 'id'}`;
  const [d, e] = await Promise.all([dbs.django.query(q), dbs.express.query(q)]);
  const norm = (rows: Record<string, unknown>[]) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v])));
  const problems = diff(norm(d.rows), norm(e.rows), { ignore: opts.ignore, toleranceMs: 10_000 });
  expect(problems, `table ${table} where ${where}`).toEqual([]);
}

/** Test accounts (one per role) that reset.sh gave the known password. */
export async function accounts(): Promise<Record<string, { id: number; email: string }>> {
  const { rows } = await dbs.django.query(
    `SELECT DISTINCT ON (role) id, email, role FROM users_user u
     WHERE is_active AND email_verified AND NOT EXISTS (SELECT 1 FROM superadmin_mfadevice m WHERE m.user_id = u.id)
     ORDER BY role, id`);
  return Object.fromEntries(rows.map((r) => [r.role, { id: Number(r.id), email: r.email }]));
}

/** Clears both instances' throttle/cache state so earlier tests can't throttle later ones. */
export async function flushRedis() {
  const r = new Redis('redis://parity-redis:6379/0');
  await r.flushall();
  r.disconnect();
}

/** Parsed Set-Cookie for one cookie name: value + normalised attribute map (Expires dropped — time-based). */
export function cookie(resp: Resp, name: string): { value: string; attrs: Record<string, string> } | null {
  const raw = resp.setCookies.find((c) => c.startsWith(name + '='));
  if (!raw) return null;
  const [kv, ...attrs] = raw.split(';').map((s) => s.trim());
  const map: Record<string, string> = {};
  for (const a of attrs) {
    const [k, ...v] = a.split('=');
    const key = k!.toLowerCase();
    if (key === 'expires') continue;
    map[key] = v.join('=').toLowerCase();
  }
  return { value: kv!.slice(name.length + 1), attrs: map };
}

export function sameCookie(r: { django: Resp; express: Resp }, name: string, opts: { valueMayDiffer?: boolean } = { valueMayDiffer: true }) {
  const d = cookie(r.django, name); const e = cookie(r.express, name);
  expect(!!e, `express ${name} cookie presence`).toBe(!!d);
  if (!d || !e) return;
  expect(e.attrs, `${name} cookie attributes`).toEqual(d.attrs);
  if (!opts.valueMayDiffer) expect(e.value).toBe(d.value);
  else expect(e.value === '' || e.value === '""').toBe(d.value === '' || d.value === '""');
}
