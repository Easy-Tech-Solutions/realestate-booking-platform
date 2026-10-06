// Minimal exact decimal arithmetic (Python's decimal.Decimal semantics for the
// operations notifications.services uses: +, -, *, quantize(ROUND_HALF_EVEN),
// str(), format(".2f"), comparison). Values from Postgres numeric columns
// arrive as strings (db/index.ts), so nothing goes through floats.

export class Dec {
  /** value = coef × 10^-scale */
  constructor(readonly coef: bigint, readonly scale: number) {}

  static from(v: string | number | bigint | Dec | null | undefined): Dec {
    if (v instanceof Dec) return v;
    if (v === null || v === undefined) return new Dec(0n, 0);
    if (typeof v === 'bigint') return new Dec(v, 0);
    const s = typeof v === 'number' ? String(v) : v.trim();
    const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
    if (!m || (m[2] === '' && (m[3] ?? '') === '')) throw new Error(`Invalid decimal literal: ${v}`);
    const [, sign, int = '', frac = '', exp] = m;
    let scale = frac.length - Number(exp ?? 0);
    let coef = BigInt((int + frac) || '0');
    if (scale < 0) {
      // Python keeps a positive exponent (e.g. Decimal('1E+2')); normalise to an integer here.
      coef *= 10n ** BigInt(-scale);
      scale = 0;
    }
    return new Dec(sign === '-' ? -coef : coef, scale);
  }

  private align(o: Dec): [bigint, bigint, number] {
    const s = Math.max(this.scale, o.scale);
    return [this.coef * 10n ** BigInt(s - this.scale), o.coef * 10n ** BigInt(s - o.scale), s];
  }

  add(o: Dec | string | number): Dec { const [a, b, s] = this.align(Dec.from(o)); return new Dec(a + b, s); }
  sub(o: Dec | string | number): Dec { const [a, b, s] = this.align(Dec.from(o)); return new Dec(a - b, s); }
  mul(o: Dec | string | number): Dec { const d = Dec.from(o); return new Dec(this.coef * d.coef, this.scale + d.scale); }
  /** Exact division by a power of ten (Decimal(x) / Decimal(10**n)). */
  divPow10(n: number): Dec { return new Dec(this.coef, this.scale + n); }

  cmp(o: Dec | string | number): number { const [a, b] = this.align(Dec.from(o)); return a < b ? -1 : a > b ? 1 : 0; }
  isZero(): boolean { return this.coef === 0n; }

  /** quantize(Decimal('1e-places')) with ROUND_HALF_EVEN (the default context). */
  quantize(places: number): Dec {
    if (places >= this.scale) return new Dec(this.coef * 10n ** BigInt(places - this.scale), places);
    const div = 10n ** BigInt(this.scale - places);
    const neg = this.coef < 0n;
    const abs = neg ? -this.coef : this.coef;
    let q = abs / div;
    const r = abs % div;
    const twice = r * 2n;
    if (twice > div || (twice === div && q % 2n === 1n)) q += 1n;
    return new Dec(neg ? -q : q, places);
  }

  /** str(Decimal) — plain notation at the stored scale. */
  toString(): string {
    const neg = this.coef < 0n;
    let digits = (neg ? -this.coef : this.coef).toString();
    if (this.scale > 0) {
      digits = digits.padStart(this.scale + 1, '0');
      digits = `${digits.slice(0, -this.scale)}.${digits.slice(-this.scale)}`;
    }
    return (neg ? '-' : '') + digits;
  }

  /** f'{d:.2f}' */
  fixed(places = 2): string { return this.quantize(places).toString(); }
}
