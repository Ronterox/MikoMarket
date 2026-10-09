import { createRng, TIMEFRAME_MS, type Bar, type BarSeries, type Instrument, type Timeframe } from '@miko/engine';

/**
 * Synthetic demo market: geometric Brownian motion with GARCH-style volatility
 * clustering, slow regime drift and intraday session hours. Used only when the
 * API server is unreachable, and always labelled "Demo data" in the UI.
 */
export function generateDemoSeries(instrument: Instrument, timeframe: Timeframe, count: number, seed: number, startPrice: number): BarSeries {
  const rng = createRng(seed);
  const step = TIMEFRAME_MS[timeframe];
  const intraday = step < 86_400_000;
  const barsPerYear = intraday ? (6.5 * 3_600_000 / step) * 252 : timeframe === '1d' ? 252 : 52;

  const annualVol = instrument.kind === 'future' ? 0.22 : instrument.kind === 'stock' ? 0.32 : 0.18;
  const baseVar = (annualVol * annualVol) / barsPerYear;
  // GARCH(1,1): var_t = w + a*r^2 + b*var
  const a = 0.08, b = 0.9, w = baseVar * (1 - a - b);

  // Walk backwards from a fixed recent date so charts look current.
  const end = Date.UTC(2026, 8, 30, 20, 0, 0);
  const times: number[] = [];
  let t = end - step;
  while (times.length < count) {
    const d = new Date(t);
    const dow = d.getUTCDay();
    const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
    const weekday = dow !== 0 && dow !== 6;
    const ok = timeframe === '1w' ? true : intraday ? weekday && mins >= 13 * 60 + 30 && mins < 20 * 60 : weekday;
    if (ok) times.push(timeframe === '1d' ? Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) : t);
    t -= step;
  }
  times.reverse();

  const bars: Bar[] = [];
  let price = startPrice * (0.75 + rng.next() * 0.3);
  let variance = baseVar;
  let drift = 0;
  const tick = instrument.tickSize;
  const round = (p: number) => Math.max(tick, Math.round(p / tick) * tick);

  for (let i = 0; i < times.length; i++) {
    if (i % 400 === 0) drift = (rng.next() - 0.45) * 0.6 / barsPerYear; // gentle bull bias regimes
    const z = rng.gaussian();
    const sigma = Math.sqrt(variance);
    const r = drift - variance / 2 + sigma * z;
    variance = w + a * r * r + b * variance;
    variance = Math.min(variance, baseVar * 12);

    const open = price;
    const close = open * Math.exp(r);
    const wick = sigma * open;
    const high = Math.max(open, close) + Math.abs(rng.gaussian()) * wick * 0.6;
    const low = Math.min(open, close) - Math.abs(rng.gaussian()) * wick * 0.6;
    const vol = Math.round(1000 * Math.exp(0.5 * rng.gaussian()) * (1 + Math.abs(z) * 1.5) * (instrument.kind === 'future' ? 1 : 50));
    bars.push({ t: times[i]!, o: round(open), h: round(high), l: round(Math.max(tick, low)), c: round(close), v: vol });
    price = close;
  }
  // Keep OHLC consistent after rounding.
  for (const bar of bars) {
    bar.h = Math.max(bar.h, bar.o, bar.c);
    bar.l = Math.min(bar.l, bar.o, bar.c);
  }
  return { instrument, timeframe, bars };
}
