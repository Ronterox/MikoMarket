import { describe, expect, test } from 'bun:test';
import type { Bar, BarSeries, StrategySpec } from '../types.ts';
import { createRng } from '../util/rng.ts';
import { runBacktest } from '../backtest/index.ts';
import { STRATEGY_TEMPLATES } from '../strategy/index.ts';
import { evolveStrategy, fitnessOf, splitInOut, stressTest, walkForward } from './index.ts';

/** Random walk with positive drift plus slow trend regimes (EMA crosses have an edge). */
function trendingSeries(n: number, seed = 1): BarSeries {
  const rng = createRng(seed);
  const bars: Bar[] = [];
  let p = 100;
  const t0 = Date.UTC(2020, 0, 1);
  for (let i = 0; i < n; i++) {
    const regime = Math.sin((2 * Math.PI * i) / 400) * 0.0015;
    const o = p;
    p = Math.max(1, p * (1 + 0.0003 + regime + rng.gaussian() * 0.004));
    const h = Math.max(o, p) * (1 + Math.abs(rng.gaussian()) * 0.001);
    const l = Math.min(o, p) * (1 - Math.abs(rng.gaussian()) * 0.001);
    bars.push({ t: t0 + i * 3_600_000, o, h, l, c: p, v: 1000 + rng.int(0, 500) });
  }
  return {
    instrument: { symbol: 'SYN', name: 'Synthetic', kind: 'stock', pointValue: 1, tickSize: 0.01 },
    timeframe: '1h',
    bars,
  };
}

const ema = (period: number) => ({ kind: 'indicator' as const, id: 'ema', params: { period } });

const emaCross = (fast = 40, slow = 45): StrategySpec => ({
  id: 'ema-cross',
  name: 'EMA cross',
  version: 1,
  long: { enter: { kind: 'cross', left: ema(fast), dir: 'above', right: ema(slow) } },
  exits: {
    stopLoss: { kind: 'atr', mult: 3, period: 14 },
    exitWhen: { kind: 'cross', left: ema(fast), dir: 'below', right: ema(slow) },
  },
  sizing: { kind: 'percentEquity', percent: 50 },
  genes: [
    { path: '/long/enter/left/params/period', label: 'Fast EMA', min: 3, max: 40, int: true },
    { path: '/long/enter/right/params/period', label: 'Slow EMA', min: 20, max: 200, int: true },
  ],
});

const series = trendingSeries(4000, 3);
const ga = { population: 16, generations: 6, seed: 5 };

describe('evolveStrategy', () => {
  const res = evolveStrategy(series, emaCross(), { ga });
  const { inSample: is, outOfSample: oos } = splitInOut(series, 0.3);

  test('improves IS fitness over the initial spec', () => {
    const initial = runBacktest(series, emaCross(), { startIndex: is[0], endIndex: is[1] });
    const f0 = fitnessOf(initial.metrics, 'robust');
    expect(res.ga.bestFitness).toBeGreaterThanOrEqual(f0);
    expect(res.ga.bestFitness).toBeGreaterThan(f0);
    expect(fitnessOf(res.inSample.metrics, 'robust')).toBeCloseTo(res.ga.bestFitness, 9);
  });

  test('OOS range never overlaps IS and is the most recent data', () => {
    expect(res.inSample.startIndex).toBe(is[0]);
    expect(res.inSample.endIndex).toBe(is[1]);
    expect(res.outOfSample.startIndex).toBe(oos[0]);
    expect(res.outOfSample.endIndex).toBe(series.bars.length - 1);
    expect(res.outOfSample.startIndex).toBeGreaterThan(res.inSample.endIndex);
    const isEndT = series.bars[is[1]]!.t;
    for (const t of res.inSample.trades) expect(t.exitT).toBeLessThanOrEqual(isEndT);
  });

  test('OOS data never influences selection', () => {
    // same IS bars, wildly different OOS bars => same genome
    const other = trendingSeries(4000, 99);
    const mixed: BarSeries = { ...series, bars: [...series.bars.slice(0, is[1] + 1), ...other.bars.slice(is[1] + 1)] };
    const r2 = evolveStrategy(mixed, emaCross(), { ga });
    expect(r2.ga.bestGenome).toEqual(res.ga.bestGenome);
    expect(r2.ga.bestFitness).toBe(res.ga.bestFitness);
  });

  test('deterministic with a seed', () => {
    const again = evolveStrategy(series, emaCross(), { ga });
    expect(again.ga).toEqual(res.ga);
    expect(again.best).toEqual(res.best);
    expect(again.outOfSample.metrics).toEqual(res.outOfSample.metrics);
  });

  test('best spec carries the evolved genome', () => {
    const left = res.best.long!.enter as unknown as { left: { params: { period: number } } };
    expect(left.left.params.period).toBe(res.ga.bestGenome[0]!);
  });
});

describe('walkForward', () => {
  test('rolling, non-overlapping OOS windows and stitched trades', () => {
    const wf = walkForward(series, emaCross(), { windows: 3, ga: { population: 10, generations: 3 } });
    expect(wf.segments.length).toBe(3);
    for (let k = 0; k < wf.segments.length; k++) {
      const s = wf.segments[k]!;
      expect(s.outOfSample[0]).toBe(s.inSample[1] + 1);
      if (k > 0) expect(s.outOfSample[0]).toBe(wf.segments[k - 1]!.outOfSample[1] + 1);
    }
    expect(wf.segments.at(-1)!.outOfSample[1]).toBe(series.bars.length - 1);
    const firstOosT = series.bars[wf.segments[0]!.outOfSample[0]]!.t;
    for (const t of wf.oosTrades) expect(t.entryT).toBeGreaterThanOrEqual(firstOosT);
    expect(Number.isFinite(wf.efficiency)).toBe(true);
  });
});

describe('stressTest', () => {
  test('returns a valid report', () => {
    const r = stressTest(series, emaCross(10, 60), { monteCarlo: { runs: 300 } });
    expect(['S', 'A', 'B', 'C', 'D']).toContain(r.grade);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.reasons.length).toBeGreaterThanOrEqual(2);
    expect(r.reasons.length).toBeLessThanOrEqual(5);
    for (const s of r.reasons) expect(s.length).toBeLessThan(70);
    expect(r.monteCarlo.runs).toBe(300);
    expect(r.walkForwardEfficiency).toBeUndefined();
    const w = stressTest(series, emaCross(10, 60), { monteCarlo: { runs: 100 }, walkForwardEfficiency: 0.8 });
    expect(w.walkForwardEfficiency).toBe(0.8);
  });

  test('a strategy that barely trades is graded low and told why', () => {
    const r = stressTest(trendingSeries(300, 4), emaCross(10, 60));
    expect(r.score).toBeLessThanOrEqual(45);
    expect(r.reasons[0]).toMatch(/too few to trust/);
  });
});

describe('performance', () => {
  test('population 30 x 15 generations on 20k bars', () => {
    const big = trendingSeries(20_000, 7);
    const t0 = performance.now();
    const r = evolveStrategy(big, emaCross(), { ga: { population: 30, generations: 15, seed: 1 } });
    const ms = performance.now() - t0;
    console.log(`evolveStrategy 30x15 on 20k bars: ${ms.toFixed(0)} ms, ${r.ga.evaluations} evaluations`);
    expect(ms).toBeLessThan(15_000);
  }, 60_000);
});

describe('stressTest caps', () => {
  test('a losing training run cannot grade above C, whatever the unseen data did', () => {
    // Downtrend first (training), uptrend last (unseen): a long-only trend bot loses IS and wins OOS.
    const rng = createRng(7);
    let p = 100;
    const bars = Array.from({ length: 3000 }, (_, i) => {
      const drift = i < 2100 ? -0.0004 : 0.0012;
      const o = p; p = p * (1 + drift + rng.gaussian() * 0.004);
      return { t: i * 300_000, o, h: Math.max(o, p) * 1.001, l: Math.min(o, p) * 0.999, c: p, v: 1000 };
    });
    const series = { instrument: { symbol: 'X', name: 'X', kind: 'stock' as const, pointValue: 1, tickSize: 0.01 }, timeframe: '5m' as const, bars };
    const tpl = STRATEGY_TEMPLATES.find((t) => t.id === 'tpl_ema_cross')!;
    const longOnly = { ...tpl, short: undefined, genes: tpl.genes };
    const r = stressTest(series, longOnly, { monteCarlo: { runs: 200, seed: 1 } });
    expect(r.inSample.netProfit).toBeLessThan(0);
    expect(r.score).toBeLessThanOrEqual(54);
    if (r.monteCarlo.probabilityOfProfit < 0.5) expect(r.score).toBeLessThanOrEqual(49);
  });
});
