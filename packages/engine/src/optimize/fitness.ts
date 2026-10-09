import type { BarSeries, FitnessKind, Metrics } from '../types.ts';

const fin = (x: number, fallback = 0) => (Number.isFinite(x) ? x : fallback);

/**
 * Scalar fitness (higher = better). Never returns NaN or ±Infinity.
 *
 * - netProfit / sharpe / expectancy: the metric itself (non-finite => 0).
 * - profitFactor: capped at 10 (Infinity with trades => 10; no trades => 0).
 * - robust (default for the GA):
 *     trades >= 10:
 *       robust = max(-5, sharpe · sqrt(min(trades, 100) / 100) − maxDrawdownPct / 20)
 *       (a 20% drawdown costs one Sharpe unit; fewer than 100 trades shrink the
 *        Sharpe toward 0 because it is less trustworthy)
 *     trades < 10 (hard penalty, always below any >= 10-trade strategy):
 *       robust = −5.5 − (10 − trades) · 0.4 + clamp(sharpe, −1, 1) · 0.1
 *       (range ≈ [−9.6, −5.5]; still sloped so the GA climbs toward more trades)
 */
export function fitnessOf(metrics: Metrics, kind: FitnessKind = 'robust'): number {
  const trades = fin(metrics.trades);
  switch (kind) {
    case 'netProfit':
      return fin(metrics.netProfit);
    case 'sharpe':
      return fin(metrics.sharpe);
    case 'expectancy':
      return fin(metrics.expectancy);
    case 'profitFactor': {
      if (trades <= 0) return 0;
      const pf = Number.isNaN(metrics.profitFactor) ? 0 : metrics.profitFactor;
      return Math.min(10, Math.max(0, pf));
    }
    case 'robust': {
      const sharpe = fin(metrics.sharpe);
      if (trades < 10) {
        return -5.5 - (10 - Math.max(0, trades)) * 0.4 + Math.min(1, Math.max(-1, sharpe)) * 0.1;
      }
      const dd = Math.max(0, fin(metrics.maxDrawdownPct, 100));
      return Math.max(-5, sharpe * Math.sqrt(Math.min(trades, 100) / 100) - dd / 20);
    }
  }
}

/**
 * Chronological in-sample / out-of-sample split, inclusive bar indices.
 * OOS is the most recent `oosFraction` of the bars. With >= 2 bars both sides
 * get at least one bar. An empty side is [x, x - 1].
 */
export function splitInOut(
  series: BarSeries,
  oosFraction = 0.3,
): { inSample: [number, number]; outOfSample: [number, number] } {
  const n = series.bars.length;
  const f = Number.isFinite(oosFraction) ? Math.min(1, Math.max(0, oosFraction)) : 0.3;
  let oos = Math.round(n * f);
  if (n >= 2) oos = Math.min(n - 1, Math.max(1, oos));
  else oos = 0;
  const isEnd = n - oos - 1;
  return { inSample: [0, isEnd], outOfSample: [isEnd + 1, n - 1] };
}
