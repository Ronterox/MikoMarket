import { describe, expect, test } from 'bun:test';
import {
  ACTION_COOLDOWN, ACTION_LINES, CLOCK_GAP, CLOCK_MOMENTS, Coach, INDICATOR_TIPS, PERFORMANCE_LINES, comboVerdict, indicatorTips, nyClock,
  type CoachContext,
} from './index.ts';
import { listIndicators } from '../indicators/index.ts';
import type { Bar, Tip } from '../types.ts';
import { account, position, trade } from './fixtures.test-util.ts';

const ctx = (over: Partial<CoachContext> = {}): CoachContext => ({
  state: account(), recentTrades: [], barsSinceLastTrade: 0, mode: 'arcade', index: 100, lifetimeTrades: 10, ...over,
});
const bar = (o: number, c: number, h = Math.max(o, c), l = Math.min(o, c)): Bar => ({ t: 0, o, h, l, c, v: 1 });
const ET_JULY = (d: number, hh: number, mm = 0) => Date.UTC(2026, 6, d, hh + 4, mm); // EDT = UTC-4
const ET_JAN = (d: number, hh: number, mm = 0) => Date.UTC(2026, 0, d, hh + 5, mm); // EST = UTC-5

describe('indicator tips', () => {
  test('every catalog indicator has 2+ tips, each <= 140 chars', () => {
    for (const m of listIndicators()) {
      const tips = indicatorTips(m.id);
      expect(tips.length, m.id).toBeGreaterThanOrEqual(2);
      for (const t of tips) expect(t.length, t).toBeLessThanOrEqual(140);
    }
    expect(Object.keys(INDICATOR_TIPS).sort()).toEqual(listIndicators().map((m) => m.id).sort());
    expect(indicatorTips('nope')).toEqual([]);
  });
});

describe('comboVerdict', () => {
  const cases: [string[], string, RegExp?][] = [
    [['rsi', 'stoch', 'willr'], 'redundant', /momentum oscillators/],
    [['ema', 'ema', 'sma', 'hma'], 'redundant', /spaghetti/],
    [['ichimoku', 'rsi'], 'unusual', /cloud/],
    [['bb', 'keltner'], 'classic', /squeeze/],
    [['ema', 'vwap'], 'classic'],
    [['bb', 'rsi'], 'classic'],
    [['supertrend', 'adx'], 'classic'],
    [['macd', 'ema'], 'classic'],
    [['ha', 'ema'], 'classic'],
    [['bb', 'ha'], 'classic', /RKBB/],
    [['stoch', 'willr'], 'redundant'],
    [['atr', 'natr'], 'redundant'],
    [['bb', 'keltner', 'donchian'], 'redundant'],
    [['adx', 'chop'], 'redundant'],
    [['sma', 'rsi', 'macd', 'atr', 'obv', 'vwap', 'pdhl'], 'unusual'],
    [['ichimoku'], 'fine'],
    [['kama'], 'fine'],
    [[], 'fine'],
  ];
  for (const [ids, kind, re] of cases) {
    test(`${ids.join('+') || '(none)'} -> ${kind}`, () => {
      const v = comboVerdict(ids);
      expect(v.kind).toBe(kind as never);
      if (re) expect(v.text).toMatch(re);
      expect(v.text.length).toBeLessThanOrEqual(140);
    });
  }
});

describe('Coach.onIndicators', () => {
  test('add teaches, combos react, params flag oddities, fast swapping is muted', () => {
    const c = new Coach(3);
    const t1 = c.onIndicators([{ id: 'rsi' }], { id: 'rsi', action: 'add' });
    expect(t1?.id).toBe('ind_teach_rsi');
    expect(INDICATOR_TIPS.rsi).toContain(t1!.text);

    const t2 = c.onIndicators([{ id: 'rsi' }, { id: 'bb' }], { id: 'bb', action: 'add' });
    expect(t2?.id).toBe('ind_combo_bb_rsi');
    expect(t2?.mood).toBe('excited');

    const t3 = c.onIndicators([{ id: 'rsi' }, { id: 'bb' }, { id: 'stoch' }, { id: 'willr' }], { id: 'willr', action: 'add' });
    expect(t3?.id).toBe('ind_combo_osc_stack');
    expect(t3?.text).toContain('😳');

    const p1 = c.onIndicators([{ id: 'rsi', params: { period: 2 } }], { id: 'rsi', action: 'params' });
    expect(p1?.id).toBe('ind_params_rsi_twitchy');
    expect(c.onIndicators([{ id: 'rsi', params: { period: 3 } }], { id: 'rsi', action: 'params' })).toBeNull(); // same warning, no repeat
    expect(c.onIndicators([{ id: 'sma', params: { period: 200 } }], { id: 'sma', action: 'params' }, { timeframe: '1m' })?.text).toMatch(/1m/);
    expect(c.onIndicators([{ id: 'bb', params: { period: 20, mult: 3 } }], { id: 'bb', action: 'params' })?.id).toBe('ind_params_bb_wide');
    expect(c.onIndicators([{ id: 'rsi', params: { period: 14 } }], { id: 'rsi', action: 'params' })).toBeNull();

    const fast = new Coach(5);
    const ids = ['atr', 'obv', 'cci', 'aroon', 'linreg', 'kama', 'psar', 'cmf'];
    let tips = 0;
    for (const id of ids) if (fast.onIndicators([{ id }], { id, action: 'add' })) tips++;
    expect(tips).toBeGreaterThan(0);
    expect(tips).toBeLessThan(ids.length);
  });

  test('ichimoku + anything is surprising; remove is occasional', () => {
    const c = new Coach(1);
    expect(c.onIndicators([{ id: 'ichimoku' }, { id: 'ema' }], { id: 'ema', action: 'add' })?.id).toBe('ind_combo_ichimoku_plus');
    let removes = 0;
    for (let i = 0; i < 200; i++) {
      c.observe({ type: 'bar', index: i * 10, bar: bar(1, 1) }, ctx({ index: i * 10 }));
      if (c.onIndicators([], { id: 'ema', action: 'remove' })) removes++;
    }
    expect(removes).toBeGreaterThan(20);
    expect(removes).toBeLessThan(120);
  });
});

describe('Coach.onAction', () => {
  test('reacts to roughly 40-50% of presses', () => {
    const c = new Coach(11);
    let fired = 0;
    const n = 3000;
    for (let i = 0; i < n; i++) if (c.onAction('buy', ctx({ index: i * ACTION_COOLDOWN }))) fired++;
    expect(fired / n).toBeGreaterThan(0.4);
    expect(fired / n).toBeLessThan(0.5);
  });

  test('per-kind cooldown is respected', () => {
    const c = new Coach(2);
    const last = new Map<string, number>();
    for (let i = 0; i < 2000; i++) {
      for (const kind of ['buy', 'sell'] as const) {
        const tip = c.onAction(kind, ctx({ index: i }));
        if (tip) {
          const prev = last.get(kind);
          if (prev !== undefined) expect(i - prev).toBeGreaterThanOrEqual(ACTION_COOLDOWN);
          last.set(kind, i);
        }
      }
    }
    expect(last.size).toBe(2);
  });

  const firstTip = (fn: (c: Coach, i: number) => Tip | null): Tip => {
    const c = new Coach(7);
    for (let i = 0; i < 200; i++) {
      const t = fn(c, i * 10);
      if (t) return t;
    }
    throw new Error('never fired');
  };

  test('contextual reactions', () => {
    const reds = [...Array.from({ length: 17 }, () => bar(100, 101)), bar(101, 100), bar(100, 99), bar(99, 98)];
    expect(firstTip((c, i) => c.onAction('buy', ctx({ index: i, recentBars: reds }))).id).toBe('action_buy_dip');
    const high = [...Array.from({ length: 19 }, () => bar(100, 100.5, 101, 99)), bar(100.5, 100.8, 105, 100)];
    expect(firstTip((c, i) => c.onAction('sell', ctx({ index: i, recentBars: high }))).id).toBe('action_sell_high');
    const early = account({ position: position({ unrealized: 80, barsHeld: 1 }) });
    const paper = firstTip((c, i) => c.onAction('close', ctx({ index: i, state: early })));
    expect(paper.id).toBe('action_close_paper');
    expect(paper.text).toMatch(/🧻|scalp/);
    const loser = account({ position: position({ unrealized: -120, barsHeld: 9 }) });
    expect(firstTip((c, i) => c.onAction('close', ctx({ index: i, state: loser }))).id).toBe('action_close_loss');
    const winner = account({ position: position({ unrealized: 120, barsHeld: 9 }) });
    expect(firstTip((c, i) => c.onAction('close', ctx({ index: i, state: winner }))).id).toBe('action_close_win');
    const shortPos = account({ position: position({ side: 'short' }) });
    expect(firstTip((c, i) => c.onAction('buy', ctx({ index: i, state: shortPos }))).id).toBe('action_cover');
    const c = new Coach(1);
    for (let i = 0; i < 50; i++) expect(c.onAction('close', ctx({ index: i * 10 }))).toBeNull(); // nothing to close
  });

  test('all action and performance lines fit (<= 120 chars)', () => {
    const p = { pnl: -12345.67, pct: 12.3, dd: 45.6, streak: 12 };
    for (const lines of [...Object.values(ACTION_LINES), ...Object.values(PERFORMANCE_LINES)]) {
      for (const l of lines) expect(l(p).length, l(p)).toBeLessThanOrEqual(120);
    }
  });
});

describe('Coach.onPerformance', () => {
  test('hot streak, up 2%, drawdown (kind), comeback; rare and spaced', () => {
    const c = new Coach(4);
    const tips: { i: number; tip: Tip }[] = [];
    const step = (i: number, equity: number, dd: number, trades = [] as ReturnType<typeof trade>[]) => {
      const tip = c.onPerformance(ctx({ index: i, state: account({ equity, drawdownPct: dd }), recentTrades: trades }));
      if (tip) tips.push({ i, tip });
      return tip;
    };
    expect(step(0, 10_000, 0)).toBeNull();
    const wins = [trade({ pnl: 50 }), trade({ pnl: 60 }), trade({ pnl: 70 })];
    expect(step(10, 10_100, 0, wins)?.id).toBe('perf_hot');
    for (let i = 11; i < 40; i++) step(i, 10_100, 0, wins);
    expect(step(40, 10_250, 0, wins)?.id).toBe('perf_up');
    for (let i = 41; i < 80; i++) step(i, 10_250, 0, wins);
    const down = step(80, 9_500, 7.3, [...wins, trade({ pnl: -400 })]);
    expect(down?.id).toBe('perf_down');
    expect(down?.text).not.toMatch(/stupid|bad trader|terrible|shame/i);
    for (let i = 81; i < 120; i++) step(i, 9_600, 6);
    expect(step(120, 10_260, 0)?.id).toBe('perf_recover');
    for (let k = 1; k < tips.length; k++) expect(tips[k]!.i - tips[k - 1]!.i).toBeGreaterThanOrEqual(25);
  });

  test('flat for a long time, at most once until things move', () => {
    const c = new Coach(1);
    const ids: string[] = [];
    for (let i = 0; i < 400; i++) {
      const t = c.onPerformance(ctx({ index: i, state: account({ equity: 10_000 + (i % 3) }) }));
      if (t) ids.push(t.id);
    }
    expect(ids).toEqual(['perf_flat']);
  });

  test('a long random session stays quiet', () => {
    const c = new Coach(9);
    let eq = 10_000, peak = 10_000, n = 0, x = 1;
    for (let i = 0; i < 2000; i++) {
      x = (x * 1103515245 + 12345) % 2147483648;
      eq *= 1 + ((x / 2147483648) - 0.5) * 0.004;
      peak = Math.max(peak, eq);
      if (c.onPerformance(ctx({ index: i, state: account({ equity: eq, drawdownPct: ((peak - eq) / peak) * 100 }) }))) n++;
    }
    expect(n).toBeLessThanOrEqual(2000 / 25);
  });
});

describe('Coach.onClock', () => {
  test('NY time respects DST (July = UTC-4, January = UTC-5)', () => {
    expect(nyClock(Date.UTC(2026, 6, 8, 16, 0)).minute).toBe(720);
    expect(nyClock(Date.UTC(2026, 0, 14, 17, 0)).minute).toBe(720);
    expect(nyClock(Date.UTC(2026, 0, 14, 16, 0)).minute).toBe(660);
    expect(nyClock(ET_JULY(10, 12)).dow).toBe(5); // Fri 10 Jul 2026
  });

  test('high noon fires on the 12:00 ET bar in summer and winter, probabilistically', () => {
    for (const t of [ET_JULY(8, 12), ET_JAN(14, 12)]) {
      let fired = 0;
      for (let seed = 1; seed <= 400; seed++) {
        const tip = new Coach(seed).onClock(t);
        if (tip) {
          expect(tip.id).toBe('clock_high_noon');
          fired++;
        }
      }
      expect(fired / 400).toBeGreaterThan(0.3);
      expect(fired / 400).toBeLessThan(0.55);
    }
    // 16:00 UTC in January is 11:00 ET: no noon jokes yet
    for (let seed = 1; seed <= 100; seed++) expect(new Coach(seed).onClock(Date.UTC(2026, 0, 14, 16, 0))?.id).not.toBe('clock_high_noon');
  });

  test('first bar at/after the moment, at most once per moment per NY day, deterministic per seed', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const c = new Coach(seed);
      const seen = new Map<string, number>();
      for (let m = 0; m < 12; m++) {
        const tip = c.onClock(ET_JULY(8, 11, 57) + m * 60_000 * 3); // 11:57 ... 12:30
        if (tip) seen.set(tip.id, (seen.get(tip.id) ?? 0) + 1);
        if (tip?.id === 'clock_high_noon') expect(m).toBe(1); // the 12:00 bar, never later ones
      }
      for (const n of seen.values()) expect(n).toBe(1);
    }
    const run = (seed: number) => {
      const c = new Coach(seed);
      const out: string[] = [];
      for (let i = 0; i < 2000; i++) out.push(c.onClock(ET_JULY(6, 0) + i * 300_000)?.text ?? '');
      return out.join('|');
    };
    expect(run(42)).toBe(run(42));
    expect(run(42)).not.toBe(run(43));
  });

  test('10 days of 5m bars: some moments fire, not all, spaced by CLOCK_GAP', () => {
    const c = new Coach(2026);
    const fired: { i: number; id: string; day: number; text: string }[] = [];
    const start = ET_JULY(6, 0); // Monday
    for (let i = 0; i < 10 * 288; i++) {
      const t = start + i * 300_000;
      const tip = c.onClock(t);
      if (tip) fired.push({ i, id: tip.id, day: nyClock(t).day, text: tip.text });
    }
    const eligible = 8 * 14; // rough count of weekday moment-days; any reasonable run fires far fewer
    expect(fired.length).toBeGreaterThan(5);
    expect(fired.length).toBeLessThan(eligible);
    const kinds = new Set(fired.map((f) => f.id));
    expect(kinds.size).toBeGreaterThan(3);
    expect(kinds.size).toBeLessThan(CLOCK_MOMENTS.length);
    for (let k = 1; k < fired.length; k++) expect(fired[k]!.i - fired[k - 1]!.i).toBeGreaterThanOrEqual(CLOCK_GAP);
    const perDay = new Set<string>();
    for (const f of fired) {
      const key = `${f.day}|${f.id}`;
      expect(perDay.has(key)).toBe(false);
      perDay.add(key);
    }
  });

  test('clock lines are short and the moments are time-ordered', () => {
    let prev = -1;
    for (const m of CLOCK_MOMENTS) {
      expect(m.minute).toBeGreaterThanOrEqual(prev);
      prev = m.minute;
      expect(m.lines.length).toBeGreaterThanOrEqual(2);
      for (const l of m.lines) expect(l.length, l).toBeLessThanOrEqual(120);
    }
    expect(CLOCK_MOMENTS.find((m) => m.id === 'high_noon')!.lines.some((l) => /high noon/i.test(l))).toBe(true);
  });
});
