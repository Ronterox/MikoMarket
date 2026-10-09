import type { CandlePattern, CompareOp, Condition, GeneSpec, Operand, Params, Source } from '../types.ts';
import { INDICATORS } from '../indicators/index.ts';

export type BlockGroup = 'trend' | 'momentum' | 'volatility' | 'candles' | 'time';

/** A friendly builder "card". Gene paths are relative to `condition`. */
export interface BlockCard {
  id: string;
  icon: string;
  label: string;          // <= 4 words
  group: BlockGroup;
  side: 'long' | 'short' | 'both';
  blurb: string;
  condition: Condition;
  genes: GeneSpec[];
}

// small builders
export const price = (source: Source = 'close', offset?: number): Operand =>
  offset ? { kind: 'price', source, offset } : { kind: 'price', source };
export const ind = (id: string, params: Params = {}, output?: string, offset?: number): Operand => {
  const o: Operand = { kind: 'indicator', id, params };
  if (output !== undefined) o.output = output;
  if (offset) o.offset = offset;
  return o;
};
export const k = (value: number): Operand => ({ kind: 'const', value });
export const cmp = (left: Operand, op: CompareOp, right: Operand): Condition => ({ kind: 'compare', left, op, right });
export const cross = (left: Operand, dir: 'above' | 'below', right: Operand): Condition => ({ kind: 'cross', left, dir, right });
export const candle = (pattern: CandlePattern): Condition => ({ kind: 'candle', pattern });

const g = (path: string, label: string, min: number, max: number, step?: number, int = true): GeneSpec =>
  step !== undefined ? { path, label, min, max, step, int } : { path, label, min, max, int };

export const BLOCK_CATALOG: BlockCard[] = [
  // ── trend
  { id: 'price_above_ema', icon: '📈', label: 'Price above EMA', group: 'trend', side: 'long',
    blurb: 'Only trade when price sits above its average: the trend is up.',
    condition: cmp(price('close'), '>', ind('ema', { period: 50 })),
    genes: [g('/right/params/period', 'EMA length', 10, 200, 5)] },
  { id: 'ema_cross_up', icon: '⚡', label: 'EMA crosses up', group: 'trend', side: 'long',
    blurb: 'The fast average crosses above the slow one: momentum just turned up.',
    condition: cross(ind('ema', { period: 9 }), 'above', ind('ema', { period: 21 })),
    genes: [g('/left/params/period', 'Fast EMA', 3, 30), g('/right/params/period', 'Slow EMA', 10, 100)] },
  { id: 'ema_rising', icon: '🛗', label: 'EMA rising', group: 'trend', side: 'long',
    blurb: 'The average keeps climbing bar after bar.',
    condition: { kind: 'rising', operand: ind('ema', { period: 20 }), bars: 3 },
    genes: [g('/operand/params/period', 'EMA length', 5, 100), g('/bars', 'Bars rising', 1, 10)] },
  { id: 'supertrend_flip_up', icon: '🦸', label: 'SuperTrend flips up', group: 'trend', side: 'long',
    blurb: 'SuperTrend switches from red to green: a fresh uptrend may be starting.',
    condition: cross(ind('supertrend', { period: 10, mult: 3 }, 'dir'), 'above', k(0)),
    genes: [g('/left/params/period', 'ATR length', 5, 30), g('/left/params/mult', 'Multiplier', 1, 5, 0.5, false)] },
  { id: 'supertrend_up', icon: '🟢', label: 'SuperTrend is up', group: 'trend', side: 'long',
    blurb: 'SuperTrend is green: stay with the uptrend.',
    condition: cmp(ind('supertrend', { period: 10, mult: 3 }, 'dir'), '>', k(0)),
    genes: [g('/left/params/period', 'ATR length', 5, 30), g('/left/params/mult', 'Multiplier', 1, 5, 0.5, false)] },
  { id: 'psar_flip_up', icon: '🪂', label: 'SAR flips up', group: 'trend', side: 'long',
    blurb: 'Parabolic SAR dots jump below price: the trend turned up.',
    condition: cross(ind('psar', {}, 'dir'), 'above', k(0)),
    genes: [] },
  { id: 'adx_trending', icon: '💪', label: 'ADX trending', group: 'trend', side: 'both',
    blurb: 'ADX above 25 means a real trend, not chop.',
    condition: cmp(ind('adx', { period: 14 }, 'adx'), '>', k(25)),
    genes: [g('/left/params/period', 'ADX length', 7, 30), g('/right/value', 'ADX level', 15, 40)] },
  { id: 'above_vwap', icon: '⚓', label: 'Above VWAP', group: 'trend', side: 'long',
    blurb: 'Price is above the average price paid today: buyers are in control.',
    condition: cmp(price('close'), '>', ind('vwap')),
    genes: [] },

  // ── momentum
  { id: 'rsi_oversold', icon: '🔥', label: 'RSI oversold', group: 'momentum', side: 'long',
    blurb: 'RSI below 30: price fell hard and may bounce.',
    condition: cmp(ind('rsi', { period: 14 }), '<', k(30)),
    genes: [g('/left/params/period', 'RSI length', 2, 30), g('/right/value', 'Oversold level', 10, 45)] },
  { id: 'rsi_cross_up', icon: '🌅', label: 'RSI bounces up', group: 'momentum', side: 'long',
    blurb: 'RSI climbs back above 30: the selling wave is fading.',
    condition: cross(ind('rsi', { period: 14 }), 'above', k(30)),
    genes: [g('/left/params/period', 'RSI length', 2, 30), g('/right/value', 'Level', 10, 50)] },
  { id: 'macd_cross_up', icon: '🌊', label: 'MACD crosses signal', group: 'momentum', side: 'long',
    blurb: 'MACD crosses above its signal line: momentum is turning up.',
    condition: cross(ind('macd', { fast: 12, slow: 26, signal: 9 }, 'hist'), 'above', k(0)),
    genes: [g('/left/params/fast', 'Fast length', 5, 20), g('/left/params/slow', 'Slow length', 20, 60), g('/left/params/signal', 'Signal length', 3, 15)] },
  { id: 'macd_above_zero', icon: '🏄', label: 'MACD above zero', group: 'momentum', side: 'long',
    blurb: 'MACD above zero: the short-term average is above the long one.',
    condition: cmp(ind('macd', { fast: 12, slow: 26, signal: 9 }, 'macd'), '>', k(0)),
    genes: [g('/left/params/fast', 'Fast length', 5, 20), g('/left/params/slow', 'Slow length', 20, 60)] },
  { id: 'stoch_oversold', icon: '🎯', label: 'Stoch oversold', group: 'momentum', side: 'long',
    blurb: 'Stochastic below 20: price is near the bottom of its recent range.',
    condition: cmp(ind('stoch', { kPeriod: 14, smooth: 3, dPeriod: 3 }, 'k'), '<', k(20)),
    genes: [g('/left/params/kPeriod', '%K length', 5, 30), g('/right/value', 'Oversold level', 5, 35)] },

  // ── volatility
  { id: 'bb_lower_touch', icon: '🎈', label: 'BB lower touch', group: 'volatility', side: 'long',
    blurb: 'Price tags the lower Bollinger Band: stretched to the downside.',
    condition: cmp(price('low'), '<=', ind('bb', { period: 20, mult: 2 }, 'lower')),
    genes: [g('/right/params/period', 'BB length', 10, 50), g('/right/params/mult', 'BB width', 1, 3.5, 0.1, false)] },
  { id: 'bb_upper_break', icon: '🚀', label: 'Close above BB', group: 'volatility', side: 'long',
    blurb: 'Close above the upper band: a strong push that may keep going.',
    condition: cmp(price('close'), '>', ind('bb', { period: 20, mult: 2 }, 'upper')),
    genes: [g('/right/params/period', 'BB length', 10, 50), g('/right/params/mult', 'BB width', 1, 3.5, 0.1, false)] },
  { id: 'donchian_breakout', icon: '🧱', label: '20-bar high breakout', group: 'volatility', side: 'long',
    blurb: 'Close above the highest high of the last 20 bars: a breakout.',
    condition: cmp(price('close'), '>', ind('donchian', { period: 20 }, 'upper', 1)),
    genes: [g('/right/params/period', 'Lookback bars', 5, 100)] },
  { id: 'keltner_lower_touch', icon: '🎀', label: 'Keltner lower touch', group: 'volatility', side: 'long',
    blurb: 'Price dips to the lower Keltner channel.',
    condition: cmp(price('low'), '<=', ind('keltner', { period: 20, atrPeriod: 10, mult: 2 }, 'lower')),
    genes: [g('/right/params/period', 'Average length', 10, 50), g('/right/params/mult', 'Width (ATRs)', 1, 4, 0.25, false)] },

  // ── candles
  { id: 'ha_turns_green', icon: '🍡', label: 'HA turns green', group: 'candles', side: 'long',
    blurb: 'The Heikin-Ashi candle flips from red to green.',
    condition: cross(ind('ha', {}, 'dir'), 'above', k(0)),
    genes: [] },
  { id: 'ha_green', icon: '🍏', label: 'HA is green', group: 'candles', side: 'long',
    blurb: 'The smoothed Heikin-Ashi candle is green.',
    condition: candle('ha_bullish'), genes: [] },
  { id: 'green_candle', icon: '🟩', label: 'Green candle', group: 'candles', side: 'long',
    blurb: 'The bar closed above where it opened.',
    condition: candle('bullish'), genes: [] },
  { id: 'bull_engulfing', icon: '🐂', label: 'Bullish engulfing', group: 'candles', side: 'long',
    blurb: 'A green candle swallows the previous red one.',
    condition: candle('engulfing_bull'), genes: [] },
  { id: 'hammer', icon: '🔨', label: 'Hammer', group: 'candles', side: 'long',
    blurb: 'A long lower wick: sellers pushed down but buyers fought back.',
    condition: candle('hammer'), genes: [] },
  { id: 'inside_bar', icon: '📦', label: 'Inside bar', group: 'candles', side: 'both',
    blurb: 'The bar fits inside the previous one: the market is coiling.',
    condition: candle('inside_bar'), genes: [] },

  // ── time
  { id: 'morning_only', icon: '🌅', label: 'Morning only', group: 'time', side: 'both',
    blurb: 'Only trade 09:30 to 11:30 New York time, when markets move most.',
    condition: { kind: 'time', from: '09:30', to: '11:30' }, genes: [] },
  { id: 'afternoon_only', icon: '🌇', label: 'Afternoon only', group: 'time', side: 'both',
    blurb: 'Only trade 13:30 to 15:45 New York time.',
    condition: { kind: 'time', from: '13:30', to: '15:45' }, genes: [] },
];

/** Prefixes a card's relative genes with the pointer where its condition was placed. */
export function cardGenes(card: BlockCard, basePath: string): GeneSpec[] {
  return card.genes.map((x) => ({ ...x, path: basePath + x.path }));
}

// ───────────── mirroring ─────────────

const BY_ID = new Map(INDICATORS.map((d) => [d.id, d]));

/** Outputs whose value has no direction (trend strength, volatility, volume). */
const NON_DIRECTIONAL = new Set([
  'adx:adx', 'atr:value', 'natr:value', 'bb:bandwidth', 'stdev:value', 'chop:value', 'volsma:volume', 'volsma:sma', 'obv:value',
]);

const SWAP_OUT: Record<string, string> = {
  upper: 'lower', lower: 'upper', pdh: 'pdl', pdl: 'pdh', up: 'down', down: 'up', pdi: 'mdi', mdi: 'pdi',
  high: 'low', low: 'high',
};
const SWAP_SRC: Partial<Record<Source, Source>> = { high: 'low', low: 'high' };
const FLIP_OP: Record<CompareOp, CompareOp> = { '>': '<', '<': '>', '>=': '<=', '<=': '>=' };
const FLIP_PATTERN: Partial<Record<CandlePattern, CandlePattern>> = {
  bullish: 'bearish', bearish: 'bullish', ha_bullish: 'ha_bearish', ha_bearish: 'ha_bullish',
  hammer: 'shooting_star', shooting_star: 'hammer', engulfing_bull: 'engulfing_bear', engulfing_bear: 'engulfing_bull',
};

const outKey = (op: Extract<Operand, { kind: 'indicator' }>): string =>
  op.output ?? BY_ID.get(op.id)?.outputs[0]?.key ?? 'value';

const directional = (op: Operand): boolean =>
  op.kind === 'price' ? op.source !== 'volume' : op.kind === 'indicator' ? !NON_DIRECTIONAL.has(`${op.id}:${outKey(op)}`) : false;

function mirrorOperand(op: Operand): Operand {
  if (op.kind === 'price') {
    const s = SWAP_SRC[op.source];
    return s ? { ...op, source: s } : op;
  }
  if (op.kind === 'indicator') {
    const out = outKey(op);
    const s = SWAP_OUT[out];
    return s && BY_ID.get(op.id)?.outputs.some((o) => o.key === s) ? { ...op, output: s } : op;
  }
  return op;
}

/** Mirrors a threshold against the partner operand: bounded range a..b → a+b−v, else −v. */
function mirrorConst(c: Extract<Operand, { kind: 'const' }>, partner: Operand): Operand {
  if (partner.kind !== 'indicator') return c;
  const def = BY_ID.get(partner.id);
  const range = def?.range;
  const v = range ? range[0] + range[1] - c.value : -c.value;
  return { kind: 'const', value: Number(v.toFixed(10)) || 0 };
}

function mirrorPair(left: Operand, right: Operand): [Operand, Operand] {
  const l = left.kind === 'const' ? mirrorConst(left, right) : mirrorOperand(left);
  const r = right.kind === 'const' ? mirrorConst(right, left) : mirrorOperand(right);
  return [l, r];
}

/**
 * Turns a long-side condition into its short-side twin: above↔below, crosses up↔down,
 * oversold↔overbought (RSI 30 → 70 via the indicator's range), lower↔upper band, high↔low,
 * bullish↔bearish patterns, rising↔falling. Non-directional filters (ADX, time, inside bar)
 * stay unchanged.
 */
export function mirrorCondition(c: Condition): Condition {
  switch (c.kind) {
    case 'compare': {
      if (!directional(c.left) && !directional(c.right)) return c;
      const [left, right] = mirrorPair(c.left, c.right);
      return { kind: 'compare', left, op: FLIP_OP[c.op], right };
    }
    case 'cross': {
      if (!directional(c.left) && !directional(c.right)) return c;
      const [left, right] = mirrorPair(c.left, c.right);
      return { kind: 'cross', left, dir: c.dir === 'above' ? 'below' : 'above', right };
    }
    case 'rising':
    case 'falling':
      if (!directional(c.operand)) return c;
      return { ...c, kind: c.kind === 'rising' ? 'falling' : 'rising', operand: mirrorOperand(c.operand) };
    case 'candle': {
      const p = FLIP_PATTERN[c.pattern];
      return p ? { kind: 'candle', pattern: p } : c;
    }
    case 'time': return c;
    case 'all':
    case 'any': return { kind: c.kind, of: c.of.map(mirrorCondition) };
    case 'not': return { kind: 'not', of: mirrorCondition(c.of) };
  }
}
