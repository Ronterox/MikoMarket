/**
 * America/New_York calendar days from epoch ms, without Intl. Uses the US DST rules:
 * 2007+: 2nd Sunday of March 02:00 to 1st Sunday of November 02:00;
 * earlier: 1st Sunday of April to last Sunday of October.
 */

const DAY = 86_400_000;
const HOUR = 3_600_000;

const dow = (year: number, month: number, day: number): number =>
  (Math.floor(Date.UTC(year, month, day) / DAY) + 4) % 7; // 0 = Sunday

function dstWindow(year: number): [number, number] {
  if (year >= 2007) {
    const secondSunMar = 1 + ((7 - dow(year, 2, 1)) % 7) + 7;
    const firstSunNov = 1 + ((7 - dow(year, 10, 1)) % 7);
    return [Date.UTC(year, 2, secondSunMar) + 7 * HOUR, Date.UTC(year, 10, firstSunNov) + 6 * HOUR];
  }
  const firstSunApr = 1 + ((7 - dow(year, 3, 1)) % 7);
  const lastSunOct = 31 - dow(year, 9, 31);
  return [Date.UTC(year, 3, firstSunApr) + 7 * HOUR, Date.UTC(year, 9, lastSunOct) + 6 * HOUR];
}

let cacheYear = NaN;
let cacheStart = 0;
let cacheEnd = 0;

/** UTC offset of New York at instant `t`, in hours (-4 or -5). */
export function nyOffsetHours(t: number): number {
  const year = new Date(t).getUTCFullYear();
  if (year !== cacheYear) {
    [cacheStart, cacheEnd] = dstWindow(year);
    cacheYear = year;
  }
  return t >= cacheStart && t < cacheEnd ? -4 : -5;
}

/** Integer day number of the New York calendar date at instant `t`. Changes at NY midnight. */
export function nyDay(t: number): number {
  return Math.floor((t + nyOffsetHours(t) * HOUR) / DAY);
}
