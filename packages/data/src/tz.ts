/**
 * Time-zone arithmetic without dependencies, on top of Intl.
 *
 * US exchange data is stamped in America/New_York, and every offset there is a
 * whole number of hours, so offsets are memoised per UTC hour (and per local
 * hour for the reverse direction). That keeps parsing a multi-million-line CSV
 * fast: one Intl call per distinct hour instead of one per line.
 */

export const NEW_YORK = 'America/New_York';

const HOUR = 3_600_000;
const formatters = new Map<string, Intl.DateTimeFormat>();
const offsetByUtcHour = new Map<string, number>();
const offsetByLocalHour = new Map<string, number>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

function computeOffset(utcMs: number, tz: string): number {
  const parts = formatter(tz).formatToParts(new Date(utcMs));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Local time minus UTC, in ms, at the given instant (e.g. -4h for New York in summer). */
export function tzOffsetMs(utcMs: number, tz: string = NEW_YORK): number {
  const key = `${tz}|${Math.floor(utcMs / HOUR)}`;
  let off = offsetByUtcHour.get(key);
  if (off === undefined) {
    off = computeOffset(Math.floor(utcMs / HOUR) * HOUR, tz);
    offsetByUtcHour.set(key, off);
  }
  return off;
}

/** The UTC instant of a wall-clock time in `tz`. Month is 1-based. */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string = NEW_YORK, s = 0): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const key = `${tz}|${Math.floor(guess / HOUR)}`;
  let off = offsetByLocalHour.get(key);
  if (off === undefined) {
    off = tzOffsetMs(guess, tz);
    const second = tzOffsetMs(guess - off, tz);
    if (second !== off) off = second;
    offsetByLocalHour.set(key, off);
  }
  return guess - off;
}

/** Wall-clock fields of an instant in `tz`. dow: 0 = Sunday. */
export function localParts(utcMs: number, tz: string = NEW_YORK): { y: number; mo: number; d: number; h: number; mi: number; dow: number } {
  const local = new Date(utcMs + tzOffsetMs(utcMs, tz));
  return {
    y: local.getUTCFullYear(), mo: local.getUTCMonth() + 1, d: local.getUTCDate(),
    h: local.getUTCHours(), mi: local.getUTCMinutes(), dow: local.getUTCDay(),
  };
}
