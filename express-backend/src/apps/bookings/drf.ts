// DRF plumbing shared by the bookings / leaseagreements / agents ports:
// request.data (JSON / form / multipart, QueryDict-ness) and the serializer field types their ModelSerializers use, with DRF's exact
// validation messages and Field.get_value() semantics for HTML (form) input.

import type { NextFunction, Request, Response } from 'express';
import { imageSize } from 'image-size';
import { sql } from 'kysely';
import { db } from '../../db/index.js';
import { UnsupportedMediaType } from '../../lib/errors.js';
import { multipart, files as uploadedFiles } from '../../lib/upload.js';
import { parseDate, pyDecimal, pyRepr, pyStr, pyStrip } from './py.js';

const last = (v: unknown): unknown => (Array.isArray(v) ? v[v.length - 1] : v);

// ---- request.data ---------------------------------------------------------------------------

export interface ReqData {
  /** The parsed body: dict for JSON objects / forms, or any JSON value. */
  data: unknown;
  /** QueryDict (form / multipart) input → DRF's html get_value rules apply. */
  html: boolean;
  files: (field: string) => Express.Multer.File[];
}

const cache = new WeakMap<Request, ReqData>();

/** request.data: {} for an empty body, 415 for an unsupported content type, QueryDict-style last values for forms. */
export async function requestData(req: Request, res: Response): Promise<ReqData> {
  const hit = cache.get(req);
  if (hit) return hit;
  const hasBody = Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding'] !== undefined;
  let out: ReqData;
  const noFiles = () => [];
  if (req.is('multipart/form-data')) {
    await new Promise<void>((resolve, reject) => multipart(req, res, ((e?: unknown) => (e ? reject(e) : resolve())) as NextFunction));
    const d = Object.fromEntries(Object.entries((req.body ?? {}) as Record<string, unknown>).map(([k, v]) => [k, last(v)]));
    for (const f of (req.files as Express.Multer.File[] | undefined) ?? []) if (!(f.fieldname in d)) d[f.fieldname] = f;
    out = { data: d, html: true, files: (f) => uploadedFiles(req, f) };
  } else if (req.is('application/x-www-form-urlencoded')) {
    out = { data: Object.fromEntries(Object.entries((req.body ?? {}) as Record<string, unknown>).map(([k, v]) => [k, last(v)])), html: true, files: noFiles };
  } else if (req.is(['application/json', 'application/*+json'])) {
    out = { data: req.body ?? {}, html: false, files: noFiles };
  } else if (hasBody) {
    throw new UnsupportedMediaType(req.headers['content-type'] ?? '');
  } else {
    out = { data: {}, html: false, files: noFiles };
  }
  cache.set(req, out);
  return out;
}

export function isMultipartFile(v: unknown): v is Express.Multer.File {
  return !!v && typeof v === 'object' && 'buffer' in (v as object) && 'originalname' in (v as object);
}

/** Python type(x).__name__ for a request.data value. */
export function pyTypeName(v: unknown): string {
  if (v === null || v === undefined) return 'NoneType';
  if (Array.isArray(v)) return 'list';
  if (typeof v === 'string') return 'str';
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'float';
  if (isMultipartFile(v)) return 'InMemoryUploadedFile';
  return 'dict';
}

/** request.data.get(key, default): AttributeError (→ 500) when data isn't a mapping. */
export function dget(data: unknown, key: string, dflt: unknown = null): unknown {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new TypeError(`'${pyTypeName(data)}' object has no attribute 'get'`);
  }
  return key in (data as object) ? (data as Record<string, unknown>)[key] : dflt;
}

/** str(value).strip() on a request value (AttributeError for non-str `.strip()` is the caller's concern). */
export { pyStrStrip as strStrip } from '../../lib/py.js';

/** value.strip() — AttributeError (→ 500) for non-strings, like Python. */
export function strictStrip(v: unknown): string {
  if (typeof v !== 'string') throw new TypeError(`'${pyTypeName(v)}' object has no attribute 'strip'`);
  return pyStrip(v);
}

// ---- serializer fields -----------------------------------------------------------------------

export const empty = Symbol('empty');
export class SkipField extends Error {}

/** A DRF ValidationError raised inside a field (list of messages, or a nested dict for ListField). */
export class FieldInvalid extends Error {
  constructor(public detail: string[] | Record<string, unknown>) { super(Array.isArray(detail) ? detail.join(' ') : 'invalid'); }
}
const fail = (msg: string): never => { throw new FieldInvalid([msg]); };

export interface Field {
  required?: boolean;
  allowNull?: boolean;
  allowBlank?: boolean;
  /** model default / field default: a function (callable default) or value. */
  default?: unknown;
  /** BooleanField's default_empty_html = False; empty otherwise. */
  defaultEmptyHtml?: unknown;
  readOnly?: boolean;
  toInternal(v: unknown): unknown | Promise<unknown>;
  validators?: ((v: unknown) => void | Promise<void>)[];
  /** Field.error_messages['required'] override (FileField: 'No file was submitted.'). */
  requiredMessage?: string;
  /** char-like fields return '' for blank input before validators. */
  charLike?: boolean;
}

const NULL_MSG = 'This field may not be null.';
const REQUIRED_MSG = 'This field is required.';

export function charField(o: { maxLength?: number; minLength?: number; allowBlank?: boolean; allowNull?: boolean; required?: boolean; default?: unknown; trim?: boolean; unique?: { table: string; column: string; message: string } } = {}): Field {
  const trim = o.trim ?? true;
  return {
    required: o.required, allowNull: o.allowNull, allowBlank: o.allowBlank, default: o.default, charLike: true,
    toInternal(v) {
      if (typeof v === 'boolean' || !(typeof v === 'string' || typeof v === 'number')) fail('Not a valid string.');
      const s = pyStr(v);
      return trim ? pyStrip(s) : s;
    },
    validators: [
      (v) => {
        const s = v as string;
        const errs: string[] = [];
        if (o.maxLength !== undefined && [...s].length > o.maxLength) errs.push(`Ensure this field has no more than ${o.maxLength} characters.`);
        if (o.minLength !== undefined && [...s].length < o.minLength) errs.push(`Ensure this field has at least ${o.minLength} characters.`);
        if (s.includes('\u0000')) errs.push('Null characters are not allowed.');
        if (errs.length) throw new FieldInvalid(errs);
      },
      ...(o.unique ? [async (v: unknown) => {
        const hit = await db.selectFrom(o.unique!.table as never).select(sql`1`.as('x')).where(sql.ref(o.unique!.column), '=', v as string).executeTakeFirst();
        if (hit) fail(o.unique!.message);
      }] : []),
    ],
  };
}

export function choiceField(choices: string[], o: { allowBlank?: boolean; allowNull?: boolean; required?: boolean; default?: unknown } = {}): Field {
  return {
    required: o.required, allowNull: o.allowNull, allowBlank: o.allowBlank, default: o.default,
    toInternal(v) {
      if (v === '' && o.allowBlank) return '';
      if (Array.isArray(v) || (v !== null && typeof v === 'object')) {
        // str(list/dict) is hashable → plain invalid_choice with the repr
        fail(`"${pyRepr(v)}" is not a valid choice.`);
      }
      const s = pyStr(v);
      if (!choices.includes(s)) fail(`"${s}" is not a valid choice.`);
      return s;
    },
  };
}

const TRUE_VALUES = ['t', 'T', 'y', 'Y', 'yes', 'Yes', 'YES', 'true', 'True', 'TRUE', 'on', 'On', 'ON', '1', 1, true];
const FALSE_VALUES = ['f', 'F', 'n', 'N', 'no', 'No', 'NO', 'false', 'False', 'FALSE', 'off', 'Off', 'OFF', '0', 0, false];

export function boolField(o: { required?: boolean; default?: unknown; allowNull?: boolean } = {}): Field {
  return {
    required: o.required, default: o.default, allowNull: o.allowNull, defaultEmptyHtml: false,
    toInternal(v) {
      if (TRUE_VALUES.includes(v as never)) return true;
      if (FALSE_VALUES.includes(v as never)) return false;
      if (o.allowNull && ['null', 'Null', 'NULL', '', null].includes(v as never)) return null;
      return fail('Must be a valid boolean.');
    },
  };
}

const INT_MIN = -2147483648, INT_MAX = 2147483647;

export function integerField(o: { required?: boolean; allowNull?: boolean; default?: unknown; min?: number | null; max?: number | null; extraMin?: number } = {}): Field {
  const min = o.min === undefined ? INT_MIN : o.min;
  const max = o.max === undefined ? INT_MAX : o.max;
  return {
    required: o.required, allowNull: o.allowNull, default: o.default,
    toInternal(v) {
      if (typeof v === 'string' && v.length > 1000) fail('String value too large.');
      let s: string;
      if (typeof v === 'number') s = Number.isInteger(v) ? String(v) : pyStr(v);
      else if (typeof v === 'string') s = v;
      else if (typeof v === 'boolean') return fail('A valid integer is required.');
      else return fail('A valid integer is required.');
      s = s.replace(/\.0*\s*$/, '');
      const t = pyStrip(s);
      if (!/^[+-]?\d+(?:_\d+)*$/.test(t)) fail('A valid integer is required.');
      return Number(t.replace(/_/g, ''));
    },
    validators: [(v) => {
      const n = v as number;
      const errs: string[] = [];
      if (max !== null && n > max) errs.push(`Ensure this value is less than or equal to ${max}.`);
      if (min !== null && n < min) errs.push(`Ensure this value is greater than or equal to ${min}.`);
      if (o.extraMin !== undefined && n < o.extraMin) errs.push(`Ensure this value is greater than or equal to ${o.extraMin}.`);
      if (errs.length) throw new FieldInvalid(errs);
    }],
  };
}

/** DRF DecimalField(max_digits, decimal_places): returns the quantized value as a string. */
export function decimalField(maxDigits: number, places: number, o: { required?: boolean; allowNull?: boolean; default?: unknown } = {}): Field {
  return {
    required: o.required, allowNull: o.allowNull, default: o.default,
    toInternal(v) {
      const s = pyStrip(typeof v === 'number' ? pyStr(v) : pyStr(v));
      if (s.length > 1000) fail('String value too large.');
      const d = pyDecimal(s);
      if (!d || d.kind !== 'num') return fail('A valid number is required.');
      // as_tuple(): digits without leading zeros, exponent
      const m = /^-?(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(d.text)!;
      const intPart = m[1]!, frac = m[2] ?? '', exp = Number(m[3] ?? 0) - frac.length;
      let digits = (intPart + frac).replace(/^0+/, '');
      if (digits === '') digits = '0';
      let total: number, whole: number, dp: number;
      if (exp >= 0) { total = digits.length + exp; whole = total; dp = 0; }
      else if (digits.length > -exp) { total = digits.length; whole = total + exp; dp = -exp; }
      else { dp = -exp; total = dp; whole = 0; }
      if (total > maxDigits) fail(`Ensure that there are no more than ${maxDigits} digits in total.`);
      if (dp > places) fail(`Ensure that there are no more than ${places} decimal places.`);
      if (whole > maxDigits - places) fail(`Ensure that there are no more than ${maxDigits - places} digits before the decimal point.`);
      return quantizeText(d.text, places);
    },
  };
}

/** Decimal(text).quantize(10^-places) (half-even) as a plain string. */
export function quantizeText(text: string, places: number): string {
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(text)!;
  const neg = m[1] === '-';
  let coef = BigInt(m[2]! + (m[3] ?? ''));
  let scale = (m[3] ?? '').length - Number(m[4] ?? 0);
  if (scale < 0) { coef *= 10n ** BigInt(-scale); scale = 0; }
  if (scale > places) {
    const div = 10n ** BigInt(scale - places);
    let q = coef / div; const r = coef % div;
    if (r * 2n > div || (r * 2n === div && q % 2n === 1n)) q += 1n;
    coef = q;
  } else coef *= 10n ** BigInt(places - scale);
  let s = coef.toString().padStart(places + 1, '0');
  if (places) s = `${s.slice(0, -places)}.${s.slice(-places)}`;
  return (neg && coef !== 0n ? '-' : neg ? '-' : '') + s;
}

export function dateField(o: { required?: boolean; allowNull?: boolean } = {}): Field {
  return {
    required: o.required, allowNull: o.allowNull,
    toInternal(v) {
      let parsed: string | null = null;
      try { parsed = parseDate(v); } catch { parsed = null; }
      if (parsed === null) fail('Date has wrong format. Use one of these formats instead: YYYY-MM-DD.');
      return parsed;
    },
  };
}

/** PrimaryKeyRelatedField(queryset=<table>.objects.all()) → the row. */
export function pkField(table: string, o: { required?: boolean; allowNull?: boolean } = {}): Field {
  return {
    required: o.required, allowNull: o.allowNull,
    async toInternal(v) {
      const bad = () => fail(`Incorrect type. Expected pk value, received ${pyTypeName(v)}.`);
      if (typeof v === 'boolean') return bad();
      let n: bigint;
      if (typeof v === 'number') { if (!Number.isFinite(v)) return bad(); n = BigInt(Math.trunc(v)); }
      else if (typeof v === 'string') {
        const t = pyStrip(v);
        if (!/^[+-]?\d+(?:_\d+)*$/.test(t)) return bad();
        n = BigInt(t.replace(/_/g, ''));
      } else return bad();
      const missing = () => fail(`Invalid pk "${pyStr(v)}" - object does not exist.`);
      if (n > 9223372036854775807n || n < -9223372036854775808n) return missing();
      const row = await db.selectFrom(table as never).selectAll().where(sql.ref('id'), '=', Number(n)).executeTakeFirst();
      if (!row) return missing();
      return row;
    },
  };
}

/** ListField(child=IntegerField()) */
export function intListField(o: { required?: boolean } = {}): Field {
  const child = integerField({ min: null, max: null });
  return {
    required: o.required,
    toInternal(v) {
      if (typeof v === 'string' || !Array.isArray(v)) {
        fail(`Expected a list of items but got type "${pyTypeName(v)}".`);
      }
      const errors: Record<string, unknown> = {};
      const out: number[] = [];
      (v as unknown[]).forEach((item, i) => {
        try {
          if (item === null) throw new FieldInvalid([NULL_MSG]);
          out.push(child.toInternal(item) as number);
        } catch (e) {
          if (e instanceof FieldInvalid) errors[String(i)] = e.detail; else throw e;
        }
      });
      if (Object.keys(errors).length) throw new FieldInvalid(errors);
      return out;
    },
  };
}

/** serializers.JSONField (binary=False). */
export function jsonField(o: { required?: boolean; allowNull?: boolean; default?: unknown } = {}): Field {
  return {
    required: o.required, allowNull: o.allowNull, default: o.default,
    toInternal(v) {
      if ((v as { __jsonString?: boolean })?.__jsonString) {
        try { return JSON.parse((v as { value: string }).value); } catch { return fail('Value must be valid JSON.'); }
      }
      return v;
    },
  };
}

/** ImageField / FileField(max_length=100 for the name). Returns the multer file. */
export function fileField(o: { required?: boolean; allowNull?: boolean; image?: boolean; maxLength?: number } = {}): Field {
  return {
    required: o.required, allowNull: o.allowNull, requiredMessage: 'No file was submitted.',
    toInternal(v) {
      if (!isMultipartFile(v)) return fail('The submitted data was not a file. Check the encoding type on the form.');
      const name = v.originalname;
      if (!name) fail('No filename could be determined.');
      const max = o.maxLength ?? 100;
      if ([...name].length > max) fail(`Ensure this filename has at most ${max} characters (it has ${[...name].length}).`);
      if (!v.size) fail('The submitted file is empty.');
      if (o.image) {
        try { imageSize(v.buffer); } catch {
          fail('Upload a valid image. The file you uploaded was either not an image or a corrupted image.');
        }
      }
      return v;
    },
  };
}

export type Spec = Record<string, Field>;

export interface ValidateResult { errors: Record<string, unknown> | null; values: Record<string, unknown> }

/** "Invalid data. Expected a dictionary, but got X." */
export function notADict(data: unknown): Record<string, unknown> | null {
  if (data === null || typeof data !== 'object' || Array.isArray(data) || isMultipartFile(data)) {
    return { non_field_errors: [`Invalid data. Expected a dictionary, but got ${pyTypeName(data)}.`] };
  }
  return null;
}

/**
 * Serializer.is_valid() field phase (to_internal_value): returns field
 * errors or validated values (defaults applied). `validate` (object-level)
 * is the caller's job once errors is null.
 */
export async function runFields(rd: { data: unknown; html: boolean }, spec: Spec, opts: { partial?: boolean } = {}): Promise<ValidateResult> {
  const bad = notADict(rd.data);
  if (bad) return { errors: bad, values: {} };
  const d = rd.data as Record<string, unknown>;
  const errors: Record<string, unknown> = {};
  const values: Record<string, unknown> = {};
  for (const [name, f] of Object.entries(spec)) {
    if (f.readOnly) continue;
    // Field.get_value
    let raw: unknown;
    if (rd.html) {
      if (!(name in d)) raw = opts.partial ? empty : (f.defaultEmptyHtml ?? empty);
      else {
        raw = d[name];
        if (raw === '' && f.allowNull) raw = f.allowBlank ? '' : null;
        else if (raw === '' && f.required === false) raw = f.allowBlank ? '' : empty;
      }
    } else raw = name in d ? d[name] : empty;
    // validate_empty_values
    if (raw === empty) {
      if (opts.partial) continue;
      if (f.default !== undefined) { values[name] = typeof f.default === 'function' ? (f.default as () => unknown)() : f.default; continue; }
      if (f.required !== false) errors[name] = [f.requiredMessage ?? REQUIRED_MSG];
      continue;
    }
    if (raw === null) {
      if (!f.allowNull) errors[name] = [NULL_MSG];
      else values[name] = null;
      continue;
    }
    if (f.charLike && (raw === '' || (typeof raw === 'string' || typeof raw === 'number') && pyStrip(pyStr(raw)) === '')) {
      if (!f.allowBlank) errors[name] = ['This field may not be blank.'];
      else values[name] = '';
      continue;
    }
    try {
      const input = rd.html && name in d && isJsonSpec(f) && typeof raw === 'string'
        ? { __jsonString: true, value: raw } : raw;
      const v = await f.toInternal(input);
      for (const val of f.validators ?? []) await val(v);
      values[name] = v;
    } catch (e) {
      if (e instanceof FieldInvalid) errors[name] = e.detail;
      else throw e;
    }
  }
  return { errors: Object.keys(errors).length ? errors : null, values };
}

const JSON_FIELDS = new WeakSet<Field>();
function isJsonSpec(f: Field): boolean { return JSON_FIELDS.has(f); }
/** Marks a jsonField so HTML (form) input is parsed as a JSON string, like DRF's JSONString. */
export function htmlJson(f: Field): Field { JSON_FIELDS.add(f); return f; }
