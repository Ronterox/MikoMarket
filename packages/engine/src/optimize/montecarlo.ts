import type { MonteCarloOptions, MonteCarloResult, Trade } from '../types.ts';
import { createRng } from '../util/rng.ts';

export const DEFAULT_MC_OPTIONS: MonteCarloOptions = {
  runs: 1000,
  method: 'shuffle',
  skipPct: 10,
  ruinPct: 50,
  seed: 42,
};

const SAMPLE_CURVES = 20;
const MAX_CURVE_POINTS = 200;

type Pct = MonteCarloResult['finalEquity'];

/**
 * Monte Carlo on a trade list. Each run rebuilds an equity curve by ADDING each
 * trade's currency `pnl` to the running equity (same as the backtester's
 * accounting; position sizes are kept as traded, not re-scaled by equity).
 *
 * - 'shuffle':   same trades, random order. Final equity is identical in every
 *                run (exactly initialCash + Σpnl) unless the account is ruined;
 *                the drawdown distribution is what matters.
 * - 'bootstrap': n trades drawn with replacement.
 * - 'skip':      each trade is dropped with probability skipPct/100 (percent,
 *                default 10) — models missed fills.
 *
 * If equity hits 0 the run is ruined: drawdown 100%, equity stays at 0.
 * riskOfRuin = share of runs whose max drawdown reached `ruinPct` (default 50%).
 * probabilityOfProfit = share of runs ending above initialCash.
 * sampleCurves: the first 20 runs, per-trade equity (initial point included),
 * downsampled to <= 200 points.
 */
export function monteCarlo(
  trades: readonly Trade[],
  initialCash: number,
  opts: Partial<MonteCarloOptions> = {},
): MonteCarloResult {
  const o: MonteCarloOptions = { ...DEFAULT_MC_OPTIONS };
  for (const [k, v] of Object.entries(opts)) if (v !== undefined) (o as unknown as Record<string, unknown>)[k] = v;
  const runs = Math.max(1, Math.floor(o.runs));
  const skip = Math.min(1, Math.max(0, (o.skipPct ?? 10) / 100));
  const ruinPct = o.ruinPct ?? 50;
  const rng = createRng(o.seed);

  const pnls = trades.map((t) => (Number.isFinite(t.pnl) ? t.pnl : 0));
  const n = pnls.length;
  const total = pnls.reduce((s, p) => s + p, 0);
  const finals = new Float64Array(runs);
  const dds = new Float64Array(runs);
  const sampleCurves: number[][] = [];
  const seq = pnls.slice();
  let profitable = 0;
  let ruins = 0;

  for (let r = 0; r < runs; r++) {
    let len = n;
    if (o.method === 'shuffle') {
      for (let i = n - 1; i > 0; i--) {
        const j = rng.int(0, i);
        const tmp = seq[i]!; seq[i] = seq[j]!; seq[j] = tmp;
      }
    } else if (o.method === 'bootstrap') {
      for (let i = 0; i < n; i++) seq[i] = pnls[rng.int(0, n - 1)]!;
    } else {
      len = 0;
      for (let i = 0; i < n; i++) if (rng.next() >= skip) seq[len++] = pnls[i]!;
    }

    const curve = r < SAMPLE_CURVES ? [initialCash] : null;
    let eq = initialCash;
    let peak = initialCash;
    let maxDd = 0;
    let ruined = initialCash <= 0;
    for (let i = 0; i < len && !ruined; i++) {
      eq += seq[i]!;
      if (eq <= 0) { eq = 0; ruined = true; }
      if (eq > peak) peak = eq;
      const dd = peak > 0 ? ((peak - eq) / peak) * 100 : 0;
      if (dd > maxDd) maxDd = dd;
      curve?.push(eq);
    }
    if (ruined) maxDd = 100;
    if (o.method === 'shuffle' && !ruined) eq = initialCash + total;
    finals[r] = eq;
    dds[r] = maxDd;
    if (eq > initialCash) profitable++;
    if (maxDd >= ruinPct) ruins++;
    if (curve) {
      while (curve.length < len + 1) curve.push(eq); // ruined: flat at 0
      sampleCurves.push(downsample(curve, MAX_CURVE_POINTS));
    }
  }

  return {
    runs,
    finalEquity: percentiles(finals),
    maxDrawdownPct: percentiles(dds),
    probabilityOfProfit: profitable / runs,
    riskOfRuin: ruins / runs,
    sampleCurves,
  };
}

function percentiles(values: Float64Array): Pct {
  const s = Float64Array.from(values).sort();
  const at = (p: number) => {
    if (s.length === 0) return 0;
    const pos = (s.length - 1) * p;
    const lo = Math.floor(pos);
    const hi = Math.min(s.length - 1, lo + 1);
    return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
  };
  return { p5: at(0.05), p25: at(0.25), p50: at(0.5), p75: at(0.75), p95: at(0.95) };
}

/** Evenly spaced points, always keeping the first and last. */
export function downsample(curve: number[], max: number): number[] {
  if (curve.length <= max) return curve;
  const out: number[] = [];
  for (let k = 0; k < max; k++) out.push(curve[Math.round((k * (curve.length - 1)) / (max - 1))]!);
  return out;
}
