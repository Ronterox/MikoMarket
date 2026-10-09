import { describe, expect, test } from 'bun:test';
import type { Metrics, Trade } from '../types.ts';
import { createRng } from '../util/rng.ts';
import { fitnessOf, splitInOut } from './fitness.ts';
import { monteCarlo } from './montecarlo.ts';

const trade = (pnl: number, i = 0): Trade => ({
  id: `t${i}`, side: 'long', qty: 1, entryT: i, entryPrice: 100, exitT: i + 1, exitPrice: 100 + pnl,
  pnl, pnlPct: pnl / 100, commission: 0, mae: 0, mfe: 0, barsHeld: 1, exitReason: 'signal',
  actor: 'bot', hadStop: true,
});

const rng = createRng(11);
const trades = Array.from({ length: 300 }, (_, i) => trade(Math.round((rng.gaussian() * 100 + 15) * 100) / 100, i));
const total = trades.reduce((s, t) => s + t.pnl, 0);

describe('monteCarlo', () => {
  test('shuffle keeps final equity identical across runs; drawdowns vary', () => {
    const r = monteCarlo(trades, 10_000, { runs: 500, method: 'shuffle', seed: 1 });
    const f = r.finalEquity;
    expect(f.p5).toBe(10_000 + total);
    expect(f.p95).toBe(f.p5);
    expect(r.maxDrawdownPct.p95).toBeGreaterThan(r.maxDrawdownPct.p5);
    expect(r.probabilityOfProfit).toBe(1);
    expect(r.runs).toBe(500);
    expect(r.sampleCurves.length).toBe(20);
    for (const c of r.sampleCurves) {
      expect(c.length).toBeLessThanOrEqual(200);
      expect(c[0]).toBe(10_000);
      expect(c[c.length - 1]).toBeCloseTo(10_000 + total, 6);
    }
  });

  test('bootstrap spreads final equity', () => {
    const r = monteCarlo(trades, 10_000, { method: 'bootstrap', seed: 2 });
    expect(r.finalEquity.p95).toBeGreaterThan(r.finalEquity.p5);
    expect(r.finalEquity.p50).toBeGreaterThan(10_000);
    expect(r.probabilityOfProfit).toBeGreaterThan(0.5);
    expect(r.probabilityOfProfit).toBeLessThanOrEqual(1);
  });

  test('skip drops ~skipPct of trades', () => {
    const ones = Array.from({ length: 1000 }, (_, i) => trade(1, i));
    const r = monteCarlo(ones, 10_000, { method: 'skip', skipPct: 20, runs: 200 });
    expect(r.finalEquity.p50).toBeGreaterThan(10_770);
    expect(r.finalEquity.p50).toBeLessThan(10_830);
  });

  test('deterministic for a seed', () => {
    const a = monteCarlo(trades, 10_000, { method: 'bootstrap', seed: 3, runs: 100 });
    const b = monteCarlo(trades, 10_000, { method: 'bootstrap', seed: 3, runs: 100 });
    expect(a).toEqual(b);
  });

  test('risk of ruin counts runs whose drawdown reaches ruinPct', () => {
    const losers = Array.from({ length: 50 }, (_, i) => trade(i % 2 ? -400 : 150, i));
    const r = monteCarlo(losers, 10_000, { method: 'bootstrap', runs: 300 });
    expect(r.riskOfRuin).toBeGreaterThan(0.5);
    const blown = monteCarlo([trade(-20_000)], 10_000, { runs: 10 });
    expect(blown.riskOfRuin).toBe(1);
    expect(blown.finalEquity.p50).toBe(0);
    expect(blown.maxDrawdownPct.p50).toBe(100);
  });

  test('empty trades', () => {
    const r = monteCarlo([], 10_000, { runs: 50 });
    expect(r.finalEquity).toEqual({ p5: 10_000, p25: 10_000, p50: 10_000, p75: 10_000, p95: 10_000 });
    expect(r.maxDrawdownPct.p95).toBe(0);
    expect(r.probabilityOfProfit).toBe(0);
    expect(r.riskOfRuin).toBe(0);
    expect(r.sampleCurves[0]).toEqual([10_000]);
  });
});

const metrics = (m: Partial<Metrics>): Metrics => ({
  netProfit: 0, netProfitPct: 0, trades: 0, wins: 0, losses: 0, winRate: 0, profitFactor: 0, avgWin: 0,
  avgLoss: 0, payoff: 0, expectancy: 0, expectancyR: NaN, maxDrawdown: 0, maxDrawdownPct: 0, sharpe: 0,
  sortino: 0, calmar: 0, cagr: 0, exposure: 0, avgBarsHeld: 0, maxConsecWins: 0, maxConsecLosses: 0,
  recoveryFactor: 0, sqn: 0, ...m,
});

describe('fitnessOf', () => {
  test('robust formula', () => {
    expect(fitnessOf(metrics({ trades: 100, sharpe: 2, maxDrawdownPct: 10 }), 'robust')).toBeCloseTo(1.5);
    expect(fitnessOf(metrics({ trades: 25, sharpe: 2, maxDrawdownPct: 0 }), 'robust')).toBeCloseTo(1);
    // few trades always rank below enough trades, but more trades still help
    const few = fitnessOf(metrics({ trades: 9, sharpe: 5 }), 'robust');
    const fewer = fitnessOf(metrics({ trades: 2, sharpe: 5 }), 'robust');
    const bad = fitnessOf(metrics({ trades: 10, sharpe: -9, maxDrawdownPct: 99 }), 'robust');
    expect(few).toBeLessThan(bad);
    expect(fewer).toBeLessThan(few);
  });

  test('never NaN or infinite', () => {
    const nasty = metrics({ trades: NaN, sharpe: NaN, maxDrawdownPct: NaN, profitFactor: Infinity, netProfit: NaN, expectancy: -Infinity });
    for (const k of ['netProfit', 'sharpe', 'profitFactor', 'expectancy', 'robust'] as const) {
      expect(Number.isFinite(fitnessOf(nasty, k))).toBe(true);
      expect(Number.isFinite(fitnessOf(metrics({ trades: 50, sharpe: Infinity, profitFactor: NaN }), k))).toBe(true);
    }
    expect(fitnessOf(metrics({ trades: 5, profitFactor: Infinity }), 'profitFactor')).toBe(10);
  });
});

describe('splitInOut', () => {
  const series = (n: number) => ({
    instrument: { symbol: 'X', name: 'X', kind: 'stock' as const, pointValue: 1, tickSize: 0.01 },
    timeframe: '1d' as const,
    bars: Array.from({ length: n }, (_, i) => ({ t: i, o: 1, h: 1, l: 1, c: 1, v: 1 })),
  });
  test('chronological, contiguous, OOS last', () => {
    expect(splitInOut(series(100))).toEqual({ inSample: [0, 69], outOfSample: [70, 99] });
    expect(splitInOut(series(10), 0.25)).toEqual({ inSample: [0, 6], outOfSample: [7, 9] });
  });
  test('edge cases', () => {
    expect(splitInOut(series(2), 0.01)).toEqual({ inSample: [0, 0], outOfSample: [1, 1] });
    expect(splitInOut(series(5), 1)).toEqual({ inSample: [0, 0], outOfSample: [1, 4] });
    expect(splitInOut(series(0))).toEqual({ inSample: [0, -1], outOfSample: [0, -1] });
  });
});
