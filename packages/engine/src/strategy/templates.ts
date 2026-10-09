import type { Condition, ExitRules, GeneSpec, Sizing, StrategySpec } from '../types.ts';
import { candle, cmp, cross, ind, k, mirrorCondition, price } from './blocks.ts';
import { linkMirrorGenes } from './genes.ts';

const RISK_1: Sizing = { kind: 'risk', percent: 1 };
const STOP_ATR = (mult: number): ExitRules['stopLoss'] => ({ kind: 'atr', mult, period: 14 });

type G = [path: string, label: string, min: number, max: number, step?: number, int?: boolean];
const gene = ([path, label, min, max, step, int = true]: G): GeneSpec =>
  step !== undefined ? { path, label, min, max, step, int } : { path, label, min, max, int };

const STOP_GENE: G = ['/exits/stopLoss/mult', 'Stop distance (ATRs)', 1, 4, 0.25, false];
const RR_GENE: G = ['/exits/takeProfit/ratio', 'Reward : risk', 1, 4, 0.25, false];

/** Long entry + its mirrored short twin; long genes (relative to /long/enter) are mirrored too. */
function make(id: string, name: string, icon: string, long: Condition, exits: ExitRules, longGenes: G[], exitGenes: G[], sizing: Sizing = RISK_1): StrategySpec {
  const spec: StrategySpec = { id, name, icon, version: 1, long: { enter: long }, short: { enter: mirrorCondition(long) }, exits, sizing };
  // A path may list several leaves separated by '|': the first is the gene, the rest move with it.
  const lg = longGenes.map(([p, label, ...rest]) => {
    const [first, ...others] = p.split('|');
    const g = gene([`/long/enter${first}`, `${label} (long)`, ...rest] as G);
    return others.length ? { ...g, linked: others.map((o) => ({ path: `/long/enter${o}` })) } : g;
  });
  spec.genes = [...linkMirrorGenes(spec, lg), ...exitGenes.map(gene)];
  return spec;
}

export const STRATEGY_TEMPLATES: StrategySpec[] = [
  make('tpl_ema_cross', 'EMA Cross', '⚡',
    cross(ind('ema', { period: 9 }), 'above', ind('ema', { period: 21 })),
    { stopLoss: STOP_ATR(2), takeProfit: { kind: 'rr', ratio: 2 } },
    [['/left/params/period', 'Fast EMA', 3, 30], ['/right/params/period', 'Slow EMA', 10, 100]],
    [STOP_GENE, RR_GENE]),

  make('tpl_rsi_bounce', 'RSI Bounce', '🔥',
    { kind: 'all', of: [cross(ind('rsi', { period: 14 }), 'above', k(30)), cmp(price('close'), '>', ind('ema', { period: 200 }))] },
    { stopLoss: STOP_ATR(1.5), takeProfit: { kind: 'rr', ratio: 2 }, maxBars: 30 },
    [['/of/0/left/params/period', 'RSI length', 2, 30], ['/of/0/right/value', 'RSI level', 10, 45], ['/of/1/right/params/period', 'Trend EMA', 50, 300, 10]],
    [STOP_GENE, RR_GENE]),

  make('tpl_bb_reversion', 'BB Mean Reversion', '🎈',
    { kind: 'all', of: [cmp(price('low'), '<=', ind('bb', { period: 20, mult: 2 }, 'lower')), candle('bullish')] },
    { stopLoss: STOP_ATR(1.5), takeProfit: { kind: 'rr', ratio: 1.5 }, maxBars: 20 },
    [['/of/0/right/params/period', 'BB length', 10, 50], ['/of/0/right/params/mult', 'BB width', 1.5, 3, 0.1, false]],
    [STOP_GENE, RR_GENE, ['/exits/maxBars', 'Max bars in trade', 5, 60]]),

  make('tpl_donchian', 'Donchian Breakout', '🧱',
    cmp(price('close'), '>', ind('donchian', { period: 20 }, 'upper', 1)),
    { stopLoss: STOP_ATR(2), trailing: { kind: 'atr', mult: 3, period: 14 } },
    [['/right/params/period', 'Breakout bars', 10, 100]],
    [STOP_GENE, ['/exits/trailing/mult', 'Trailing (ATRs)', 1.5, 6, 0.25, false]]),

  make('tpl_supertrend', 'SuperTrend Follow', '🦸',
    cross(ind('supertrend', { period: 10, mult: 3 }, 'dir'), 'above', k(0)),
    { stopLoss: STOP_ATR(3), trailing: { kind: 'atr', mult: 3, period: 14 } },
    [['/left/params/period', 'ATR length', 5, 30], ['/left/params/mult', 'Multiplier', 1.5, 5, 0.5, false]],
    [STOP_GENE, ['/exits/trailing/mult', 'Trailing (ATRs)', 1.5, 6, 0.25, false]]),

  make('tpl_ha_ema', 'HA Trend + EMA', '🍡',
    { kind: 'all', of: [cross(ind('ha', {}, 'dir'), 'above', k(0)), cmp(price('close'), '>', ind('ema', { period: 50 }))] },
    { stopLoss: STOP_ATR(2), takeProfit: { kind: 'rr', ratio: 2 } },
    [['/of/1/right/params/period', 'Trend EMA', 10, 200, 5]],
    [STOP_GENE, RR_GENE]),

  make('tpl_macd', 'MACD Momentum', '🌊',
    { kind: 'all', of: [cross(ind('macd', { fast: 12, slow: 26, signal: 9 }, 'hist'), 'above', k(0)), cmp(ind('adx', { period: 14 }, 'adx'), '>', k(20))] },
    { stopLoss: STOP_ATR(2), takeProfit: { kind: 'rr', ratio: 2 } },
    [['/of/0/left/params/fast', 'MACD fast', 5, 20], ['/of/0/left/params/slow', 'MACD slow', 20, 60], ['/of/0/left/params/signal', 'MACD signal', 3, 15], ['/of/1/right/value', 'ADX level', 10, 35]],
    [STOP_GENE, RR_GENE]),

  // RKBB: Bollinger Band touch (this bar or the previous one) + Heikin-Ashi colour change.
  make('tpl_rkbb', 'RKBB (BB + Heikin-Ashi)', '🌸',
    { kind: 'all', of: [
      cross(ind('ha', {}, 'dir'), 'above', k(0)),
      { kind: 'any', of: [
        cmp(price('low'), '<=', ind('bb', { period: 20, mult: 2 }, 'lower')),
        cmp(price('low', 1), '<=', ind('bb', { period: 20, mult: 2 }, 'lower', 1)),
      ] },
    ] },
    { stopLoss: STOP_ATR(1.5), takeProfit: { kind: 'rr', ratio: 2 }, flatAt: '15:55' },
    [['/of/1/of/0/right/params/period|/of/1/of/1/right/params/period', 'BB length', 10, 50],
      ['/of/1/of/0/right/params/mult|/of/1/of/1/right/params/mult', 'BB width', 1.5, 3, 0.1, false]],
    [STOP_GENE, RR_GENE]),
];
