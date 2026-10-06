// Python decimal.Decimal semantics for the payments port: the default context
// (prec=28, ROUND_HALF_EVEN, InvalidOperation trapped), str() / format(..., 'f')
// output, quantize(), exact float→Decimal conversion and as_tuple() — so every
// amount the API prints or stores is byte-identical to Django's.
//
// Values from Postgres numeric columns arrive as strings (db/index.ts) and go
// straight into PyDecimal.parse(); nothing passes through floats.

/** decimal.InvalidOperation / ConversionSyntax (DecimalException in Python). */
export class DecimalException extends Error {
  constructor(msg = "[<class 'decimal.InvalidOperation'>]") { super(msg); }
}

type Special = 'nan' | 'snan' | 'inf';

const PREC = 28;

function digitsOf(n: bigint): string {
  return (n < 0n ? -n : n).toString();
}

export class PyDecimal {
  /** value = coef × 10^exp (coef carries the sign). */
  private constructor(
    readonly coef: bigint,
    readonly exp: number,
    readonly special: Special | null = null,
    readonly negative = false,
  ) {}

  static of(coef: bigint, exp: number): PyDecimal { return new PyDecimal(coef, exp, null, coef < 0n); }

  /**
   * Decimal(str): surrounding whitespace, sign, digits with single underscores,
   * optional fraction and exponent, Inf/Infinity/NaN/sNaN (case-insensitive).
   */
  static parse(input: string): PyDecimal {
    const s = input.replace(/^[\s\u0085]+|[\s\u0085]+$/g, '');
    const sp = /^([+-]?)(inf|infinity|nan|snan)(\d*)$/i.exec(s);
    if (sp) {
      const neg = sp[1] === '-';
      const kind = sp[2]!.toLowerCase();
      if (kind === 'inf' || kind === 'infinity') {
        if (sp[3]) throw new DecimalException();
        return new PyDecimal(0n, 0, 'inf', neg);
      }
      return new PyDecimal(sp[3] ? BigInt(sp[3]) : 0n, 0, kind === 'nan' ? 'nan' : 'snan', neg);
    }
    const D = '\\d(?:_?\\d)*';
    const m = new RegExp(`^([+-]?)(?:(${D})(?:\\.(${D})?)?|\\.(${D}))(?:[eE]([+-]?${D}))?$`).exec(s);
    if (!m) throw new DecimalException();
    const neg = m[1] === '-';
    const int = (m[2] ?? '').replace(/_/g, '');
    const frac = (m[3] ?? m[4] ?? '').replace(/_/g, '');
    const e = m[5] ? Number(m[5].replace(/_/g, '')) : 0;
    const coef = BigInt((int + frac) || '0');
    return new PyDecimal(neg ? -coef : coef, e - frac.length, null, neg);
  }

  /** Decimal(int) */
  static fromInt(n: number | bigint): PyDecimal { return PyDecimal.of(BigInt(n), 0); }

  /** Decimal(float) — the exact binary value. */
  static fromFloat(x: number): PyDecimal {
    if (Number.isNaN(x)) return new PyDecimal(0n, 0, 'nan');
    if (!Number.isFinite(x)) return new PyDecimal(0n, 0, 'inf', x < 0);
    if (x === 0) return new PyDecimal(0n, 0, null, Object.is(x, -0));
    const buf = new DataView(new ArrayBuffer(8));
    buf.setFloat64(0, x);
    const bits = buf.getBigUint64(0);
    const neg = bits >> 63n === 1n;
    const e = Number((bits >> 52n) & 0x7ffn);
    let mant = bits & ((1n << 52n) - 1n);
    let exp2: number;
    if (e === 0) exp2 = -1074;
    else { mant |= 1n << 52n; exp2 = e - 1075; }
    while (mant % 2n === 0n && exp2 < 0) { mant /= 2n; exp2++; }
    let coef: bigint;
    let exp10 = 0;
    if (exp2 >= 0) coef = mant << BigInt(exp2);
    else { coef = mant * 5n ** BigInt(-exp2); exp10 = exp2; }
    return PyDecimal.of(neg ? -coef : coef, exp10);
  }

  /** Context(prec).create_decimal_from_float(x) — what a float assigned to a DecimalField becomes. */
  static createFromFloat(x: number, prec: number): PyDecimal {
    return PyDecimal.fromFloat(x).roundToPrec(prec);
  }

  isNaN(): boolean { return this.special === 'nan' || this.special === 'snan'; }
  isInfinite(): boolean { return this.special === 'inf'; }
  isFinite(): boolean { return this.special === null; }
  isZero(): boolean { return this.special === null && this.coef === 0n; }
  /** bool(Decimal) */
  truthy(): boolean { return this.special !== null || this.coef !== 0n; }

  private requireFinite(): void {
    if (this.special !== null) throw new DecimalException();
  }

  /** as_tuple(): (digits, exponent) for finite values. */
  asTuple(): { digits: string; exponent: number } {
    return { digits: digitsOf(this.coef), exponent: this.exp };
  }

  /** Round to `prec` significant digits (ROUND_HALF_EVEN), like a context operation. */
  roundToPrec(prec = PREC): PyDecimal {
    if (this.special) return this;
    const d = digitsOf(this.coef);
    if (d.length <= prec) return this;
    const drop = d.length - prec;
    return PyDecimal.of(roundDiv(this.coef, 10n ** BigInt(drop)), this.exp + drop);
  }

  private static align(a: PyDecimal, b: PyDecimal): [bigint, bigint, number] {
    const e = Math.min(a.exp, b.exp);
    return [a.coef * 10n ** BigInt(a.exp - e), b.coef * 10n ** BigInt(b.exp - e), e];
  }

  add(o: PyDecimal): PyDecimal {
    if (this.isNaN() || o.isNaN()) throw new DecimalException();
    if (this.special || o.special) {
      if (this.special && o.special && this.negative !== o.negative) throw new DecimalException();
      return this.special ? this : o;
    }
    const [a, b, e] = PyDecimal.align(this, o);
    return PyDecimal.of(a + b, e).roundToPrec();
  }

  neg(): PyDecimal {
    if (this.special) return new PyDecimal(this.coef, this.exp, this.special, !this.negative);
    return PyDecimal.of(-this.coef, this.exp);
  }

  sub(o: PyDecimal): PyDecimal { return this.add(o.neg()); }

  mul(o: PyDecimal): PyDecimal {
    this.requireFinite(); o.requireFinite();
    return PyDecimal.of(this.coef * o.coef, this.exp + o.exp).roundToPrec();
  }

  /** self / other in the default context (28 significant digits, ROUND_HALF_EVEN). */
  div(o: PyDecimal): PyDecimal {
    this.requireFinite(); o.requireFinite();
    if (o.coef === 0n) throw new DecimalException("[<class 'decimal.DivisionByZero'>]");
    const ideal = this.exp - o.exp;
    if (this.coef === 0n) return PyDecimal.of(0n, ideal);
    const sign = (this.coef < 0n) !== (o.coef < 0n) ? -1n : 1n;
    const a = this.coef < 0n ? -this.coef : this.coef;
    const b = o.coef < 0n ? -o.coef : o.coef;
    // Scale the dividend so the integer quotient carries > PREC digits.
    let shift = Math.max(0, PREC + 2 + digitsOf(b).length - digitsOf(a).length);
    let q = (a * 10n ** BigInt(shift)) / b;
    const r = (a * 10n ** BigInt(shift)) % b;
    let exp = ideal - shift;
    if (r === 0n) {
      // Exact: strip trailing zeros back towards the ideal exponent.
      while (exp < ideal && q % 10n === 0n) { q /= 10n; exp++; shift--; }
      return PyDecimal.of(sign * q, exp).roundToPrec();
    }
    const d = q.toString();
    const drop = d.length - PREC;
    const div = 10n ** BigInt(drop);
    let head = q / div;
    const tail = q % div;
    const half = div / 2n;
    if (tail > half || (tail === half && r > 0n) || (tail === half && r === 0n && head % 2n === 1n)) head += 1n;
    return PyDecimal.of(sign * head, exp + drop).roundToPrec();
  }

  /** Comparison; NaN raises InvalidOperation like Python's <, >, <=, >=. */
  cmp(o: PyDecimal): number {
    if (this.isNaN() || o.isNaN()) throw new DecimalException();
    const inf = (d: PyDecimal) => (d.special === 'inf' ? (d.negative ? -1 : 1) : 0);
    const ia = inf(this); const ib = inf(o);
    if (ia || ib) return Math.sign(ia - ib);
    const [a, b] = PyDecimal.align(this, o);
    return a < b ? -1 : a > b ? 1 : 0;
  }
  gt(o: PyDecimal): boolean { return this.cmp(o) > 0; }
  lt(o: PyDecimal): boolean { return this.cmp(o) < 0; }
  lte(o: PyDecimal): boolean { return this.cmp(o) <= 0; }
  /** == (NaN is never equal, no exception). */
  eq(o: PyDecimal): boolean {
    if (this.isNaN() || o.isNaN()) return false;
    return this.cmp(o) === 0;
  }

  /**
   * quantize(Decimal('1e<exp>')) with ROUND_HALF_EVEN; InvalidOperation when the
   * result needs more than `prec` digits (Python's context check).
   */
  quantize(exp: number, prec = PREC): PyDecimal {
    this.requireFinite();
    let out: PyDecimal;
    if (exp >= this.exp) out = PyDecimal.of(roundDiv(this.coef, 10n ** BigInt(exp - this.exp)), exp);
    else out = PyDecimal.of(this.coef * 10n ** BigInt(this.exp - exp), exp);
    if (digitsOf(out.coef).length > prec) throw new DecimalException();
    return out;
  }

  /** to_integral_value() (ROUND_HALF_EVEN) as a bigint. */
  toIntegral(): bigint {
    this.requireFinite();
    if (this.exp >= 0) return this.coef * 10n ** BigInt(this.exp);
    return roundDiv(this.coef, 10n ** BigInt(-this.exp));
  }

  /** float(Decimal) */
  toNumber(): number {
    if (this.special === 'inf') return this.negative ? -Infinity : Infinity;
    if (this.special) return NaN;
    return Number(this.toString());
  }

  /** str(Decimal) — Python's to_sci_string. */
  toString(): string {
    const sign = this.negative ? '-' : '';
    if (this.special === 'inf') return `${sign}Infinity`;
    if (this.special === 'nan') return `${sign}NaN${this.coef ? this.coef : ''}`;
    if (this.special === 'snan') return `${sign}sNaN${this.coef ? this.coef : ''}`;
    const digits = digitsOf(this.coef);
    const leftdigits = this.exp + digits.length;
    const dotplace = this.exp <= 0 && leftdigits > -6 ? leftdigits : 1;
    let intpart: string;
    let fracpart: string;
    if (dotplace <= 0) { intpart = '0'; fracpart = '.' + '0'.repeat(-dotplace) + digits; }
    else if (dotplace >= digits.length) { intpart = digits + '0'.repeat(dotplace - digits.length); fracpart = ''; }
    else { intpart = digits.slice(0, dotplace); fracpart = '.' + digits.slice(dotplace); }
    const e = leftdigits - dotplace;
    const expStr = leftdigits === dotplace ? '' : `E${e >= 0 ? '+' : '-'}${Math.abs(e)}`;
    return sign + intpart + fracpart + expStr;
  }

  /** format(d, 'f') — plain notation at the stored exponent (DRF's coerce_to_string output). */
  toFixedString(): string {
    if (this.special) return this.toString();
    const sign = this.negative ? '-' : '';
    const digits = digitsOf(this.coef);
    if (this.exp >= 0) return sign + (this.coef === 0n ? '0' : digits + '0'.repeat(this.exp));
    const places = -this.exp;
    const padded = digits.padStart(places + 1, '0');
    return `${sign}${padded.slice(0, -places)}.${padded.slice(-places)}`;
  }
}

/** n / d rounded ROUND_HALF_EVEN (d > 0). */
function roundDiv(n: bigint, d: bigint): bigint {
  if (d === 1n) return n;
  const neg = n < 0n;
  const a = neg ? -n : n;
  let q = a / d;
  const r = a % d;
  const twice = r * 2n;
  if (twice > d || (twice === d && q % 2n === 1n)) q += 1n;
  return neg ? -q : q;
}

/** Decimal(value) from a Postgres numeric (string) — null/undefined → Decimal('0'). */
export function dec(v: string | number | null | undefined): PyDecimal {
  if (v === null || v === undefined) return PyDecimal.fromInt(0);
  if (typeof v === 'number') return Number.isInteger(v) ? PyDecimal.fromInt(v) : PyDecimal.fromFloat(v);
  return PyDecimal.parse(v);
}

/**
 * What Django sends for a DecimalField value: since Django 4.2 the Decimal goes
 * to Postgres unformatted (str(Decimal)) and Postgres rounds it to the column
 * scale itself (half away from zero; overflow / Infinity → error → 500).
 * maxDigits/decimalPlaces are kept for documentation of the target column.
 */
export function dbDecimal(v: PyDecimal, _maxDigits?: number, _decimalPlaces?: number): string {
  return v.toString();
}
