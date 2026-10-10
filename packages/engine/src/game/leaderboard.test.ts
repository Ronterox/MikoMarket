import { describe, expect, test } from 'bun:test';
import {
  MIN_RANKED_TRADES, RIVALS, applySession, createProfile, rankLeaderboard, rivalEntries, weekKey, weeklyStats, weeksWithData,
  type LeaderboardEntry,
} from './index.ts';
import { runBacktest } from '../backtest/index.ts';
import { STRATEGY_TEMPLATES } from '../strategy/index.ts';
import type { Bar, BarSeries, Profile, SessionSummary } from '../types.ts';
import { metrics, trade } from './fixtures.test-util.ts';

const row = (t: number, mode: SessionSummary['mode'], m: Partial<ReturnType<typeof metrics>>, grossWins?: number): SessionSummary => ({
  id: `s${t}`, t, mode, symbol: 'SPY', timeframe: '5m', metrics: metrics(m), xpEarned: 0, ratingDelta: 0,
  ...(grossWins !== undefined ? { grossWins } : {}),
});

describe('weekKey', () => {
  test('NY Monday of the week, DST-aware', () => {
    expect(weekKey(Date.UTC(2026, 6, 6, 14))).toBe('2026-07-06'); // Mon
    expect(weekKey(Date.UTC(2026, 6, 10, 19))).toBe('2026-07-06'); // Fri
    expect(weekKey(Date.UTC(2026, 6, 13, 3))).toBe('2026-07-06'); // Sun 23:00 EDT
    expect(weekKey(Date.UTC(2026, 6, 13, 4, 30))).toBe('2026-07-13'); // Mon 00:30 EDT
    expect(weekKey(Date.UTC(2026, 0, 12, 4, 30))).toBe('2026-01-05'); // Sun 23:30 EST
    expect(weekKey(Date.UTC(2026, 0, 12, 5, 30))).toBe('2026-01-12'); // Mon 00:30 EST
  });
});

describe('weeklyStats', () => {
  const W = '2026-07-06';
  const inWeek = Date.UTC(2026, 6, 7, 15);
  const profile: Profile = {
    ...createProfile('p1', 'Miko', 0),
    level: 4,
    history: [
      row(inWeek, 'arcade', { trades: 4, wins: 3, netProfit: 300, netProfitPct: 3 }, 450),
      row(inWeek + 3_600_000, 'live', { trades: 2, wins: 0, netProfit: -100, netProfitPct: -1 }),
      row(inWeek + 7_200_000, 'live', { trades: 1, wins: 1, netProfit: 80, netProfitPct: 0.8 }), // no grossWins: falls back to max(profit, 0)
      row(inWeek, 'bot', { trades: 50, wins: 40, netProfit: 9_999, netProfitPct: 99 }, 20_000), // Bot Lab backtest: ignored
      { ...row(inWeek, 'bot', { trades: 3, wins: 2, netProfit: 60, netProfitPct: 0.6 }, 90), playedForward: true }, // bot played on Play: counts
      row(Date.UTC(2026, 6, 14, 15), 'arcade', { trades: 9, wins: 9, netProfit: 900, netProfitPct: 9 }), // next week
    ],
  };

  test('sums arcade, live and played-forward bot sessions of that week only', () => {
    const e = weeklyStats(profile, W)!;
    expect(e).toMatchObject({ id: 'p1', name: 'Miko', kind: 'player', trades: 10, wins: 6, profit: 340, level: 4 });
    expect(e.winRate).toBeCloseTo(6 / 10);
    expect(e.profitPct).toBeCloseTo(3.4);
    expect(e.winnings).toBe(450 + 0 + 80 + 90);
    expect(weeklyStats(profile, '2026-06-29')).toBeNull();
  });

  test('applySession records grossWins from the trades', () => {
    const p = createProfile('p2', 'Kai', 0);
    const trades = [trade({ pnl: 120 }), trade({ pnl: -50 }), trade({ pnl: 30 })];
    const res = applySession(p, {
      summary: { id: 'x', t: inWeek, mode: 'arcade', symbol: 'SPY', timeframe: '5m', metrics: metrics({ trades: 3, wins: 2, netProfit: 100, netProfitPct: 1 }) },
      trades,
    }, inWeek);
    expect(res.profile.history[0]!.grossWins).toBe(150);
    expect(weeklyStats(res.profile, W)?.winnings).toBe(150);
  });

  test('a bot round played forward counts as results, without habit XP or skill achievements', () => {
    const p = createProfile('p3', 'Kai', 0);
    const trades = [trade({ pnl: 120, r: 6 }), trade({ pnl: -50, r: -0.4 }), trade({ pnl: 30 })];
    const res = applySession(p, {
      summary: { id: 'b', t: inWeek, mode: 'bot', playedForward: true, symbol: 'SPY', timeframe: '5m', metrics: metrics({ trades: 3, wins: 2, netProfit: 100, netProfitPct: 1 }) },
      trades,
    }, inWeek);
    expect(res.profile.stats).toMatchObject({ trades: 3, wins: 2, losses: 1, netProfit: 100 });
    expect(weeklyStats(res.profile, W)).toMatchObject({ trades: 3, wins: 2, profit: 100, winnings: 150 });
    expect(res.awards.map((w) => w.reason)).toEqual(expect.arrayContaining(['Bot finished a round']));
    expect(res.awards.some((w) => /stop|risk|Winner|Lesson|Cut/i.test(w.reason))).toBe(false);
    expect(res.achievements.map((a) => a.id)).not.toContain('moonshot');
    expect(res.achievements.map((a) => a.id)).not.toContain('cut_quick');
  });
});

describe('rankLeaderboard', () => {
  const e = (id: string, profit: number, trades: number, wins: number): LeaderboardEntry => ({
    id, name: id, kind: 'player', trades, wins, winRate: trades ? wins / trades : 0, profit, profitPct: profit / 100, winnings: Math.max(profit, 0),
  });

  test('profit desc, then win rate, then trades; < 3 trades listed after, unranked', () => {
    const out = rankLeaderboard([
      e('a', 100, 5, 2), e('b', 300, 4, 1), e('c', 100, 5, 4), e('d', 9_000, 2, 2), e('f', 100, 10, 8), e('g', -50, 3, 1),
    ]);
    expect(out.map((x) => x.id)).toEqual(['b', 'f', 'c', 'a', 'g', 'd']);
    expect(out.map((x) => x.rank)).toEqual([1, 2, 3, 4, 5, undefined]);
    expect(MIN_RANKED_TRADES).toBe(3);
  });
});

/** Two weeks of 5m RTH bars with swings, so every template trades. */
function series(): BarSeries {
  const bars: Bar[] = [];
  let p = 100;
  let k = 0;
  for (let d = 0; d < 21; d++) {
    const day = Date.UTC(2026, 5, 22 + d, 13, 30); // from Mon 22 Jun 2026, 09:30 EDT
    const dow = new Date(day).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    for (let i = 0; i < 78; i++, k++) {
      const o = p;
      p = 100 + 6 * Math.sin(k / 40) + 2 * Math.sin(k / 7);
      bars.push({ t: day + i * 300_000, o, h: Math.max(o, p) + 0.2, l: Math.min(o, p) - 0.2, c: p, v: 1000 + (k % 13) * 50 });
    }
  }
  return { instrument: { symbol: 'SPY', name: 'SPY', kind: 'etf', pointValue: 1, tickSize: 0.01 }, timeframe: '5m', bars };
}

describe('rivals', () => {
  const s = series();

  test('weeksWithData lists weeks newest first', () => {
    expect(weeksWithData([s])).toEqual(['2026-07-06', '2026-06-29', '2026-06-22']);
  });

  test('real backtests on that week only, one entry per rival', () => {
    const out = rivalEntries([s], '2026-06-29');
    expect(out).toHaveLength(RIVALS.length);
    for (const r of out) {
      expect(r.kind).toBe('rival');
      expect(r.avatar).toBeTruthy();
      expect(r.strategy).toBeTruthy();
      expect(r.winRate).toBeGreaterThanOrEqual(0);
      expect(r.winnings).toBeGreaterThanOrEqual(Math.max(0, r.profit) - 1e-9);
    }
    expect(out.some((r) => r.trades > 0)).toBe(true);
    // Hana's numbers equal a direct backtest of the RKBB template over that week
    const lo = s.bars.findIndex((b) => weekKey(b.t) === '2026-06-29');
    let hi = lo;
    while (hi + 1 < s.bars.length && weekKey(s.bars[hi + 1]!.t) === '2026-06-29') hi++;
    const from = Math.max(0, lo - 600);
    const direct = runBacktest({ ...s, bars: s.bars.slice(from, hi + 1) }, STRATEGY_TEMPLATES.find((t) => t.id === 'tpl_rkbb')!, { startIndex: lo - from, initialCash: 10_000 });
    const hana = out.find((r) => r.id === 'rival_hana')!;
    expect(hana.trades).toBe(direct.metrics.trades);
    expect(hana.profit).toBeCloseTo(direct.metrics.netProfit, 6);
    for (const t of direct.trades) expect(weekKey(t.entryT)).toBe('2026-06-29');
    expect(rivalEntries([s], '2026-06-29')).toEqual(out); // deterministic
  });

  test('no data that week = no rivals', () => {
    expect(rivalEntries([s], '2026-09-07')).toEqual([]);
  });
});
