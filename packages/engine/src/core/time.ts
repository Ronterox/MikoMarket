import { nyOffsetHours } from '../indicators/index.ts';
import { TIMEFRAME_MS, type Timeframe } from '../types.ts';

const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Minutes since midnight in the given zone (America/New_York by default, or 'UTC'). */
export function minutesOfDay(t: number, tz?: string): number {
  const off = tz === 'UTC' || tz === 'Etc/UTC' ? 0 : nyOffsetHours(t) * HOUR;
  const local = t + off;
  return Math.floor((((local % DAY) + DAY) % DAY) / 60_000);
}

/** 'HH:MM' -> minutes since midnight, or NaN when malformed. */
export function parseHHMM(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return NaN;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 24 || mi > 59) return NaN;
  return h * 60 + mi;
}

/**
 * True when a bar opening at `t` closes at or after `flatAt` (New York time), the rule the
 * Session uses for flatAt exits. `flatAt` may be 'HH:MM' or minutes after midnight. Pass the
 * timeframe to test the bar's close time (t + timeframe); without it `t` itself is tested.
 * Daily and weekly bars never count as past flatAt.
 */
export function isPastFlatAt(t: number, flatAt: string | number | undefined, timeframe?: Timeframe): boolean {
  if (flatAt === undefined) return false;
  const flat = typeof flatAt === 'number' ? flatAt : parseHHMM(flatAt);
  if (flat !== flat) return false;
  const tf = timeframe ? TIMEFRAME_MS[timeframe] : 0;
  if (tf >= DAY) return false;
  return minutesOfDay(t + tf) >= flat;
}
