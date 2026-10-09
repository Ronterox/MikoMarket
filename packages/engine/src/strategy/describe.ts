import type { CandlePattern, Condition, Distance, Operand, StrategySpec } from '../types.ts';
import { INDICATORS } from '../indicators/index.ts';

const BY_ID = new Map(INDICATORS.map((d) => [d.id, d]));

const SHORT: Record<string, string> = {
  bb: 'BB', keltner: 'Keltner', donchian: 'Donchian', stoch: 'Stoch', stochrsi: 'StochRSI', willr: '%R',
  psar: 'SAR', ha: 'HA', volsma: 'Volume', linreg: 'LinReg', chop: 'Chop', ichimoku: 'Ichimoku', stdev: 'StdDev',
};

const SOURCE_NAMES: Record<string, string> = {
  open: 'Open', high: 'High', low: 'Low', close: 'Close', hl2: 'HL2', hlc3: 'HLC3', ohlc4: 'OHLC4', volume: 'Volume',
};

const PATTERN_TEXT: Record<CandlePattern, string> = {
  bullish: 'Green candle', bearish: 'Red candle', ha_bullish: 'Heikin-Ashi is green', ha_bearish: 'Heikin-Ashi is red',
  doji: 'Doji candle', hammer: 'Hammer candle', shooting_star: 'Shooting star candle',
  engulfing_bull: 'Bullish engulfing', engulfing_bear: 'Bearish engulfing', inside_bar: 'Inside bar', outside_bar: 'Outside bar',
};

const num = (x: number): string => (Number.isInteger(x) ? String(x) : String(Number(x.toFixed(4))));
const ago = (off: number | undefined): string => (off && off > 0 ? ` ${off} bar${off === 1 ? '' : 's'} ago` : '');

export function describeOperand(op: Operand): string {
  switch (op.kind) {
    case 'const': return num(op.value);
    case 'price': return (SOURCE_NAMES[op.source] ?? op.source) + ago(op.offset);
    case 'indicator': {
      const def = BY_ID.get(op.id);
      if (!def) return op.id + ago(op.offset);
      const name = SHORT[def.id] ?? def.name;
      const args: string[] = [];
      for (const p of def.params) {
        const v = op.params?.[p.key] ?? p.default;
        if (p.type === 'source') { if (v !== p.default) args.push(String(v)); }
        else args.push(typeof v === 'number' ? num(v) : String(v));
      }
      const outKey = op.output ?? def.outputs[0]?.key;
      const outIdx = def.outputs.findIndex((o) => o.key === outKey);
      const outLabel = outIdx >= 0 ? def.outputs[outIdx]!.label.replace(/\s*\(.*\)$/, '') : '';
      const showOut = outIdx > 0 || (def.outputs.length > 1 && outLabel !== def.name && outLabel !== name);
      const out = showOut ? ' ' + outLabel : '';
      if (def.id === 'pdhl') return def.outputs[Math.max(0, outIdx)]!.label + ago(op.offset);
      if (def.id === 'ha') return 'HA ' + def.outputs[Math.max(0, outIdx)]!.label.toLowerCase() + ago(op.offset);
      return `${name}${args.length ? `(${args.join(', ')})` : ''}${out}${ago(op.offset)}`;
    }
  }
}

const OP_TEXT = { '>': 'is above', '<': 'is below', '>=': 'is at or above', '<=': 'is at or below' } as const;

/** Short plain English, e.g. "RSI(14) crosses above 30". */
export function describeCondition(c: Condition): string {
  switch (c.kind) {
    case 'compare': return `${describeOperand(c.left)} ${OP_TEXT[c.op]} ${describeOperand(c.right)}`;
    case 'cross': return `${describeOperand(c.left)} crosses ${c.dir} ${describeOperand(c.right)}`;
    case 'rising':
    case 'falling':
      return `${describeOperand(c.operand)} ${c.kind}${c.bars > 1 ? ` for ${c.bars} bars` : ''}`;
    case 'candle': return PATTERN_TEXT[c.pattern] ?? c.pattern;
    case 'time': return `Between ${c.from} and ${c.to}${c.tz === 'UTC' || c.tz === 'Etc/UTC' ? ' UTC' : ' NY time'}`;
    case 'all':
    case 'any': {
      const parts = c.of.map((s) => (s.kind === 'all' || s.kind === 'any') && c.of.length > 1 ? `(${describeCondition(s)})` : describeCondition(s));
      return parts.join(c.kind === 'all' ? ' and ' : ' or ');
    }
    case 'not': return `not (${describeCondition(c.of)})`;
  }
}

export function describeDistance(d: Distance): string {
  switch (d.kind) {
    case 'atr': return `${num(d.mult)}× ATR(${d.period})`;
    case 'percent': return `${num(d.value)}%`;
    case 'points': return `${num(d.value)} points`;
  }
}

/** One plain-English line per rule. */
export function describeStrategy(spec: StrategySpec): string[] {
  const lines: string[] = [];
  if (spec.long) lines.push(`Buy when ${describeCondition(spec.long.enter)}`);
  if (spec.short) lines.push(`Sell short when ${describeCondition(spec.short.enter)}`);
  const ex = spec.exits;
  if (ex.stopLoss) lines.push(`Stop-loss ${describeDistance(ex.stopLoss)} from entry`);
  else lines.push('No stop-loss (risky!)');
  if (ex.takeProfit) {
    lines.push(ex.takeProfit.kind === 'rr'
      ? `Take profit at ${num(ex.takeProfit.ratio)}× the risk`
      : `Take profit ${describeDistance(ex.takeProfit)} from entry`);
  }
  if (ex.trailing) lines.push(`Trailing stop ${describeDistance(ex.trailing)} behind price`);
  if (ex.exitWhen) lines.push(`Exit when ${describeCondition(ex.exitWhen)}`);
  if (ex.maxBars) lines.push(`Exit after ${ex.maxBars} bars`);
  if (ex.flatAt) lines.push(`Close everything at ${ex.flatAt} NY time`);
  const sz = spec.sizing;
  lines.push(sz.kind === 'fixed' ? `Trade ${num(sz.qty)} unit${sz.qty === 1 ? '' : 's'}`
    : sz.kind === 'risk' ? `Risk ${num(sz.percent)}% of equity per trade`
      : `Use ${num(sz.percent)}% of equity per trade`);
  return lines;
}
