import { TIMEFRAME_MS, type Timeframe } from '@miko/engine';

export const TIMEFRAMES = Object.keys(TIMEFRAME_MS) as Timeframe[];

export type TsUnit = 'Minute' | 'Daily' | 'Weekly' | 'Monthly';

/** Our timeframe as TradeStation's barcharts interval + unit. */
export function tsInterval(tf: Timeframe): { interval: number; unit: TsUnit } {
  switch (tf) {
    case '1d': return { interval: 1, unit: 'Daily' };
    case '1w': return { interval: 1, unit: 'Weekly' };
    default: return { interval: TIMEFRAME_MS[tf] / 60_000, unit: 'Minute' };
  }
}

/** The timeframe whose bar length is exactly `ms`, or null. */
export function timeframeForMs(ms: number): Timeframe | null {
  return TIMEFRAMES.find((tf) => TIMEFRAME_MS[tf] === ms) ?? null;
}

/** Lenient parse: '5m', 'm5', '5min', '15mins', 'H1', '60', 'D', 'daily', '1w'. */
export function parseTimeframe(input: string): Timeframe {
  const s = input.trim().toLowerCase();
  if ((TIMEFRAMES as string[]).includes(s)) return s as Timeframe;
  const named: Record<string, Timeframe> = { d: '1d', d1: '1d', day: '1d', daily: '1d', w: '1w', w1: '1w', week: '1w', weekly: '1w' };
  if (named[s]) return named[s]!;
  let m = /^(\d+)\s*(m|min|mins|minute|minutes)?$/.exec(s) ?? /^m(\d+)$/.exec(s);
  if (m) {
    const tf = timeframeForMs(Number(m[1]) * 60_000);
    if (tf) return tf;
  }
  m = /^(\d+)\s*(h|hr|hour|hours)$/.exec(s) ?? /^h(\d+)$/.exec(s);
  if (m) {
    const tf = timeframeForMs(Number(m[1]) * 3_600_000);
    if (tf) return tf;
  }
  throw new Error(`Unknown timeframe "${input}". Use one of: ${TIMEFRAMES.join(', ')}`);
}
