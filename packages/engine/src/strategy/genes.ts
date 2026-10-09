import type { Condition, Distance, GeneSpec, Operand, StrategySpec } from '../types.ts';
import { INDICATORS } from '../indicators/index.ts';
import { describeOperand } from './describe.ts';
import { getAtPointer } from './pointer.ts';

const BY_ID = new Map(INDICATORS.map((d) => [d.id, d]));
const r4 = (x: number) => Number(x.toFixed(4));

function operandGenes(op: Operand, path: string, side: string, out: GeneSpec[]): void {
  if (op.kind !== 'indicator') return;
  const def = BY_ID.get(op.id);
  if (!def) return;
  for (const p of def.params) {
    const v = op.params?.[p.key];
    if (typeof v !== 'number' || (p.type !== 'int' && p.type !== 'float')) continue;
    const lo = Math.max(p.min ?? -Infinity, p.type === 'int' ? Math.round(v / 2) : v / 2);
    const hi = Math.min(p.max ?? Infinity, p.type === 'int' ? Math.round(v * 2) : v * 2);
    if (!(hi > lo)) continue;
    const g: GeneSpec = { path: `${path}/params/${p.key}`, label: `${describeOperand({ ...op, offset: 0 })} ${p.label.toLowerCase()}${side}`, min: r4(lo), max: r4(hi), int: p.type === 'int' };
    if (p.type === 'float') g.step = p.step ?? 0.1;
    out.push(g);
  }
}

function constGene(c: Extract<Operand, { kind: 'const' }>, partner: Operand, path: string, side: string, out: GeneSpec[]): void {
  const v = c.value;
  const range = partner.kind === 'indicator' ? BY_ID.get(partner.id)?.range : undefined;
  let lo: number, hi: number;
  if (range) {
    const q = (range[1] - range[0]) / 4;
    lo = Math.max(range[0], v - q);
    hi = Math.min(range[1], v + q);
  } else {
    if (v === 0) return; // zero lines (MACD, SuperTrend direction) are structural
    lo = Math.min(v * 0.5, v * 1.5);
    hi = Math.max(v * 0.5, v * 1.5);
  }
  const int = Number.isInteger(v) && hi - lo >= 4;
  out.push({ path, label: `${describeOperand(partner)} level${side}`, min: r4(lo), max: r4(hi), int });
}

function condGenes(c: Condition, path: string, side: string, out: GeneSpec[]): void {
  switch (c.kind) {
    case 'compare':
    case 'cross':
      operandGenes(c.left, `${path}/left`, side, out);
      operandGenes(c.right, `${path}/right`, side, out);
      if (c.left.kind === 'const') constGene(c.left, c.right, `${path}/left/value`, side, out);
      if (c.right.kind === 'const') constGene(c.right, c.left, `${path}/right/value`, side, out);
      return;
    case 'rising':
    case 'falling':
      operandGenes(c.operand, `${path}/operand`, side, out);
      out.push({ path: `${path}/bars`, label: `Bars ${c.kind}${side}`, min: 1, max: Math.max(5, c.bars * 2), int: true });
      return;
    case 'all':
    case 'any':
      c.of.forEach((s, k) => condGenes(s, `${path}/of/${k}`, side, out));
      return;
    case 'not':
      condGenes(c.of, `${path}/of`, side, out);
      return;
    default:
      return;
  }
}

function distanceGenes(d: Distance | undefined, path: string, name: string, out: GeneSpec[]): void {
  if (!d) return;
  if (d.kind === 'atr') out.push({ path: `${path}/mult`, label: `${name} (ATRs)`, min: 0.5, max: 6, step: 0.25 });
  else out.push({ path: `${path}/value`, label: `${name} (${d.kind === 'percent' ? '%' : 'points'})`, min: r4(d.value / 2), max: r4(d.value * 2) });
}

/** Sensible genes from the numeric leaves of a spec (indicator params, thresholds, exits). */
export function autoGenes(spec: StrategySpec): GeneSpec[] {
  const out: GeneSpec[] = [];
  const both = !!spec.long && !!spec.short;
  if (spec.long) condGenes(spec.long.enter, '/long/enter', both ? ' (long)' : '', out);
  if (spec.short) condGenes(spec.short.enter, '/short/enter', both ? ' (short)' : '', out);
  const ex = spec.exits;
  if (ex.exitWhen) condGenes(ex.exitWhen, '/exits/exitWhen', ' (exit)', out);
  distanceGenes(ex.stopLoss, '/exits/stopLoss', 'Stop distance', out);
  if (ex.takeProfit) {
    if (ex.takeProfit.kind === 'rr') out.push({ path: '/exits/takeProfit/ratio', label: 'Reward : risk', min: 0.5, max: 5, step: 0.25 });
    else distanceGenes(ex.takeProfit, '/exits/takeProfit', 'Target distance', out);
  }
  distanceGenes(ex.trailing, '/exits/trailing', 'Trailing distance', out);
  if (ex.maxBars) out.push({ path: '/exits/maxBars', label: 'Max bars in trade', min: Math.max(1, Math.round(ex.maxBars / 2)), max: ex.maxBars * 2, int: true });
  return out;
}

/**
 * Copies genes on /long/... onto the matching /short/... paths. Bounds are reflected the
 * same way the value was mirrored (e.g. RSI 30 → 70 turns [10, 45] into [55, 90]).
 */
export function mirrorGenes(spec: StrategySpec, longGenes: GeneSpec[]): GeneSpec[] {
  const out: GeneSpec[] = [];
  for (const g of longGenes) {
    if (!g.path.startsWith('/long/')) continue;
    const path = '/short/' + g.path.slice('/long/'.length);
    const lv = getAtPointer(spec, g.path), sv = getAtPointer(spec, path);
    if (typeof lv !== 'number' || typeof sv !== 'number') continue;
    const sum = lv + sv;
    const [min, max] = lv === sv ? [g.min, g.max] : [r4(sum - g.max), r4(sum - g.min)];
    const toShort = (q: string) => (q.startsWith('/long/') ? '/short/' + q.slice('/long/'.length) : q);
    const linked = g.linked?.map((l) => ({ ...l, path: toShort(l.path) }));
    out.push({ ...g, path, label: g.label.replace(/ \(long\)$/, '') + ' (short)', min, max, ...(linked ? { linked } : {}) });
  }
  return out;
}

/**
 * Long genes that also drive the mirrored /short/ leaves, so the GA tunes one
 * value per idea instead of letting the two sides drift apart.
 */
export function linkMirrorGenes(spec: StrategySpec, longGenes: GeneSpec[]): GeneSpec[] {
  return longGenes.map((g) => {
    if (!g.path.startsWith('/long/')) return g;
    const path = '/short/' + g.path.slice('/long/'.length);
    const lv = getAtPointer(spec, g.path), sv = getAtPointer(spec, path);
    if (typeof lv !== 'number' || typeof sv !== 'number') return g;
    const mirror = (from: string, to: string, a: unknown, b: unknown) =>
      a === b ? { path: to } : { path: to, scale: -1, offset: r4((a as number) + (b as number)) };
    const links = [mirror(g.path, path, lv, sv)];
    for (const l of g.linked ?? []) {
      if (!l.path.startsWith('/long/')) continue;
      const sp = '/short/' + l.path.slice('/long/'.length);
      const a = getAtPointer(spec, l.path), b = getAtPointer(spec, sp);
      if (typeof a === 'number' && typeof b === 'number') links.push(mirror(l.path, sp, a, b));
    }
    return { ...g, label: g.label.replace(/ \(long\)$/, ''), linked: [...(g.linked ?? []), ...links] };
  });
}
