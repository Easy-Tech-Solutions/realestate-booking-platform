// Test-side helpers for the mock Stripe / MTN MoMo providers (parity/mocks/server.mjs).
import { createHmac } from 'node:crypto';
import { expect } from 'vitest';
import { diff, type Resp, type Side } from '../lib.js';

const ADMIN = process.env.PARITY_MOCKS_ADMIN ?? 'http://parity-mocks:8080';

/** The fake credentials docker-compose.parity.yml hands both backends (mock mode only). */
export const MOCK = {
  stripeSecretKey: 'sk_test_parity_0000000000000000000000',
  stripeWebhookSecret: 'whsec_parity_00000000000000000000000000',
};

export interface MockRequest {
  seq: number; side: string; host: string; method: string; path: string; query: string;
  headers: Record<string, string>; contentType: string; body: unknown;
}

async function admin(method: string, path: string, body?: unknown) {
  const r = await fetch(ADMIN + path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) throw new Error(`mock admin ${method} ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}
export const mockReset = () => admin('POST', '/__reset');
export const mockConfig = (cfg: { momo?: Record<string, unknown>; stripe?: Record<string, unknown> }) => admin('POST', '/__config', cfg);
export const mockRequests = (): Promise<MockRequest[]> => admin('GET', '/__requests');
/** Marks a PaymentIntent succeeded in both sides' mock stores (what a real card confirmation would do). */
export const stripeSucceed = (piId: string) => admin('POST', `/__stripe/payment_intents/${piId}/succeed`);

/** A Stripe-Signature header for `payload` (scheme v1 = HMAC-SHA256 over "<t>.<payload>"). */
export function stripeSignature(payload: string, opts: { secret?: string; t?: number } = {}) {
  const t = opts.t ?? Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', opts.secret ?? MOCK.stripeWebhookSecret).update(`${t}.${payload}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Replaces each distinct uuid4 (payment ids, MoMo reference ids — generated
 * independently on each side) with a per-side ordinal placeholder, so
 * "the uuid sent as X-Reference-Id is the one stored as gateway_transaction_id"
 * is checked while the random values themselves are not compared. Feed both
 * sides the same sequence of values and their placeholders line up.
 */
export class UuidNormaliser {
  private maps: Record<Side, Map<string, string>> = { django: new Map(), express: new Map() };
  constructor(private keep: Set<string> = new Set()) {}
  /** Fixture uuids identical on both sides: keep them verbatim. */
  keepAs(...ids: string[]) { for (const i of ids) this.keep.add(i.toLowerCase()); }
  norm<T>(side: Side, v: T): T {
    const map = this.maps[side];
    const fix = (s: string) => s.replace(UUID_RE, (u) => {
      const k = u.toLowerCase();
      if (this.keep.has(k)) return k;
      if (!map.has(k)) map.set(k, `<uuid#${map.size + 1}>`);
      return map.get(k)!;
    });
    const walk = (x: unknown): unknown => {
      if (typeof x === 'string') return fix(x);
      if (Array.isArray(x)) return x.map(walk);
      if (x instanceof Date) return x.toISOString();
      if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, val]) => [fix(k), walk(val)]));
      return x;
    };
    return walk(v) as T;
  }
  /** The placeholder already assigned to `uuid` on `side` (undefined when unseen). */
  placeholder(side: Side, uuid: string) { return this.maps[side].get(uuid.toLowerCase()); }
}

/**
 * Tracks the provider requests each side has made since the previous check and
 * asserts both sides made the same calls (host, method, path, query, body,
 * auth/target/reference headers, Stripe-Version), uuids normalised.
 * Returns the new requests per side for further assertions.
 */
export class ProviderLog {
  private seen: Record<Side, number> = { django: 0, express: 0 };
  constructor(private u: UuidNormaliser) {}
  async take(): Promise<Record<Side, MockRequest[]>> {
    const all = await mockRequests();
    const out = {} as Record<Side, MockRequest[]>;
    for (const side of ['django', 'express'] as const) {
      const mine = all.filter((r) => r.side === side);
      out[side] = mine.slice(this.seen[side]);
      this.seen[side] = mine.length;
    }
    const strays = all.filter((r) => r.side !== 'django' && r.side !== 'express');
    expect(strays.map((r) => `${r.side} ${r.method} ${r.host}${r.path}`), 'provider calls from an unknown caller').toEqual([]);
    return out;
  }
  /** Assert both sides made identical provider calls since the last check; returns them. */
  async same(expectCount?: number) {
    const got = await this.take();
    const view = (side: Side) => got[side].map((r) => this.u.norm(side, {
      call: `${r.method} https://${r.host}${r.path}${r.query}`,
      headers: Object.fromEntries(Object.entries(r.headers).filter(([k]) => k !== 'idempotency-key')),
      contentType: r.contentType.split(';')[0],
      body: r.body,
    }));
    const d = view('django'); const e = view('express');
    expect(diff(d, e, { toleranceMs: 0 }), `provider calls\ndjango=${JSON.stringify(d, null, 1).slice(0, 3000)}\nexpress=${JSON.stringify(e, null, 1).slice(0, 3000)}`).toEqual([]);
    if (expectCount !== undefined) expect(d.length, `number of provider calls\n${JSON.stringify(d.map((x) => x.call))}`).toBe(expectCount);
    return got;
  }
}

/** same() with per-side uuid normalisation of both bodies. */
export function sameNorm(u: UuidNormaliser, r: { django: Resp; express: Resp }, opts: { ignore?: string[] } = {}) {
  const problems: string[] = [];
  if (r.django.status !== r.express.status) problems.push(`status ${r.django.status} != ${r.express.status}`);
  problems.push(...diff(u.norm('django', r.django.body), u.norm('express', r.express.body), opts));
  expect(problems, `django=${r.django.text.slice(0, 600)}\nexpress=${r.express.text.slice(0, 600)}`).toEqual([]);
}
