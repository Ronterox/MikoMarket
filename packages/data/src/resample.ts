import { TIMEFRAME_MS, type Bar, type BarSeries, type Instrument, type Timeframe } from '@miko/engine';
import { NEW_YORK, tzOffsetMs, zonedToUtc } from './tz.ts';

const DAY = 86_400_000;

/**
 * The session open for a trading date (local New York calendar date):
 * 09:30 for stocks/ETFs, 18:00 the evening before for futures (Globex).
 */
export function sessionOpenUtc(y: number, mo: number, d: number, instrument?: Pick<Instrument, 'kind'>): number {
  if (instrument?.kind === 'future') {
    const prev = new Date(Date.UTC(y, mo - 1, d) - DAY);
    return zonedToUtc(prev.getUTCFullYear(), prev.getUTCMonth() + 1, prev.getUTCDate(), 18, 0, NEW_YORK);
  }
  return zonedToUtc(y, mo, d, 9, 30, NEW_YORK);
}

/**
 * Days since the epoch of the bar's trading date in New York. Futures trade
 * from 18:00 the evening before, so for them the evening belongs to tomorrow.
 */
export function tradingDay(t: number, instrument?: Pick<Instrument, 'kind'>): number {
  const shift = instrument?.kind === 'future' ? 6 * 3_600_000 : 0;
  const local = t + tzOffsetMs(t, NEW_YORK) + shift;
  return Math.floor(local / DAY);
}

/**
 * Aggregate bars into a coarser timeframe. Bars must be sorted by `t` (open time).
 *
 * Intraday buckets are aligned on New York wall-clock multiples of the target
 * length (so 1h bars start on the hour, 4h bars at 00/04/08/... local). Daily
 * bars group by trading date (futures roll at 18:00), weekly by Monday-based
 * week of that date; their `t` is the first constituent bar's open.
 */
export function resample(series: BarSeries, tf: Timeframe): BarSeries {
  const srcMs = TIMEFRAME_MS[series.timeframe];
  const dstMs = TIMEFRAME_MS[tf];
  if (dstMs < srcMs) throw new Error(`Cannot resample ${series.timeframe} down to ${tf}`);
  if (dstMs === srcMs) return { ...series, bars: series.bars.slice() };

  const inst = series.instrument;
  const keyOf: (t: number) => number =
    tf === '1d' ? (t) => tradingDay(t, inst)
    : tf === '1w' ? (t) => Math.floor((tradingDay(t, inst) + 3) / 7) // epoch day 0 is a Thursday
    : (t) => Math.floor((t + tzOffsetMs(t, NEW_YORK)) / dstMs);
  const startOf: (t: number, key: number) => number =
    tf === '1d' || tf === '1w' ? (t) => t
    : (t, key) => key * dstMs - tzOffsetMs(t, NEW_YORK);

  const out: Bar[] = [];
  let cur: Bar | null = null;
  let curKey = NaN;
  for (const b of series.bars) {
    const key = keyOf(b.t);
    if (cur && key === curKey) {
      if (b.h > cur.h) cur.h = b.h;
      if (b.l < cur.l) cur.l = b.l;
      cur.c = b.c;
      cur.v += b.v;
    } else {
      cur = { t: startOf(b.t, key), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v };
      curKey = key;
      out.push(cur);
    }
  }
  return { instrument: inst, timeframe: tf, bars: out };
}

/** Sort by t and drop duplicates; for equal t the LAST occurrence wins (newer data overrides). */
export function dedupeBars(bars: readonly Bar[]): Bar[] {
  const byT = new Map<number, Bar>();
  for (const b of bars) byT.set(b.t, b);
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

/** Merge two bar lists, `incoming` overriding `existing` on equal t. */
export function mergeBars(existing: readonly Bar[], incoming: readonly Bar[]): Bar[] {
  return dedupeBars([...existing, ...incoming]);
}
