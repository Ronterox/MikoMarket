import type { Condition, Distance, Operand, StrategySpec } from '../types.ts';
import { INDICATORS } from '../indicators/index.ts';
import { parseHHMM } from '../core/time.ts';
import { getAtPointer } from './pointer.ts';

const BY_ID = new Map(INDICATORS.map((d) => [d.id, d]));
const SOURCES = new Set(['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4', 'volume']);
const OPS = new Set(['>', '<', '>=', '<=']);
const PATTERNS = new Set([
  'bullish', 'bearish', 'ha_bullish', 'ha_bearish', 'doji', 'hammer', 'shooting_star',
  'engulfing_bull', 'engulfing_bear', 'inside_bar', 'outside_bar',
]);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

function checkOperand(op: Operand | undefined, at: string, errs: string[]): void {
  if (!op || typeof op !== 'object') { errs.push(`${at}: missing operand`); return; }
  if (op.kind === 'const') { if (!isNum(op.value)) errs.push(`${at}: const value must be a number`); return; }
  if ('offset' in op && op.offset !== undefined && !(isNum(op.offset) && op.offset >= 0 && Number.isInteger(op.offset))) {
    errs.push(`${at}: offset must be a whole number >= 0`);
  }
  if (op.kind === 'price') { if (!SOURCES.has(op.source)) errs.push(`${at}: unknown price source "${String(op.source)}"`); return; }
  if (op.kind === 'indicator') {
    const def = BY_ID.get(op.id);
    if (!def) { errs.push(`${at}: unknown indicator "${String(op.id)}"`); return; }
    if (op.output !== undefined && !def.outputs.some((o) => o.key === op.output)) {
      errs.push(`${at}: ${def.name} has no output "${op.output}"`);
    }
    for (const [k, v] of Object.entries(op.params ?? {})) {
      const p = def.params.find((x) => x.key === k);
      if (!p) { errs.push(`${at}: ${def.name} has no parameter "${k}"`); continue; }
      if (p.type === 'int' || p.type === 'float') {
        if (!isNum(v)) errs.push(`${at}: ${def.name} ${k} must be a number`);
        else if ((p.min !== undefined && v < p.min) || (p.max !== undefined && v > p.max)) errs.push(`${at}: ${def.name} ${k}=${v} is out of range`);
      } else if (p.options && !p.options.includes(String(v))) errs.push(`${at}: ${def.name} ${k}="${String(v)}" is not allowed`);
    }
    return;
  }
  errs.push(`${at}: unknown operand kind "${String((op as { kind: unknown }).kind)}"`);
}

function checkCond(c: Condition | undefined, at: string, errs: string[]): void {
  if (!c || typeof c !== 'object') { errs.push(`${at}: missing condition`); return; }
  switch (c.kind) {
    case 'compare':
      if (!OPS.has(c.op)) errs.push(`${at}: unknown operator "${String(c.op)}"`);
      checkOperand(c.left, `${at}/left`, errs);
      checkOperand(c.right, `${at}/right`, errs);
      return;
    case 'cross':
      if (c.dir !== 'above' && c.dir !== 'below') errs.push(`${at}: cross dir must be above or below`);
      checkOperand(c.left, `${at}/left`, errs);
      checkOperand(c.right, `${at}/right`, errs);
      return;
    case 'rising':
    case 'falling':
      if (!(isNum(c.bars) && c.bars >= 1)) errs.push(`${at}: bars must be >= 1`);
      checkOperand(c.operand, `${at}/operand`, errs);
      return;
    case 'candle':
      if (!PATTERNS.has(c.pattern)) errs.push(`${at}: unknown candle pattern "${String(c.pattern)}"`);
      return;
    case 'time':
      if (!(parseHHMM(c.from) >= 0) || !(parseHHMM(c.to) >= 0)) errs.push(`${at}: time must be HH:MM`);
      if (c.tz !== undefined && !['America/New_York', 'UTC', 'Etc/UTC'].includes(c.tz)) errs.push(`${at}: only America/New_York and UTC time zones are supported`);
      return;
    case 'all':
    case 'any':
      if (!Array.isArray(c.of) || c.of.length === 0) { errs.push(`${at}: needs at least one condition`); return; }
      c.of.forEach((s, k) => checkCond(s, `${at}/of/${k}`, errs));
      return;
    case 'not':
      checkCond(c.of, `${at}/of`, errs);
      return;
  }
  errs.push(`${at}: unknown condition kind "${String((c as { kind: unknown }).kind)}"`);
}

function checkDistance(d: Distance | undefined, at: string, errs: string[]): void {
  if (!d) return;
  switch (d.kind) {
    case 'atr':
      if (!(isNum(d.mult) && d.mult > 0)) errs.push(`${at}: ATR multiple must be > 0`);
      if (!(isNum(d.period) && d.period >= 1)) errs.push(`${at}: ATR period must be >= 1`);
      return;
    case 'percent':
    case 'points':
      if (!(isNum(d.value) && d.value > 0)) errs.push(`${at}: value must be > 0`);
      return;
  }
  errs.push(`${at}: unknown distance kind "${String((d as { kind: unknown }).kind)}"`);
}

/** Returns human-readable problems; an empty array means the spec is valid. */
export function validateStrategy(spec: StrategySpec): string[] {
  const errs: string[] = [];
  if (!spec || typeof spec !== 'object') return ['Strategy must be an object'];
  if (spec.version !== 1) errs.push('version must be 1');
  if (!spec.id) errs.push('id is required');
  if (!spec.name) errs.push('name is required');
  if (!spec.long && !spec.short) errs.push('Add a long or a short entry');
  if (spec.long) checkCond(spec.long.enter, '/long/enter', errs);
  if (spec.short) checkCond(spec.short.enter, '/short/enter', errs);
  const ex = spec.exits;
  if (!ex || typeof ex !== 'object') errs.push('exits is required');
  else {
    checkDistance(ex.stopLoss, '/exits/stopLoss', errs);
    if (ex.takeProfit) {
      if (ex.takeProfit.kind === 'rr') {
        if (!(isNum(ex.takeProfit.ratio) && ex.takeProfit.ratio > 0)) errs.push('/exits/takeProfit: ratio must be > 0');
        if (!ex.stopLoss) errs.push('/exits/takeProfit: a reward:risk target needs a stop-loss');
      } else checkDistance(ex.takeProfit, '/exits/takeProfit', errs);
    }
    checkDistance(ex.trailing, '/exits/trailing', errs);
    if (ex.maxBars !== undefined && !(isNum(ex.maxBars) && ex.maxBars >= 1)) errs.push('/exits/maxBars must be >= 1');
    if (ex.exitWhen) checkCond(ex.exitWhen, '/exits/exitWhen', errs);
    if (ex.flatAt !== undefined && !(parseHHMM(ex.flatAt) >= 0)) errs.push('/exits/flatAt must be HH:MM');
  }
  const sz = spec.sizing;
  if (!sz) errs.push('sizing is required');
  else if (sz.kind === 'fixed') { if (!(isNum(sz.qty) && sz.qty > 0)) errs.push('/sizing/qty must be > 0'); }
  else if (sz.kind === 'risk' || sz.kind === 'percentEquity') {
    if (!(isNum(sz.percent) && sz.percent > 0)) errs.push('/sizing/percent must be > 0');
  } else errs.push(`/sizing: unknown kind "${String((sz as { kind: unknown }).kind)}"`);
  for (const [k, g] of (spec.genes ?? []).entries()) {
    const v = getAtPointer(spec, g.path);
    if (!isNum(v)) errs.push(`/genes/${k}: "${g.path}" does not point at a number`);
    if (!(isNum(g.min) && isNum(g.max) && g.min <= g.max)) errs.push(`/genes/${k}: min must be <= max`);
  }
  return errs;
}
