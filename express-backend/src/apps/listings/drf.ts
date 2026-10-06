// DRF request parsing + serializer field validation, as used by the listings,
// inventory, propertyverifications and trustsafety ports. Reproduces:
//   - request.data per parser_classes (JSON / multipart / form → QueryDict),
//     415 for an unsupported content type, {} for an empty body;
//   - Field.get_value() (HTML-form semantics incl. default_empty_html),
//     validate_empty_values(), run_validation() and the field types these
//     serializers use (Char, Integer, Decimal, Boolean, Choice, JSON, File,
//     Image, PrimaryKeyRelated, ListField(ImageField));
//   - Serializer.to_internal_value() error collection ({field: [msgs]}).

import { IMAGE_EXTENSIONS } from '../../lib/upload.js';
import { extname } from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { imageSize } from 'image-size';
import { db } from '../../db/index.js';
import { UnsupportedMediaType } from '../../lib/errors.js';
import { pyIntStr, pyRepr, pyStr, pyStrip } from '../../lib/py.js';

// ---- uploaded files / QueryDict ---------------------------------------------------------

export interface Upload { name: string; size: number; data: Buffer; mimetype: string }

/** django.http.QueryDict (request.data for multipart/form bodies): every key → list of values. */
export class QueryDict {
  constructor(public readonly map: Map<string, unknown[]> = new Map()) {}
  has(k: string) { return this.map.has(k); }
  /** qd[k] — the last value. */
  get(k: string): unknown { const v = this.map.get(k); return v ? v[v.length - 1] : undefined; }
  getlist(k: string): unknown[] { return this.map.get(k) ?? []; }
  keys() { return [...this.map.keys()]; }
  /** {**qd} — plain dict of last values. */
  toDict(): Record<string, unknown> { return Object.fromEntries([...this.map.keys()].map((k) => [k, this.get(k)])); }
}

export function isUpload(v: unknown): v is Upload {
  return !!v && typeof v === 'object' && 'data' in v && Buffer.isBuffer((v as Upload).data);
}

export type Parser = 'json' | 'multipart' | 'form';

export interface ParsedRequest {
  /** request.data: a QueryDict, a plain object, or any JSON value. */
  data: unknown;
  /** request.FILES (field → files). */
  files: Map<string, Upload[]>;
}

const multipartParser = multer({ storage: multer.memoryStorage() }).any();

/** DRF Request._parse with the view's parser_classes. */
export async function parseRequest(req: Request, res: Response, parsers: Parser[] = ['json', 'multipart', 'form']): Promise<ParsedRequest> {
  const cached = (req as unknown as { _drfParsed?: ParsedRequest })._drfParsed;
  if (cached) return cached;
  const files = new Map<string, Upload[]>();
  const ctype = req.headers['content-type'];
  const len = req.headers['content-length'];
  const hasBody = (len !== undefined && Number(len) > 0) || (len === undefined && req.headers['transfer-encoding'] !== undefined);
  let out: ParsedRequest;
  const isForm = !!ctype && /^\s*(application\/x-www-form-urlencoded|multipart\/form-data)/i.test(ctype);
  if (!hasBody || !ctype) {
    out = { data: isForm ? new QueryDict() : {}, files };
  } else if (req.is('multipart/form-data') && parsers.includes('multipart')) {
    await new Promise<void>((resolve, reject) => multipartParser(req, res, ((e?: unknown) => (e ? reject(e) : resolve())) as NextFunction));
    const qd = new QueryDict();
    for (const [k, v] of Object.entries((req.body ?? {}) as Record<string, unknown>)) {
      qd.map.set(k, Array.isArray(v) ? v.map(String) : [String(v)]);
    }
    for (const f of (req.files as Express.Multer.File[]) ?? []) {
      // Django's MultiPartParser drops file parts without a filename.
      if (!f.originalname) continue;
      const up: Upload = { name: sanitizeFileName(f.originalname), size: f.size, data: f.buffer, mimetype: f.mimetype };
      if (!files.has(f.fieldname)) files.set(f.fieldname, []);
      files.get(f.fieldname)!.push(up);
    }
    // request.data = data.copy(); data.update(files) → files are appended to the field's list
    for (const [k, list] of files) qd.map.set(k, [...(qd.map.get(k) ?? []), ...list]);
    out = { data: qd, files };
  } else if (req.is('application/x-www-form-urlencoded') && parsers.includes('form')) {
    const qd = new QueryDict();
    for (const [k, v] of Object.entries((req.body ?? {}) as Record<string, unknown>)) qd.map.set(k, Array.isArray(v) ? v.map(String) : [String(v)]);
    out = { data: qd, files };
  } else if (req.is(['application/json', 'application/*+json']) && parsers.includes('json')) {
    out = { data: req.body === undefined ? {} : req.body, files };
  } else {
    throw new UnsupportedMediaType(ctype);
  }
  (req as unknown as { _drfParsed?: ParsedRequest })._drfParsed = out;
  return out;
}

/** MultiPartParser.sanitize_file_name (basename, html-unescape-free approximation). */
function sanitizeFileName(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? '';
  return base.trim();
}

/** request.data.get(key, default) — AttributeError (→ 500) when data isn't a mapping. */
export function dataGet(data: unknown, key: string, dflt?: unknown): unknown {
  if (data instanceof QueryDict) return data.has(key) ? data.get(key) : dflt;
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new TypeError(`'${pyTypeName(data)}' object has no attribute 'get'`);
  }
  return key in (data as object) ? (data as Record<string, unknown>)[key] : dflt;
}

/** `key in request.data` */
export function dataHas(data: unknown, key: string): boolean {
  if (data instanceof QueryDict) return data.has(key);
  if (typeof data === 'string') return data.includes(key);
  if (Array.isArray(data)) return data.includes(key);
  if (data && typeof data === 'object') return key in data;
  throw new TypeError(`argument of type '${pyTypeName(data)}' is not iterable`);
}

/** request.data[key] */
export function dataItem(data: unknown, key: string): unknown {
  if (data instanceof QueryDict) return data.get(key);
  return (data as Record<string, unknown>)[key];
}

export function pyTypeName(v: unknown): string {
  if (v === null || v === undefined) return 'NoneType';
  if (Array.isArray(v)) return 'list';
  if (typeof v === 'string') return 'str';
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'float';
  if (v instanceof QueryDict) return 'QueryDict';
  if (isUpload(v)) return 'InMemoryUploadedFile';
  return 'dict';
}

/** str(value) the way Python formats a parsed request value. */
export function pystr(v: unknown): string {
  if (isUpload(v)) return v.name;
  return pyStr(v);
}

export { pyStrip };

// ---- number parsing ------------------------------------------------------------------------

/** Python int(str) — returns a bigint or null when Python would raise ValueError. */
export const pyInt: (s: string) => bigint | null = pyIntStr;

/** decimal.Decimal(str).as_tuple() — null when it raises; 'nan'/'inf' for special values. */
export function pyDecimal(s: string): { neg: boolean; digits: string; exp: number } | 'nan' | 'inf' | null {
  const t = s;
  if (/^[+-]?(nan|snan)\d*$/i.test(t)) return 'nan';
  if (/^[+-]?(inf|infinity)$/i.test(t)) return 'inf';
  const m = /^([+-])?(?:(\d(?:_?\d)*)(?:\.(\d(?:_?\d)*)?)?|\.(\d(?:_?\d)*))(?:[eE]([+-]?\d(?:_?\d)*))?$/.exec(t);
  if (!m) return null;
  const intPart = (m[2] ?? '').replace(/_/g, '');
  const frac = (m[3] ?? m[4] ?? '').replace(/_/g, '');
  const e = m[5] ? Number(m[5].replace(/_/g, '')) : 0;
  let digits = (intPart + frac).replace(/^0+/, '');
  if (digits === '') digits = '0';
  return { neg: m[1] === '-', digits, exp: e - frac.length };
}

// ---- dates -----------------------------------------------------------------------------------

const DAY_MS = 86_400_000;
function validYmd(y: number, m: number, d: number) {
  if (y < 1 || y > 9999 || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function ymd(y: number, m: number, d: number) {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** datetime.date.fromisoformat (Python 3.12) → 'YYYY-MM-DD' or null (ValueError). */
export function dateFromIsoformat(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s) ?? /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return validYmd(+m[1]!, +m[2]!, +m[3]!) ? ymd(+m[1]!, +m[2]!, +m[3]!) : null;
  m = /^(\d{4})-?W(\d{2})(?:-?(\d))?$/.exec(s);
  if (m) {
    // ISO week date; the separators must be consistent.
    const dashed = s[4] === '-';
    if (dashed !== /^\d{4}-W\d{2}(-\d)?$/.test(s) && !(!dashed && /^\d{4}W\d{2}\d?$/.test(s))) return null;
    const y = +m[1]!; const w = +m[2]!; const d = m[3] ? +m[3] : 1;
    if (y < 1 || w < 1 || w > 53 || d < 1 || d > 7) return null;
    const jan4 = Date.UTC(y, 0, 4);
    const jan4Dow = (new Date(jan4).getUTCDay() + 6) % 7;
    const week1Mon = jan4 - jan4Dow * DAY_MS;
    if (w === 53) {
      const dec28 = Date.UTC(y, 11, 28);
      const lastWeekMon = dec28 - ((new Date(dec28).getUTCDay() + 6) % 7) * DAY_MS;
      if ((lastWeekMon - week1Mon) / DAY_MS / 7 + 1 < 53) return null;
    }
    const t = new Date(week1Mon + ((w - 1) * 7 + (d - 1)) * DAY_MS);
    return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }
  return null;
}

/**
 * django.utils.dateparse.parse_date: fromisoformat, else the lenient regex.
 * Returns the date, null (no match), or throws (regex matched but invalid date).
 */
export function djangoParseDate(s: string): string | null {
  const iso = dateFromIsoformat(s);
  if (iso) return iso;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s.endsWith('\n') ? s.slice(0, -1) : s);
  if (!m) return null;
  if (!validYmd(+m[1]!, +m[2]!, +m[3]!)) throw new RangeError('day is out of range for month');
  return ymd(+m[1]!, +m[2]!, +m[3]!);
}

/** DateField lookup value (to_python): the parsed date, or throws Django's ValidationError (→ 500). */
export function dateLookupValue(s: string): string {
  let d: string | null;
  try { d = djangoParseDate(s); } catch { throw new Error(`“${s}” value has the correct format (YYYY-MM-DD) but it is an invalid date.`); }
  if (d === null) throw new Error(`“${s}” value has an invalid date format. It must be in YYYY-MM-DD format.`);
  return d;
}

export const dayNumber = (isoDate: string) => Math.round(Date.parse(isoDate + 'T00:00:00Z') / DAY_MS);
export const dayToIso = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);
/** timezone.now().date() (UTC). */
export const todayIso = () => new Date().toISOString().slice(0, 10);

// ---- exact float formatting (Python round() / format(.Nf)) --------------------------------------

/** Exact decimal expansion of a double → [negative, digits, exponent10] (value = digits × 10^exp). */
function exactDecimal(x: number): [boolean, bigint, number] {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0); const lo = buf.getUint32(4);
  const neg = (hi >>> 31) === 1;
  const expBits = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e2: number;
  if (expBits === 0) e2 = -1074;
  else { mant |= 1n << 52n; e2 = expBits - 1075; }
  if (e2 >= 0) return [neg, mant << BigInt(e2), 0];
  return [neg, mant * 5n ** BigInt(-e2), e2];
}

/** Round half-even of a double's exact value to `n` decimals → [neg, scaled integer]. */
function roundHalfEven(x: number, n: number): [boolean, bigint] {
  const [neg, digits, exp] = exactDecimal(x);
  const shift = exp + n; // value × 10^n = digits × 10^shift
  if (shift >= 0) return [neg, digits * 10n ** BigInt(shift)];
  const div = 10n ** BigInt(-shift);
  let q = digits / div;
  const r = digits % div;
  if (r * 2n > div || (r * 2n === div && q % 2n === 1n)) q += 1n;
  return [neg, q];
}

/** format(x, '.Nf') */
export function pyFixed(x: number, n: number): string {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? 'nan' : x > 0 ? 'inf' : '-inf';
  const [neg, q] = roundHalfEven(x, n);
  let s = q.toString().padStart(n + 1, '0');
  if (n > 0) s = `${s.slice(0, s.length - n)}.${s.slice(s.length - n)}`;
  return (neg ? '-' : '') + s;
}

/** round(x, n) for a Python float. */
export function pyRound(x: number, n: number): number {
  if (!Number.isFinite(x)) return x;
  return Number(pyFixed(x, n));
}

// ---- field specs -------------------------------------------------------------------------------

export class FieldError extends Error {
  constructor(public detail: unknown) { super(typeof detail === 'string' ? detail : JSON.stringify(detail)); }
}
class Skip {}
const EMPTY = Symbol('empty');
type Empty = typeof EMPTY;

export type FieldKind = 'char' | 'email' | 'int' | 'decimal' | 'bool' | 'choice' | 'json' | 'file' | 'image' | 'pk' | 'imagelist';

export interface FieldSpec {
  kind: FieldKind;
  required?: boolean;
  allowNull?: boolean;
  allowBlank?: boolean;
  /** Declared serializer default (not the model default — ModelSerializer never sets those). */
  default?: unknown;
  maxLength?: number;
  minValue?: number;
  maxValue?: number;
  maxDigits?: number;
  decimalPlaces?: number;
  choices?: (string | number)[];
  /** PrimaryKeyRelatedField queryset table. */
  pkTable?: string;
  /** Validators run after to_internal_value (e.g. UniqueValidator); return an error message or null. */
  validators?: ((value: unknown) => Promise<string | null> | string | null)[];
  /** validate_<field>(value) — return the new value or throw FieldError. */
  validate?: (value: unknown) => unknown;
}

export type Fields = [string, FieldSpec][];

const BIGINT_MAX = 9223372036854775807n;

function fail(msg: string): never { throw new FieldError([msg]); }

function getValue(name: string, spec: FieldSpec, data: Record<string, unknown> | QueryDict, partial: boolean): unknown {
  if (data instanceof QueryDict) {
    if (spec.kind === 'imagelist') {
      const val = data.getlist(name);
      if (val.length) return val;
      if (partial && !data.keys().some((k) => k.startsWith(name + '['))) return EMPTY;
      return EMPTY; // parse_html_list(default=empty) for the indexed form — not used by the SPA
    }
    if (spec.kind === 'json' && data.has(name)) return { __jsonString: String(data.get(name)) };
    if (!data.has(name)) {
      if (partial) return EMPTY;
      return spec.kind === 'bool' ? false : EMPTY; // default_empty_html
    }
    const ret = data.get(name);
    if (ret === '' && spec.allowNull) return spec.allowBlank ? '' : null;
    if (ret === '' && spec.required === false) return spec.allowBlank ? '' : EMPTY;
    return ret;
  }
  if (spec.kind === 'imagelist' && !(name in data) && partial) return EMPTY;
  return name in data ? data[name] : EMPTY;
}

async function toInternal(spec: FieldSpec, data: unknown): Promise<unknown> {
  switch (spec.kind) {
    case 'char':
    case 'email': {
      if (typeof data === 'boolean' || !(typeof data === 'string' || typeof data === 'number')) fail('Not a valid string.');
      return pyStrip(typeof data === 'string' ? data : pystr(data));
    }
    case 'int': {
      if (typeof data === 'string' && data.length > 1000) fail('String value too large.');
      const s = (typeof data === 'string' ? data : pystr(data)).replace(/\.0*\s*$/, '');
      const n = typeof data === 'boolean' || data === null || typeof data === 'object' ? null : pyInt(s);
      if (n === null) fail('A valid integer is required.');
      return n;
    }
    case 'decimal': {
      const s = pyStrip(typeof data === 'string' ? data : pystr(data));
      if (s.length > 1000) fail('String value too large.');
      const d = typeof data === 'object' && data !== null ? null : pyDecimal(s);
      if (d === null || d === 'nan' || d === 'inf') fail('A valid number is required.');
      const { digits, exp } = d;
      let total: number; let whole: number; let places: number;
      if (exp >= 0) { total = digits.length + exp; whole = total; places = 0; }
      else if (digits.length > -exp) { total = digits.length; whole = total + exp; places = -exp; }
      else { total = -exp; whole = 0; places = total; }
      const maxDigits = spec.maxDigits!; const dp = spec.decimalPlaces!;
      if (total > maxDigits) fail(`Ensure that there are no more than ${maxDigits} digits in total.`);
      if (places > dp) fail(`Ensure that there are no more than ${dp} decimal places.`);
      if (whole > maxDigits - dp) fail(`Ensure that there are no more than ${maxDigits - dp} digits before the decimal point.`);
      // quantize to `dp` places (only pads — precision was validated above)
      let coef = BigInt(digits) * 10n ** BigInt(exp + dp);
      let str = coef.toString().padStart(dp + 1, '0');
      if (dp > 0) str = `${str.slice(0, str.length - dp)}.${str.slice(str.length - dp)}`;
      coef = 0n;
      return (d.neg ? '-' : '') + str;
    }
    case 'bool': {
      const v = typeof data === 'string' ? data.toLowerCase() : data;
      if (['t', 'y', 'yes', 'true', 'on', '1', 1, true].includes(v as never)) return true;
      if (['f', 'n', 'no', 'false', 'off', '0', 0, false].includes(v as never)) return false;
      if ((v === 'null' || v === '' || v === null) && spec.allowNull) return null;
      fail('Must be a valid boolean.');
      break;
    }
    case 'choice': {
      if (data === '' && spec.allowBlank) return '';
      const key = pystr(data);
      const hit = spec.choices!.find((c) => String(c) === key);
      if (hit === undefined || (typeof data === 'object' && data !== null && !isUpload(data))) fail(`"${key}" is not a valid choice.`);
      return hit;
    }
    case 'json': {
      if (data && typeof data === 'object' && '__jsonString' in data) {
        try { return JSON.parse((data as { __jsonString: string }).__jsonString); } catch { fail('Value must be valid JSON.'); }
      }
      return data;
    }
    case 'file':
    case 'image': {
      if (!isUpload(data)) fail('The submitted data was not a file. Check the encoding type on the form.');
      if (!data.name) fail('No filename could be determined.');
      if (!data.size) fail('The submitted file is empty.');
      if (spec.maxLength && [...data.name].length > spec.maxLength) {
        fail(`Ensure this filename has at most ${spec.maxLength} characters (it has ${[...data.name].length}).`);
      }
      if (spec.kind === 'image') validateImage(data);
      return data;
    }
    case 'imagelist': {
      if (typeof data === 'string' || !Array.isArray(data)) {
        fail(`Expected a list of items but got type "${pyTypeName(data)}".`);
      }
      const errors: Record<string, unknown> = {};
      const out: unknown[] = [];
      for (const [i, item] of data.entries()) {
        try {
          if (item === null) fail('This field may not be null.');
          out.push(await toInternal({ kind: 'image', maxLength: undefined }, item));
        } catch (e) {
          if (!(e instanceof FieldError)) throw e;
          errors[String(i)] = e.detail;
        }
      }
      if (Object.keys(errors).length) throw new FieldError(errors);
      return out;
    }
    case 'pk': {
      if (typeof data === 'boolean' || data === null || typeof data === 'object') {
        fail(`Incorrect type. Expected pk value, received ${pyTypeName(data)}.`);
      }
      let n: bigint | null;
      if (typeof data === 'number') n = Number.isFinite(data) ? BigInt(Math.trunc(data)) : null;
      else n = pyInt(String(data));
      if (n === null) fail(`Incorrect type. Expected pk value, received ${pyTypeName(data)}.`);
      const missing = `Invalid pk "${pystr(data)}" - object does not exist.`;
      if (n > BIGINT_MAX || n < -BIGINT_MAX - 1n) fail(missing);
      const row = await db.selectFrom(spec.pkTable as 'listings_listing').selectAll().where('id', '=', n.toString() as unknown as number).executeTakeFirst();
      if (!row) fail(missing);
      return row;
    }
  }
  return data;
}

// Pillow's registered extensions (get_available_image_extensions()) in the order they have once
// Image.open() ran preinit() (Bmp/Gif/Jpeg/Ppm/Png first) — always the case when the validator runs.

/** forms.ImageField.to_python (PIL open + verify) then validate_image_file_extension. */
function validateImage(f: Upload) {
  let ok = false;
  try {
    const sig = f.data.subarray(0, 12);
    const known = sig.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      || (sig[0] === 0xff && sig[1] === 0xd8 && sig[2] === 0xff)
      || sig.subarray(0, 6).toString('latin1') === 'GIF87a' || sig.subarray(0, 6).toString('latin1') === 'GIF89a'
      || (sig.subarray(0, 4).toString('latin1') === 'RIFF' && sig.subarray(8, 12).toString('latin1') === 'WEBP')
      || sig.subarray(0, 2).toString('latin1') === 'BM';
    if (known) { const dim = imageSize(f.data); ok = !!dim.width && !!dim.height; }
  } catch { ok = false; }
  if (!ok) fail('Upload a valid image. The file you uploaded was either not an image or a corrupted image.');
  const ext = extname(f.name).slice(1).toLowerCase();
  const suffix = f.name.startsWith('.') && !f.name.slice(1).includes('.') ? '' : ext;
  if (!IMAGE_EXTENSIONS.includes(suffix)) {
    fail(`File extension “${suffix}” is not allowed. Allowed extensions are: ${IMAGE_EXTENSIONS.join(', ')}.`);
  }
}

async function runValidation(name: string, spec: FieldSpec, data: unknown | Empty, partial: boolean): Promise<unknown> {
  // CharField.run_validation: blank check before anything else
  if ((spec.kind === 'char' || spec.kind === 'email') && data !== EMPTY && (data === '' || pyStrip(pystr(data)) === '')) {
    if (!spec.allowBlank) fail('This field may not be blank.');
    return '';
  }
  // validate_empty_values
  if (data === EMPTY) {
    if (partial) throw new Skip();
    if (spec.required !== false) {
      fail(spec.kind === 'file' || spec.kind === 'image' ? 'No file was submitted.' : 'This field is required.');
    }
    if (spec.default === undefined) throw new Skip();
    return spec.default;
  }
  if (data === null) {
    if (!spec.allowNull) fail('This field may not be null.');
    return null;
  }
  const value = await toInternal(spec, data);
  const errors: string[] = [];
  for (const v of spec.validators ?? []) {
    const e = await v(value);
    if (e) errors.push(e);
  }
  if (spec.kind === 'char' || spec.kind === 'email') {
    const s = value as string;
    if (spec.kind === 'email' && !isEmail(s)) errors.push('Enter a valid email address.');
    if (spec.maxLength !== undefined && [...s].length > spec.maxLength) errors.push(`Ensure this field has no more than ${spec.maxLength} characters.`);
    if (s.includes('\u0000')) errors.push('Null characters are not allowed.');
  }
  if (spec.kind === 'int') {
    const n = value as bigint;
    if (spec.maxValue !== undefined && n > BigInt(spec.maxValue)) errors.push(`Ensure this value is less than or equal to ${spec.maxValue}.`);
    if (spec.minValue !== undefined && n < BigInt(spec.minValue)) errors.push(`Ensure this value is greater than or equal to ${spec.minValue}.`);
  }
  if (errors.length) throw new FieldError(errors);
  return spec.kind === 'int' ? Number(value) : value;
}

function isEmail(s: string): boolean {
  return /^[-!#$%&'*+/=?^_`{}|~0-9A-Za-z]+(\.[-!#$%&'*+/=?^_`{}|~0-9A-Za-z]+)*@((?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z0-9-]{2,63})$/.test(s);
}

export interface Validated { errors: Record<string, unknown> | null; values: Record<string, unknown> }

/**
 * serializer.is_valid() field phase (Serializer.to_internal_value): returns
 * validated_data or the DRF errors dict. `validate` (Serializer.validate)
 * runs only when every field passed.
 */
export async function runSerializer(
  data: unknown,
  fields: Fields,
  opts: { partial?: boolean; validate?: (attrs: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown> } = {},
): Promise<Validated> {
  const partial = !!opts.partial;
  if (!(data instanceof QueryDict) && (data === null || typeof data !== 'object' || Array.isArray(data))) {
    return { errors: { non_field_errors: [`Invalid data. Expected a dictionary, but got ${pyTypeName(data)}.`] }, values: {} };
  }
  const errors: Record<string, unknown> = {};
  const values: Record<string, unknown> = {};
  for (const [name, spec] of fields) {
    const raw = getValue(name, spec, data as Record<string, unknown> | QueryDict, partial);
    try {
      let v = await runValidation(name, spec, raw, partial);
      if (spec.validate) v = await spec.validate(v);
      values[name] = v;
    } catch (e) {
      if (e instanceof Skip) continue;
      if (e instanceof FieldError) { errors[name] = e.detail; continue; }
      throw e;
    }
  }
  if (Object.keys(errors).length) return { errors, values: {} };
  if (opts.validate) {
    try {
      return { errors: null, values: await opts.validate(values) };
    } catch (e) {
      if (e instanceof FieldError) {
        const d = e.detail;
        if (d && typeof d === 'object' && !Array.isArray(d)) {
          return { errors: Object.fromEntries(Object.entries(d).map(([k, v]) => [k, Array.isArray(v) ? v : [v]])), values: {} };
        }
        return { errors: { non_field_errors: Array.isArray(d) ? d : [d] }, values: {} };
      }
      throw e;
    }
  }
  return { errors: null, values };
}

const CODES: [RegExp, string][] = [
  [/^This field is required\.$|^No file was submitted\.$/, 'required'], [/^This field may not be blank\.$/, 'blank'],
  [/^This field may not be null\.$/, 'null'], [/^Ensure this field has no more than/, 'max_length'],
  [/^Ensure this value is less than or equal/, 'max_value'], [/^Ensure this value is greater than or equal/, 'min_value'],
  [/digits in total\.$/, 'max_digits'], [/decimal places\.$/, 'max_decimal_places'], [/digits before the decimal point\.$/, 'max_whole_digits'],
  [/is not a valid choice\.$/, 'invalid_choice'], [/^Invalid pk /, 'does_not_exist'], [/^Incorrect type\./, 'incorrect_type'],
  [/^Null characters/, 'null_characters_not_allowed'], [/^String value too large/, 'max_string_length'],
];
function errorCode(msg: string): string {
  for (const [re, code] of CODES) if (re.test(msg)) return code;
  return 'invalid';
}

/** Python repr() of serializer.errors (ReturnDict of lists of ErrorDetail). */
export function pyErrorsRepr(errors: unknown): string {
  if (Array.isArray(errors)) return `[${errors.map(pyErrorsRepr).join(', ')}]`;
  if (errors && typeof errors === 'object') {
    return `{${Object.entries(errors).map(([k, v]) => `${pyRepr(k)}: ${pyErrorsRepr(v)}`).join(', ')}}`;
  }
  if (typeof errors === 'string') return `ErrorDetail(string=${pyRepr(errors)}, code='${errorCode(errors)}')`;
  return pyRepr(errors);
}

/** Primary-key path segment (Django <int:...>) → string id, or null when it can't match a bigint row. */
export function pkParam(raw: unknown): number | null {
  const n = BigInt(String(raw));
  // bigint-safe: handed to pg as text (ids beyond 2^53 never exist, but must not lose the "not found")
  return n > BIGINT_MAX ? null : (n.toString() as unknown as number);
}

/**
 * The value Django's IntegerField.get_prep_value makes of a lookup value:
 * a numeric id string, null (no row can match), or throws (ValueError/TypeError → 500).
 */
export function ormPk(v: unknown, field = 'id'): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return (v ? 1 : 0);
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`cannot convert float to integer`);
    return pkParamSafe(BigInt(Math.trunc(v)));
  }
  if (typeof v === 'string') {
    const n = pyInt(v);
    if (n === null) throw new Error(`Field '${field}' expected a number but got ${JSON.stringify(v)}.`);
    return pkParamSafe(n);
  }
  throw new TypeError(`Field '${field}' expected a number but got ${pyTypeName(v)}.`);
}
function pkParamSafe(n: bigint): number | null {
  return n > 9223372036854775807n || n < -9223372036854775808n ? null : (n.toString() as unknown as number);
}


/**
 * Django DecimalField.get_db_prep_save(float): Context(prec=max_digits).create_decimal_from_float
 * (round half-even to `prec` significant digits) → decimal string handed to Postgres.
 */
export function floatToDecimalPrec(x: number, prec: number): string {
  if (!Number.isFinite(x)) throw new Error('cannot convert float to Decimal');
  if (x === 0) return '0';
  const [neg, digits, exp] = exactDecimal(x);
  const s = digits.toString();
  const drop = s.length - prec;
  let coef: bigint; let e: number;
  if (drop <= 0) { coef = digits; e = exp; } else {
    const div = 10n ** BigInt(drop);
    let q = digits / div; const r = digits % div;
    if (r * 2n > div || (r * 2n === div && q % 2n === 1n)) q += 1n;
    coef = q; e = exp + drop;
  }
  let str: string;
  if (e >= 0) str = coef.toString() + '0'.repeat(e);
  else { const p = coef.toString().padStart(-e + 1, '0'); str = `${p.slice(0, p.length + e)}.${p.slice(p.length + e)}`; }
  return (neg ? '-' : '') + str;
}

/** DRF DecimalField.to_representation(float): quantize(Decimal(str(x)), places) half-even. */
export function floatDecimalRepr(x: number, places: number): string {
  return pyFixedDecimalString(pyFloatReprLocal(x), places);
}
function pyFloatReprLocal(x: number): string {
  const s = String(x);
  return s;
}
function pyFixedDecimalString(s: string, places: number): string {
  const d = pyDecimal(s.includes('e') || s.includes('E') ? s : s);
  if (d === null || d === 'nan' || d === 'inf') throw new Error('invalid decimal');
  const shift = d.exp + places;
  let q: bigint;
  if (shift >= 0) q = BigInt(d.digits) * 10n ** BigInt(shift);
  else {
    const div = 10n ** BigInt(-shift);
    const digits = BigInt(d.digits);
    q = digits / div; const r = digits % div;
    if (r * 2n > div || (r * 2n === div && q % 2n === 1n)) q += 1n;
  }
  let str = q.toString().padStart(places + 1, '0');
  if (places) str = `${str.slice(0, str.length - places)}.${str.slice(str.length - places)}`;
  return (d.neg ? '-' : '') + str;
}
