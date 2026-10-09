import type { Columns, Condition, Distance, Operand, Params, StrategySpec } from '../types.ts';
import { atr, computeIndicator, getIndicator, heikinAshi } from '../indicators/index.ts';
import { sourceOf } from '../util/columns.ts';
import { minutesOfDay, parseHHMM } from '../core/time.ts';

/**
 * A strategy compiled against one set of columns. Every condition is precomputed into a
 * boolean array once, so evaluating bar i is an array lookup. Indicators are causal, so
 * reading index i never looks ahead.
 */
export interface CompiledStrategy {
  spec: StrategySpec;
  /** First bar index where every referenced indicator (and offset) is defined. */
  warmup: number;
  hasLong: boolean;
  hasShort: boolean;
  longEntry(i: number): boolean;
  shortEntry(i: number): boolean;
  exitSignal(i: number): boolean;
  /** Price distance from entry to the stop, NaN when the spec has no stop. */
  stopDistance(i: number, entry: number): number;
  /** Price distance from entry to the target, NaN when none. */
  targetDistance(i: number, entry: number): number;
  /** Trailing distance in price units, NaN when none. */
  trailDistance(i: number): number;
  /** flatAt as minutes after midnight New York time. */
  flatAt?: number;
  maxBars?: number;
  /** Raw (un-rounded) position size for an entry at `entry`. */
  size(i: number, equity: number, entry: number, stopDist: number, pointValue: number): number;
}

interface Ctx {
  cols: Columns;
  n: number;
  ind: Map<string, Record<string, Float64Array>>;
  atrs: Map<number, Float64Array>;
  ha?: { o: Float64Array; c: Float64Array };
  minutes: Map<string, Float64Array>;
}

const firstFinite = (a: Float64Array): number => {
  for (let i = 0; i < a.length; i++) if (a[i] === a[i]) return i;
  return a.length;
};

/** Fill indicator defaults so {period:14} and {} share one cache entry. */
export function normalizeParams(id: string, params: Params): Params {
  const def = getIndicator(id);
  const out: Params = {};
  for (const p of def.params) out[p.key] = params[p.key] ?? p.default;
  return out;
}

function indicatorArray(ctx: Ctx, op: Extract<Operand, { kind: 'indicator' }>): Float64Array {
  const def = getIndicator(op.id);
  const params = normalizeParams(op.id, op.params ?? {});
  const key = op.id + '|' + JSON.stringify(params);
  let res = ctx.ind.get(key);
  if (!res) {
    res = computeIndicator(ctx.cols, op.id, params);
    ctx.ind.set(key, res);
  }
  const outKey = op.output ?? def.outputs[0]?.key;
  const arr = outKey !== undefined ? res[outKey] : undefined;
  if (!arr) throw new Error(`Indicator "${op.id}" has no output "${String(op.output)}"`);
  return arr;
}

/** Operand as a full-length array of values at each bar (offset applied, NaN before data). */
function operandValues(ctx: Ctx, op: Operand): { v: Float64Array; warm: number } {
  const n = ctx.n;
  if (op.kind === 'const') return { v: new Float64Array(n).fill(op.value), warm: 0 };
  const base = op.kind === 'price' ? sourceOf(ctx.cols, op.source) : indicatorArray(ctx, op);
  const off = Math.max(0, Math.floor(op.offset ?? 0));
  if (off === 0) return { v: base, warm: firstFinite(base) };
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) v[i] = i - off >= 0 ? base[i - off]! : NaN;
  return { v, warm: firstFinite(base) + off };
}

function getHa(ctx: Ctx) {
  if (!ctx.ha) {
    const h = heikinAshi(ctx.cols);
    ctx.ha = { o: h.o, c: h.c };
  }
  return ctx.ha;
}

function candle(ctx: Ctx, pattern: string, out: Uint8Array): number {
  const { o, h, l, c } = ctx.cols;
  const n = ctx.n;
  switch (pattern) {
    case 'bullish': for (let i = 0; i < n; i++) out[i] = c[i]! > o[i]! ? 1 : 0; return 0;
    case 'bearish': for (let i = 0; i < n; i++) out[i] = c[i]! < o[i]! ? 1 : 0; return 0;
    case 'ha_bullish':
    case 'ha_bearish': {
      const ha = getHa(ctx);
      const up = pattern === 'ha_bullish';
      for (let i = 0; i < n; i++) out[i] = (up ? ha.c[i]! > ha.o[i]! : ha.c[i]! < ha.o[i]!) ? 1 : 0;
      return 0;
    }
    case 'doji':
      for (let i = 0; i < n; i++) {
        const r = h[i]! - l[i]!;
        out[i] = r > 0 && Math.abs(c[i]! - o[i]!) <= 0.1 * r ? 1 : 0;
      }
      return 0;
    case 'hammer':
    case 'shooting_star': {
      const ham = pattern === 'hammer';
      for (let i = 0; i < n; i++) {
        const r = h[i]! - l[i]!;
        if (!(r > 0)) { out[i] = 0; continue; }
        const body = Math.abs(c[i]! - o[i]!);
        const lowW = Math.min(o[i]!, c[i]!) - l[i]!;
        const upW = h[i]! - Math.max(o[i]!, c[i]!);
        const longW = ham ? lowW : upW, shortW = ham ? upW : lowW;
        out[i] = body <= 0.35 * r && longW >= 2 * Math.max(body, 0.05 * r) && shortW <= 0.15 * r ? 1 : 0;
      }
      return 0;
    }
    case 'engulfing_bull':
    case 'engulfing_bear': {
      const bull = pattern === 'engulfing_bull';
      out[0] = 0;
      for (let i = 1; i < n; i++) {
        const po = o[i - 1]!, pc = c[i - 1]!, co = o[i]!, cc = c[i]!;
        out[i] = bull
          ? (pc < po && cc > co && co <= pc && cc >= po && cc - co > po - pc ? 1 : 0)
          : (pc > po && cc < co && co >= pc && cc <= po && co - cc > pc - po ? 1 : 0);
      }
      return 1;
    }
    case 'inside_bar':
      out[0] = 0;
      for (let i = 1; i < n; i++) out[i] = h[i]! < h[i - 1]! && l[i]! > l[i - 1]! ? 1 : 0;
      return 1;
    case 'outside_bar':
      out[0] = 0;
      for (let i = 1; i < n; i++) out[i] = h[i]! > h[i - 1]! && l[i]! < l[i - 1]! ? 1 : 0;
      return 1;
  }
  throw new Error(`Unknown candle pattern "${pattern}"`);
}

/** Condition -> boolean per bar (1/0) plus the first index where it is meaningful. */
function compileCond(ctx: Ctx, c: Condition): { a: Uint8Array; warm: number } {
  const n = ctx.n;
  const a = new Uint8Array(n);
  switch (c.kind) {
    case 'compare': {
      const L = operandValues(ctx, c.left), R = operandValues(ctx, c.right);
      const l = L.v, r = R.v;
      switch (c.op) {
        case '>': for (let i = 0; i < n; i++) a[i] = l[i]! > r[i]! ? 1 : 0; break;
        case '<': for (let i = 0; i < n; i++) a[i] = l[i]! < r[i]! ? 1 : 0; break;
        case '>=': for (let i = 0; i < n; i++) a[i] = l[i]! >= r[i]! ? 1 : 0; break;
        case '<=': for (let i = 0; i < n; i++) a[i] = l[i]! <= r[i]! ? 1 : 0; break;
        default: throw new Error(`Unknown compare op "${String((c as { op: unknown }).op)}"`);
      }
      return { a, warm: Math.max(L.warm, R.warm) };
    }
    case 'cross': {
      const L = operandValues(ctx, c.left), R = operandValues(ctx, c.right);
      const l = L.v, r = R.v;
      const up = c.dir === 'above';
      for (let i = 1; i < n; i++) {
        const pl = l[i - 1]!, pr = r[i - 1]!, cl = l[i]!, cr = r[i]!;
        a[i] = up ? (pl <= pr && cl > cr ? 1 : 0) : (pl >= pr && cl < cr ? 1 : 0);
      }
      return { a, warm: Math.max(L.warm, R.warm) + 1 };
    }
    case 'rising':
    case 'falling': {
      const O = operandValues(ctx, c.operand);
      const v = O.v;
      const bars = Math.max(1, Math.floor(c.bars));
      const up = c.kind === 'rising';
      let run = 0;
      for (let i = 1; i < n; i++) {
        const ok = up ? v[i]! > v[i - 1]! : v[i]! < v[i - 1]!;
        run = ok ? run + 1 : 0;
        a[i] = run >= bars ? 1 : 0;
      }
      return { a, warm: O.warm + bars };
    }
    case 'candle': {
      const warm = candle(ctx, c.pattern, a);
      return { a, warm };
    }
    case 'time': {
      const from = parseHHMM(c.from), to = parseHHMM(c.to);
      if (from !== from || to !== to) throw new Error(`Bad time window ${c.from}-${c.to}`);
      const tz = c.tz ?? 'America/New_York';
      let m = ctx.minutes.get(tz);
      if (!m) {
        m = new Float64Array(n);
        for (let i = 0; i < n; i++) m[i] = minutesOfDay(ctx.cols.t[i]!, tz);
        ctx.minutes.set(tz, m);
      }
      const wrap = from > to;
      for (let i = 0; i < n; i++) {
        const x = m[i]!;
        a[i] = (wrap ? x >= from || x < to : x >= from && x < to) ? 1 : 0;
      }
      return { a, warm: 0 };
    }
    case 'all':
    case 'any': {
      const all = c.kind === 'all';
      if (c.of.length === 0) { a.fill(all ? 1 : 0); return { a, warm: 0 }; }
      let warm = 0;
      a.fill(all ? 1 : 0);
      for (const sub of c.of) {
        const s = compileCond(ctx, sub);
        warm = Math.max(warm, s.warm);
        const b = s.a;
        if (all) for (let i = 0; i < n; i++) a[i] = a[i]! & b[i]!;
        else for (let i = 0; i < n; i++) a[i] = a[i]! | b[i]!;
      }
      return { a, warm };
    }
    case 'not': {
      const s = compileCond(ctx, c.of);
      const b = s.a;
      for (let i = 0; i < n; i++) a[i] = b[i]! ? 0 : 1;
      // Before warm-up the inner condition is "false" only because data is missing.
      for (let i = 0; i < Math.min(s.warm, n); i++) a[i] = 0;
      return { a, warm: s.warm };
    }
  }
  throw new Error(`Unknown condition kind "${String((c as { kind: unknown }).kind)}"`);
}

function atrOf(ctx: Ctx, period: number): Float64Array {
  const p = Math.max(1, Math.floor(period));
  let a = ctx.atrs.get(p);
  if (!a) {
    a = atr(ctx.cols, p);
    ctx.atrs.set(p, a);
  }
  return a;
}

/** Distance -> function (i, entry) => price distance, plus warm-up. */
function compileDistance(ctx: Ctx, d: Distance): { f: (i: number, entry: number) => number; warm: number } {
  switch (d.kind) {
    case 'atr': {
      const a = atrOf(ctx, d.period);
      const m = d.mult;
      return { f: (i) => a[i]! * m, warm: firstFinite(a) };
    }
    case 'percent': {
      const p = d.value / 100;
      return { f: (_i, e) => e * p, warm: 0 };
    }
    case 'points': {
      const v = d.value;
      return { f: () => v, warm: 0 };
    }
  }
  throw new Error(`Unknown distance kind "${String((d as { kind: unknown }).kind)}"`);
}

const NONE = (): number => NaN;

export function compileStrategy(spec: StrategySpec, cols: Columns): CompiledStrategy {
  const n = cols.c.length;
  const ctx: Ctx = { cols, n, ind: new Map(), atrs: new Map(), minutes: new Map() };
  let warmup = 0;

  const compileOpt = (c: Condition | undefined) => {
    if (!c) return null;
    const r = compileCond(ctx, c);
    warmup = Math.max(warmup, r.warm);
    return r.a;
  };
  const L = compileOpt(spec.long?.enter);
  const S = compileOpt(spec.short?.enter);
  const X = compileOpt(spec.exits.exitWhen);

  const ex = spec.exits;
  let stop: (i: number, e: number) => number = NONE;
  if (ex.stopLoss) {
    const d = compileDistance(ctx, ex.stopLoss);
    stop = d.f;
    warmup = Math.max(warmup, d.warm);
  }
  let target: (i: number, e: number) => number = NONE;
  if (ex.takeProfit) {
    const tp = ex.takeProfit;
    if (tp.kind === 'rr') {
      const ratio = tp.ratio;
      target = (i, e) => stop(i, e) * ratio;
    } else {
      const d = compileDistance(ctx, tp);
      target = d.f;
      warmup = Math.max(warmup, d.warm);
    }
  }
  let trail: (i: number) => number = NONE;
  if (ex.trailing) {
    const d = compileDistance(ctx, ex.trailing);
    const f = d.f;
    const c = cols.c;
    trail = (i) => f(i, c[i]!);
    warmup = Math.max(warmup, d.warm);
  }

  const sz = spec.sizing;
  let size: CompiledStrategy['size'];
  switch (sz.kind) {
    case 'fixed': { const q = sz.qty; size = () => q; break; }
    case 'risk': {
      const p = sz.percent / 100;
      size = (_i, eq, _e, sd, pv) => (sd > 0 && sd === sd ? (eq * p) / (sd * pv) : 1);
      break;
    }
    case 'percentEquity': {
      const p = sz.percent / 100;
      size = (_i, eq, e, _sd, pv) => (e > 0 ? (eq * p) / (e * pv) : 0);
      break;
    }
    default: throw new Error(`Unknown sizing kind "${String((sz as { kind: unknown }).kind)}"`);
  }

  const flat = ex.flatAt !== undefined ? parseHHMM(ex.flatAt) : NaN;
  return {
    spec,
    warmup: Math.min(warmup, Math.max(0, n - 1)),
    hasLong: L !== null,
    hasShort: S !== null,
    longEntry: L ? (i) => L[i] === 1 : () => false,
    shortEntry: S ? (i) => S[i] === 1 : () => false,
    exitSignal: X ? (i) => X[i] === 1 : () => false,
    stopDistance: stop,
    targetDistance: target,
    trailDistance: trail,
    flatAt: flat === flat ? flat : undefined,
    maxBars: ex.maxBars !== undefined && ex.maxBars > 0 ? Math.floor(ex.maxBars) : undefined,
    size,
  };
}
