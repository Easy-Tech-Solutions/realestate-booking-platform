// DRF request plumbing the payments views need that isn't in lib/view.ts
// (content negotiation is lib/view.ts negotiatedView): request.data parsing
// (JSON / form / multipart / 415), QueryDict-style .get(), and the raw request
// body for plain Django views.

import type { NextFunction, Request, Response } from 'express';
import { UnsupportedMediaType } from '../../lib/errors.js';
import { multipart } from '../../lib/upload.js';
import { markHtml } from './fields.js';
import { pyTypeName } from './py.js';

export const last = (v: unknown): unknown => (Array.isArray(v) ? v[v.length - 1] : v);

/** request.query_params.get(key) — last value, undefined if absent. */
export { qp } from '../../lib/drf.js';

/** request.data: {} for an empty body, 415 for unsupported types, QueryDict (last values, html-marked) for forms. */
export async function requestData(req: Request, res: Response): Promise<unknown> {
  const cached = (req as unknown as { _drfData?: unknown })._drfData;
  if (cached !== undefined) return cached;
  const hasBody = Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding'] !== undefined;
  let data: unknown;
  if (req.is('multipart/form-data')) {
    await new Promise<void>((resolve, reject) => multipart(req, res, ((e?: unknown) => (e ? reject(e) : resolve())) as NextFunction));
    data = markHtml(Object.fromEntries(Object.entries((req.body ?? {}) as Record<string, unknown>).map(([k, v]) => [k, last(v)])));
  } else if (req.is('application/x-www-form-urlencoded')) {
    data = markHtml(Object.fromEntries(Object.entries((req.body ?? {}) as Record<string, unknown>).map(([k, v]) => [k, last(v)])));
  } else if (req.is(['application/json', 'application/*+json'])) {
    data = req.body ?? {};
  } else if (hasBody) {
    throw new UnsupportedMediaType(req.headers['content-type'] ?? '');
  } else data = {};
  (req as unknown as { _drfData?: unknown })._drfData = data;
  return data;
}

/** request.data.get(key, default) — AttributeError (→ 500) when data isn't a mapping. */
export function dataGet(data: unknown, key: string, dflt: unknown = null): unknown {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new TypeError(`'${pyTypeName(data)}' object has no attribute 'get'`);
  }
  return key in (data as object) ? (data as Record<string, unknown>)[key] : dflt;
}

/** `key in request.data` (list data: membership test; no 500 for that part). */
export function dataHas(data: unknown, key: string): boolean {
  if (Array.isArray(data)) return data.includes(key);
  if (data === null || typeof data !== 'object') throw new TypeError(`argument of type '${pyTypeName(data)}' is not iterable`);
  return key in (data as object);
}

/** request.data[key] */
export function dataItem(data: unknown, key: string): unknown {
  if (Array.isArray(data)) throw new TypeError('list indices must be integers or slices, not str');
  return (data as Record<string, unknown>)[key];
}

/**
 * request.body for plain (non-DRF) Django views. The global JSON/urlencoded
 * parsers in app.ts may already have consumed the stream: then the raw bytes
 * are taken from `req.rawBody` when the parser kept them, else re-serialised
 * (byte-exact only for compact JSON — see the payments report).
 */
export async function rawBody(req: Request): Promise<Buffer> {
  const kept = (req as unknown as { rawBody?: Buffer }).rawBody;
  if (Buffer.isBuffer(kept)) return kept;
  if (req.body === undefined && !req.readableEnded) {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    return Buffer.concat(chunks);
  }
  if (req.is('application/x-www-form-urlencoded')) {
    return Buffer.from(new URLSearchParams(req.body as Record<string, string>).toString());
  }
  if (req.body === undefined) return Buffer.alloc(0);
  return Buffer.from(JSON.stringify(req.body));
}
