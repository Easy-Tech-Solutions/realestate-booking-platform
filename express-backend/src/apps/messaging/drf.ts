// DRF Serializer input validation (rest_framework 3.18 semantics) for the
// messaging / support / hostapplications ports: field get_value (JSON vs
// html/QueryDict input), validate_empty_values, CharField/EmailField/
// ChoiceField/IntegerField/BooleanField/DecimalField/PrimaryKeyRelatedField/
// FileField/ImageField/ListField, per-field validate_<name> hooks and the
// object-level validate(), with DRF's exact error messages and shapes.

import { IMAGE_EXTENSIONS } from '../../lib/upload.js';
import { imageSize } from 'image-size';
import { isValidEmail } from '../../lib/validators.js';
import { QueryDict, Upload } from './request.js';
import { pyDecimal, pyLen, pyParseInt, pySplitext, pyStr, pyStrip } from './pyutil.js';

export const EMPTY = Symbol('empty');
export class SkipField extends Error {}

/** serializers.ValidationError raised inside a field / validate hook. */
export class FieldError extends Error {
  constructor(public detail: unknown) { super(typeof detail === 'string' ? detail : JSON.stringify(detail)); }
}

export interface Ctx { partial: boolean; html: boolean }

export interface Field {
  required?: boolean;
  default?: unknown; // EMPTY when absent
  allowNull?: boolean;
  readOnly?: boolean;
  /** error_messages['required'] */
  requiredMsg?: string;
  /** CharField(allow_blank) — used by get_value for '' html input. */
  allowBlankHtml?: boolean;
  /** Field.default_empty_html */
  defaultEmptyHtml?: unknown;
  /** get_value override (ListField). */
  getValue?(data: QueryDict, name: string, ctx: Ctx): unknown;
  /** run_validation override hook: return [true, value] to short-circuit. */
  preValidate?(data: unknown): [boolean, unknown];
  toInternal(data: unknown): Promise<unknown> | unknown;
  /** validators run on the internal value; all messages collected. */
  validators?: ((v: unknown) => string | null)[];
}

const fail = (msg: string): never => { throw new FieldError([msg]); };

// ---- messages / python reprs ------------------------------------------------------------------

/** type(data).__name__ for a JSON / QueryDict value. */
export function pyTypeName(v: unknown): string {
  if (v === null || v === undefined) return 'NoneType';
  if (typeof v === 'string') return 'str';
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'float';
  if (Array.isArray(v)) return 'list';
  if (v instanceof Upload) return 'InMemoryUploadedFile';
  return 'dict';
}

// ---- field factories -----------------------------------------------------------------------------

interface CharOpts { required?: boolean; default?: unknown; allowBlank?: boolean; allowNull?: boolean; maxLength?: number; minLength?: number; trim?: boolean }

function charValidators(o: CharOpts): ((v: unknown) => string | null)[] {
  const vs: ((v: unknown) => string | null)[] = [];
  if (o.maxLength !== undefined) vs.push((v) => (pyLen(String(v)) > o.maxLength! ? `Ensure this field has no more than ${o.maxLength} characters.` : null));
  if (o.minLength !== undefined) vs.push((v) => (pyLen(String(v)) < o.minLength! ? `Ensure this field has at least ${o.minLength} characters.` : null));
  vs.push((v) => (String(v).includes('\u0000') ? 'Null characters are not allowed.' : null));
  vs.push((v) => {
    const m = /[\ud800-\udfff]/.exec(String(v).replace(/[\ud800-\udbff][\udc00-\udfff]/g, ''));
    return m ? `Surrogate characters are not allowed: U+${m[0].charCodeAt(0).toString(16).toUpperCase()}.` : null;
  });
  return vs;
}

export function CharField(o: CharOpts = {}): Field {
  const trim = o.trim ?? true;
  return {
    required: o.required ?? (o.default === undefined),
    default: o.default === undefined ? EMPTY : o.default,
    allowNull: o.allowNull ?? false,
    allowBlankHtml: !!o.allowBlank,
    preValidate(data) {
      if (data === EMPTY || data === null) return [false, data];
      const s = typeof data === 'string' ? data : pyStr(data);
      if (data === '' || (trim && pyStrip(s) === '')) {
        if (!o.allowBlank) fail('This field may not be blank.');
        return [true, ''];
      }
      return [false, data];
    },
    toInternal(data) {
      if (typeof data === 'boolean' || !(typeof data === 'string' || typeof data === 'number')) fail('Not a valid string.');
      const v = pyStr(data);
      return trim ? pyStrip(v) : v;
    },
    validators: charValidators(o),
  };
}

export function EmailField(o: CharOpts = {}): Field {
  const f = CharField(o);
  f.validators = [...f.validators!, (v) => (isValidEmail(String(v)) ? null : 'Enter a valid email address.')];
  return f;
}

export function ChoiceField(choices: string[], o: { required?: boolean; default?: unknown; allowBlank?: boolean } = {}): Field {
  return {
    required: o.required ?? (o.default === undefined),
    default: o.default === undefined ? EMPTY : o.default,
    toInternal(data) {
      if (data === '' && o.allowBlank) return '';
      const s = pyStr(data);
      if (!choices.includes(s)) fail(`"${s}" is not a valid choice.`);
      return s;
    },
  };
}

export function IntegerField(o: { required?: boolean; allowNull?: boolean; default?: unknown } = {}): Field {
  return {
    required: o.required ?? (o.default === undefined),
    default: o.default === undefined ? EMPTY : o.default,
    allowNull: o.allowNull ?? false,
    toInternal(data) {
      if (typeof data === 'string' && data.length > 1000) fail('String value too large.');
      const s = pyStr(data).replace(/\.0*[\t\n\x0b\x0c\r ]*$/u, '');
      const v = typeof data === 'boolean' ? null : pyParseInt(s);
      if (v === null) fail('A valid integer is required.');
      return v;
    },
  };
}

export function BooleanField(o: { required?: boolean; default?: unknown } = {}): Field {
  return {
    required: o.required ?? (o.default === undefined),
    default: o.default === undefined ? EMPTY : o.default,
    defaultEmptyHtml: false,
    toInternal(data) {
      const TRUE = ['t', 'T', 'y', 'Y', 'yes', 'Yes', 'YES', 'true', 'True', 'TRUE', 'on', 'On', 'ON', '1', 1, true];
      const FALSE = ['f', 'F', 'n', 'N', 'no', 'No', 'NO', 'false', 'False', 'FALSE', 'off', 'Off', 'OFF', '0', 0, false];
      if (typeof data === 'number' && !Number.isInteger(data)) {
        if (data === 1) return true;
        if (data === 0) return false;
      }
      if (TRUE.includes(data as never)) return true;
      if (FALSE.includes(data as never)) return false;
      return fail('Must be a valid boolean.');
    },
  };
}

/** DecimalField(max_digits, decimal_places) → internal value is the quantized '{:f}' string. */
export function DecimalField(maxDigits: number, decimalPlaces: number, o: { required?: boolean } = {}): Field {
  const maxWhole = maxDigits - decimalPlaces;
  return {
    required: o.required ?? true,
    default: EMPTY,
    toInternal(data) {
      const s = pyStrip(pyStr(data));
      if (s.length > 1000) fail('String value too large.');
      const d = pyDecimal(s);
      if (!d || d.special) fail('A valid number is required.');
      const nd = d!.digits.length;
      let total: number; let whole: number; let places: number;
      if (d!.exp >= 0) { total = nd + d!.exp; whole = total; places = 0; }
      else if (nd > -d!.exp) { total = nd; whole = total + d!.exp; places = -d!.exp; }
      else { total = -d!.exp; whole = 0; places = total; }
      if (total > maxDigits) fail(`Ensure that there are no more than ${maxDigits} digits in total.`);
      if (places > decimalPlaces) fail(`Ensure that there are no more than ${decimalPlaces} decimal places.`);
      if (whole > maxWhole) fail(`Ensure that there are no more than ${maxWhole} digits before the decimal point.`);
      // quantize (exact here — precision already validated)
      let coef = BigInt(d!.digits);
      let scale = -d!.exp;
      if (scale < 0) { coef *= 10n ** BigInt(-scale); scale = 0; }
      coef *= 10n ** BigInt(decimalPlaces - scale);
      let str = coef.toString().padStart(decimalPlaces + 1, '0');
      str = decimalPlaces ? `${str.slice(0, -decimalPlaces)}.${str.slice(-decimalPlaces)}` : str;
      return (d!.sign ? '-' : '') + str;
    },
  };
}

/** PrimaryKeyRelatedField(queryset=Model.objects.all()); `lookup(pk)` resolves the row or null. */
export function PrimaryKeyRelatedField<T>(lookup: (pk: bigint) => Promise<T | null>, o: { required?: boolean; allowNull?: boolean } = {}): Field {
  return {
    required: o.required ?? true,
    default: EMPTY,
    allowNull: o.allowNull ?? false,
    async toInternal(data) {
      if (typeof data === 'boolean') fail('Incorrect type. Expected pk value, received bool.');
      let pk: bigint | null = null;
      if (typeof data === 'number' && Number.isFinite(data)) pk = BigInt(Math.trunc(data));
      else if (typeof data === 'string') pk = pyParseInt(data);
      if (pk === null) fail(`Incorrect type. Expected pk value, received ${pyTypeName(data)}.`);
      const row = pk! > 9223372036854775807n || pk! < -9223372036854775808n ? null : await lookup(pk!);
      if (!row) fail(`Invalid pk "${pyStr(data)}" - object does not exist.`);
      return row;
    },
  };
}

export function FileField(o: { required?: boolean; maxLength?: number; allowNull?: boolean } = {}): Field {
  return {
    required: o.required ?? true,
    default: EMPTY,
    allowNull: o.allowNull ?? false,
    requiredMsg: 'No file was submitted.',
    toInternal(data) {
      if (!(data instanceof Upload)) return fail('The submitted data was not a file. Check the encoding type on the form.');
      if (!data.name) fail('No filename could be determined.');
      if (!data.size) fail('The submitted file is empty.');
      if (o.maxLength && pyLen(data.name) > o.maxLength) fail(`Ensure this filename has at most ${o.maxLength} characters (it has ${pyLen(data.name)}).`);
      return data;
    },
  };
}

/** Pillow 12.3's registered extensions in a running Django process (Image.open → preinit() plugins first, then init()). */
const IMAGE_EXT_SET = new Set(IMAGE_EXTENSIONS);

/** Whether Pillow would open + verify() this file (approximated with image-size; SVG isn't a Pillow format). */
export function looksLikeImage(buf: Buffer): boolean {
  try {
    const r = imageSize(buf);
    return !!r && r.type !== 'svg' && !!r.width && !!r.height;
  } catch {
    return false;
  }
}

export function ImageField(o: { required?: boolean; maxLength?: number } = {}): Field {
  const base = FileField(o);
  return {
    ...base,
    toInternal(data) {
      const f = base.toInternal(data) as Upload;
      if (!looksLikeImage(f.buffer)) fail('Upload a valid image. The file you uploaded was either not an image or a corrupted image.');
      // FileExtensionValidator: Path(name).suffix
      const suffix = pySplitext(f.name)[1];
      const ext = (suffix.length > 1 ? suffix.slice(1) : '').toLowerCase();
      if (!IMAGE_EXT_SET.has(ext)) fail(`File extension “${ext}” is not allowed. Allowed extensions are: ${IMAGE_EXTENSIONS.join(', ')}.`);
      return f;
    },
  };
}

/** ListField(child=...). Child errors come back as {index: [msgs]}. */
export function ListField(child: Field, o: { required?: boolean } = {}): Field {
  return {
    required: o.required ?? true,
    default: EMPTY,
    getValue(data, name) {
      const val = data.getlist(name);
      if (val.length > 0) return val;
      // html.parse_html_list(data, prefix=name) — "name[0]" style keys
      const re = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\[([0-9]+)\\](.*)$`);
      const items = new Map<number, unknown>();
      for (const [k, vs] of data.lists) {
        const m = re.exec(k);
        if (!m || m[2]) continue;
        items.set(Number(m[1]), vs[vs.length - 1]);
      }
      if (!items.size) return EMPTY;
      return [...items.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
    },
    async toInternal(data) {
      if (typeof data === 'string' || data === null || typeof data !== 'object' || !Array.isArray(data)) {
        if (data instanceof Upload) fail(`Expected a list of items but got type "${pyTypeName(data)}".`);
        if (typeof data === 'string' || (typeof data === 'object' && data !== null)) fail(`Expected a list of items but got type "${pyTypeName(data)}".`);
        fail(`Expected a list of items but got type "${pyTypeName(data)}".`);
      }
      const errors: Record<string, unknown> = {};
      const out: unknown[] = [];
      for (const [i, item] of (data as unknown[]).entries()) {
        try {
          out.push(await runField(child, item));
        } catch (e) {
          if (e instanceof FieldError) errors[String(i)] = e.detail;
          else throw e;
        }
      }
      if (Object.keys(errors).length) throw new FieldError(errors);
      return out;
    },
  };
}

// ---- running ----------------------------------------------------------------------------------------

async function runField(f: Field, data: unknown): Promise<unknown> {
  // validate_empty_values
  if (f.readOnly) throw new SkipField();
  if (data === EMPTY) {
    if (f.required) fail(f.requiredMsg ?? 'This field is required.');
    if (f.default === EMPTY || f.default === undefined) throw new SkipField();
    return f.default;
  }
  if (data === null || data === undefined) {
    if (!f.allowNull) fail('This field may not be null.');
    return null;
  }
  if (f.preValidate) {
    const [done, v] = f.preValidate(data);
    if (done) return v;
  }
  const value = await f.toInternal(data);
  const errors: string[] = [];
  for (const v of f.validators ?? []) {
    const m = v(value);
    if (m) errors.push(m);
  }
  if (errors.length) throw new FieldError(errors);
  return value;
}

/** Field.get_value(dictionary) */
function getValue(f: Field, name: string, data: unknown, ctx: Ctx): unknown {
  if (data instanceof QueryDict) {
    if (f.getValue) return f.getValue(data, name, ctx);
    if (!data.has(name)) {
      if (ctx.partial) return EMPTY;
      return f.defaultEmptyHtml !== undefined ? f.defaultEmptyHtml : EMPTY;
    }
    const ret = data.get(name);
    const allowBlank = f.allowBlankHtml;
    if (ret === '' && f.allowNull) return allowBlank ? '' : null;
    if (ret === '' && !f.required) return allowBlank ? '' : EMPTY;
    return ret;
  }
  const d = data as Record<string, unknown>;
  return name in d ? d[name] : EMPTY;
}

export type FieldSpecs = [name: string, field: Field, validate?: (v: unknown) => unknown | Promise<unknown>][];

/**
 * serializer.is_valid(): {errors} in DRF's shape, or {values} (validated_data).
 * `validate(attrs)` is the object-level hook (throw FieldError(string | dict)).
 */
export async function validate(
  data: unknown,
  specs: FieldSpecs,
  opts: { partial?: boolean; validate?: (attrs: Record<string, unknown>) => unknown | Promise<unknown> } = {},
): Promise<{ errors: Record<string, unknown> | null; values: Record<string, unknown> }> {
  if (data === null || data === undefined) return { errors: { non_field_errors: ['No data provided'] }, values: {} };
  if (!(data instanceof QueryDict) && (typeof data !== 'object' || Array.isArray(data))) {
    return { errors: { non_field_errors: [`Invalid data. Expected a dictionary, but got ${pyTypeName(data)}.`] }, values: {} };
  }
  const ctx: Ctx = { partial: !!opts.partial, html: data instanceof QueryDict };
  const errors: Record<string, unknown> = {};
  const values: Record<string, unknown> = {};
  for (const [name, field, hook] of specs) {
    if (field.readOnly) continue;
    const primitive = getValue(field, name, data, ctx);
    try {
      if (primitive === EMPTY && ctx.partial) throw new SkipField();
      let v = await runField(field, primitive);
      if (hook) v = await hook(v);
      values[name] = v;
    } catch (e) {
      if (e instanceof SkipField) continue;
      if (e instanceof FieldError) { errors[name] = typeof e.detail === 'string' ? [e.detail] : e.detail; continue; }
      throw e;
    }
  }
  if (Object.keys(errors).length) return { errors, values };
  if (opts.validate) {
    try {
      const r = await opts.validate(values);
      if (r && typeof r === 'object') return { errors: null, values: r as Record<string, unknown> };
    } catch (e) {
      if (!(e instanceof FieldError)) throw e;
      const d = e.detail;
      if (typeof d === 'string') return { errors: { non_field_errors: [d] }, values };
      if (Array.isArray(d)) return { errors: { non_field_errors: d }, values };
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(d as Record<string, unknown>)) out[k] = typeof v === 'string' ? [v] : v;
      return { errors: out, values };
    }
  }
  return { errors: null, values };
}

/** Raise serializers.ValidationError('msg') from a validate_<field> hook. */
export const invalid = (msg: string): never => { throw new FieldError([msg]); };
