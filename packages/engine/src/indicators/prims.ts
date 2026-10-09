/**
 * Primitive, causal, O(n) rolling helpers. Every function returns an array of the same
 * length as its input with NaN during warm-up. NaN inputs are tolerated: a window that
 * contains a NaN yields NaN, and recursive filters restart from the next valid window.
 */

export type Arr = Float64Array;

const nanArr = (n: number): Arr => new Float64Array(n).fill(NaN);
const per = (n: number): number => Math.max(1, Math.floor(n));

/** Simple moving average. */
export function sma(x: Arr, period: number): Arr {
  const n = per(period);
  const out = nanArr(x.length);
  let sum = 0;
  let run = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i]!;
    if (v !== v) { run = 0; sum = 0; continue; }
    run++;
    sum += v;
    if (run > n) sum -= x[i - n]!;
    if (run >= n) out[i] = sum / n;
  }
  return out;
}

/** Exponential-style filter seeded with the SMA of the first valid window. */
function recursive(x: Arr, n: number, alpha: number): Arr {
  const out = nanArr(x.length);
  let prev = NaN;
  let run = 0;
  let sum = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i]!;
    if (v !== v) { prev = NaN; run = 0; sum = 0; continue; }
    if (prev === prev) {
      prev += alpha * (v - prev);
      out[i] = prev;
    } else {
      run++;
      sum += v;
      if (run === n) { prev = sum / n; out[i] = prev; }
    }
  }
  return out;
}

/** Exponential moving average (alpha = 2 / (n + 1)). */
export function ema(x: Arr, period: number): Arr {
  const n = per(period);
  return recursive(x, n, 2 / (n + 1));
}

/** Wilder's smoothing / running moving average (alpha = 1 / n). */
export function rma(x: Arr, period: number): Arr {
  const n = per(period);
  return recursive(x, n, 1 / n);
}

/** Linearly weighted moving average (newest bar has the biggest weight). */
export function wma(x: Arr, period: number): Arr {
  const n = per(period);
  const out = nanArr(x.length);
  const den = (n * (n + 1)) / 2;
  let run = 0;
  let s = 0;
  let w = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i]!;
    if (v !== v) { run = 0; continue; }
    run++;
    if (run < n) continue;
    if (run === n) {
      s = 0; w = 0;
      for (let j = 0; j < n; j++) { const y = x[i - n + 1 + j]!; s += y; w += (j + 1) * y; }
    } else {
      w = w - s + n * v;
      s = s + v - x[i - n]!;
    }
    out[i] = w / den;
  }
  return out;
}

/** Population standard deviation over a rolling window (what Bollinger Bands use). */
export function stdev(x: Arr, period: number): Arr {
  const n = per(period);
  const out = nanArr(x.length);
  let run = 0;
  let ref = 0;
  let s = 0;
  let sq = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i]!;
    if (v !== v) { run = 0; s = 0; sq = 0; continue; }
    run++;
    if (run === 1) ref = v;
    const d = v - ref;
    s += d;
    sq += d * d;
    if (run > n) { const o = x[i - n]! - ref; s -= o; sq -= o * o; }
    if (run >= n) {
      const m = s / n;
      out[i] = Math.sqrt(Math.max(0, sq / n - m * m));
    }
  }
  return out;
}

function extreme(x: Arr, period: number, isMax: boolean): Arr {
  const n = per(period);
  const out = nanArr(x.length);
  const dq = new Int32Array(x.length);
  let head = 0;
  let tail = 0;
  let run = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i]!;
    if (v !== v) { head = tail = 0; run = 0; continue; }
    run++;
    while (tail > head && (isMax ? x[dq[tail - 1]!]! <= v : x[dq[tail - 1]!]! >= v)) tail--;
    dq[tail++] = i;
    if (dq[head]! <= i - n) head++;
    if (run >= n) out[i] = x[dq[head]!]!;
  }
  return out;
}

/** Highest value of the last `period` bars (including the current one). */
export function highest(x: Arr, period: number): Arr { return extreme(x, period, true); }
/** Lowest value of the last `period` bars (including the current one). */
export function lowest(x: Arr, period: number): Arr { return extreme(x, period, false); }

interface HLC { h: Arr; l: Arr; c: Arr }

/** True range. Accepts (h, l, c) or any object with h/l/c arrays (e.g. Columns). */
export function trueRange(h: Arr, l: Arr, c: Arr): Arr;
export function trueRange(cols: HLC): Arr;
export function trueRange(a: Arr | HLC, b?: Arr, c?: Arr): Arr {
  const h = a instanceof Float64Array ? a : a.h;
  const l = a instanceof Float64Array ? b! : a.l;
  const cl = a instanceof Float64Array ? c! : a.c;
  const out = new Float64Array(h.length);
  for (let i = 0; i < h.length; i++) {
    const r = h[i]! - l[i]!;
    out[i] = i === 0 ? r : Math.max(r, Math.abs(h[i]! - cl[i - 1]!), Math.abs(l[i]! - cl[i - 1]!));
  }
  return out;
}

/** Average true range with Wilder smoothing. Accepts (h, l, c, period) or (cols, period). */
export function atr(h: Arr, l: Arr, c: Arr, period: number): Arr;
export function atr(cols: HLC, period: number): Arr;
export function atr(a: Arr | HLC, b: Arr | number, c?: Arr, d?: number): Arr {
  if (a instanceof Float64Array) return rma(trueRange(a, b as Arr, c!), d!);
  return rma(trueRange(a), b as number);
}

/** Heikin-Ashi candles. Causal: each HA open uses only the previous HA candle. */
export function heikinAshi(cols: { o: Arr; h: Arr; l: Arr; c: Arr }): { o: Arr; h: Arr; l: Arr; c: Arr } {
  const n = cols.c.length;
  const o = nanArr(n), h = nanArr(n), l = nanArr(n), c = nanArr(n);
  let prevO = NaN;
  let prevC = NaN;
  for (let i = 0; i < n; i++) {
    const bo = cols.o[i]!, bh = cols.h[i]!, bl = cols.l[i]!, bc = cols.c[i]!;
    if (bo !== bo || bh !== bh || bl !== bl || bc !== bc) { prevO = NaN; prevC = NaN; continue; }
    const hc = (bo + bh + bl + bc) / 4;
    const ho = prevO === prevO ? (prevO + prevC) / 2 : (bo + bc) / 2;
    o[i] = ho; c[i] = hc;
    h[i] = Math.max(bh, ho, hc);
    l[i] = Math.min(bl, ho, hc);
    prevO = ho; prevC = hc;
  }
  return { o, h, l, c };
}

/** Wilder RSI on a series. */
export function rsi(x: Arr, period: number): Arr {
  const n = x.length;
  const up = nanArr(n), dn = nanArr(n);
  for (let i = 1; i < n; i++) {
    const d = x[i]! - x[i - 1]!;
    if (d === d) { up[i] = d > 0 ? d : 0; dn[i] = d < 0 ? -d : 0; }
  }
  const ag = rma(up, period), al = rma(dn, period);
  const out = nanArr(n);
  for (let i = 0; i < n; i++) {
    const g = ag[i]!, l = al[i]!;
    if (g !== g || l !== l) continue;
    out[i] = l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l);
  }
  return out;
}
