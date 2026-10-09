import type { Grade, Trade } from '../types.ts';

export const GRADE_ORDER: readonly Grade[] = ['D', 'C', 'B', 'A', 'S'];

export function betterGrade(a: Grade | undefined, b: Grade | undefined): Grade | undefined {
  if (!a) return b;
  if (!b) return a;
  return GRADE_ORDER.indexOf(b) > GRADE_ORDER.indexOf(a) ? b : a;
}

/**
 * Equity before each trade. Trade.pnlPct = pnl / equityAtEntry * 100, so the equity at
 * entry is recovered as pnl * 100 / pnlPct. When that is not available (pnl 0) the running
 * equity is used, starting from `initialCash` (default 10,000).
 */
export function equityBeforeEach(trades: readonly Trade[], initialCash = 10_000): number[] {
  const out: number[] = [];
  let running = initialCash;
  for (const t of trades) {
    const implied = t.pnlPct !== 0 && Number.isFinite(t.pnlPct) ? (t.pnl * 100) / t.pnlPct : NaN;
    const before = Number.isFinite(implied) && implied > 0 ? implied : running;
    out.push(before);
    running = before + t.pnl;
  }
  return out;
}

export function maxConsecutive(trades: readonly Trade[], pred: (t: Trade) => boolean): number {
  let best = 0;
  let cur = 0;
  for (const t of trades) {
    cur = pred(t) ? cur + 1 : 0;
    if (cur > best) best = cur;
  }
  return best;
}

/** 'YYYY-MM-DD' (UTC) for an epoch-ms instant. */
export function dayOf(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

/** Whole days between two 'YYYY-MM-DD' strings (b - a). NaN when either is malformed. */
export function daysBetween(a: string, b: string): number {
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  return Math.round((tb - ta) / 86_400_000);
}
