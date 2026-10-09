import { describe, expect, test } from 'bun:test';
import type { Condition, StrategySpec } from '../types.ts';
import { toColumns } from '../util/columns.ts';
import {
  BLOCK_CATALOG, STRATEGY_TEMPLATES, applyGenome, autoGenes, cardGenes, compileStrategy, describeCondition,
  describeStrategy, getAtPointer, mirrorCondition, setAtPointer, validateStrategy,
  mirrorGenes,
} from './index.ts';
import { runBacktest } from '../backtest/index.ts';
import { randomSeries, seriesOf } from '../core/test-helpers.ts';

const rsi = (period = 14) => ({ kind: 'indicator' as const, id: 'rsi', params: { period } });

describe('JSON pointer helpers', () => {
  const obj = { a: { 'b/c': [1, { d: 2 }], 'x~y': 3 } };
  test('getAtPointer reads with RFC 6901 escapes', () => {
    expect(getAtPointer(obj, '/a/b~1c/1/d')).toBe(2);
    expect(getAtPointer(obj, '/a/x~0y')).toBe(3);
    expect(getAtPointer(obj, '')).toBe(obj);
    expect(getAtPointer(obj, '/a/missing/x')).toBeUndefined();
    expect(getAtPointer(obj, '/a/b~1c/9')).toBeUndefined();
  });
  test('setAtPointer is immutable and shares untouched branches', () => {
    const next = setAtPointer(obj, '/a/b~1c/1/d', 5);
    expect(getAtPointer(next, '/a/b~1c/1/d')).toBe(5);
    expect(obj.a['b/c'][1]).toEqual({ d: 2 });
    expect(next.a['x~y']).toBe(3);
    expect(Array.isArray(next.a['b/c'])).toBe(true);
  });
  test('applyGenome clamps, rounds ints and snaps to steps', () => {
    const spec: StrategySpec = {
      id: 's', name: 's', version: 1,
      long: { enter: { kind: 'compare', left: rsi(), op: '<', right: { kind: 'const', value: 30 } } },
      exits: { stopLoss: { kind: 'atr', mult: 2, period: 14 } }, sizing: { kind: 'fixed', qty: 1 },
      genes: [
        { path: '/long/enter/left/params/period', label: 'p', min: 2, max: 30, int: true },
        { path: '/exits/stopLoss/mult', label: 'm', min: 1, max: 4, step: 0.25 },
      ],
    };
    const out = applyGenome(spec, [7.6, 9]);
    expect(getAtPointer(out, '/long/enter/left/params/period')).toBe(8);
    expect(getAtPointer(out, '/exits/stopLoss/mult')).toBe(4);
    expect(getAtPointer(applyGenome(spec, [1, 1.6]), '/exits/stopLoss/mult')).toBe(1.5);
    expect(getAtPointer(spec, '/long/enter/left/params/period')).toBe(14);
  });
});

describe('compiler', () => {
  test('cross, compare, offsets and candle patterns', () => {
    const s = seriesOf([[10, 11, 9, 10], [10, 12, 9.5, 11], [11, 11.5, 8, 9], [9, 13, 8.5, 12.5], [12, 12.2, 11.8, 12]]);
    const cols = toColumns(s.bars);
    const mk = (c: Condition): boolean[] => {
      const cs = compileStrategy({ id: 't', name: 't', version: 1, long: { enter: c }, exits: {}, sizing: { kind: 'fixed', qty: 1 } }, cols);
      return s.bars.map((_, i) => cs.longEntry(i));
    };
    const close = { kind: 'price' as const, source: 'close' as const };
    expect(mk({ kind: 'cross', left: close, dir: 'above', right: { kind: 'const', value: 10.5 } })).toEqual([false, true, false, true, false]);
    expect(mk({ kind: 'compare', left: close, op: '>', right: { ...close, offset: 1 } })).toEqual([false, true, false, true, false]);
    expect(mk({ kind: 'candle', pattern: 'bullish' })).toEqual([false, true, false, true, false]);
    expect(mk({ kind: 'candle', pattern: 'engulfing_bull' })).toEqual([false, false, false, true, false]);
    expect(mk({ kind: 'candle', pattern: 'outside_bar' })).toEqual([false, false, false, false, false]);
    expect(mk({ kind: 'candle', pattern: 'inside_bar' })).toEqual([false, false, false, false, true]);
    expect(mk({ kind: 'rising', operand: close, bars: 1 })).toEqual([false, true, false, true, false]);
    expect(mk({ kind: 'not', of: { kind: 'candle', pattern: 'bullish' } })).toEqual([true, false, true, false, true]);
    // 09:30..09:40 NY = first two bars
    expect(mk({ kind: 'time', from: '09:30', to: '09:40' })).toEqual([true, true, false, false, false]);
  });

  test('computes each distinct indicator once and is causal on truncated data', () => {
    const s = randomSeries(400, 3);
    const spec = STRATEGY_TEMPLATES.find((t) => t.id === 'tpl_rkbb')!;
    const full = compileStrategy(spec, toColumns(s.bars));
    const part = compileStrategy(spec, toColumns(s.bars.slice(0, 250)));
    for (let i = 0; i < 250; i++) {
      expect(part.longEntry(i)).toBe(full.longEntry(i));
      expect(part.shortEntry(i)).toBe(full.shortEntry(i));
    }
    expect(full.warmup).toBeGreaterThanOrEqual(20);
  });

  test('distances and sizing', () => {
    const s = randomSeries(100, 4);
    const cols = toColumns(s.bars);
    const cs = compileStrategy({
      id: 'd', name: 'd', version: 1, long: { enter: { kind: 'candle', pattern: 'bullish' } },
      exits: { stopLoss: { kind: 'percent', value: 2 }, takeProfit: { kind: 'rr', ratio: 3 }, trailing: { kind: 'points', value: 1.5 } },
      sizing: { kind: 'risk', percent: 1 },
    }, cols);
    expect(cs.stopDistance(50, 100)).toBeCloseTo(2, 9);
    expect(cs.targetDistance(50, 100)).toBeCloseTo(6, 9);
    expect(cs.trailDistance(50)).toBe(1.5);
    expect(cs.size(50, 10_000, 100, 2, 1)).toBeCloseTo(50, 9);
    expect(cs.size(50, 10_000, 100, NaN, 1)).toBe(1);
  });
});

describe('validate / describe', () => {
  test('catches problems', () => {
    const bad = { id: '', name: 'x', version: 1, exits: { flatAt: '25:99' }, sizing: { kind: 'fixed', qty: 0 } } as unknown as StrategySpec;
    const errs = validateStrategy(bad);
    expect(errs.length).toBeGreaterThanOrEqual(4);
    const unknown: StrategySpec = {
      id: 'u', name: 'u', version: 1, exits: {}, sizing: { kind: 'fixed', qty: 1 },
      long: { enter: { kind: 'compare', left: { kind: 'indicator', id: 'nope', params: {} }, op: '>', right: { kind: 'const', value: 1 } } },
    };
    expect(validateStrategy(unknown)[0]).toMatch(/unknown indicator/);
  });

  test('plain English', () => {
    expect(describeCondition({ kind: 'cross', left: rsi(), dir: 'above', right: { kind: 'const', value: 30 } })).toBe('RSI(14) crosses above 30');
    expect(describeCondition({ kind: 'compare', left: { kind: 'price', source: 'close' }, op: '>', right: { kind: 'indicator', id: 'ema', params: { period: 50 } } })).toBe('Close is above EMA(50)');
    expect(describeCondition({ kind: 'compare', left: { kind: 'price', source: 'low' }, op: '<=', right: { kind: 'indicator', id: 'bb', params: { period: 20, mult: 2 }, output: 'lower' } })).toBe('Low is at or below BB(20, 2) Lower');
    const lines = describeStrategy(STRATEGY_TEMPLATES[0]!);
    expect(lines[0]).toBe('Buy when EMA(9) crosses above EMA(21)');
    expect(lines[1]).toBe('Sell short when EMA(9) crosses below EMA(21)');
  });
});

describe('blocks and mirroring', () => {
  test('mirrorCondition', () => {
    const m = mirrorCondition({ kind: 'compare', left: rsi(), op: '<', right: { kind: 'const', value: 30 } });
    expect(m).toEqual({ kind: 'compare', left: rsi(), op: '>', right: { kind: 'const', value: 70 } });
    const bb = BLOCK_CATALOG.find((b) => b.id === 'bb_lower_touch')!;
    expect(describeCondition(mirrorCondition(bb.condition))).toBe('High is at or above BB(20, 2) Upper');
    expect(mirrorCondition({ kind: 'candle', pattern: 'hammer' })).toEqual({ kind: 'candle', pattern: 'shooting_star' });
    const adx = BLOCK_CATALOG.find((b) => b.id === 'adx_trending')!;
    expect(mirrorCondition(adx.condition)).toEqual(adx.condition);
    const st = BLOCK_CATALOG.find((b) => b.id === 'supertrend_flip_up')!;
    expect(describeCondition(mirrorCondition(st.condition))).toBe('SuperTrend(10, 3) Direction crosses below 0');
  });

  test('every card is valid, short-labelled and its genes resolve', () => {
    expect(BLOCK_CATALOG.length).toBeGreaterThanOrEqual(15);
    expect(BLOCK_CATALOG.length).toBeLessThanOrEqual(25);
    const ids = new Set<string>();
    for (const card of BLOCK_CATALOG) {
      expect(ids.has(card.id)).toBe(false);
      ids.add(card.id);
      expect(card.label.split(/\s+/).length).toBeLessThanOrEqual(4);
      const spec: StrategySpec = {
        id: card.id, name: card.label, version: 1, long: { enter: card.condition }, short: { enter: mirrorCondition(card.condition) },
        exits: { stopLoss: { kind: 'atr', mult: 2, period: 14 } }, sizing: { kind: 'fixed', qty: 1 },
        genes: cardGenes(card, '/long/enter'),
      };
      expect(validateStrategy(spec)).toEqual([]);
    }
  });
});

describe('templates', () => {
  test('all validate, run, and autoGenes point at numbers', () => {
    expect(STRATEGY_TEMPLATES.length).toBe(8);
    const s = randomSeries(1500, 7);
    for (const t of STRATEGY_TEMPLATES) {
      expect(validateStrategy(t)).toEqual([]);
      const r = runBacktest(s, t);
      expect(r.equity.length).toBe(r.endIndex - r.startIndex + 1);
      expect(Number.isFinite(r.metrics.netProfit)).toBe(true);
      const auto = autoGenes(t);
      expect(auto.length).toBeGreaterThan(0);
      expect(validateStrategy({ ...t, genes: auto })).toEqual([]);
      // a genome at the midpoint stays valid
      const mid = applyGenome(t, (t.genes ?? []).map((g) => (g.min + g.max) / 2));
      expect(validateStrategy(mid)).toEqual([]);
    }
    const traded = STRATEGY_TEMPLATES.filter((t) => runBacktest(s, t).trades.length > 0).length;
    expect(traded).toBeGreaterThanOrEqual(7);
  });

  test('mirrored short genes reflect thresholds', () => {
    const t = STRATEGY_TEMPLATES.find((x) => x.id === 'tpl_rsi_bounce')!;
    const g = t.genes!.find((x) => x.path === '/long/enter/of/0/right/value')!;
    const out = applyGenome(t, t.genes!.map((x) => (x === g ? 10 : x.min)));
    expect(getAtPointer(out, '/short/enter/of/0/right/value')).toBe(90);
  });
});

describe('linked genes', () => {
  test('one gene drives mirrored long/short leaves', () => {
    const tpl = STRATEGY_TEMPLATES.find((t) => t.id === 'tpl_rsi_bounce')!;
    const genes = tpl.genes!;
    expect(genes.some((g) => g.path.startsWith('/short/'))).toBe(false);
    const values = genes.map((g) => g.min);
    const out = applyGenome(tpl, values);
    const levelGene = genes.find((g) => g.linked?.some((l) => l.scale === -1))!;
    const link = levelGene.linked!.find((l) => l.scale === -1)!;
    expect(getAtPointer(out, link.path)).toBeCloseTo(link.offset! - levelGene.min, 6);
  });

  test('RKBB tunes both Bollinger copies together', () => {
    const tpl = STRATEGY_TEMPLATES.find((t) => t.id === 'tpl_rkbb')!;
    const out = applyGenome(tpl, tpl.genes!.map((g) => g.max));
    for (const side of ['long', 'short']) {
      const a = getAtPointer(out, `/${side}/enter/of/1/of/0/right/params/period`);
      const b = getAtPointer(out, `/${side}/enter/of/1/of/1/right/params/period`);
      expect(a).toBe(50);
      expect(b).toBe(50);
    }
  });
});

describe('mirrorGenes keeps linked leaves', () => {
  test('linked /long/ paths are remapped to /short/', () => {
    const tpl = STRATEGY_TEMPLATES.find((t) => t.id === 'tpl_rkbb')!;
    const longGene = { path: '/long/enter/of/1/of/0/right/params/period', label: 'BB length (long)', min: 10, max: 50, int: true,
      linked: [{ path: '/long/enter/of/1/of/1/right/params/period' }] };
    const [g] = mirrorGenes(tpl, [longGene]);
    expect(g!.path).toBe('/short/enter/of/1/of/0/right/params/period');
    expect(g!.linked![0]!.path).toBe('/short/enter/of/1/of/1/right/params/period');
  });
});
