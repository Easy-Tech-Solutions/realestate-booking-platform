// DRF serializer input validation for the payments serializers — CharField,
// IntegerField, UUIDField, DecimalField, ChoiceField, BooleanField — with
// DRF's exact run_validation order, messages and QueryDict (HTML form) rules.

import { DecimalException, PyDecimal } from './decimal.js';
import { pyStr, pyStrip, pyTypeName } from './py.js';

export class FieldError extends Error {
  constructor(public messages: string[] | Record<string, unknown>) { super(Array.isArray(messages) ? messages[0] : 'invalid'); }
}
/** serializers.ValidationError("msg") inside validate_<field>() / validate(). */
export const fail = (msg: string): never => { throw new FieldError([msg]); };

export type FieldKind = 'char' | 'int' | 'uuid' | 'decimal' | 'choice' | 'bool';

export interface FieldSpec {
  name: string;
  kind: FieldKind;
  required?: boolean; // default true
  allowBlank?: boolean;
  allowNull?: boolean;
  maxLength?: number;
  maxDigits?: number;
  decimalPlaces?: number;
  choices?: string[];
  /** Validators run after to_internal_value (e.g. UniqueValidator); return messages. */
  validators?: ((v: unknown) => Promise<string[]> | string[])[];
  /** validate_<field>(value) */
  validate?: (v: any) => unknown | Promise<unknown>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const EMPTY = Symbol('empty');
class Skip extends Error {}

/** True when request.data came from a form (DRF html.is_html_input). */
export const HTML_INPUT = Symbol('html');
export function markHtml(data: Record<string, unknown>): Record<string, unknown> {
  Object.defineProperty(data, HTML_INPUT, { value: true, enumerable: false });
  return data;
}
const isHtml = (d: object) => !!(d as Record<symbol, unknown>)[HTML_INPUT];

function getValue(spec: FieldSpec, data: Record<string, unknown>, partial: boolean): unknown {
  const required = spec.required ?? true;
  if (isHtml(data)) {
    if (!(spec.name in data)) {
      if (partial) return EMPTY;
      return spec.kind === 'bool' ? false : EMPTY;
    }
    const ret = data[spec.name];
    if (ret === '' && spec.allowNull) return spec.allowBlank ? '' : null;
    if (ret === '' && !required) return spec.allowBlank ? '' : EMPTY;
    return ret;
  }
  return spec.name in data ? data[spec.name] : EMPTY;
}

const TRUE_VALUES = new Set<unknown>(['t', 'T', 'y', 'Y', 'yes', 'Yes', 'YES', 'true', 'True', 'TRUE', 'on', 'On', 'ON', '1', 1, true]);
const FALSE_VALUES = new Set<unknown>(['f', 'F', 'n', 'N', 'no', 'No', 'NO', 'false', 'False', 'FALSE', 'off', 'Off', 'OFF', '0', 0, false]);

/** uuid.UUID(hex=...) / UUID(int=...) → canonical string, or null (ValueError). */
export function parseUuid(v: unknown): string | null {
  let n: bigint | null = null;
  if (typeof v === 'number' || typeof v === 'boolean') {
    if (typeof v === 'number' && !Number.isInteger(v)) return null;
    n = BigInt(typeof v === 'boolean' ? (v ? 1 : 0) : v);
  } else if (typeof v === 'string') {
    let hex = v.replace(/urn:/g, '').replace(/uuid:/g, '');
    hex = hex.replace(/^[{}]+|[{}]+$/g, '').replace(/-/g, '');
    if ([...hex].length !== 32) return null;
    // int(hex, 16): whitespace, sign, optional 0x, single underscores.
    const m = /^\s*([+-]?)(?:0[xX]_?)?([0-9a-fA-F](?:_?[0-9a-fA-F])*)\s*$/.exec(hex);
    if (!m) return null;
    n = BigInt('0x' + m[2]!.replace(/_/g, ''));
    if (m[1] === '-') n = -n;
  } else return null;
  if (n < 0n || n >= 1n << 128n) return null;
  const h = n.toString(16).padStart(32, '0');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** format(data) as DRF's error message formatting does (str()). */
const fmt = (v: unknown) => pyStr(v);

function toInternal(spec: FieldSpec, data: unknown): unknown {
  switch (spec.kind) {
    case 'char': {
      if (typeof data === 'boolean' || !(typeof data === 'string' || typeof data === 'number')) throw new FieldError(['Not a valid string.']);
      return pyStrip(pyStr(data));
    }
    case 'int': {
      if (typeof data === 'string' && [...data].length > 1000) throw new FieldError(['String value too large.']);
      const s = pyStr(data).replace(/\.0*\s*$/, '');
      const m = /^\s*([+-]?)(\d(?:_?\d)*)\s*$/.exec(s);
      if (typeof data === 'boolean' || data === null || typeof data === 'object' || !m) throw new FieldError(['A valid integer is required.']);
      const n = BigInt(m[2]!.replace(/_/g, ''));
      return m[1] === '-' ? -n : n;
    }
    case 'uuid': {
      const u = parseUuid(data);
      if (u === null) throw new FieldError(['Must be a valid UUID.']);
      return u;
    }
    case 'decimal': {
      const s = pyStrip(pyStr(data));
      if ([...s].length > 1000) throw new FieldError(['String value too large.']);
      let value: PyDecimal;
      try { value = PyDecimal.parse(s); } catch (e) {
        if (e instanceof DecimalException) throw new FieldError(['A valid number is required.']);
        throw e;
      }
      if (!value.isFinite()) throw new FieldError(['A valid number is required.']);
      const { digits, exponent } = value.asTuple();
      let total: number; let whole: number; let places: number;
      if (exponent >= 0) { total = digits.length + exponent; whole = total; places = 0; }
      else if (digits.length > -exponent) { total = digits.length; whole = total + exponent; places = -exponent; }
      else { total = -exponent; whole = 0; places = total; }
      const maxDigits = spec.maxDigits!; const dp = spec.decimalPlaces!;
      if (total > maxDigits) throw new FieldError([`Ensure that there are no more than ${maxDigits} digits in total.`]);
      if (places > dp) throw new FieldError([`Ensure that there are no more than ${dp} decimal places.`]);
      if (whole > maxDigits - dp) throw new FieldError([`Ensure that there are no more than ${maxDigits - dp} digits before the decimal point.`]);
      return value.quantize(-dp, maxDigits);
    }
    case 'choice': {
      if (data === '' && spec.allowBlank) return '';
      const s = pyStr(data);
      if (typeof data === 'object' || !spec.choices!.includes(s)) throw new FieldError([`"${fmt(data)}" is not a valid choice.`]);
      return s;
    }
    case 'bool': {
      if (TRUE_VALUES.has(data)) return true;
      if (FALSE_VALUES.has(data)) return false;
      throw new FieldError(['Must be a valid boolean.']);
    }
  }
}

async function runValidation(spec: FieldSpec, data: unknown, partial: boolean): Promise<unknown> {
  // CharField.run_validation: blank check comes first.
  if (spec.kind === 'char' && data !== EMPTY && (data === '' || pyStrip(pyStr(data)) === '')) {
    if (!spec.allowBlank) throw new FieldError(['This field may not be blank.']);
    return '';
  }
  if (data === EMPTY) {
    if (partial) throw new Skip();
    if (spec.required ?? true) throw new FieldError(['This field is required.']);
    throw new Skip();
  }
  if (data === null) {
    if (!spec.allowNull) throw new FieldError(['This field may not be null.']);
    return null;
  }
  const value = toInternal(spec, data);
  const errors: string[] = [];
  for (const v of spec.validators ?? []) errors.push(...(await v(value)));
  if (spec.kind === 'char') {
    const s = value as string;
    if (spec.maxLength !== undefined && [...s].length > spec.maxLength) errors.push(`Ensure this field has no more than ${spec.maxLength} characters.`);
    if (s.includes('\u0000')) errors.push('Null characters are not allowed.');
    const sur = /[\ud800-\udfff]/.exec(s);
    if (sur) errors.push(`Surrogate characters are not allowed: U+${sur[0].charCodeAt(0).toString(16).toUpperCase()}.`);
  }
  if (errors.length) throw new FieldError(errors);
  return value;
}

/**
 * serializer.is_valid(): {errors} in DRF's serializer.errors shape, or {values}
 * (validated_data, in field order). `validate` is the serializer-level hook.
 */
export async function validate(
  data: unknown,
  specs: FieldSpec[],
  opts: { partial?: boolean; validate?: (attrs: Record<string, unknown>) => unknown | Promise<unknown> } = {},
): Promise<{ errors: Record<string, unknown> | null; values: Record<string, unknown> }> {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { errors: { non_field_errors: [`Invalid data. Expected a dictionary, but got ${pyTypeName(data)}.`] }, values: {} };
  }
  const d = data as Record<string, unknown>;
  const errors: Record<string, unknown> = {};
  const values: Record<string, unknown> = {};
  for (const spec of specs) {
    try {
      let v = await runValidation(spec, getValue(spec, d, !!opts.partial), !!opts.partial);
      if (spec.validate) v = await spec.validate(v);
      values[spec.name] = v;
    } catch (e) {
      if (e instanceof Skip) continue;
      if (e instanceof FieldError) { errors[spec.name] = e.messages; continue; }
      throw e;
    }
  }
  if (Object.keys(errors).length) return { errors, values: {} };
  if (opts.validate) {
    try { await opts.validate(values); } catch (e) {
      if (e instanceof FieldError) {
        const m = e.messages;
        if (Array.isArray(m)) return { errors: { non_field_errors: m }, values: {} };
        return { errors: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Array.isArray(v) ? v : [v]])), values: {} };
      }
      throw e;
    }
  }
  return { errors: null, values };
}
