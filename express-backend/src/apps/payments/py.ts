// Python built-in behaviour the payments views rely on: str() of JSON values,
// str.strip(), int(str), float(x), and Python float repr for amounts.

import { INT_WS, pyFloatRepr, pyIntStr, pyRepr } from '../../lib/py.js';

export { BIGINT_MAX, inBigintRange, pyStrip } from '../../lib/py.js';

/** repr(float) — lib/py.ts pyFloatRepr. */
export const pyFloatStr = pyFloatRepr;

/** str(value) for a value from request.data (JSON numbers: ints as ints, others as Python floats). */
export function pyStr(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isInteger(v)) return Number.isSafeInteger(v) ? String(v) : BigInt(v).toString();
  return pyRepr(v);
}

/** Python type name of a request.data value (for error messages). */
export function pyTypeName(v: unknown): string {
  if (v === null || v === undefined) return 'NoneType';
  if (Array.isArray(v)) return 'list';
  if (typeof v === 'string') return 'str';
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'float';
  return 'dict';
}

/** int(str) — lib/py.ts pyIntStr. Returns null on ValueError. */
export const pyIntFromStr = pyIntStr;

/** int(x) for a query param or JSON value; null = ValueError/TypeError. */
export function pyInt(v: unknown): bigint | null {
  if (typeof v === 'boolean') return v ? 1n : 0n;
  if (typeof v === 'number') return Number.isFinite(v) ? BigInt(Math.trunc(v)) : null;
  if (typeof v === 'string') return pyIntFromStr(v);
  return null;
}

const NUM_WS = new RegExp(`^[${INT_WS}]+|[${INT_WS}]+$`, 'gu');

/** float(x); null = ValueError/TypeError. */
export function pyFloat(v: unknown): number | null {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return null;
  const s = v.replace(NUM_WS, ''); // float() strips like int() (INT_WS)
  const sp = /^([+-]?)(inf|infinity|nan)$/i.exec(s);
  if (sp) return sp[2]!.toLowerCase() === 'nan' ? NaN : sp[1] === '-' ? -Infinity : Infinity;
  const D = '\\d(?:_?\\d)*';
  if (!new RegExp(`^[+-]?(?:${D}(?:\\.(?:${D})?)?|\\.${D})(?:[eE][+-]?${D})?$`).test(s)) return null;
  return Number(s.replace(/_/g, ''));
}

/** Python list repr of strings, e.g. ['a', 'b']. */
export function pyListRepr(items: string[]): string {
  return pyRepr(items);
}
