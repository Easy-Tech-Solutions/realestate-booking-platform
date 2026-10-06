// DRF request.data + small Python-semantics helpers shared by the users,
// suspensions, reports, testimonials and newsletter ports.

import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { qp } from '../../lib/drf.js';
import { UnsupportedMediaType } from '../../lib/errors.js';
import { inBigintRange, pyIntStr, pyRepr, pyStr, pyStrip, pyTypeName as jsonTypeName } from '../../lib/py.js';

export { pyRepr, pyStr };

import { isFile, type UploadedFile } from '../../lib/upload.js';

export { isFile, type UploadedFile };

/**
 * request.data. JSON bodies come back as parsed; form / multipart bodies as a
 * plain object of the LAST value per key (QueryDict.get / __getitem__), with
 * uploaded files merged in (DRF merges request.FILES into request.data).
 * `lists` keeps every value (QueryDict.getlist). 415 for unsupported types.
 */
export interface RequestData { data: unknown; lists: Record<string, unknown[]>; files: Record<string, UploadedFile> }

const last = (v: unknown): unknown => (Array.isArray(v) ? v[v.length - 1] : v);
const parseCache = new WeakMap<Request, RequestData>();

function runMulter(req: Request, res: Response): Promise<void> {
  // No per-file size cap: Django only caps the non-file part of the body
  // (DATA_UPLOAD_MAX_MEMORY_SIZE); large files are spooled to disk there.
  return new Promise((resolve, reject) =>
    multer({ storage: multer.memoryStorage() }).any()(req, res, ((e?: unknown) => (e ? reject(e) : resolve())) as NextFunction));
}

export async function requestData(req: Request, res: Response): Promise<RequestData> {
  const cached = parseCache.get(req);
  if (cached) return cached;
  const hasBody = Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding'] !== undefined;
  let out: RequestData;
  if (req.is('multipart/form-data')) {
    await runMulter(req, res);
    const lists: Record<string, unknown[]> = {};
    for (const [k, v] of Object.entries((req.body ?? {}) as Record<string, unknown>)) lists[k] = Array.isArray(v) ? [...v] : [v];
    const files: Record<string, UploadedFile> = {};
    for (const f of (req.files as Express.Multer.File[] | undefined) ?? []) {
      if (!f.originalname) continue; // Django skips file parts without a filename
      const uf: UploadedFile = { __file: true, name: f.originalname, size: f.size, buffer: f.buffer, contentType: f.mimetype };
      files[f.fieldname] = uf;
      (lists[f.fieldname] ??= []).push(uf);
    }
    const data = Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, v[v.length - 1]]));
    out = { data, lists, files };
  } else if (req.is('application/x-www-form-urlencoded')) {
    const lists: Record<string, unknown[]> = {};
    for (const [k, v] of Object.entries((req.body ?? {}) as Record<string, unknown>)) lists[k] = Array.isArray(v) ? [...v] : [v];
    out = { data: Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, last(v)])), lists, files: {} };
  } else if (req.is(['application/json', 'application/*+json'])) {
    out = { data: req.body === undefined ? {} : req.body, lists: {}, files: {} };
  } else if (hasBody) {
    throw new UnsupportedMediaType(req.headers['content-type'] ?? '');
  } else {
    out = { data: {}, lists: {}, files: {} };
  }
  parseCache.set(req, out);
  return out;
}

/** Python type name of a JSON value (for error messages / TypeErrors). */
export function pyTypeName(v: unknown): string {
  return isFile(v) ? 'InMemoryUploadedFile' : jsonTypeName(v);
}

const isDict = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && !isFile(v);

/** data.get(key, default) — AttributeError (→ 500) unless data is a mapping. */
export function dget(data: unknown, key: string, dflt: unknown = null): unknown {
  if (!isDict(data)) throw new TypeError(`'${pyTypeName(data)}' object has no attribute 'get'`);
  return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : dflt;
}

/** `key in data` (dict keys, list members, substring) — TypeError for scalars. */
export function pyIn(data: unknown, key: string): boolean {
  if (isDict(data)) return Object.prototype.hasOwnProperty.call(data, key);
  if (Array.isArray(data)) return data.some((x) => x === key);
  if (typeof data === 'string') return data.includes(key);
  throw new TypeError(`argument of type '${pyTypeName(data)}' is not iterable`);
}

/** data[key] */
export function pyGetItem(data: unknown, key: string): unknown {
  if (isDict(data)) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) throw new TypeError(`KeyError: '${key}'`);
    return data[key];
  }
  throw new TypeError(`${pyTypeName(data)} indices must be integers or slices, not str`);
}

/** str.strip() — AttributeError (→ 500) for non-strings, like Python. */
export function strip(v: unknown): string {
  if (typeof v !== 'string') throw new TypeError(`'${pyTypeName(v)}' object has no attribute 'strip'`);
  return pyStrip(v);
}
export { pyStrip };

/** str(x).strip() */
export { pyStrStrip as strStrip } from '../../lib/py.js';

/** Python truthiness of a request.data value. */
export function pyBool(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  if (isFile(v)) return true;
  if (typeof v === 'object') return Object.keys(v as object).length > 0;
  return true;
}

/** Python int(str) for a query-param string; null when int() would raise ValueError. */
export function pyIntParse(s: string): number | null {
  const n = pyIntStr(s);
  return n === null ? null : Number(n);
}

/** The last value of a query param (QueryDict.get), or undefined. */
export { qp };

/** `limit`/`offset` parsing shared by the suspensions/reports admin lists. */
export function limitOffset(req: Request): { limit: number; offset: number } {
  const l = qp(req, 'limit');
  const o = qp(req, 'offset');
  const li = l === undefined ? 20 : pyIntParse(l);
  const oi = o === undefined ? 0 : pyIntParse(o);
  if (li === null || oi === null) return { limit: 20, offset: 0 };
  return { limit: Math.max(1, Math.min(li, 100)), offset: Math.max(0, oi) };
}

/** Python slicing by code points: s[:n] */
export const pySlice = (s: string, n: number) => [...s].slice(0, n).join('');

/** str.upper() */
export const pyUpper = (s: string) => s.toUpperCase();


/**
 * Django pk lookup value for an IntegerField/BigAutoField (`filter(pk=x)`):
 * returns the integer, `null` for an out-of-range integer (no match), or
 * throws (→ 500 ValueError) when int() rejects it.
 */
export function pkValue(v: unknown, field = 'id'): number | null {
  let big: bigint;
  if (typeof v === 'boolean') big = v ? 1n : 0n;
  else if (typeof v === 'number' && Number.isFinite(v)) big = BigInt(Math.trunc(v));
  else if (typeof v === 'string' && pyIntStr(v) !== null) big = pyIntStr(v)!;
  else throw new TypeError(`Field '${field}' expected a number but got ${pyRepr(v)}.`);
  if (!inBigintRange(big)) return null;
  return Number(big);
}

// ---- CPython set iteration order (for `set(a) - b` results rendered as lists) ---------------

type SetKey = number | string;

/** hash() for ints (CPython: n mod (2**61 - 1), -1 → -2) as an unsigned 64-bit value; strings are randomised in CPython. */
function pyHash(k: SetKey): bigint | null {
  if (typeof k === 'string') return null;
  const M = (1n << 61n) - 1n;
  let n = BigInt(k);
  const neg = n < 0n;
  let h = (neg ? -n : n) % M;
  if (neg) h = -h;
  if (h === -1n) h = -2n;
  return BigInt.asUintN(64, h);
}

/** Emulates CPython's setobject.c table layout so iteration order matches for int keys. */
class PySet {
  table: (SetKey | undefined)[] = new Array(8).fill(undefined);
  hashes: bigint[] = new Array(8).fill(0n);
  fill = 0;
  used = 0;
  order: SetKey[] = []; // fallback order for non-int keys

  private eq(a: SetKey, b: SetKey) { return a === b; }

  has(k: SetKey): boolean { return this.order.some((x) => this.eq(x, k)); }

  add(k: SetKey) {
    if (this.has(k)) return;
    this.order.push(k);
    const h = pyHash(k);
    if (h === null) return;
    const mask = BigInt(this.table.length - 1);
    let i = h & mask;
    let perturb = h;
    for (;;) {
      const probes = i + 9n <= mask ? 9 : 0;
      let j = i;
      for (let p = 0; p <= probes; p++, j++) {
        if (this.table[Number(j)] === undefined) {
          this.table[Number(j)] = k; this.hashes[Number(j)] = h;
          this.fill++; this.used++;
          if (BigInt(this.fill) * 5n >= mask * 3n) this.resize(this.used > 50000 ? this.used * 2 : this.used * 4);
          return;
        }
      }
      perturb >>= 5n;
      i = (i * 5n + 1n + perturb) & mask;
    }
  }

  private resize(minused: number) {
    let size = 8;
    while (size <= minused) size <<= 1;
    const old = this.table.map((k, idx) => [k, this.hashes[idx]!] as const).filter(([k]) => k !== undefined);
    this.table = new Array(size).fill(undefined);
    this.hashes = new Array(size).fill(0n);
    const mask = BigInt(size - 1);
    for (const [k, h] of old) {
      let i = h & mask;
      let perturb = h;
      outer: for (;;) {
        if (this.table[Number(i)] === undefined) { this.table[Number(i)] = k; this.hashes[Number(i)] = h; break; }
        if (i + 9n <= mask) {
          for (let j = 1n; j <= 9n; j++) {
            if (this.table[Number(i + j)] === undefined) { this.table[Number(i + j)] = k; this.hashes[Number(i + j)] = h; break outer; }
          }
        }
        perturb >>= 5n;
        i = (i * 5n + 1n + perturb) & mask;
      }
    }
    this.fill = this.used;
  }

  /** Iteration order: table order for int keys, then insertion order for the rest. */
  items(): SetKey[] {
    const ints = this.table.filter((k): k is SetKey => k !== undefined);
    return [...ints, ...this.order.filter((k) => typeof k === 'string')];
  }
}

/**
 * `set(a) - set(b)` iteration order (CPython). `a` values are ints or strings
 * (ints compare equal to ints only; True/False count as 1/0).
 */
export function pySetDifference(a: SetKey[], b: SetKey[]): SetKey[] {
  const sa = new PySet();
  for (const x of a) sa.add(x);
  const sb = new PySet();
  for (const x of b) sb.add(x);
  const aItems = sa.items();
  if ((aItems.length >> 2) > sb.items().length) {
    // set_copy_and_difference: copy keeps the table layout, discards leave dummies.
    return aItems.filter((x) => !sb.has(x));
  }
  const out = new PySet();
  for (const x of aItems) if (!sb.has(x)) out.add(x);
  return out.items();
}

/** Coerces a JSON list element for set membership like Python (True == 1, 1.0 == 1). Unhashable → TypeError. */
export function setKey(v: unknown): SetKey {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return v;
  if (v === null) return 'None\u0000'; // hashable, never equal to a pk
  throw new TypeError(`unhashable type: '${pyTypeName(v)}'`);
}
