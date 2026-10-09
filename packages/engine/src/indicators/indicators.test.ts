import { describe, expect, test } from 'bun:test';
import type { Bar, Columns, Params } from '../types.ts';
import { toColumns } from '../util/columns.ts';
import { createRng } from '../util/rng.ts';
import {
  INDICATORS, atr, computeIndicator, ema, getIndicator, heikinAshi, highest, listIndicators, lowest,
  nyDay, rma, sma, stdev, trueRange, wma,
} from './index.ts';

const f = (...a: number[]) => Float64Array.from(a);
const close = (got: ArrayLike<number>, want: (number)[], eps = 1e-9) => {
  expect(got.length).toBe(want.length);
  want.forEach((w, i) => {
    if (Number.isNaN(w)) expect(got[i]).toBeNaN();
    else expect(Math.abs(got[i]! - w)).toBeLessThan(eps);
  });
};
const NaNs = NaN;

function series(n: number, seed = 7): Bar[] {
  const rng = createRng(seed);
  const bars: Bar[] = [];
  let p = 100;
  const t0 = Date.UTC(2024, 0, 2, 14, 30);
  for (let i = 0; i < n; i++) {
    const o = p;
    const c = Math.max(1, o + rng.gaussian() * 0.5);
    const h = Math.max(o, c) + rng.next() * 0.4;
    const l = Math.min(o, c) - rng.next() * 0.4;
    bars.push({ t: t0 + i * 300_000, o, h, l, c, v: Math.round(rng.float(100, 5000)) });
    p = c;
  }
  return bars;
}

const sameArr = (a: Float64Array, b: Float64Array) => {
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
};
const prefix = (c: Columns, k: number): Columns => ({
  t: c.t.slice(0, k), o: c.o.slice(0, k), h: c.h.slice(0, k), l: c.l.slice(0, k), c: c.c.slice(0, k), v: c.v.slice(0, k),
});
const midParams = (id: string): Params => {
  const p: Params = {};
  for (const s of getIndicator(id).params) {
    if (s.type === 'int' || s.type === 'float') {
      const v = (s.min! + s.max!) / 2;
      p[s.key] = s.type === 'int' ? Math.round(v) : v;
    }
  }
  return p;
};

describe('primitives', () => {
  test('sma', () => close(sma(f(1, 2, 3, 4, 5), 3), [NaNs, NaNs, 2, 3, 4]));
  test('sma with NaN gap', () => close(sma(f(1, 2, NaN, 4, 5, 6), 2), [NaNs, 1.5, NaNs, NaNs, 4.5, 5.5]));
  test('ema seeded by sma', () => close(ema(f(1, 2, 3, 4, 5), 3), [NaNs, NaNs, 2, 3, 4]));
  test('ema skips NaN warm-up', () => close(ema(f(NaN, NaN, 1, 2, 3, 4, 5), 3), [NaNs, NaNs, NaNs, NaNs, 2, 3, 4]));
  test('rma wilder', () => close(rma(f(3, 3, 6, 9), 3), [NaNs, NaNs, 4, (4 * 2 + 9) / 3]));
  test('wma', () => close(wma(f(1, 2, 3, 4), 3), [NaNs, NaNs, (1 + 4 + 9) / 6, (2 + 6 + 12) / 6]));
  test('stdev population', () => close(stdev(f(1, 2, 3, 4, 5), 3), [NaNs, NaNs, Math.sqrt(2 / 3), Math.sqrt(2 / 3), Math.sqrt(2 / 3)]));
  test('highest/lowest', () => {
    close(highest(f(1, 3, 2, 5, 4, 1), 3), [NaNs, NaNs, 3, 5, 5, 5]);
    close(lowest(f(4, 3, 2, 5, 4, 1), 3), [NaNs, NaNs, 2, 2, 2, 1]);
  });
  test('true range & ATR (Wilder)', () => {
    const h = f(10, 11, 12, 12, 13), l = f(8, 9, 9, 10, 10), c = f(9, 10, 11, 11, 12);
    close(trueRange(h, l, c), [2, 2, 3, 2, 3]);
    close(atr(h, l, c, 3), [NaNs, NaNs, 7 / 3, 20 / 9, 67 / 27]);
  });
  test('heikin-ashi', () => {
    const ha = heikinAshi({ o: f(10, 11), h: f(12, 13), l: f(9, 10), c: f(11, 12) });
    close(ha.c, [10.5, 11.5]);
    close(ha.o, [10.5, 10.5]);
    close(ha.h, [12, 13]);
    close(ha.l, [9, 10]);
  });
});

describe('reference values', () => {
  const mk = (h: number[], l: number[], c: number[]): Columns => {
    const n = c.length;
    return { t: f(...c.map((_, i) => i * 60_000)), o: f(...c), h: f(...h), l: f(...l), c: f(...c), v: f(...c.map(() => 100)) };
  };
  const flat = (c: number[]) => mk(c, c, c);

  test('RSI Wilder', () => {
    const r = computeIndicator(flat([10, 11, 12, 11, 13]), 'rsi', { period: 3 }).value!;
    close(r, [NaNs, NaNs, NaNs, 200 / 3, 100 - 100 / 6]);
  });
  test('RSI all-up is 100', () => {
    const r = computeIndicator(flat([1, 2, 3, 4, 5, 6]), 'rsi', { period: 3 }).value!;
    expect(r[5]).toBe(100);
  });
  test('Bollinger', () => {
    const b = computeIndicator(flat([1, 2, 3, 4, 5]), 'bb', { period: 3, mult: 2 });
    const sd = Math.sqrt(2 / 3);
    close(b.middle!, [NaNs, NaNs, 2, 3, 4]);
    close(b.upper!, [NaNs, NaNs, 2 + 2 * sd, 3 + 2 * sd, 4 + 2 * sd]);
    close(b.lower!, [NaNs, NaNs, 2 - 2 * sd, 3 - 2 * sd, 4 - 2 * sd]);
    expect(b.percentB![2]!).toBeCloseTo((3 - (2 - 2 * sd)) / (4 * sd), 9);
    expect(b.bandwidth![2]!).toBeCloseTo((4 * sd) / 2, 9);
  });
  test('MACD', () => {
    const m = computeIndicator(flat([1, 3, 2, 5, 4, 6]), 'macd', { fast: 2, slow: 3, signal: 2 });
    close(m.macd!, [NaNs, NaNs, 0, 0.5, 0.25, 16 / 3 - 4.875]);
    close(m.signal!, [NaNs, NaNs, NaNs, 0.25, 0.25, (2 / 3) * (16 / 3 - 4.875) + 0.25 / 3]);
    expect(m.hist![5]!).toBeCloseTo(16 / 3 - 4.875 - ((2 / 3) * (16 / 3 - 4.875) + 0.25 / 3), 9);
  });
  test('Stochastic', () => {
    const cols = mk([10, 11, 12, 13], [8, 9, 10, 11], [9, 10, 11, 12.5]);
    const s = computeIndicator(cols, 'stoch', { kPeriod: 3, smooth: 1, dPeriod: 2 });
    close(s.k!, [NaNs, NaNs, 75, 87.5]);
    close(s.d!, [NaNs, NaNs, NaNs, 81.25]);
  });
  test('Heikin-Ashi indicator', () => {
    const cols = mk([12, 13], [9, 10], [11, 12]);
    cols.o = f(10, 11);
    const h = computeIndicator(cols, 'ha');
    close(h.open!, [10.5, 10.5]);
    close(h.close!, [10.5, 11.5]);
    close(h.dir!, [1, 1]);
  });
  test('ATR indicator', () => {
    const cols = mk([10, 11, 12, 12, 13], [8, 9, 9, 10, 10], [9, 10, 11, 11, 12]);
    close(computeIndicator(cols, 'atr', { period: 3 }).value!, [NaNs, NaNs, 7 / 3, 20 / 9, 67 / 27]);
  });
  test('SMA / EMA indicators default to close', () => {
    close(computeIndicator(flat([1, 2, 3, 4, 5]), 'sma', { period: 3 }).value!, [NaNs, NaNs, 2, 3, 4]);
    close(computeIndicator(flat([1, 2, 3, 4, 5]), 'ema', { period: 3 }).value!, [NaNs, NaNs, 2, 3, 4]);
  });
});

describe('sessions', () => {
  test('nyDay changes at New York midnight, DST aware', () => {
    // summer (EDT, UTC-4)
    expect(nyDay(Date.UTC(2024, 6, 2, 3, 59, 59))).toBe(nyDay(Date.UTC(2024, 6, 1, 12)));
    expect(nyDay(Date.UTC(2024, 6, 2, 4, 0, 0))).toBe(nyDay(Date.UTC(2024, 6, 1, 12)) + 1);
    // winter (EST, UTC-5)
    expect(nyDay(Date.UTC(2024, 0, 2, 4, 59, 59))).toBe(nyDay(Date.UTC(2024, 0, 1, 12)));
    expect(nyDay(Date.UTC(2024, 0, 2, 5, 0, 0))).toBe(nyDay(Date.UTC(2024, 0, 1, 12)) + 1);
    // 2024 DST starts Mar 10 07:00 UTC: Mar 11 midnight EDT is 04:00 UTC
    expect(nyDay(Date.UTC(2024, 2, 11, 3, 59))).toBe(nyDay(Date.UTC(2024, 2, 10, 12)));
    expect(nyDay(Date.UTC(2024, 2, 11, 4, 0))).toBe(nyDay(Date.UTC(2024, 2, 10, 12)) + 1);
    // 2024 DST ends Nov 3 06:00 UTC: Nov 4 midnight EST is 05:00 UTC
    expect(nyDay(Date.UTC(2024, 10, 4, 4, 59))).toBe(nyDay(Date.UTC(2024, 10, 3, 12)));
    expect(nyDay(Date.UTC(2024, 10, 4, 5, 0))).toBe(nyDay(Date.UTC(2024, 10, 3, 12)) + 1);
  });
  test('VWAP resets per day and PDH/PDL use prior session', () => {
    const day = 86_400_000;
    const t0 = Date.UTC(2024, 0, 2, 15); // 10:00 NY
    const bars: Bar[] = [
      { t: t0, o: 10, h: 12, l: 9, c: 11, v: 100 },
      { t: t0 + 3_600_000, o: 11, h: 14, l: 10, c: 13, v: 100 },
      { t: t0 + day, o: 13, h: 15, l: 12, c: 14, v: 50 },
      { t: t0 + day + 3_600_000, o: 14, h: 16, l: 13, c: 15, v: 50 },
    ];
    const cols = toColumns(bars);
    const vw = computeIndicator(cols, 'vwap').value!;
    expect(vw[0]).toBeCloseTo((12 + 9 + 11) / 3, 9);
    expect(vw[2]).toBeCloseTo((15 + 12 + 14) / 3, 9);
    const pd = computeIndicator(cols, 'pdhl');
    close(pd.pdh!, [NaNs, NaNs, 14, 14]);
    close(pd.pdl!, [NaNs, NaNs, 9, 9]);
  });
});

describe('catalog contract', () => {
  const cols = toColumns(series(1500));

  test('required ids exist', () => {
    const ids = INDICATORS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(INDICATORS.length).toBeGreaterThanOrEqual(37);
  });
  test('unknown id gives helpful error', () => {
    expect(() => getIndicator('nope')).toThrow(/Unknown indicator "nope".*sma/);
  });
  test('listIndicators has no compute', () => {
    for (const m of listIndicators()) expect('compute' in m).toBe(false);
  });

  for (const d of INDICATORS) {
    test(`${d.id}: meta + outputs well formed`, () => {
      expect(d.blurb.length).toBeGreaterThan(20);
      expect(d.blurb.split(/[.!?]\s/).length).toBe(1);
      expect(d.icon.length).toBeGreaterThan(0);
      expect(/^[\x00-\x7f]+$/.test(d.icon)).toBe(false);
      expect(d.outputs.length).toBeGreaterThan(0);
      for (const s of d.params) {
        if (s.type === 'int' || s.type === 'float') {
          expect(s.min).toBeDefined(); expect(s.max).toBeDefined(); expect(s.step).toBeDefined();
          expect(s.default as number).toBeGreaterThanOrEqual(s.min!);
          expect(s.default as number).toBeLessThanOrEqual(s.max!);
        } else expect(s.options!.length).toBeGreaterThan(0);
      }
      const r = computeIndicator(cols, d.id);
      expect(Object.keys(r).sort()).toEqual(d.outputs.map((o) => o.key).sort());
      for (const o of d.outputs) {
        expect(r[o.key]!.length).toBe(cols.c.length);
        expect(r[o.key]!.some((v) => v === v)).toBe(true);
        expect(r[o.key]!.every((v) => v !== Infinity && v !== -Infinity)).toBe(true);
      }
    });

    test(`${d.id}: causal (prefix == full)`, () => {
      for (const params of [{}, midParams(d.id)]) {
        const full = computeIndicator(cols, d.id, params);
        for (const k of [120, 431, 900]) {
          const part = computeIndicator(prefix(cols, k), d.id, params);
          for (const key of Object.keys(full)) {
            expect(sameArr(full[key]!.slice(0, k), part[key]!)).toBe(true);
          }
        }
      }
    });
  }

  test('performance: whole catalog on 50k bars', () => {
    const big = toColumns(series(50_000, 3));
    const t = performance.now();
    for (const d of INDICATORS) computeIndicator(big, d.id);
    const ms = performance.now() - t;
    console.log(`catalog on 50k bars: ${ms.toFixed(0)}ms`);
    expect(ms).toBeLessThan(1000);
  });
});
