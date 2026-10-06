// DRF request.data / request.FILES for the messaging, support, hostapplications
// and chatbot ports (parsers: JSON, MultiPart, Form — DRF's defaults here).
// File saving is lib/upload.ts saveUpload.

import type { NextFunction, Request, Response } from 'express';
import { UnsupportedMediaType } from '../../lib/errors.js';
import { multipart } from '../../lib/upload.js';
import { htmlUnescape, pyIsPrintable, pySplitext, pyStr } from './pyutil.js';

/** An uploaded file (Django UploadedFile: .name, .size, .content_type). */
export class Upload {
  constructor(public name: string, public size: number, public contentType: string, public buffer: Buffer) {}
}

/** django.http.QueryDict (request.data for form / multipart bodies). */
export class QueryDict {
  constructor(public lists: Map<string, unknown[]> = new Map()) {}
  has(k: string) { return this.lists.has(k); }
  /** QueryDict.get(k, default) → last value */
  get(k: string, dflt?: unknown): unknown {
    const l = this.lists.get(k);
    if (!l) return dflt;
    return l.length ? l[l.length - 1] : [];
  }
  getlist(k: string): unknown[] { return this.lists.get(k) ?? []; }
}

export interface ParsedRequest {
  /** dict (JSON object), QueryDict, or whatever JSON value the body held. */
  data: unknown;
  files: Map<string, Upload[]>;
}

/** MultiPartParser.sanitize_file_name + UploadedFile._set_name; null → part skipped. */
export function sanitizeUploadName(raw: string): string | null {
  let name = htmlUnescape(raw);
  name = name.slice(name.lastIndexOf('/') + 1);
  name = name.slice(name.lastIndexOf('\\') + 1);
  name = Array.from(name).filter(pyIsPrintable).join('');
  if (name === '' || name === '.' || name === '..') return null;
  // UploadedFile._set_name: basename, truncate to 255 keeping the extension
  if ([...name].length > 255) {
    const [root, ext0] = pySplitext(name);
    const ext = [...ext0].slice(0, 255).join('');
    name = [...root].slice(0, 255 - [...ext].length).join('') + ext;
  }
  return name;
}

const kept = (v: unknown): unknown[] => (Array.isArray(v) ? v : [v]);

const cache = new WeakMap<Request, ParsedRequest>();

/** request.data (+ request.FILES) — parsed on first access, like DRF. */
export async function parseRequest(req: Request, res: Response): Promise<ParsedRequest> {
  const hit = cache.get(req);
  if (hit) return hit;
  let out: ParsedRequest;
  const hasBody = Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding'] !== undefined;
  if (req.is('multipart/form-data')) {
    await new Promise<void>((resolve, reject) => multipart(req, res, ((e?: unknown) => (e ? reject(e) : resolve())) as NextFunction));
    const lists = new Map<string, unknown[]>();
    for (const [k, v] of Object.entries((req.body ?? {}) as Record<string, unknown>)) lists.set(k, kept(v).map((x) => pyStr(x)));
    const files = new Map<string, Upload[]>();
    for (const f of (req.files as Express.Multer.File[]) ?? []) {
      // busboy hands non-ASCII names over as latin1; Django decodes the header as UTF-8.
      let original = f.originalname;
      if (/[\u0080-ÿ]/.test(original) && !/[^\u0000-ÿ]/.test(original)) {
        const re = Buffer.from(original, 'latin1').toString('utf8');
        if (!re.includes('�')) original = re;
      }
      const name = sanitizeUploadName(original);
      if (name === null) continue;
      const up = new Upload(name, f.size, f.mimetype ?? '', f.buffer);
      (files.get(f.fieldname) ?? files.set(f.fieldname, []).get(f.fieldname)!).push(up);
    }
    // request.data = data.copy(); data.update(files)
    for (const [k, ups] of files) lists.set(k, [...(lists.get(k) ?? []), ...ups]);
    out = { data: new QueryDict(lists), files };
  } else if (req.is('application/x-www-form-urlencoded')) {
    const lists = new Map<string, unknown[]>();
    for (const [k, v] of Object.entries((req.body ?? {}) as Record<string, unknown>)) lists.set(k, kept(v));
    out = { data: new QueryDict(lists), files: new Map() };
  } else if (req.is(['application/json', 'application/*+json'])) {
    out = { data: req.body === undefined ? {} : req.body, files: new Map() };
  } else if (hasBody) {
    throw new UnsupportedMediaType(req.headers['content-type'] ?? '');
  } else {
    out = { data: {}, files: new Map() };
  }
  cache.set(req, out);
  return out;
}

/** request.data.get(key, default) — AttributeError (→ 500) when data isn't a mapping. */
export function dget(data: unknown, key: string, dflt?: unknown): unknown {
  if (data instanceof QueryDict) return data.get(key, dflt);
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new TypeError(`'${Array.isArray(data) ? 'list' : data === null ? 'NoneType' : typeof data}' object has no attribute 'get'`);
  }
  return key in (data as object) ? (data as Record<string, unknown>)[key] : dflt;
}

/** str(value).strip() on a request value. */
export { pyStrStrip as strStrip } from '../../lib/py.js';
