import type { Columns, IndicatorDef, IndicatorMeta, ParamSpec, Params, Source } from '../types.ts';
import { sourceOf } from '../util/columns.ts';
import { nyDay } from './nyTime.ts';
import {
  type Arr, atr, ema, heikinAshi, highest, lowest, rma, rsi, sma, stdev, trueRange, wma,
} from './prims.ts';

// ───────────── helpers ─────────────

const SOURCES: Source[] = ['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4', 'volume'];

const pInt = (key: string, label: string, def: number, min: number, max: number, step = 1): ParamSpec =>
  ({ key, label, type: 'int', default: def, min, max, step });
const pFloat = (key: string, label: string, def: number, min: number, max: number, step: number): ParamSpec =>
  ({ key, label, type: 'float', default: def, min, max, step });
const pSrc = (def: Source = 'close'): ParamSpec =>
  ({ key: 'source', label: 'Price used', type: 'source', default: def, options: [...SOURCES] });

type Fn = (cols: Columns, p: Params) => Record<string, Arr>;
type MetaIn = Omit<IndicatorMeta, 'overlay'> & { overlay?: boolean };

function def(meta: MetaIn, fn: Fn): IndicatorDef {
  const defaults: Params = {};
  for (const s of meta.params) defaults[s.key] = s.default;
  const full: IndicatorMeta = { overlay: false, ...meta };
  return {
    ...full,
    compute(cols, params) {
      const merged: Params = { ...defaults };
      for (const k in params) if (params[k] !== undefined) merged[k] = params[k]!;
      return fn(cols, merged);
    },
  };
}

const int = (p: Params, k: string): number => Math.max(1, Math.round(Number(p[k])));
const flt = (p: Params, k: string): number => Number(p[k]);
const src = (cols: Columns, p: Params): Arr => sourceOf(cols, (p.source ?? 'close') as Source);
const nanArr = (n: number): Arr => new Float64Array(n).fill(NaN);
const out1 = (a: Arr): Record<string, Arr> => ({ value: a });

function zip(a: Arr, b: Arr, f: (x: number, y: number) => number): Arr {
  const o = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) o[i] = f(a[i]!, b[i]!);
  return o;
}

function shifted(x: Arr, k: number): Arr {
  const o = nanArr(x.length);
  for (let i = k; i < x.length; i++) o[i] = x[i - k]!;
  return o;
}

/** Raw stochastic %K of (hi, lo, close) over n bars. */
function stochRaw(hi: Arr, lo: Arr, cl: Arr, n: number): Arr {
  const hh = highest(hi, n), ll = lowest(lo, n);
  const o = nanArr(cl.length);
  for (let i = 0; i < cl.length; i++) {
    const r = hh[i]! - ll[i]!;
    if (r !== r) continue;
    o[i] = r > 0 ? (100 * (cl[i]! - ll[i]!)) / r : 50;
  }
  return o;
}

function hma(x: Arr, n: number): Arr {
  const half = Math.max(1, Math.floor(n / 2));
  const w = zip(wma(x, half), wma(x, n), (a, b) => 2 * a - b);
  return wma(w, Math.max(1, Math.round(Math.sqrt(n))));
}

function kama(x: Arr, n: number, fast: number, slow: number): Arr {
  const out = nanArr(x.length);
  const fs = 2 / (fast + 1), sl = 2 / (slow + 1);
  let prev = NaN;
  let run = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i]!;
    if (v !== v) { prev = NaN; run = 0; continue; }
    run++;
    if (run < n) continue;
    if (run === n) { prev = v; out[i] = prev; continue; }
    let vol = 0;
    for (let j = i - n + 1; j <= i; j++) vol += Math.abs(x[j]! - x[j - 1]!);
    const er = vol > 0 ? Math.abs(v - x[i - n]!) / vol : 0;
    const sc = (er * (fs - sl) + sl) ** 2;
    prev += sc * (v - prev);
    out[i] = prev;
  }
  return out;
}

function macd(x: Arr, fast: number, slow: number, sig: number): { macd: Arr; signal: Arr; hist: Arr } {
  const m = zip(ema(x, fast), ema(x, slow), (a, b) => a - b);
  const s = ema(m, sig);
  return { macd: m, signal: s, hist: zip(m, s, (a, b) => a - b) };
}

function bollinger(x: Arr, n: number, mult: number) {
  const mid = sma(x, n), sd = stdev(x, n);
  const upper = zip(mid, sd, (m, s) => m + mult * s);
  const lower = zip(mid, sd, (m, s) => m - mult * s);
  const pctB = nanArr(x.length), bw = nanArr(x.length);
  for (let i = 0; i < x.length; i++) {
    const w = upper[i]! - lower[i]!;
    if (w !== w) continue;
    pctB[i] = w > 0 ? (x[i]! - lower[i]!) / w : 0.5;
    bw[i] = mid[i]! !== 0 ? w / mid[i]! : NaN;
  }
  return { upper, middle: mid, lower, percentB: pctB, bandwidth: bw };
}

function adx(cols: Columns, n: number) {
  const len = cols.c.length;
  const pdm = nanArr(len), mdm = nanArr(len);
  for (let i = 1; i < len; i++) {
    const up = cols.h[i]! - cols.h[i - 1]!;
    const dn = cols.l[i - 1]! - cols.l[i]!;
    pdm[i] = up > dn && up > 0 ? up : 0;
    mdm[i] = dn > up && dn > 0 ? dn : 0;
  }
  const a = rma(trueRange(cols), n);
  const sp = rma(pdm, n), sm = rma(mdm, n);
  const pdi = nanArr(len), mdi = nanArr(len), dx = nanArr(len);
  for (let i = 0; i < len; i++) {
    if (a[i]! !== a[i]! || sp[i]! !== sp[i]! || sm[i]! !== sm[i]!) continue;
    const p = a[i]! > 0 ? (100 * sp[i]!) / a[i]! : 0;
    const m = a[i]! > 0 ? (100 * sm[i]!) / a[i]! : 0;
    pdi[i] = p; mdi[i] = m;
    dx[i] = p + m > 0 ? (100 * Math.abs(p - m)) / (p + m) : 0;
  }
  return { adx: rma(dx, n), pdi, mdi };
}

function superTrend(cols: Columns, n: number, mult: number): { line: Arr; dir: Arr } {
  const len = cols.c.length;
  const a = atr(cols, n);
  const line = nanArr(len), dir = nanArr(len);
  let fub = NaN, flb = NaN, d = 1;
  for (let i = 0; i < len; i++) {
    if (a[i]! !== a[i]!) continue;
    const mid = (cols.h[i]! + cols.l[i]!) / 2;
    const ub = mid + mult * a[i]!, lb = mid - mult * a[i]!;
    if (fub !== fub) {
      fub = ub; flb = lb; d = 1;
    } else {
      const pc = cols.c[i - 1]!;
      const nub = ub < fub || pc > fub ? ub : fub;
      const nlb = lb > flb || pc < flb ? lb : flb;
      fub = nub; flb = nlb;
      if (d === -1 && cols.c[i]! > fub) d = 1;
      else if (d === 1 && cols.c[i]! < flb) d = -1;
    }
    line[i] = d === 1 ? flb : fub;
    dir[i] = d;
  }
  return { line, dir };
}

function psar(cols: Columns, start: number, step: number, max: number): { sar: Arr; dir: Arr } {
  const n = cols.c.length;
  const sar = nanArr(n), dir = nanArr(n);
  if (n < 2) return { sar, dir };
  let up = cols.c[1]! >= cols.c[0]!;
  let s = up ? cols.l[0]! : cols.h[0]!;
  let ep = up ? cols.h[0]! : cols.l[0]!;
  let af = start;
  for (let i = 1; i < n; i++) {
    s = s + af * (ep - s);
    if (up) {
      s = Math.min(s, cols.l[i - 1]!, i >= 2 ? cols.l[i - 2]! : Infinity);
      if (cols.l[i]! < s) { up = false; s = ep; ep = cols.l[i]!; af = start; }
      else if (cols.h[i]! > ep) { ep = cols.h[i]!; af = Math.min(af + step, max); }
    } else {
      s = Math.max(s, cols.h[i - 1]!, i >= 2 ? cols.h[i - 2]! : -Infinity);
      if (cols.h[i]! > s) { up = true; s = ep; ep = cols.h[i]!; af = start; }
      else if (cols.l[i]! < ep) { ep = cols.l[i]!; af = Math.min(af + step, max); }
    }
    sar[i] = s;
    dir[i] = up ? 1 : -1;
  }
  return { sar, dir };
}

function linreg(x: Arr, n: number): { value: Arr; slope: Arr } {
  const len = x.length;
  const value = nanArr(len), slope = nanArr(len);
  const sx = (n * (n - 1)) / 2;
  const sxx = ((n - 1) * n * (2 * n - 1)) / 6;
  const den = n * sxx - sx * sx;
  let run = 0, s = 0, w = 0;
  for (let i = 0; i < len; i++) {
    const v = x[i]!;
    if (v !== v) { run = 0; continue; }
    run++;
    if (run < n) continue;
    if (run === n) {
      s = 0; w = 0;
      for (let j = 0; j < n; j++) { const y = x[i - n + 1 + j]!; s += y; w += j * y; }
    } else {
      const old = x[i - n]!;
      w = w - (s - old) + (n - 1) * v;
      s = s - old + v;
    }
    const sl = den > 0 ? (n * w - sx * s) / den : 0;
    slope[i] = sl;
    value[i] = (s - sl * sx) / n + sl * (n - 1);
  }
  return { value, slope };
}

// ───────────── catalog ─────────────

const maDef = (id: string, name: string, icon: string, blurb: string, fn: (x: Arr, n: number) => Arr): IndicatorDef =>
  def(
    {
      id, name, icon, category: 'trend', blurb, overlay: true,
      params: [pInt('period', 'Length', 20, 2, 200), pSrc()],
      outputs: [{ key: 'value', label: name }],
    },
    (cols, p) => out1(fn(src(cols, p), int(p, 'period'))),
  );

export const INDICATORS: IndicatorDef[] = [
  maDef('sma', 'SMA', '📈', 'The plain average of recent prices, a calm line that shows which way the market is drifting.', sma),
  maDef('ema', 'EMA', '⚡', 'Like a regular average but it listens harder to the newest prices, so it reacts faster.', ema),
  maDef('wma', 'WMA', '📐', 'An average that gives each newer price a bit more weight than the one before it.', wma),
  maDef('hma', 'HMA', '🚀', 'A very smooth average that still turns quickly, so it lags much less than the usual ones.', hma),
  maDef('dema', 'DEMA', '🏃', 'A double-smoothed EMA that cuts out most of the lag of a normal moving average.', (x, n) => {
    const e1 = ema(x, n);
    return zip(e1, ema(e1, n), (a, b) => 2 * a - b);
  }),
  maDef('tema', 'TEMA', '🚗', 'A triple-smoothed EMA that hugs the price closely while filtering out the noise.', (x, n) => {
    const e1 = ema(x, n), e2 = ema(e1, n), e3 = ema(e2, n);
    const o = new Float64Array(x.length);
    for (let i = 0; i < o.length; i++) o[i] = 3 * e1[i]! - 3 * e2[i]! + e3[i]!;
    return o;
  }),

  def(
    {
      id: 'vwma', name: 'VWMA', icon: '🐋', category: 'trend', overlay: true,
      blurb: 'An average where busy, high-volume bars count for more than quiet ones.',
      params: [pInt('period', 'Length', 20, 2, 200), pSrc()],
      outputs: [{ key: 'value', label: 'VWMA' }],
    },
    (cols, p) => {
      const n = int(p, 'period');
      const x = src(cols, p);
      const pv = zip(x, cols.v, (a, b) => a * b);
      return out1(zip(sma(pv, n), sma(cols.v, n), (a, b) => (b > 0 ? a / b : NaN)));
    },
  ),

  def(
    {
      id: 'kama', name: 'KAMA', icon: '🦎', category: 'trend', overlay: true,
      blurb: 'An adaptive average that speeds up when the market trends and slows down when it just wiggles.',
      params: [pInt('period', 'Efficiency length', 10, 2, 100), pInt('fast', 'Fast speed', 2, 1, 20), pInt('slow', 'Slow speed', 30, 5, 100), pSrc()],
      outputs: [{ key: 'value', label: 'KAMA' }],
    },
    (cols, p) => out1(kama(src(cols, p), int(p, 'period'), int(p, 'fast'), int(p, 'slow'))),
  ),

  def(
    {
      id: 'rsi', name: 'RSI', icon: '🔥', category: 'momentum', range: [0, 100], levels: [30, 70],
      blurb: 'A 0-to-100 gauge of how hot or cold the market is: above 70 is stretched up, below 30 is stretched down.',
      params: [pInt('period', 'Length', 14, 2, 100), pSrc()],
      outputs: [{ key: 'value', label: 'RSI' }],
    },
    (cols, p) => out1(rsi(src(cols, p), int(p, 'period'))),
  ),

  def(
    {
      id: 'stoch', name: 'Stochastic', icon: '🎯', category: 'momentum', range: [0, 100], levels: [20, 80],
      blurb: 'Shows where the price sits inside its recent high-to-low range, from the floor (0) to the ceiling (100).',
      params: [pInt('kPeriod', '%K length', 14, 2, 100), pInt('smooth', '%K smoothing', 3, 1, 20), pInt('dPeriod', '%D length', 3, 1, 20)],
      outputs: [{ key: 'k', label: '%K' }, { key: 'd', label: '%D' }],
    },
    (cols, p) => {
      const raw = stochRaw(cols.h, cols.l, cols.c, int(p, 'kPeriod'));
      const k = int(p, 'smooth') > 1 ? sma(raw, int(p, 'smooth')) : raw;
      return { k, d: sma(k, int(p, 'dPeriod')) };
    },
  ),

  def(
    {
      id: 'stochrsi', name: 'Stochastic RSI', icon: '🎪', category: 'momentum', range: [0, 100], levels: [20, 80],
      blurb: 'A faster, twitchier version of RSI that flags overbought and oversold swings earlier.',
      params: [pInt('rsiPeriod', 'RSI length', 14, 2, 100), pInt('stochPeriod', 'Stochastic length', 14, 2, 100), pInt('smoothK', '%K smoothing', 3, 1, 20), pInt('smoothD', '%D smoothing', 3, 1, 20), pSrc()],
      outputs: [{ key: 'k', label: '%K' }, { key: 'd', label: '%D' }],
    },
    (cols, p) => {
      const r = rsi(src(cols, p), int(p, 'rsiPeriod'));
      const raw = stochRaw(r, r, r, int(p, 'stochPeriod'));
      const k = int(p, 'smoothK') > 1 ? sma(raw, int(p, 'smoothK')) : raw;
      return { k, d: sma(k, int(p, 'smoothD')) };
    },
  ),

  def(
    {
      id: 'macd', name: 'MACD', icon: '🌊', category: 'momentum', levels: [0],
      blurb: 'Compares a fast and a slow average to show when momentum is building up or fading away.',
      params: [pInt('fast', 'Fast length', 12, 2, 100), pInt('slow', 'Slow length', 26, 3, 200), pInt('signal', 'Signal length', 9, 2, 50), pSrc()],
      outputs: [{ key: 'macd', label: 'MACD' }, { key: 'signal', label: 'Signal' }, { key: 'hist', label: 'Histogram' }],
    },
    (cols, p) => macd(src(cols, p), int(p, 'fast'), int(p, 'slow'), int(p, 'signal')),
  ),

  def(
    {
      id: 'cci', name: 'CCI', icon: '🎢', category: 'momentum', levels: [-100, 0, 100],
      blurb: 'Measures how far the price has wandered from its usual level, so extreme readings hint at a snap-back.',
      params: [pInt('period', 'Length', 20, 2, 200)],
      outputs: [{ key: 'value', label: 'CCI' }],
    },
    (cols, p) => {
      const n = int(p, 'period');
      const tp = sourceOf(cols, 'hlc3');
      const m = sma(tp, n);
      const o = nanArr(tp.length);
      for (let i = 0; i < tp.length; i++) {
        if (m[i]! !== m[i]!) continue;
        let md = 0;
        for (let j = i - n + 1; j <= i; j++) md += Math.abs(tp[j]! - m[i]!);
        md /= n;
        o[i] = md > 0 ? (tp[i]! - m[i]!) / (0.015 * md) : 0;
      }
      return out1(o);
    },
  ),

  def(
    {
      id: 'roc', name: 'ROC', icon: '💨', category: 'momentum', levels: [0],
      blurb: 'The percent the price has moved over the last few bars, so you can see how fast it is going.',
      params: [pInt('period', 'Length', 12, 1, 200), pSrc()],
      outputs: [{ key: 'value', label: 'ROC %' }],
    },
    (cols, p) => {
      const x = src(cols, p), n = int(p, 'period');
      return out1(zip(x, shifted(x, n), (a, b) => (b !== 0 ? (a / b - 1) * 100 : NaN)));
    },
  ),

  def(
    {
      id: 'mom', name: 'Momentum', icon: '🏀', category: 'momentum', levels: [0],
      blurb: 'How many points the price has gained or lost compared with a few bars ago.',
      params: [pInt('period', 'Length', 10, 1, 200), pSrc()],
      outputs: [{ key: 'value', label: 'Momentum' }],
    },
    (cols, p) => {
      const x = src(cols, p);
      return out1(zip(x, shifted(x, int(p, 'period')), (a, b) => a - b));
    },
  ),

  def(
    {
      id: 'willr', name: 'Williams %R', icon: '🎳', category: 'momentum', range: [-100, 0], levels: [-80, -20],
      blurb: 'Shows how close the price is to its recent high: near 0 is the top, near -100 is the bottom.',
      params: [pInt('period', 'Length', 14, 2, 100)],
      outputs: [{ key: 'value', label: '%R' }],
    },
    (cols, p) => out1(zip(stochRaw(cols.h, cols.l, cols.c, int(p, 'period')), cols.c, (k) => k - 100)),
  ),

  def(
    {
      id: 'mfi', name: 'MFI', icon: '💰', category: 'volume', range: [0, 100], levels: [20, 80],
      blurb: 'Like RSI but it also counts volume, so it tells you if real money is flowing in or out.',
      params: [pInt('period', 'Length', 14, 2, 100)],
      outputs: [{ key: 'value', label: 'MFI' }],
    },
    (cols, p) => {
      const n = int(p, 'period');
      const tp = sourceOf(cols, 'hlc3');
      const pos = nanArr(tp.length), neg = nanArr(tp.length);
      for (let i = 1; i < tp.length; i++) {
        const flow = tp[i]! * cols.v[i]!;
        pos[i] = tp[i]! > tp[i - 1]! ? flow : 0;
        neg[i] = tp[i]! < tp[i - 1]! ? flow : 0;
      }
      return out1(zip(sma(pos, n), sma(neg, n), (a, b) => (b > 0 ? 100 - 100 / (1 + a / b) : a > 0 ? 100 : 50)));
    },
  ),

  def(
    {
      id: 'adx', name: 'ADX', icon: '💪', category: 'trend', range: [0, 100], levels: [20, 25],
      blurb: 'Tells you how strong a trend is (not which way): above 25 means the market is really going somewhere.',
      params: [pInt('period', 'Length', 14, 2, 100)],
      outputs: [{ key: 'adx', label: 'ADX' }, { key: 'pdi', label: '+DI' }, { key: 'mdi', label: '−DI' }],
    },
    (cols, p) => adx(cols, int(p, 'period')),
  ),

  def(
    {
      id: 'aroon', name: 'Aroon', icon: '🧭', category: 'trend', range: [-100, 100], levels: [0],
      blurb: 'Counts how recently the market made a new high or low, to show whether a trend is fresh or tired.',
      params: [pInt('period', 'Length', 25, 2, 200)],
      outputs: [{ key: 'up', label: 'Aroon Up' }, { key: 'down', label: 'Aroon Down' }, { key: 'osc', label: 'Oscillator' }],
    },
    (cols, p) => {
      const n = int(p, 'period');
      const len = cols.c.length;
      const up = nanArr(len), down = nanArr(len), osc = nanArr(len);
      for (let i = n; i < len; i++) {
        let hi = i, lo = i;
        for (let j = i - n; j <= i; j++) {
          if (cols.h[j]! >= cols.h[hi]!) hi = j;
          if (cols.l[j]! <= cols.l[lo]!) lo = j;
        }
        up[i] = (100 * (n - (i - hi))) / n;
        down[i] = (100 * (n - (i - lo))) / n;
        osc[i] = up[i]! - down[i]!;
      }
      return { up, down, osc };
    },
  ),

  def(
    {
      id: 'atr', name: 'ATR', icon: '📏', category: 'volatility',
      blurb: 'The typical size of one candle, handy for placing stops that match how wild the market is.',
      params: [pInt('period', 'Length', 14, 1, 100)],
      outputs: [{ key: 'value', label: 'ATR' }],
    },
    (cols, p) => out1(atr(cols, int(p, 'period'))),
  ),

  def(
    {
      id: 'natr', name: 'NATR', icon: '🔬', category: 'volatility',
      blurb: 'ATR shown as a percent of price, so you can compare how jumpy different markets are.',
      params: [pInt('period', 'Length', 14, 1, 100)],
      outputs: [{ key: 'value', label: 'NATR %' }],
    },
    (cols, p) => out1(zip(atr(cols, int(p, 'period')), cols.c, (a, c) => (c !== 0 ? (100 * a) / c : NaN))),
  ),

  def(
    {
      id: 'bb', name: 'Bollinger Bands', icon: '🎈', category: 'volatility', overlay: true,
      blurb: 'A stretchy band around the average price: touching the edges means the market has stretched far.',
      params: [pInt('period', 'Length', 20, 2, 200), pFloat('mult', 'Width (std devs)', 2, 0.5, 5, 0.1), pSrc()],
      outputs: [
        { key: 'upper', label: 'Upper' }, { key: 'middle', label: 'Middle' }, { key: 'lower', label: 'Lower' },
        { key: 'percentB', label: '%B' }, { key: 'bandwidth', label: 'Bandwidth' },
      ],
    },
    (cols, p) => bollinger(src(cols, p), int(p, 'period'), flt(p, 'mult')),
  ),

  def(
    {
      id: 'keltner', name: 'Keltner Channels', icon: '🎀', category: 'volatility', overlay: true,
      blurb: 'A channel around a moving average whose width follows the average candle size.',
      params: [pInt('period', 'Average length', 20, 2, 200), pInt('atrPeriod', 'ATR length', 10, 1, 100), pFloat('mult', 'Width (ATRs)', 2, 0.5, 6, 0.1), pSrc()],
      outputs: [{ key: 'upper', label: 'Upper' }, { key: 'middle', label: 'Middle' }, { key: 'lower', label: 'Lower' }],
    },
    (cols, p) => {
      const mid = ema(src(cols, p), int(p, 'period'));
      const a = atr(cols, int(p, 'atrPeriod'));
      const m = flt(p, 'mult');
      return { upper: zip(mid, a, (x, y) => x + m * y), middle: mid, lower: zip(mid, a, (x, y) => x - m * y) };
    },
  ),

  def(
    {
      id: 'donchian', name: 'Donchian Channels', icon: '🧱', category: 'volatility', overlay: true,
      blurb: 'Draws the highest high and lowest low of the last few bars; breaking out of it often starts a trend.',
      params: [pInt('period', 'Length', 20, 2, 200)],
      outputs: [{ key: 'upper', label: 'Upper' }, { key: 'middle', label: 'Middle' }, { key: 'lower', label: 'Lower' }],
    },
    (cols, p) => {
      const n = int(p, 'period');
      const upper = highest(cols.h, n), lower = lowest(cols.l, n);
      return { upper, middle: zip(upper, lower, (a, b) => (a + b) / 2), lower };
    },
  ),

  def(
    {
      id: 'stdev', name: 'Std Deviation', icon: '🎲', category: 'volatility',
      blurb: 'A measure of how scattered recent prices are: a big number means a wild, unpredictable market.',
      params: [pInt('period', 'Length', 20, 2, 200), pSrc()],
      outputs: [{ key: 'value', label: 'StdDev' }],
    },
    (cols, p) => out1(stdev(src(cols, p), int(p, 'period'))),
  ),

  def(
    {
      id: 'supertrend', name: 'SuperTrend', icon: '🦸', category: 'trend', overlay: true,
      blurb: 'A line that sits under the price in an uptrend and above it in a downtrend, flipping when the trend turns.',
      params: [pInt('period', 'ATR length', 10, 1, 100), pFloat('mult', 'Multiplier', 3, 0.5, 10, 0.1)],
      outputs: [{ key: 'line', label: 'SuperTrend' }, { key: 'dir', label: 'Direction (+1 up, -1 down)' }],
    },
    (cols, p) => superTrend(cols, int(p, 'period'), flt(p, 'mult')),
  ),

  def(
    {
      id: 'psar', name: 'Parabolic SAR', icon: '🪂', category: 'trend', overlay: true,
      blurb: 'A trail of dots that follows the price and speeds up the longer the trend lasts, showing where to bail out.',
      params: [pFloat('start', 'Start speed', 0.02, 0.005, 0.1, 0.005), pFloat('step', 'Speed-up step', 0.02, 0.005, 0.1, 0.005), pFloat('max', 'Max speed', 0.2, 0.05, 0.5, 0.01)],
      outputs: [{ key: 'sar', label: 'SAR' }, { key: 'dir', label: 'Direction (+1 up, -1 down)' }],
    },
    (cols, p) => psar(cols, flt(p, 'start'), flt(p, 'step'), flt(p, 'max')),
  ),

  def(
    {
      id: 'ichimoku', name: 'Ichimoku', icon: '🏯', category: 'trend', overlay: true,
      blurb: 'A Japanese all-in-one picture of trend and support: price above the cloud is bullish, below is bearish.',
      params: [pInt('tenkan', 'Conversion length', 9, 2, 100), pInt('kijun', 'Base length', 26, 2, 200), pInt('senkouB', 'Cloud length', 52, 2, 300)],
      outputs: [
        { key: 'tenkan', label: 'Conversion' }, { key: 'kijun', label: 'Base' },
        { key: 'senkouA', label: 'Cloud A' }, { key: 'senkouB', label: 'Cloud B' },
      ],
    },
    (cols, p) => {
      const mid = (n: number) => zip(highest(cols.h, n), lowest(cols.l, n), (a, b) => (a + b) / 2);
      const tenkan = mid(int(p, 'tenkan')), kijun = mid(int(p, 'kijun'));
      return { tenkan, kijun, senkouA: zip(tenkan, kijun, (a, b) => (a + b) / 2), senkouB: mid(int(p, 'senkouB')) };
    },
  ),

  def(
    {
      id: 'vwap', name: 'VWAP', icon: '⚓', category: 'volume', overlay: true,
      blurb: 'The average price paid today, weighted by volume; big traders use it as a fair-price anchor that resets each day.',
      params: [pSrc('hlc3')],
      outputs: [{ key: 'value', label: 'VWAP' }],
    },
    (cols, p) => {
      const x = src(cols, p);
      const o = nanArr(x.length);
      let day = NaN, pv = 0, vv = 0;
      for (let i = 0; i < x.length; i++) {
        const d = nyDay(cols.t[i]!);
        if (d !== day) { day = d; pv = 0; vv = 0; }
        pv += x[i]! * cols.v[i]!;
        vv += cols.v[i]!;
        o[i] = vv > 0 ? pv / vv : x[i]!;
      }
      return out1(o);
    },
  ),

  def(
    {
      id: 'obv', name: 'OBV', icon: '🔋', category: 'volume',
      blurb: 'A running total that adds volume on up days and subtracts it on down days, showing who is really buying.',
      params: [],
      outputs: [{ key: 'value', label: 'OBV' }],
    },
    (cols) => {
      const o = new Float64Array(cols.c.length);
      for (let i = 1; i < o.length; i++) {
        const d = cols.c[i]! - cols.c[i - 1]!;
        o[i] = o[i - 1]! + (d > 0 ? cols.v[i]! : d < 0 ? -cols.v[i]! : 0);
      }
      return out1(o);
    },
  ),

  def(
    {
      id: 'cmf', name: 'CMF', icon: '💧', category: 'volume', range: [-1, 1], levels: [0],
      blurb: 'Shows whether money is flowing into or out of the market: above zero is buying pressure, below is selling.',
      params: [pInt('period', 'Length', 20, 2, 100)],
      outputs: [{ key: 'value', label: 'CMF' }],
    },
    (cols, p) => {
      const n = int(p, 'period');
      const mfv = new Float64Array(cols.c.length);
      for (let i = 0; i < mfv.length; i++) {
        const r = cols.h[i]! - cols.l[i]!;
        mfv[i] = r > 0 ? (((cols.c[i]! - cols.l[i]!) - (cols.h[i]! - cols.c[i]!)) / r) * cols.v[i]! : 0;
      }
      return out1(zip(sma(mfv, n), sma(cols.v, n), (a, b) => (b > 0 ? a / b : 0)));
    },
  ),

  def(
    {
      id: 'volsma', name: 'Volume SMA', icon: '📊', category: 'volume',
      blurb: 'Compares each bar\'s trading volume with its recent average, so you can spot unusually busy moments.',
      params: [pInt('period', 'Length', 20, 2, 200)],
      outputs: [{ key: 'volume', label: 'Volume' }, { key: 'sma', label: 'Average' }],
    },
    (cols, p) => ({ volume: Float64Array.from(cols.v), sma: sma(cols.v, int(p, 'period')) }),
  ),

  def(
    {
      id: 'ha', name: 'Heikin-Ashi', icon: '🍡', category: 'candles', overlay: true,
      blurb: 'Smoothed candles that hide the noise, so trends show up as long runs of the same colour.',
      params: [],
      outputs: [
        { key: 'open', label: 'Open' }, { key: 'high', label: 'High' }, { key: 'low', label: 'Low' },
        { key: 'close', label: 'Close' }, { key: 'dir', label: 'Colour (+1 up, -1 down)' },
      ],
    },
    (cols) => {
      const h = heikinAshi(cols);
      return { open: h.o, high: h.h, low: h.l, close: h.c, dir: zip(h.c, h.o, (c, o) => (c >= o ? 1 : c < o ? -1 : NaN)) };
    },
  ),

  def(
    {
      id: 'linreg', name: 'Linear Regression', icon: '📉', category: 'trend', overlay: true,
      blurb: 'Fits a straight line through recent prices; its tilt (slope) tells you how steeply the market is rising or falling.',
      params: [pInt('period', 'Length', 20, 3, 200), pSrc()],
      outputs: [{ key: 'value', label: 'Regression line' }, { key: 'slope', label: 'Slope' }],
    },
    (cols, p) => linreg(src(cols, p), int(p, 'period')),
  ),

  def(
    {
      id: 'zscore', name: 'Z-Score', icon: '🔭', category: 'momentum', range: [-4, 4], levels: [-2, 0, 2],
      blurb: 'Counts how many "normal wiggles" the price is away from its average; beyond 2 is unusually far.',
      params: [pInt('period', 'Length', 20, 3, 200), pSrc()],
      outputs: [{ key: 'value', label: 'Z-Score' }],
    },
    (cols, p) => {
      const x = src(cols, p), n = int(p, 'period');
      const m = sma(x, n), sd = stdev(x, n);
      const o = nanArr(x.length);
      for (let i = 0; i < x.length; i++) if (sd[i]! === sd[i]!) o[i] = sd[i]! > 0 ? (x[i]! - m[i]!) / sd[i]! : 0;
      return out1(o);
    },
  ),

  def(
    {
      id: 'chop', name: 'Choppiness Index', icon: '🌀', category: 'trend', range: [0, 100], levels: [38.2, 61.8],
      blurb: 'Tells you if the market is trending (low numbers) or just chopping sideways (high numbers).',
      params: [pInt('period', 'Length', 14, 2, 100)],
      outputs: [{ key: 'value', label: 'Chop' }],
    },
    (cols, p) => {
      const n = int(p, 'period');
      const tr = trueRange(cols);
      const sum = sma(tr, n);
      const hh = highest(cols.h, n), ll = lowest(cols.l, n);
      const o = nanArr(tr.length);
      for (let i = 0; i < o.length; i++) {
        const r = hh[i]! - ll[i]!;
        if (r !== r) continue;
        o[i] = r > 0 && sum[i]! > 0 ? (100 * Math.log10((sum[i]! * n) / r)) / Math.log10(n) : 50;
      }
      return out1(o);
    },
  ),

  def(
    {
      id: 'pdhl', name: 'Previous Day High/Low', icon: '🔖', category: 'price', overlay: true,
      blurb: 'Marks yesterday\'s high and low, price levels that traders watch closely for bounces and breakouts.',
      params: [],
      outputs: [{ key: 'pdh', label: 'Prev Day High' }, { key: 'pdl', label: 'Prev Day Low' }],
    },
    (cols) => {
      const n = cols.c.length;
      const pdh = nanArr(n), pdl = nanArr(n);
      let day = NaN, curH = NaN, curL = NaN, ph = NaN, pl = NaN;
      for (let i = 0; i < n; i++) {
        const d = nyDay(cols.t[i]!);
        if (d !== day) {
          if (day === day) { ph = curH; pl = curL; }
          day = d; curH = cols.h[i]!; curL = cols.l[i]!;
        } else {
          if (cols.h[i]! > curH) curH = cols.h[i]!;
          if (cols.l[i]! < curL) curL = cols.l[i]!;
        }
        pdh[i] = ph; pdl[i] = pl;
      }
      return { pdh, pdl };
    },
  ),
];

// ───────────── registry API ─────────────

const BY_ID = new Map(INDICATORS.map((d) => [d.id, d]));

export function getIndicator(id: string): IndicatorDef {
  const d = BY_ID.get(id);
  if (!d) throw new Error(`Unknown indicator "${id}". Available: ${INDICATORS.map((x) => x.id).join(', ')}`);
  return d;
}

export function listIndicators(): IndicatorMeta[] {
  return INDICATORS.map(({ compute: _compute, ...meta }) => meta);
}

/** Computes an indicator, filling missing params with the defaults. */
export function computeIndicator(cols: Columns, id: string, params: Params = {}): Record<string, Float64Array> {
  return getIndicator(id).compute(cols, params);
}
