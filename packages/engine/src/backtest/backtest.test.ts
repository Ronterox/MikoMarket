import { describe, expect, test } from 'bun:test';
import type { EquityPoint, StrategySpec, Trade } from '../types.ts';
import { computeMetrics, emptyMetrics, runBacktest } from './index.ts';
import { STRATEGY_TEMPLATES } from '../strategy/index.ts';
import { ZERO_COSTS, randomSeries } from '../core/test-helpers.ts';

const trade = (pnl: number, r?: number, barsHeld = 2): Trade => {
  const t: Trade = {
    id: 't', side: 'long', qty: 1, entryT: 0, entryPrice: 100, exitT: 1, exitPrice: 100 + pnl, pnl, pnlPct: pnl / 100,
    commission: 0, mae: 0, mfe: 0, barsHeld, exitReason: 'signal', actor: 'bot', hadStop: r !== undefined,
  };
  if (r !== undefined) t.r = r;
  return t;
};

describe('computeMetrics', () => {
  test('deterministic numbers on a hand-made trade list', () => {
    const trades = [trade(100, 1), trade(200, 2), trade(-50, -0.5), trade(-50, -0.5), trade(0, 0)];
    const eq = [10_000, 10_100, 10_300, 10_250, 10_200, 10_200].map((equity, i): EquityPoint => ({ t: i * 86_400_000, equity, drawdownPct: 0 }));
    const m = computeMetrics(trades, eq, 10_000, '1d');
    expect(m.trades).toBe(5);
    expect(m.netProfit).toBe(200);
    expect(m.netProfitPct).toBeCloseTo(2, 9);
    expect(m.wins).toBe(2);
    expect(m.losses).toBe(2);
    expect(m.winRate).toBeCloseTo(0.4, 9);
    expect(m.profitFactor).toBeCloseTo(3, 9);
    expect(m.avgWin).toBe(150);
    expect(m.avgLoss).toBe(-50);
    expect(m.payoff).toBeCloseTo(3, 9);
    expect(m.expectancy).toBe(40);
    expect(m.expectancyR).toBeCloseTo(0.4, 9);
    expect(m.maxConsecWins).toBe(2);
    expect(m.maxConsecLosses).toBe(2);
    expect(m.maxDrawdown).toBe(100);
    expect(m.maxDrawdownPct).toBeCloseTo((100 / 10_300) * 100, 9);
    expect(m.sqn).toBeCloseTo((Math.sqrt(5) * 0.4) / Math.sqrt(4.7 / 4), 9);
    expect(m.avgBarsHeld).toBe(2);
    expect(m.exposure).toBe(1);
    expect(m.recoveryFactor).toBeCloseTo(2, 9);
    expect(m.sharpe).toBeGreaterThan(0);
    expect(m.cagr).toBeGreaterThan(0);
  });

  test('guards: no trades, no losses, no wins', () => {
    const z = computeMetrics([], [], 10_000, '5m');
    expect(z).toEqual(emptyMetrics());
    expect(Number.isNaN(z.expectancyR)).toBe(true);
    const allWins = computeMetrics([trade(10), trade(20)], [], 10_000, '1h');
    expect(allWins.profitFactor).toBe(Infinity);
    expect(allWins.payoff).toBe(Infinity);
    const allLoss = computeMetrics([trade(-10)], [], 10_000, '1h');
    expect(allLoss.profitFactor).toBe(0);
    expect(allLoss.sqn).toBe(0);
    const flatEq = computeMetrics([], [{ t: 0, equity: 10_000, drawdownPct: 0 }, { t: 1, equity: 10_000, drawdownPct: 0 }], 10_000, '1d');
    expect(flatEq.sharpe).toBe(0);
    expect(flatEq.calmar).toBe(0);
  });
});

describe('runBacktest', () => {
  test('no lookahead: an "oracle" that trades the signal bar cannot profit', () => {
    // Long whenever the bar just closed green, out at the next bar close (maxBars 1). On a random
    // walk the edge must vanish, because the trade only starts at the NEXT open.
    const s = randomSeries(4000, 11, '1d');
    const spec: StrategySpec = {
      id: 'oracle', name: 'oracle', version: 1, long: { enter: { kind: 'candle', pattern: 'bullish' } },
      exits: { maxBars: 1 }, sizing: { kind: 'fixed', qty: 1 },
    };
    const r = runBacktest(s, spec, { costs: ZERO_COSTS, allowShort: false });
    expect(r.trades.length).toBeGreaterThan(1000);
    let absMove = 0;
    for (const b of s.bars) absMove += Math.abs(b.c - b.o);
    const avgAbs = absMove / s.bars.length;
    expect(Math.abs(r.metrics.expectancy)).toBeLessThan(avgAbs * 0.1);
    // each trade enters at the open of the bar after the signal
    const byT = new Map(s.bars.map((b, i) => [b.t, i]));
    for (const t of r.trades.slice(0, 50)) {
      const i = byT.get(t.entryT)!;
      expect(t.entryPrice).toBe(s.bars[i]!.o);
      expect(s.bars[i - 1]!.c > s.bars[i - 1]!.o).toBe(true);
    }
  });

  test('no lookahead: a truncated series reproduces the first part of the trades', () => {
    const s = randomSeries(1200, 5, '1d');
    for (const tpl of STRATEGY_TEMPLATES) {
      const full = runBacktest(s, tpl);
      const k = 800;
      const part = runBacktest({ ...s, bars: s.bars.slice(0, k + 1) }, tpl);
      const lastT = s.bars[k]!.t;
      const a = full.trades.filter((t) => t.exitT < lastT);
      const b = part.trades.filter((t) => t.exitT < lastT);
      expect(b).toEqual(a);
      expect(part.equity.slice(0, -1)).toEqual(full.equity.slice(0, part.equity.length - 1));
    }
  });

  test('startIndex defaults to the warm-up and equity has one point per bar', () => {
    const s = randomSeries(300, 2);
    const r = runBacktest(s, STRATEGY_TEMPLATES[0]!);
    expect(r.startIndex).toBeGreaterThanOrEqual(21);
    expect(r.endIndex).toBe(299);
    expect(r.equity.length).toBe(300 - r.startIndex);
    const r2 = runBacktest(s, STRATEGY_TEMPLATES[0]!, { startIndex: 50, endIndex: 150 });
    expect(r2.equity.length).toBe(101);
    expect(r2.trades.every((t) => t.exitT <= s.bars[150]!.t)).toBe(true);
  });

  test('onEvent receives events', () => {
    const s = randomSeries(300, 2);
    const seen = new Set<string>();
    runBacktest(s, STRATEGY_TEMPLATES[0]!, { onEvent: (e) => seen.add(e.type) });
    for (const t of ['bar', 'order', 'fill', 'positionOpened', 'tradeClosed', 'equity', 'signal', 'end']) expect(seen.has(t)).toBe(true);
  });

  test('performance: 100k bars with a 2-indicator strategy', () => {
    const s = randomSeries(100_000, 9, '5m');
    const spec = STRATEGY_TEMPLATES[0]!; // EMA cross, ATR stop
    runBacktest(s, spec); // warm-up JIT
    const t0 = performance.now();
    const r = runBacktest(s, spec);
    const ms = performance.now() - t0;
    expect(r.trades.length).toBeGreaterThan(100);
    expect(ms).toBeLessThan(300);
  });
});
