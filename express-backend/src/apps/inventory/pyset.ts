// CPython 3.12 set iteration order for int elements (hash(i) == i for small ints),
// enough to reproduce `set(list_of_ints) - other_set` ordering in JSON output.

const MINSIZE = 8;
const LINEAR_PROBES = 9;
const PERTURB_SHIFT = 5n;
const MOD = (1n << 61n) - 1n;

function pyHash(n: bigint): bigint {
  const neg = n < 0n;
  let h = (neg ? -n : n) % MOD;
  if (neg) h = -h;
  return h === -1n ? -2n : h;
}

class PySet {
  table: (bigint | null)[] = new Array(MINSIZE).fill(null);
  fill = 0;
  used = 0;
  get mask() { return this.table.length - 1; }

  insertClean(table: (bigint | null)[], key: bigint) {
    const mask = BigInt(table.length - 1);
    const hash = pyHash(key);
    let perturb = hash < 0n ? hash + (1n << 64n) : hash; // size_t
    let i = (hash < 0n ? hash + (1n << 64n) : hash) & mask;
    for (;;) {
      let probes = i + BigInt(LINEAR_PROBES) <= mask ? LINEAR_PROBES : 0;
      let j = i;
      do {
        if (table[Number(j)] === null) { table[Number(j)] = key; return; }
        j += 1n;
      } while (probes-- > 0);
      perturb >>= PERTURB_SHIFT;
      i = (i * 5n + 1n + perturb) & mask;
    }
  }

  resize(minused: number) {
    let size = MINSIZE;
    while (size <= minused) size <<= 1;
    const old = this.table;
    this.table = new Array(size).fill(null);
    for (const k of old) if (k !== null) this.insertClean(this.table, k);
    this.fill = this.used;
  }

  add(key: bigint) {
    if (this.table.includes(key)) return;
    const mask = BigInt(this.mask);
    const hash = pyHash(key);
    let perturb = hash < 0n ? hash + (1n << 64n) : hash;
    let i = (hash < 0n ? hash + (1n << 64n) : hash) & mask;
    for (;;) {
      let probes = i + BigInt(LINEAR_PROBES) <= mask ? LINEAR_PROBES : 0;
      let j = i;
      do {
        if (this.table[Number(j)] === null) {
          this.table[Number(j)] = key;
          this.fill++; this.used++;
          if (this.fill * 5 >= this.mask * 3) this.resize(this.used > 50000 ? this.used * 2 : this.used * 4);
          return;
        }
        j += 1n;
      } while (probes-- > 0);
      perturb >>= PERTURB_SHIFT;
      i = (i * 5n + 1n + perturb) & mask;
    }
  }

  values(): bigint[] { return this.table.filter((k): k is bigint => k !== null); }
}

/** list(set(items) - other) for int items. */
export function pySetDifference(items: bigint[], other: Set<bigint>): bigint[] {
  const s = new PySet();
  for (const x of items) s.add(x);
  if ((s.used >> 2) > other.size) {
    // set_copy (set_merge into an empty set) then discard
    const c = new PySet();
    if (s.used * 5 >= c.mask * 3) c.resize(s.used * 2);
    if (c.mask === s.mask) c.table = [...s.table];
    else for (const k of s.values()) c.insertClean(c.table, k);
    return c.values().filter((k) => !other.has(k));
  }
  const out = new PySet();
  for (const k of s.values()) if (!other.has(k)) out.add(k);
  return out.values();
}
