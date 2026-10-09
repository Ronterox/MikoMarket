import { describe, expect, test } from 'bun:test';
import {
  Coach, COACH_LINES, createProfile, GREET_LINES, IDLE_TIPS, LEVEL_LINES, REPORT_LINES, SESSION_LINES, TIP_META,
  type CoachContext, type LineParams,
} from './index.ts';
import type { EngineEvent, Grade } from '../types.ts';
import { account, metrics, position, report, trade } from './fixtures.test-util.ts';

const ctx = (over: Partial<CoachContext> = {}): CoachContext => ({
  state: account(), recentTrades: [], barsSinceLastTrade: 0, mode: 'arcade', index: 100, lifetimeTrades: 10, ...over,
});

describe('Coach situations', () => {
  test('entered without a stop', () => {
    const c = new Coach(1);
    const tip = c.observe({ type: 'positionOpened', position: position({ stopLoss: undefined }) }, ctx());
    expect(tip?.id).toBe('no_stop');
    expect(tip?.mood).toBe('worried');
  });

  test('size too big (> 3% risk)', () => {
    const tip = new Coach(1).observe({ type: 'positionOpened', position: position({ initialRisk: 500 }) }, ctx());
    expect(tip?.id).toBe('too_big');
  });

  test('revenge trade beats size warning', () => {
    const last = trade({ pnl: -100, qty: 10 });
    const tip = new Coach(1).observe({ type: 'positionOpened', position: position({ qty: 30, initialRisk: 500 }) },
      ctx({ recentTrades: [last], barsSinceLastTrade: 1 }));
    expect(tip?.id).toBe('revenge');
  });

  test('first trade ever', () => {
    const tip = new Coach(1).observe({ type: 'positionOpened', position: position() }, ctx({ lifetimeTrades: 0 }));
    expect(tip?.id).toBe('first_trade');
  });

  test('3 losses in a row, stop hit, big win', () => {
    const losses = [trade({ pnl: -1 }), trade({ pnl: -1 })];
    const third = trade({ pnl: -1, exitReason: 'stop' });
    expect(new Coach(1).observe({ type: 'tradeClosed', trade: third }, ctx({ recentTrades: losses }))?.id).toBe('loss_streak');
    expect(new Coach(1).observe({ type: 'tradeClosed', trade: third }, ctx())?.id).toBe('stop_hit');
    const big = new Coach(1).observe({ type: 'tradeClosed', trade: trade({ pnl: 400, r: 4 }) }, ctx());
    expect(big?.id).toBe('big_win');
    expect(big?.mood).toBe('excited');
  });

  test('drawdown and new equity high', () => {
    const c = new Coach(1);
    expect(c.observe({ type: 'equity', t: 0, equity: 10_000, drawdownPct: 0 }, ctx({ index: 1 }))).toBeNull();
    expect(c.observe({ type: 'equity', t: 0, equity: 10_200, drawdownPct: 0 }, ctx({ index: 2 }))?.id).toBe('new_high');
    expect(c.observe({ type: 'equity', t: 0, equity: 8_000, drawdownPct: 12 }, ctx({ index: 3 }))?.id).toBe('drawdown');
  });

  test('long idle and held through flatAt', () => {
    expect(new Coach(1).observe({ type: 'bar', index: 100, bar: { t: 0, o: 1, h: 1, l: 1, c: 1, v: 1 } }, ctx({ barsSinceLastTrade: 80 }))?.id).toBe('idle_long');
    const tip = new Coach(1).observe({ type: 'bar', index: 100, bar: { t: 0, o: 1, h: 1, l: 1, c: 1, v: 1 } },
      ctx({ pastFlatAt: true, state: account({ position: position() }) }));
    expect(tip?.id).toBe('flat_at');
  });
});

describe('Coach cooldowns and determinism', () => {
  const noStop: EngineEvent = { type: 'positionOpened', position: position({ stopLoss: undefined }) };
  const win: EngineEvent = { type: 'tradeClosed', trade: trade({ pnl: 10, r: 0.5, pnlPct: 0.1 }) };

  test('per-tip cooldown in bars', () => {
    const c = new Coach(7);
    const cd = TIP_META['no_stop']!.cooldown;
    expect(c.observe(noStop, ctx({ index: 100 }))).not.toBeNull();
    expect(c.observe(noStop, ctx({ index: 101 }))).toBeNull();
    expect(c.observe(noStop, ctx({ index: 100 + cd - 1 }))).toBeNull();
    expect(c.observe(noStop, ctx({ index: 100 + cd }))).not.toBeNull();
  });

  test('global gap blocks low-priority tips but not high-priority ones', () => {
    const c = new Coach({ seed: 3, minGapBars: 8 });
    expect(c.observe(win, ctx({ index: 10 }))?.id).toBe('nice_win');
    const tip2 = c.observe({ type: 'tradeClosed', trade: trade({ pnl: -5, exitReason: 'stop' }) }, ctx({ index: 12 }));
    expect(tip2).toBeNull(); // stop_hit is priority 60, inside the gap
    expect(c.observe(noStop, ctx({ index: 13 }))?.id).toBe('no_stop'); // priority 90 bypasses
    expect(c.observe({ type: 'tradeClosed', trade: trade({ pnl: -5, exitReason: 'stop' }) }, ctx({ index: 30 }))?.id).toBe('stop_hit');
  });

  test('first trade tip shows only once', () => {
    const c = new Coach(1);
    const ev: EngineEvent = { type: 'positionOpened', position: position() };
    expect(c.observe(ev, ctx({ lifetimeTrades: 0, index: 1 }))?.id).toBe('first_trade');
    expect(c.observe(ev, ctx({ lifetimeTrades: 0, index: 10_000 }))).toBeNull();
  });

  test('same seed => same tips; different seeds vary', () => {
    const run = (seed: number) => {
      const c = new Coach(seed);
      const out: string[] = [];
      for (let i = 0; i < 40; i++) {
        out.push(c.observe(noStop, ctx({ index: i * 50 }))?.text ?? '-');
        out.push(c.idle().text);
      }
      return out;
    };
    expect(run(42)).toEqual(run(42));
    expect(run(42)).not.toEqual(run(43));
    expect(new Set(run(42)).size).toBeGreaterThan(3);
  });

  test('idle cycles through every micro-tip', () => {
    const c = new Coach(5);
    const seen = new Set<string>();
    for (let i = 0; i < IDLE_TIPS.length; i++) seen.add(c.idle().text);
    expect(seen.size).toBe(IDLE_TIPS.length);
  });

  test('onReport / onSessionEnd / onLevelUp / greet produce tips', () => {
    const c = new Coach(1);
    expect(c.onReport(report({ grade: 'D' })).mood).toBe('teaching');
    expect(c.onSessionEnd(metrics({ trades: 3, wins: 1, netProfit: -50 }), [{ amount: 40, reason: 'x', icon: 'y' }]).text).toContain('40');
    expect(c.onLevelUp(5).text).toContain('5');
    const p = createProfile('p', 'Ann', 0);
    expect(c.greet(p, '2026-10-10').id).toBe('greet_new');
    expect(c.greet({ ...p, stats: { ...p.stats, sessions: 3 }, streakDays: 3, lastPlayedDay: '2026-10-09' }, '2026-10-10').id).toBe('greet_streak');
    expect(c.greet({ ...p, stats: { ...p.stats, sessions: 3 }, streakDays: 3, lastPlayedDay: '2026-10-01' }, '2026-10-10').id).toBe('greet_back');
  });
});

describe('Coach text length', () => {
  const extremes: LineParams[] = [
    {},
    { risk: 99.99, r: 999.9, dd: 99.9, xp: 999_999, wins: 99_999, trades: 99_999, level: 999, name: 'A'.repeat(80), streak: 9999 },
    { risk: 3.1, r: 3, dd: 10.5, xp: 45, wins: 2, trades: 5, level: 2, name: 'Ann', streak: 2 },
  ];
  const all = [
    ...Object.values(COACH_LINES).flat(), ...Object.values(REPORT_LINES).flat(), ...Object.values(SESSION_LINES).flat(),
    ...LEVEL_LINES, ...Object.values(GREET_LINES).flat(),
  ];

  test('every generator <= 140 chars (target 120) with extreme params', () => {
    for (const line of all) {
      for (const p of extremes) {
        const text = line(p);
        expect(text.length).toBeGreaterThan(0);
        expect(text.length).toBeLessThanOrEqual(140);
      }
    }
    for (const t of IDLE_TIPS) expect(t.length).toBeLessThanOrEqual(120);
  });

  test('2-4 variants per situation; every tip id has metadata', () => {
    for (const [id, lines] of Object.entries(COACH_LINES)) {
      expect(TIP_META[id]).toBeDefined();
      expect(lines.length).toBeGreaterThanOrEqual(2);
      expect(lines.length).toBeLessThanOrEqual(4);
    }
    for (const g of ['S', 'A', 'B', 'C', 'D'] as Grade[]) expect(REPORT_LINES[g].length).toBeGreaterThanOrEqual(2);
  });
});
