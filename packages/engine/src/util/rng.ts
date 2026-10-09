/** Seeded PRNG (mulberry32). The engine never uses Math.random — determinism is a feature. */
export interface Rng {
  next(): number;                       // [0, 1)
  int(minInclusive: number, maxInclusive: number): number;
  float(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  gaussian(): number;                   // standard normal
}

export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    float: (a, b) => a + next() * (b - a),
    pick: (items) => {
      if (items.length === 0) throw new Error('pick from empty list');
      return items[Math.floor(next() * items.length)] as (typeof items)[number];
    },
    gaussian: () => {
      const u = Math.max(next(), 1e-12);
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
    },
  };
}
