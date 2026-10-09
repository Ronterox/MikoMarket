import type { OrderAction } from '../types.ts';
import { atr } from '../indicators/index.ts';
import type { Session } from './session.ts';

export interface QuickTradeOptions {
  riskPct?: number;  // % of equity lost if the stop is hit (default 1)
  atrMult?: number;  // stop distance in ATR(14) multiples (default 2)
  rr?: number;       // target = rr × stop distance (default 2)
}

export interface QuickTradePlan {
  qty: number;        // 0 when not even one unit is affordable
  stopLoss: number;
  takeProfit: number;
}

/**
 * Plans a one-tap trade from the last closed bar: stop = close ∓ atrMult·ATR(14), target at
 * rr × the stop distance, and qty sized so the loss at the stop ≈ riskPct of equity
 * (integer, at least 1, capped by buying power). Prices are rounded to the tick.
 */
export function planQuickTrade(session: Session, action: OrderAction, opts: QuickTradeOptions = {}): QuickTradePlan {
  const riskPct = opts.riskPct ?? 1, atrMult = opts.atrMult ?? 2, rr = opts.rr ?? 2;
  const cols = session.cols;
  const i = session.index;
  const entry = cols.c[i]!;
  const { pointValue: pv, tickSize: tick } = session.series.instrument;

  // ATR over the visible bars only (causal anyway, slicing keeps it cheap in long series).
  const from = Math.max(0, i - 300);
  const sub = { h: cols.h.subarray(from, i + 1), l: cols.l.subarray(from, i + 1), c: cols.c.subarray(from, i + 1) };
  let a = atr(sub, 14)[i - from]!;
  if (!(a > 0)) {
    // Not enough history: fall back to the mean range of what we have, then 1% of price.
    let s = 0;
    for (let k = from; k <= i; k++) s += cols.h[k]! - cols.l[k]!;
    a = s / (i - from + 1);
    if (!(a > 0)) a = entry * 0.01;
  }
  const dist = Math.max(atrMult * a, tick);
  const round = (p: number) => (tick > 0 ? Math.round(p / tick) * tick : p);
  const buy = action === 'buy';
  const stopLoss = round(buy ? entry - dist : entry + dist);
  const takeProfit = round(buy ? entry + rr * dist : entry - rr * dist);

  const riskPerUnit = Math.abs(entry - stopLoss) * pv;
  const budget = (Math.max(0, session.state.equity) * riskPct) / 100;
  let qty = riskPerUnit > 0 ? Math.floor(budget / riskPerUnit + 1e-9) : 1;
  if (qty < 1) qty = 1;
  const cap = session.maxQty(entry);
  if (qty > cap) qty = cap;
  return { qty, stopLoss, takeProfit };
}
