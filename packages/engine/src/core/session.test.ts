import { describe, expect, test } from 'bun:test';
import type { EngineEvent, StrategySpec } from '../types.ts';
import { Session, DEFAULT_COSTS, costsFor, planQuickTrade, isPastFlatAt } from './index.ts';
import { FUT, STOCK, T0, ZERO_COSTS, seriesOf } from './test-helpers.ts';

const flat = (p: number): [number, number, number, number] => [p, p + 1, p - 1, p];

describe('Session fills', () => {
  test('market orders fill at the next bar open', () => {
    const s = new Session({ series: seriesOf([flat(100), [101, 102, 100, 101.5], flat(103)]), costs: ZERO_COSTS });
    const o = s.buy(10);
    expect(o.status).toBe('working');
    expect(s.state.position).toBeNull();
    s.step();
    expect(s.index).toBe(1);
    expect(s.state.position?.avgPrice).toBe(101);
    expect(s.state.position?.qty).toBe(10);
    expect(o.status).toBe('filled');
    expect(o.fillPrice).toBe(101);
    // marked to market at the close
    expect(s.state.equity).toBeCloseTo(10_000 + 0.5 * 10, 9);
  });

  test('slippage, spread and commission arithmetic', () => {
    const costs = { commissionPerUnit: 0.01, commissionPerOrder: 1, slippageTicks: 2, spreadTicks: 2 };
    const s = new Session({ series: seriesOf([flat(100), flat(100), flat(110), flat(110)], FUT), costs, initialCash: 100_000 });
    const fills: number[] = [];
    let slipCost = 0;
    s.on('fill', (e) => { if (e.type === 'fill') { fills.push(e.fill.price); slipCost += e.fill.slippage; } });
    s.buy(2);
    s.step();
    expect(fills[0]).toBe(100 + 0.5 + 0.25); // 2 ticks slippage + half of 2-tick spread
    expect(s.state.cash).toBeCloseTo(100_000 - 1.02, 9);
    s.sell(2);
    s.step();
    expect(fills[1]).toBe(110 - 0.75);
    const t = s.trades[0]!;
    expect(t.commission).toBeCloseTo(2.04, 9);
    expect(t.pnl).toBeCloseTo((109.25 - 100.75) * 2 * 20 - 2.04, 9);
    expect(slipCost).toBeCloseTo(0.75 * 2 * 20 * 2, 9);
    expect(s.state.equity).toBeCloseTo(100_000 + t.pnl, 9);
  });

  test('default stock costs apply the $1 minimum', () => {
    expect(costsFor(STOCK)).toEqual(DEFAULT_COSTS);
    expect(costsFor(FUT).commissionPerUnit).toBe(2.5);
    const s = new Session({ series: seriesOf([flat(100), flat(100), flat(100)]) });
    s.buy(10);
    s.step();
    expect(s.state.cash).toBeCloseTo(10_000 - 1, 9);
  });

  test('limit buys gap to the better open, stop buys gap to the worse open', () => {
    const s = new Session({ series: seriesOf([flat(100), [97, 98, 96, 97], flat(97)]), costs: ZERO_COSTS });
    const lim = s.buy(5, { type: 'limit', price: 98 });
    s.step();
    expect(lim.fillPrice).toBe(97);
    const s2 = new Session({ series: seriesOf([flat(100), [103, 104, 102, 103], flat(103)]), costs: ZERO_COSTS });
    const stp = s2.buy(5, { type: 'stop', price: 102 });
    s2.step();
    expect(stp.fillPrice).toBe(103);
  });

  test('untouched limit orders keep working', () => {
    const s = new Session({ series: seriesOf([flat(100), flat(100), [95, 96, 94, 95]]), costs: ZERO_COSTS });
    const lim = s.buy(1, { type: 'limit', price: 96 });
    s.step();
    expect(lim.status).toBe('working');
    s.step();
    expect(lim.fillPrice).toBe(95);
  });
});

describe('Brackets', () => {
  test('stop beats target when both are inside one bar', () => {
    const s = new Session({ series: seriesOf([flat(100), [100, 100.5, 99.5, 100], [100, 103, 97, 100], flat(100)]), costs: ZERO_COSTS });
    s.buy(10, { stopLoss: 98, takeProfit: 102 });
    s.step();
    s.step();
    const t = s.trades[0]!;
    expect(t.exitReason).toBe('stop');
    expect(t.exitPrice).toBe(98);
    expect(t.hadStop).toBe(true);
    expect(t.initialRisk).toBeCloseTo(20, 9);
    expect(t.r).toBeCloseTo(-1, 9);
  });

  test('target fills at the limit when only the target is touched', () => {
    const s = new Session({ series: seriesOf([flat(100), [100, 100.5, 99.5, 100], [100, 103, 99, 102], flat(100)]), costs: ZERO_COSTS });
    s.buy(10, { stopLoss: 98, takeProfit: 102 });
    s.step(); s.step();
    expect(s.trades[0]!.exitReason).toBe('target');
    expect(s.trades[0]!.exitPrice).toBe(102);
    expect(s.trades[0]!.r).toBeCloseTo(1, 9);
  });

  test('a gap through the stop fills at the open (worse)', () => {
    const costs = { ...ZERO_COSTS, slippageTicks: 1 };
    const s = new Session({ series: seriesOf([flat(100), [100, 100.5, 99.5, 100], [95, 96, 94, 95], flat(95)]), costs });
    s.buy(10, { stopLoss: 98 });
    s.step(); s.step();
    const t = s.trades[0]!;
    expect(t.exitReason).toBe('stop');
    expect(t.exitPrice).toBeCloseTo(95 - 0.01, 9);
  });

  test('short stop gaps up', () => {
    const s = new Session({ series: seriesOf([flat(100), [100, 100.5, 99.5, 100], [105, 106, 104, 105], flat(105)]), costs: ZERO_COSTS });
    s.sell(10, { stopLoss: 102 });
    s.step(); s.step();
    expect(s.trades[0]!.exitPrice).toBe(105);
    expect(s.trades[0]!.side).toBe('short');
  });

  test('trailing stop ratchets from the extreme only after the bar check', () => {
    const s = new Session({
      series: seriesOf([flat(100), [100, 101, 99.5, 100.5], [101, 105, 100, 104], [104, 104, 102, 102.5], flat(102)]),
      costs: ZERO_COSTS,
    });
    s.buy(1, { trailDistance: 2 });
    s.step();
    expect(s.state.position?.trailStop).toBe(99); // 101 - 2 after the entry bar
    s.step();
    expect(s.state.position?.trailStop).toBe(103); // 105 - 2, not used on the same bar (low 100 > 99)
    s.step();
    const t = s.trades[0]!;
    expect(t.exitReason).toBe('trail');
    expect(t.exitPrice).toBe(103);
  });
});

describe('Netting and risk checks', () => {
  test('opposite orders reduce, close and reverse', () => {
    const s = new Session({ series: seriesOf([flat(100), flat(100), flat(102), flat(104), flat(104)]), costs: ZERO_COSTS });
    s.buy(5);
    s.step();
    s.sell(2);
    s.step();
    expect(s.trades.length).toBe(1);
    expect(s.trades[0]!.qty).toBe(2);
    expect(s.trades[0]!.exitReason).toBe('manual');
    expect(s.state.position?.qty).toBe(3);
    s.sell(8);
    s.step();
    expect(s.trades[1]!.exitReason).toBe('reverse');
    expect(s.trades[1]!.qty).toBe(3);
    expect(s.state.position?.side).toBe('short');
    expect(s.state.position?.qty).toBe(5);
    expect(s.state.position?.avgPrice).toBe(104);
  });

  test('rejects bad quantity and orders over buying power, never throws', () => {
    const s = new Session({ series: seriesOf([flat(100), flat(100)]), costs: ZERO_COSTS });
    const zero = s.buy(0);
    expect(zero.status).toBe('rejected');
    expect(zero.reason).toBeTruthy();
    const big = s.buy(500); // 50k notional > 4 × 10k
    expect(big.status).toBe('rejected');
    expect(big.reason).toMatch(/buying power/i);
    expect(s.buy(400).status).toBe('working');
    expect(s.state.workingOrders.length).toBe(1);
    const noPrice = s.submit({ action: 'buy', qty: 1, type: 'limit', actor: 'manual' });
    expect(noPrice.status).toBe('rejected');
  });

  test('allowShort=false rejects opening shorts', () => {
    const s = new Session({ series: seriesOf([flat(100), flat(100)]), costs: ZERO_COSTS, allowShort: false });
    expect(s.sell(1).status).toBe('rejected');
  });

  test('flatten closes on the next bar and cancels working orders', () => {
    const s = new Session({ series: seriesOf([flat(100), flat(100), flat(101), flat(101)]), costs: ZERO_COSTS });
    s.buy(3);
    s.step();
    s.buy(1, { type: 'limit', price: 50 });
    s.flatten();
    expect(s.state.workingOrders.length).toBe(1);
    s.step();
    expect(s.state.position).toBeNull();
    expect(s.trades[0]!.exitReason).toBe('manual');
    expect(s.trades[0]!.hadStop).toBe(false);
    expect(s.trades[0]!.r).toBeUndefined();
  });

  test('pnlPct is relative to equity at entry; MAE/MFE tracked', () => {
    const s = new Session({ series: seriesOf([flat(100), [100, 103, 98, 101], flat(102), flat(102)]), costs: ZERO_COSTS });
    s.buy(10);
    s.step(); s.step();
    s.sell(10);
    s.step();
    const t = s.trades[0]!;
    expect(t.pnl).toBeCloseTo(20, 9);
    expect(t.pnlPct).toBeCloseTo(0.2, 9);
    expect(t.mae).toBeCloseTo(-20, 9);
    expect(t.mfe).toBeCloseTo(30, 9);
  });
});

describe('Session lifecycle', () => {
  test('closes at the end, emits events in order', () => {
    const s = new Session({ series: seriesOf([flat(100), flat(100), flat(105)]), costs: ZERO_COSTS });
    const types: string[] = [];
    s.on('*', (e: EngineEvent) => types.push(e.type));
    s.buy(1);
    while (s.step());
    expect(s.done).toBe(true);
    expect(s.trades[0]!.exitReason).toBe('end');
    expect(s.trades[0]!.exitPrice).toBe(105);
    expect(types).toContain('fill');
    expect(types).toContain('positionOpened');
    expect(types).toContain('tradeClosed');
    expect(types.at(-1)).toBe('end');
    expect(types.slice(0, 2)).toEqual(['order', 'bar']);
    const r = s.result();
    expect(r.equity.length).toBe(3);
    expect(r.metrics.trades).toBe(1);
    expect(s.buy(1).status).toBe('rejected');
  });

  test('unsubscribe works', () => {
    const s = new Session({ series: seriesOf([flat(100), flat(100)]), costs: ZERO_COSTS });
    let n = 0;
    const off = s.on('bar', () => n++);
    off();
    s.step();
    expect(n).toBe(0);
  });

  test('appendBar extends the series in live mode', () => {
    const s = new Session({ series: seriesOf([flat(100), flat(101)]), costs: ZERO_COSTS, closeAtEnd: false });
    s.step();
    expect(s.step()).toBe(false);
    s.buy(1);
    s.appendBar({ t: T0 + 2 * 300_000, o: 102, h: 103, l: 101, c: 102, v: 1 });
    expect(s.done).toBe(false);
    expect(s.step()).toBe(true);
    expect(s.state.position?.avgPrice).toBe(102);
    expect(s.cols.c.length).toBe(3);
  });

  test('bot and manual coexist; manual flatten while the bot runs', () => {
    const spec: StrategySpec = {
      id: 'always', name: 'Always long', version: 1,
      long: { enter: { kind: 'candle', pattern: 'bullish' } },
      exits: {}, sizing: { kind: 'fixed', qty: 2 },
    };
    const bars = Array.from({ length: 6 }, (_, i): [number, number, number, number] => [100 + i, 101.5 + i, 99.5 + i, 101 + i]);
    const s = new Session({ series: seriesOf(bars), costs: ZERO_COSTS, strategy: spec });
    s.step(); // bot queued at bar 0 fills at bar 1
    expect(s.state.position?.actor).toBe('bot');
    expect(s.state.position?.qty).toBe(2);
    s.flatten('manual');
    s.step();
    expect(s.trades[0]!.exitReason).toBe('manual');
  });
});

describe('time exits', () => {
  test('isPastFlatAt uses the bar close time in New York', () => {
    const bar1550 = Date.UTC(2024, 2, 4, 20, 50); // 15:50 NY (EST)
    expect(isPastFlatAt(bar1550, '15:55', '5m')).toBe(true);
    expect(isPastFlatAt(bar1550 - 300_000, '15:55', '5m')).toBe(false);
    expect(isPastFlatAt(bar1550, undefined)).toBe(false);
    expect(isPastFlatAt(bar1550, '15:55', '1d')).toBe(false);
  });

  test('flatAt closes at that bar close with reason eod; maxBars with reason time', () => {
    const base: StrategySpec = {
      id: 'x', name: 'x', version: 1, long: { enter: { kind: 'candle', pattern: 'bullish' } },
      exits: { flatAt: '09:45' }, sizing: { kind: 'fixed', qty: 1 },
    };
    const up = Array.from({ length: 8 }, (_, i): [number, number, number, number] => [100 + i, 101.5 + i, 99.5 + i, 101 + i]);
    const s = new Session({ series: seriesOf(up), costs: ZERO_COSTS, strategy: base });
    while (s.step());
    // bar 2 opens 09:40 and closes 09:45 -> exit at its close; no new entries afterwards that day
    expect(s.trades[0]!.exitReason).toBe('eod');
    expect(s.trades[0]!.exitPrice).toBe(103);
    expect(s.trades.length).toBe(1);

    const s2 = new Session({ series: seriesOf(up), costs: ZERO_COSTS, strategy: { ...base, exits: { maxBars: 2 } } });
    while (s2.step());
    expect(s2.trades[0]!.exitReason).toBe('time');
    expect(s2.trades[0]!.barsHeld).toBe(2);
  });
});

describe('planQuickTrade', () => {
  test('sizes so the stop loses ~riskPct of equity', () => {
    const bars = Array.from({ length: 40 }, (): [number, number, number, number] => [100, 101, 99, 100]);
    const s = new Session({ series: seriesOf(bars), startIndex: 30, costs: ZERO_COSTS });
    const p = planQuickTrade(s, 'buy');
    // ATR = 2 -> stop distance 4, target 8; risk 1% of 10k = 100 -> 25 shares
    expect(p.stopLoss).toBeCloseTo(96, 9);
    expect(p.takeProfit).toBeCloseTo(108, 9);
    expect(p.qty).toBe(25);
    const sh = planQuickTrade(s, 'sell', { riskPct: 2, atrMult: 1, rr: 3 });
    expect(sh.stopLoss).toBeCloseTo(102, 9);
    expect(sh.takeProfit).toBeCloseTo(94, 9);
    expect(sh.qty).toBe(100);
    // capped by buying power (4x of 10k at $100 = 400)
    expect(planQuickTrade(s, 'buy', { riskPct: 100, atrMult: 0.5 }).qty).toBe(400);
  });

  test('at least 1 unit for futures, 0 when unaffordable', () => {
    const bars = Array.from({ length: 30 }, (): [number, number, number, number] => [1000, 1010, 990, 1000]);
    const s = new Session({ series: seriesOf(bars, FUT), startIndex: 20, costs: ZERO_COSTS });
    expect(planQuickTrade(s, 'buy').qty).toBe(1); // risk 40pts × $20 = $800 > $100 but min 1
    const poor = new Session({ series: seriesOf(bars, FUT), startIndex: 20, costs: ZERO_COSTS, initialCash: 500 });
    expect(planQuickTrade(poor, 'buy').qty).toBe(0);
  });
});
