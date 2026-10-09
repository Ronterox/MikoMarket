// Shared fixtures for core/strategy/backtest tests. Not exported from the engine index.
import type { Bar, BarSeries, CostModel, Instrument, Timeframe } from '../types.ts';
import { createRng } from '../util/rng.ts';

export const STOCK: Instrument = { symbol: 'TEST', name: 'Test Stock', kind: 'stock', pointValue: 1, tickSize: 0.01 };
export const FUT: Instrument = { symbol: '@T', name: 'Test Future', kind: 'future', pointValue: 20, tickSize: 0.25 };
export const ZERO_COSTS: CostModel = { commissionPerUnit: 0, commissionPerOrder: 0, slippageTicks: 0, spreadTicks: 0 };

// 2024-03-04 14:30 UTC = 09:30 New York (EST)
export const T0 = Date.UTC(2024, 2, 4, 14, 30);

/** Bars from [o, h, l, c] tuples, 5 minutes apart. */
export function seriesOf(ohlc: [number, number, number, number][], instrument = STOCK, timeframe: Timeframe = '5m', t0 = T0): BarSeries {
  const step = 300_000;
  const bars: Bar[] = ohlc.map(([o, h, l, c], i) => ({ t: t0 + i * step, o, h, l, c, v: 1000 }));
  return { instrument, timeframe, bars };
}

/** Seeded random walk with daily bars by default. */
export function randomSeries(n: number, seed = 1, timeframe: Timeframe = '1d', instrument = STOCK, vol = 1): BarSeries {
  const rng = createRng(seed);
  const bars: Bar[] = [];
  let p = 100;
  const step = timeframe === '1d' ? 86_400_000 : 300_000;
  for (let i = 0; i < n; i++) {
    const o = p;
    const c = Math.max(1, o + rng.gaussian() * vol);
    const h = Math.max(o, c) + Math.abs(rng.gaussian()) * vol * 0.5;
    const l = Math.max(0.5, Math.min(o, c) - Math.abs(rng.gaussian()) * vol * 0.5);
    bars.push({ t: Date.UTC(2010, 0, 1) + i * step, o, h, l, c, v: 1000 + Math.floor(rng.next() * 1000) });
    p = c;
  }
  return { instrument, timeframe, bars };
}
