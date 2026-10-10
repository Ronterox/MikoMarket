/**
 * Miko's indicator know-how: how each catalog indicator works and how traders use it,
 * plus a verdict on a whole combination (classic, redundant, unusual or fine).
 * Pure data and pure functions.
 */

/** 2-3 short, technically correct tips per catalog indicator id (each <= 120 chars). */
export const INDICATOR_TIPS: Record<string, readonly string[]> = {
  sma: [
    'SMA = plain average of the last N closes. Price above a rising SMA is the simplest uptrend check. 📈',
    'The 50 and 200 SMAs are the famous ones: a 50 crossing above the 200 is the "golden cross". ✨',
    'SMAs lag on purpose: they smooth noise, so they confirm a trend late rather than predict it. 🐢',
  ],
  ema: [
    'EMA weights recent prices more, so it turns faster than an SMA of the same length. ⚡',
    'Classic EMA cross: a fast EMA (9) crossing a slow one (21) signals a possible trend change. 🔀',
    'In trends, pullbacks often bounce near the 20 EMA. Many traders use it as a "value zone". 🎯',
  ],
  wma: [
    'WMA gives linearly more weight to newer bars: in between an SMA and an EMA in speed. 📐',
    'Use a WMA like any moving average: trend direction from its slope, signals from price crosses. 🧭',
  ],
  hma: [
    'Hull MA combines WMAs to cut lag a lot while staying smooth. Watch its slope flip for turns. 🚀',
    'HMA reacts fast, so it can overshoot in chop. Pair it with a trend filter before trading flips. ⚠️',
  ],
  dema: [
    'DEMA = 2x EMA minus EMA-of-EMA. It removes much of the lag, so crosses come earlier. 🏃',
    'Less lag also means more false signals in sideways markets. Faster is not always better! 🌀',
  ],
  tema: [
    'TEMA triple-smooths an EMA and subtracts the lag, so it hugs price very closely. 🚗',
    'TEMA works well as a fast trigger line with a slower average as the trend filter. 🎛️',
  ],
  vwma: [
    'VWMA weights each close by its volume: heavy-volume bars pull the average harder. 🐋',
    'VWMA above the SMA of the same length means volume is backing the up moves. 📊',
  ],
  kama: [
    'KAMA (Kaufman) speeds up when price trends cleanly and slows down in noise. Adaptive! 🦎',
    'A flat KAMA says "chop, wait". When it starts sloping, the efficiency ratio sees a trend. 🧘',
  ],
  rsi: [
    'RSI measures recent gains vs losses on a 0-100 scale. Above 70 = stretched up, below 30 = stretched down. 🔥',
    'In strong trends RSI can stay above 70 for ages. Overbought is not a sell signal by itself! ⚠️',
    'RSI divergence: price makes a new high but RSI does not. Momentum may be fading. 📉',
  ],
  stoch: [
    'Stochastic shows where the close sits inside the recent high-low range: 80+ near the top, 20- near the bottom. 🎯',
    '%K crossing %D inside the 20 or 80 zone is the classic Stochastic trigger. Best in ranges. 🔀',
  ],
  stochrsi: [
    'StochRSI is a Stochastic of RSI: very fast and twitchy, it hits 0 and 100 often. 🎪',
    'Use StochRSI for timing entries in the trend direction, not as a stand-alone reversal call. ⏱️',
  ],
  macd: [
    'MACD = fast EMA minus slow EMA. The signal line is its EMA; crosses hint at momentum shifts. 🌊',
    'The MACD histogram shrinking means momentum is fading, often before the actual cross. 📉',
    'MACD above zero = fast EMA above slow EMA, an uptrend bias. Below zero, a downtrend bias. ⚖️',
  ],
  cci: [
    'CCI measures how far price is from its average in units of mean deviation. ±100 are the usual lines. 🎢',
    'Trend traders buy CCI pushes above +100; range traders fade extremes beyond ±200. Pick one style. 🧭',
  ],
  roc: [
    'ROC = % change over N bars. Above 0 means price is higher than N bars ago. Simple and honest. 💨',
    'ROC zero-line crosses flag momentum shifts; extreme readings show stretched moves. 📏',
  ],
  mom: [
    'Momentum = close minus the close N bars ago. Rising momentum means the move is speeding up. 🏀',
    'Momentum in points depends on price level, so compare it within one chart, not across symbols. 🔎',
  ],
  willr: [
    'Williams %R runs 0 to -100: near 0 the close is at the range top, near -100 at the bottom. 🎳',
    '%R is basically an inverted fast Stochastic. Above -20 is overbought, below -80 oversold. 🔁',
  ],
  mfi: [
    'MFI is a volume-weighted RSI: it asks whether money flowed in or out. 80/20 are the usual lines. 💰',
    'Price up but MFI down = rally on weak money flow. A useful divergence warning. 🚩',
  ],
  adx: [
    'ADX measures trend STRENGTH, not direction. Above 25 = trending, under 20 = chop. 💪',
    'Direction comes from +DI vs -DI: +DI on top favours longs, -DI on top favours shorts. 🧭',
    'Rising ADX = trend gaining power. A falling ADX from high levels means the trend is tiring. 📉',
  ],
  aroon: [
    'Aroon counts bars since the last N-bar high and low. Aroon Up near 100 = fresh highs. 🧭',
    'Aroon Up crossing above Down is an early trend-start hint. Both low = no trend at all. 🌫️',
  ],
  atr: [
    'ATR = average true range: how much price typically moves per bar. It ignores direction. 📏',
    'ATR is the pro way to place stops: 1.5-3x ATR gives the trade room that matches the market. 🛡️',
    'Size from ATR: wider ATR stop, fewer shares, same dollar risk. Calm markets allow more size. ⚖️',
  ],
  natr: [
    'NATR = ATR as a % of price, so you can compare volatility across symbols and years. 🔬',
    'A rising NATR means bigger swings: widen stops and shrink size so risk stays the same. ⚖️',
  ],
  bb: [
    'Bollinger Bands = SMA ± 2 standard deviations. Price outside the bands is statistically stretched. 🎈',
    'A Bollinger "squeeze" (very narrow bands) means low volatility, which often expands soon. 🤏',
    'In strong trends price can "walk the band". A tag of the upper band is not an automatic short. 🚶',
  ],
  keltner: [
    'Keltner = EMA ± a multiple of ATR. Smoother than Bollinger because ATR moves calmly. 🎀',
    'A close outside Keltner often signals a real breakout; inside it, price is just breathing. 🌬️',
  ],
  donchian: [
    'Donchian = highest high and lowest low of N bars. The Turtles bought 20-bar breakouts! 🐢',
    'The middle line makes a simple trailing exit, and the opposite band works as a stop. 🧱',
  ],
  stdev: [
    'Standard deviation measures how spread out closes are around their average. Higher = wilder. 🎲',
    'Very low stdev often comes before a breakout: volatility tends to cycle low to high. 🔄',
  ],
  supertrend: [
    'SuperTrend is an ATR trailing line: below price in uptrends, above it in downtrends. 🦸',
    'A SuperTrend flip is a trend-change signal, and the line itself makes a ready-made stop. 🛡️',
    'In sideways markets SuperTrend whipsaws. An ADX filter above 20-25 helps a lot. 🌀',
  ],
  psar: [
    'Parabolic SAR dots trail price and speed up as the trend extends. A flip = possible reversal. 🪂',
    'PSAR is best as a trailing stop in clear trends; in chop it flips constantly. ⚠️',
  ],
  ichimoku: [
    'Ichimoku: price above the cloud = bullish bias, below = bearish, inside = undecided. 🏯',
    'Tenkan crossing Kijun is the classic Ichimoku trigger, strongest when it happens above the cloud. 🔀',
    'A thick cloud is strong support or resistance; a thin one breaks easily. ☁️',
  ],
  vwap: [
    'VWAP = average price weighted by volume since the session open. Institutions benchmark fills to it. ⚓',
    'Above VWAP, buyers are in control today; below it, sellers. Many day traders only trade with it. 🧭',
    'VWAP resets each session, so it means most intraday. Pullbacks to VWAP are popular entries. 🎯',
  ],
  obv: [
    'OBV adds volume on up closes and subtracts it on down closes. Its slope is what matters. 🔋',
    'OBV making new highs before price does can hint that buyers are quietly accumulating. 🕵️',
  ],
  cmf: [
    'CMF (Chaikin Money Flow) is above 0 when closes land near bar highs on volume: buying pressure. 💧',
    'CMF staying positive during a pullback suggests buyers are still in control. 💪',
  ],
  volsma: [
    'Volume SMA shows normal volume. A bar at 2x average volume means something real is happening. 📊',
    'Breakouts on above-average volume are more trustworthy than breakouts on thin volume. ✅',
  ],
  ha: [
    'Heikin-Ashi averages candles to smooth noise: green streaks = trend, small bodies = indecision. 🍡',
    'HA prices are synthetic! Use them for trend colour, but real fills happen at real prices. ⚠️',
    'HA candles with no lower wick show a strong uptrend; no upper wick, a strong downtrend. 🕯️',
  ],
  linreg: [
    'Linear regression fits a straight line to the last N closes. Its slope is the trend speed. 📉',
    'Slope above 0 = uptrend, and a flattening slope warns the trend is losing steam. 🧮',
  ],
  zscore: [
    'Z-Score = how many standard deviations price is from its average. ±2 is unusually far. 🔭',
    'Mean-reversion traders fade z-scores beyond ±2, but in strong trends extremes can persist. ⚠️',
  ],
  chop: [
    'Choppiness Index: above 61.8 = sideways chop, below 38.2 = trending. It has no direction. 🌀',
    'Use Chop as a filter: trend systems when it is low, range systems when it is high. 🎛️',
  ],
  pdhl: [
    "Yesterday's high and low are levels many traders watch. Expect reactions when price gets there. 🔖",
    'A clean break of the previous day high often brings breakout traders in. Failed breaks reverse fast. 🧲',
  ],
};

/** Teaching tips for an indicator id ([] when unknown). */
export function indicatorTips(id: string): string[] {
  return [...(INDICATOR_TIPS[id] ?? [])];
}

export type ComboKind = 'classic' | 'redundant' | 'unusual' | 'fine';
export interface ComboVerdict { kind: ComboKind; text: string }
/** Internal verdict with the ids it is about (so the coach knows whether a new indicator caused it). */
export interface ComboAnalysis extends ComboVerdict { rule: string; ids: string[] }

export const MOVING_AVERAGES = ['sma', 'ema', 'wma', 'hma', 'dema', 'tema', 'vwma', 'kama'] as const;
export const MOMENTUM_OSCILLATORS = ['rsi', 'stoch', 'stochrsi', 'willr', 'cci', 'mfi', 'roc', 'mom'] as const;
const CHANNELS = ['bb', 'keltner', 'donchian'] as const;
const TREND_STRENGTH = ['adx', 'chop', 'aroon'] as const;
const OSC_NAMES: Record<string, string> = {
  rsi: 'RSI', stoch: 'Stoch', stochrsi: 'StochRSI', willr: 'Williams %R', cci: 'CCI', mfi: 'MFI', roc: 'ROC', mom: 'Momentum',
};

interface PairRule { rule: string; ids: [string, string]; kind: ComboKind; text: string }

/** Pairs that say the same thing twice. */
const REDUNDANT_PAIRS: PairRule[] = [
  { rule: 'stoch_willr', ids: ['stoch', 'willr'], kind: 'redundant', text: 'Stoch + Williams %R? 🤔 %R is basically an upside-down fast Stochastic. Twins!' },
  { rule: 'rsi_stochrsi', ids: ['rsi', 'stochrsi'], kind: 'redundant', text: 'RSI + StochRSI 🤔 StochRSI is built from RSI, so they mostly echo each other.' },
  { rule: 'atr_natr', ids: ['atr', 'natr'], kind: 'redundant', text: 'ATR + NATR 😳 Same volatility, one in points and one in %. Pick one!' },
  { rule: 'supertrend_psar', ids: ['supertrend', 'psar'], kind: 'redundant', text: 'SuperTrend + PSAR 🤔 Two trailing-stop lines. They will mostly flip together.' },
  { rule: 'bb_zscore', ids: ['bb', 'zscore'], kind: 'redundant', text: 'BB + Z-Score 🤔 Z-Score is literally distance from the BB middle in std devs. Same info!' },
  { rule: 'bb_stdev', ids: ['bb', 'stdev'], kind: 'redundant', text: 'BB + StdDev 🤔 Bollinger band width already IS the standard deviation.' },
  { rule: 'obv_cmf_mfi', ids: ['obv', 'cmf'], kind: 'fine', text: 'OBV + CMF: two money-flow reads. Fine, but they often agree. 💧' },
];

/** Combinations traders actually use. */
const CLASSIC_PAIRS: PairRule[] = [
  { rule: 'squeeze', ids: ['bb', 'keltner'], kind: 'classic', text: 'BB + Keltner... squeeze hunter? Nice 👀 Bands inside Keltner = coiled spring.' },
  { rule: 'rkbb', ids: ['bb', 'ha'], kind: 'classic', text: 'BB + Heikin-Ashi, the RKBB recipe! 🌸 Smooth trend colour plus stretch zones.' },
  { rule: 'ema_vwap', ids: ['ema', 'vwap'], kind: 'classic', text: 'EMA + VWAP: the day-trader classic ⚓ Trade pullbacks with both lines on your side.' },
  { rule: 'bb_rsi', ids: ['bb', 'rsi'], kind: 'classic', text: 'BB + RSI, a classic mean-reversion pair 🎈 A band tag plus RSI extreme = stretched for real.' },
  { rule: 'st_adx', ids: ['supertrend', 'adx'], kind: 'classic', text: 'SuperTrend + ADX 💪 Great pair: ADX filters out the choppy flips. Pro move.' },
  { rule: 'macd_ema', ids: ['macd', 'ema'], kind: 'classic', text: 'MACD + EMA 🌊 Trend from the EMA, timing from MACD. Clean and classic.' },
  { rule: 'ha_ema', ids: ['ha', 'ema'], kind: 'classic', text: 'HA + EMA 🍡 Smooth candles for colour, EMA for direction. Trend-rider combo!' },
  { rule: 'turtle', ids: ['donchian', 'atr'], kind: 'classic', text: 'Donchian + ATR: the Turtle Traders setup 🐢 Breakouts plus ATR stops and sizing.' },
  { rule: 'vwap_pdhl', ids: ['vwap', 'pdhl'], kind: 'classic', text: "VWAP + yesterday's levels 🔖 Intraday map unlocked. Watch reactions at each line." },
  { rule: 'ema_rsi', ids: ['ema', 'rsi'], kind: 'classic', text: 'EMA + RSI ✨ Trend filter plus a pullback gauge. Simple and popular for a reason.' },
  { rule: 'sma_rsi', ids: ['sma', 'rsi'], kind: 'classic', text: 'SMA + RSI ✨ Buy RSI dips above a rising SMA: a well-known pullback recipe.' },
];

const has = (set: Set<string>, ids: readonly string[]) => ids.every((id) => set.has(id));

/** Full analysis of an indicator combination (ids may repeat, e.g. two EMAs). */
export function analyzeCombo(ids: readonly string[]): ComboAnalysis {
  const set = new Set(ids);
  const others = [...set].filter((id) => id !== 'ichimoku' && id !== 'volsma' && id !== 'pdhl');
  if (set.has('ichimoku') && others.length > 0) {
    return { rule: 'ichimoku_plus', kind: 'unusual', ids: ['ichimoku', ...others], text: 'Ichimoku plus more? 😳 The cloud is already a full system: trend, momentum and levels in one.' };
  }
  const mas = ids.filter((id) => (MOVING_AVERAGES as readonly string[]).includes(id));
  if (mas.length >= 4) {
    return { rule: 'spaghetti', kind: 'redundant', ids: [...new Set(mas)], text: `${mas.length} moving averages? That is spaghetti 🍝 Two or three lines tell the same story.` };
  }
  const osc = [...set].filter((id) => (MOMENTUM_OSCILLATORS as readonly string[]).includes(id));
  if (osc.length >= 3) {
    const names = osc.slice(0, 3).map((id) => OSC_NAMES[id]).join(' + ');
    return { rule: 'osc_stack', kind: 'redundant', ids: osc, text: `${names}? 😳 ${osc.length} momentum oscillators all saying the same thing. One is enough!` };
  }
  const ch = [...set].filter((id) => (CHANNELS as readonly string[]).includes(id));
  if (ch.length >= 3) {
    return { rule: 'channels', kind: 'redundant', ids: ch, text: 'Three channels at once? 🤔 BB, Keltner and Donchian draw very similar bands.' };
  }
  const ts = [...set].filter((id) => (TREND_STRENGTH as readonly string[]).includes(id));
  if (ts.length >= 2) {
    return { rule: 'trend_meters', kind: 'redundant', ids: ts, text: 'Two trend-strength meters 🤔 ADX, Chop and Aroon all ask "trend or range?". One will do.' };
  }
  for (const p of REDUNDANT_PAIRS) {
    if (p.kind === 'redundant' && has(set, p.ids)) return { rule: p.rule, kind: p.kind, ids: [...p.ids], text: p.text };
  }
  if (set.size >= 7) {
    return { rule: 'crowded', kind: 'unusual', ids: [...set], text: `${set.size} indicators?! 😳 More lines, less clarity. Pros often use two or three.` };
  }
  for (const p of CLASSIC_PAIRS) {
    if (has(set, p.ids)) return { rule: p.rule, kind: 'classic', ids: [...p.ids], text: p.text };
  }
  for (const p of REDUNDANT_PAIRS) {
    if (has(set, p.ids)) return { rule: p.rule, kind: p.kind, ids: [...p.ids], text: p.text };
  }
  if (set.size === 0) return { rule: 'empty', kind: 'fine', ids: [], text: 'A naked chart 🧘 Pure price action. Respect.' };
  return { rule: 'fine', kind: 'fine', ids: [...set], text: 'Nice and tidy setup ✨ Every line has its own job.' };
}

/** Classify an indicator combination: 'classic' | 'redundant' | 'unusual' | 'fine', with a short reaction. */
export function comboVerdict(ids: string[]): ComboVerdict {
  const { kind, text } = analyzeCombo(ids);
  return { kind, text };
}
