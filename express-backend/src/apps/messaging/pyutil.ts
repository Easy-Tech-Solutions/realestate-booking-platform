// Python-semantics helpers shared by the messaging / support / hostapplications /
// chatbot ports (str.strip, set iteration order, os.path.splitext, Decimal,
// uuid.UUID parsing, int() parsing, Unicode-aware \w / \s / \d regex pieces).

import { inBigintRange, PY_WS, pyIntStr, pyStr, pyStrip } from '../../lib/py.js';

export { inBigintRange, PY_WS, pyStr, pyStrip };

/** len(str) — code points. */
export function pyLen(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/** s[:n] on code points. */
export function pySlice(s: string, n: number): string {
  return Array.from(s).slice(0, n).join('');
}

/** Python regex \w (str patterns): Unicode letters, numbers and underscore. */
export const PY_W = '\\p{L}\\p{N}_';
/** Python regex \d (str patterns): Unicode decimal digits. */
export const PY_D = '\\p{Nd}';

/**
 * Translates the small subset of Python `re` syntax used by this codebase's
 * patterns to a JS RegExp with Python's Unicode semantics: \b, \w, \W, \d, \D, \s, \S.
 */
export function pyRegex(source: string, flags = ''): RegExp {
  let out = '';
  let inClass = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    if (c === '\\' && i + 1 < source.length) {
      const n = source[i + 1]!;
      i++;
      if (n === 'w') out += inClass ? PY_W : `[${PY_W}]`;
      else if (n === 'W') out += inClass ? '\\P{L}' /* unused inside classes */ : `[^${PY_W}]`;
      else if (n === 'd') out += inClass ? PY_D : `[${PY_D}]`;
      else if (n === 'D') out += inClass ? '\\P{Nd}' : '\\P{Nd}';
      else if (n === 's') out += inClass ? PY_WS : `[${PY_WS}]`;
      else if (n === 'S') out += `[^${PY_WS}]`;
      else if (n === 'b' && !inClass) out += `(?:(?<=[${PY_W}])(?![${PY_W}])|(?<![${PY_W}])(?=[${PY_W}]))`;
      else out += '\\' + n;
      continue;
    }
    if (c === '[' && !inClass) inClass = true;
    else if (c === ']' && inClass) inClass = false;
    out += c;
  }
  return new RegExp(out, flags.includes('u') ? flags : flags + 'u');
}

/** os.path.splitext */
export function pySplitext(p: string): [string, string] {
  const slash = p.lastIndexOf('/');
  const dot = p.lastIndexOf('.');
  if (dot > slash) {
    // skip all leading dots of the basename
    let i = slash + 1;
    while (i < dot && p[i] === '.') i++;
    if (i < dot) return [p.slice(0, dot), p.slice(dot)];
  }
  return [p, ''];
}

/** os.path.basename */
export function pyBasename(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1);
}

/**
 * Iteration order of a Python set built by adding these small non-negative
 * ints in order (CPython open addressing; hash(n) == n). Used to reproduce
 * the order Django's M2M add() inserts through-table rows in.
 */
export function pySetOrder(values: number[]): number[] {
  let mask = 7;
  let table: (number | null)[] = new Array(8).fill(null);
  let used = 0;
  const LINEAR_PROBES = 9;
  const insert = (tbl: (number | null)[], m: number, v: number, clean: boolean): boolean => {
    let perturb = v;
    let i = v & m;
    for (;;) {
      if (clean) {
        if (tbl[i] === null) { tbl[i] = v; return true; }
        if (i + LINEAR_PROBES <= m) {
          for (let j = 1; j <= LINEAR_PROBES; j++) if (tbl[i + j] === null) { tbl[i + j] = v; return true; }
        }
      } else {
        const probes = i + LINEAR_PROBES <= m ? LINEAR_PROBES : 0;
        for (let j = 0; j <= probes; j++) {
          const e = tbl[i + j];
          if (e === null || e === undefined) { tbl[i + j] = v; return true; }
          if (e === v) return false;
        }
      }
      perturb = Math.floor(perturb / 32);
      i = (i * 5 + 1 + perturb) & m;
    }
  };
  for (const v of values) {
    if (!insert(table, mask, v, false)) continue;
    used++;
    if (used * 5 >= mask * 3) {
      const minused = used > 50000 ? used * 2 : used * 4;
      let size = 8;
      while (size <= minused) size <<= 1;
      const old = table;
      table = new Array(size).fill(null);
      mask = size - 1;
      for (const e of old) if (e !== null) insert(table, mask, e, true);
    }
  }
  return table.filter((e): e is number => e !== null);
}

/** html.unescape — the common named entities plus numeric references. */
export function htmlUnescape(s: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return s.replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z]+);?/g, (m, body: string) => {
    if (body[0] === '#') {
      const cp = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(cp) || cp > 0x10ffff) return '�';
      if (cp === 0) return '�';
      return String.fromCodePoint(cp);
    }
    const v = named[body] ?? named[body.toLowerCase() === body ? body : ''];
    return v ?? m;
  });
}

/** Python str.isprintable() for one code point (approximation via Unicode categories). */
export function pyIsPrintable(ch: string): boolean {
  if (ch === ' ') return true;
  return !/[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]/u.test(ch);
}

// ---- int() -------------------------------------------------------------------------------

/** Python int(str) (base 10) — lib/py.ts pyIntStr. Null if invalid. */
export const pyParseInt = pyIntStr;


/**
 * IntegerField.get_prep_value(value) → int(value) for a model id lookup.
 * Returns the bigint, or throws a TypeError/ValueError-alike (→ 500) like Django.
 */
export function pyIntForLookup(v: unknown, field = 'id'): bigint {
  if (typeof v === 'boolean') return v ? 1n : 0n;
  if (typeof v === 'number' && Number.isFinite(v)) return BigInt(Math.trunc(v));
  if (typeof v === 'string') {
    const r = pyParseInt(v);
    if (r !== null) return r;
  }
  throw new Error(`Field '${field}' expected a number but got ${typeof v === 'string' ? `'${v}'` : pyStr(v)}.`);
}

// ---- Decimal ----------------------------------------------------------------------------

export interface PyDecimal { sign: 0 | 1; digits: string; exp: number; special?: 'inf' | 'nan' | 'snan' }

/** decimal.Decimal(str) — null when Python raises InvalidOperation. */
export function pyDecimal(s: string): PyDecimal | null {
  const t = pyStrip(s).replace(/(?<=\d)_(?=\d)/g, '');
  const sp = /^([+-]?)(inf|infinity|nan|snan)(\d*)$/i.exec(t);
  if (sp) {
    const kind = sp[2]!.toLowerCase();
    if (kind.startsWith('inf')) return sp[3] ? null : { sign: sp[1] === '-' ? 1 : 0, digits: '0', exp: 0, special: 'inf' };
    return { sign: sp[1] === '-' ? 1 : 0, digits: sp[3] || '0', exp: 0, special: kind === 'nan' ? 'nan' : 'snan' };
  }
  const m = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(t);
  if (!m) return null;
  const intPart = m[2] ?? '';
  const frac = m[3] ?? m[4] ?? '';
  let digits = (intPart + frac).replace(/^0+(?=\d)/, '');
  if (digits === '') digits = '0';
  return { sign: m[1] === '-' ? 1 : 0, digits, exp: Number(m[5] ?? 0) - frac.length };
}

/** str(Decimal) (Python's to-scientific-string). */
export function pyDecimalStr(d: PyDecimal): string {
  const sign = d.sign ? '-' : '';
  if (d.special === 'inf') return sign + 'Infinity';
  if (d.special === 'nan') return sign + 'NaN' + (d.digits === '0' ? '' : d.digits);
  if (d.special === 'snan') return sign + 'sNaN' + (d.digits === '0' ? '' : d.digits);
  const { digits, exp } = d;
  const leftdigits = exp + digits.length;
  let dotplace: number;
  if (exp <= 0 && leftdigits > -6) dotplace = leftdigits;
  else dotplace = 1;
  let intpart: string; let fracpart: string;
  if (dotplace <= 0) { intpart = '0'; fracpart = '.' + '0'.repeat(-dotplace) + digits; }
  else if (dotplace >= digits.length) { intpart = digits + '0'.repeat(dotplace - digits.length); fracpart = ''; }
  else { intpart = digits.slice(0, dotplace); fracpart = '.' + digits.slice(dotplace); }
  const e = leftdigits - dotplace;
  const expStr = e === 0 ? '' : `E${e > 0 ? '+' : '-'}${Math.abs(e)}`;
  return sign + intpart + fracpart + expStr;
}

/** Exact value as {coef, scale} (value = coef × 10^-scale), scale ≥ 0. */
export function pyDecimalToFixedParts(d: PyDecimal): { coef: bigint; scale: number } {
  let coef = BigInt(d.digits);
  let scale = -d.exp;
  if (scale < 0) { coef *= 10n ** BigInt(-scale); scale = 0; }
  return { coef: d.sign ? -coef : coef, scale };
}

/** quantize to `places` with ROUND_HALF_EVEN; returns the '{:f}' string. */
export function quantizeStr(coef: bigint, scale: number, places: number): string {
  let q: bigint;
  if (places >= scale) q = coef * 10n ** BigInt(places - scale);
  else {
    const div = 10n ** BigInt(scale - places);
    const neg = coef < 0n;
    const abs = neg ? -coef : coef;
    let r0 = abs / div;
    const rem = abs % div;
    if (rem * 2n > div || (rem * 2n === div && r0 % 2n === 1n)) r0 += 1n;
    q = neg ? -r0 : r0;
  }
  const neg = q < 0n;
  let s = (neg ? -q : q).toString();
  if (places > 0) {
    s = s.padStart(places + 1, '0');
    s = `${s.slice(0, -places)}.${s.slice(-places)}`;
  }
  return (neg ? '-' : '') + s;
}

/** Compare two exact decimals given as {coef, scale}. */
export function decCmp(a: { coef: bigint; scale: number }, b: { coef: bigint; scale: number }): number {
  const s = Math.max(a.scale, b.scale);
  const x = a.coef * 10n ** BigInt(s - a.scale);
  const y = b.coef * 10n ** BigInt(s - b.scale);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Postgres numeric text → {coef, scale}. */
export function pgDec(v: string): { coef: bigint; scale: number } {
  return pyDecimalToFixedParts(pyDecimal(v)!);
}

// ---- uuid.UUID(hex=...) / UUID(int=...) ------------------------------------------------------

/** UUIDField.to_python: canonical string, or null when Django raises ValidationError (→ 500 in these views). */
export function pyUuid(v: unknown): string | null {
  let hex: string;
  if (typeof v === 'number' || typeof v === 'boolean') {
    if (typeof v === 'number' && !Number.isInteger(v)) return null; // float → .replace AttributeError
    const n = BigInt(typeof v === 'boolean' ? (v ? 1 : 0) : v);
    if (n < 0n || n >= 1n << 128n) return null;
    hex = n.toString(16).padStart(32, '0');
  } else if (typeof v === 'string') {
    let h = v.replace(/urn:/g, '').replace(/uuid:/g, '');
    h = h.replace(/^[{}]+|[{}]+$/g, '').replace(/-/g, '');
    if (h.length !== 32) return null;
    if (!/^[0-9a-fA-F]{32}$/.test(h)) return null;
    hex = h.toLowerCase();
  } else return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Python truthiness for request.data values. */
export function pyTruthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object' && !Buffer.isBuffer(v)) return Object.keys(v as object).length > 0;
  return true;
}

/** user.get_full_name() */
export function fullName(u: { first_name: string; last_name: string }): string {
  return pyStrip(`${u.first_name} ${u.last_name}`);
}

/** Epoch ms of a Postgres timestamptz text (or Date). */
export function pgMs(v: string | Date): number {
  if (v instanceof Date) return v.getTime();
  const s = v.trim().replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1').replace(/([+-]\d{2})$/, '$1:00');
  return Date.parse(s);
}
