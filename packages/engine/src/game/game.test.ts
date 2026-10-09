import { describe, expect, test } from 'bun:test';
import {
  ACHIEVEMENTS, applySession, awardTrade, checkAchievements, createProfile, dailyStreak, levelForXp, levelProgress,
  RANKS, rankFor, RATING_MAX_DELTA, ratingTier, ratingUpdate, sumXp, xpForLevel, TRADE_XP,
} from './index.ts';
import type { Profile, SessionSummary } from '../types.ts';
import { AWFUL, GREAT, metrics, report, trade } from './fixtures.test-util.ts';

const NOW = Date.UTC(2026, 9, 10, 12);

describe('levels', () => {
  test('curve is strictly increasing, level 1 at 0, about 3 good trades to level 2', () => {
    expect(xpForLevel(1)).toBe(0);
    for (let l = 1; l < 300; l++) expect(xpForLevel(l + 1)).toBeGreaterThan(xpForLevel(l));
    for (let l = 2; l < 300; l++) {
      expect(xpForLevel(l + 1) - xpForLevel(l)).toBeGreaterThanOrEqual(xpForLevel(l) - xpForLevel(l - 1));
    }
    const good = sumXp(awardTrade(trade({ r: 1, pnl: 100 }), { equityBefore: 10_000, streak: 1 }));
    expect(Math.ceil(xpForLevel(2) / good)).toBe(3);
  });

  test('levelForXp inverts xpForLevel', () => {
    for (let l = 1; l < 300; l++) {
      expect(levelForXp(xpForLevel(l))).toBe(l);
      expect(levelForXp(xpForLevel(l + 1) - 1)).toBe(l);
    }
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(-5)).toBe(1);
  });

  test('levelProgress', () => {
    const p = levelProgress(xpForLevel(4) + 10);
    expect(p.level).toBe(4);
    expect(p.into).toBe(10);
    expect(p.needed).toBe(xpForLevel(5) - xpForLevel(4));
    expect(p.pct).toBeGreaterThan(0);
    expect(p.pct).toBeLessThan(1);
  });

  test('ranks: 10 of them, ordered, cover all levels', () => {
    expect(RANKS.length).toBe(10);
    expect(rankFor(1).title).toBe('Rookie');
    expect(rankFor(500).title).toBe('Legend of the Tape');
    const titles = new Set<string>();
    for (let l = 1; l <= 60; l++) titles.add(rankFor(l).title);
    expect(titles.size).toBe(10);
  });
});

describe('awardTrade', () => {
  const ctx = { equityBefore: 10_000, streak: 0 };
  test('no-stop trade earns only the minimal base, even when it wins big', () => {
    const a = awardTrade(trade({ hadStop: false, r: undefined, pnl: 5000, pnlPct: 50 }), { ...ctx, streak: 5, followedPlan: true });
    expect(a).toHaveLength(1);
    expect(sumXp(a)).toBe(TRADE_XP.base);
  });

  test('a loss with a stop still earns lesson and cut-loss XP', () => {
    const a = awardTrade(trade({ pnl: -100, pnlPct: -1, r: -1, exitReason: 'stop' }), ctx);
    const reasons = a.map((x) => x.reason).join('|');
    expect(reasons).toContain('Lesson learned');
    expect(reasons).toContain('within 1R');
    expect(reasons).toContain('Sane risk');
    expect(sumXp(a)).toBeGreaterThan(TRADE_XP.base * 3);
  });

  test('a loss beyond 1R gets no cut-loss bonus', () => {
    const a = awardTrade(trade({ pnl: -300, pnlPct: -3, r: -1.5 }), ctx);
    expect(a.some((x) => x.reason.includes('within 1R'))).toBe(false);
  });

  test('wins scale with R, capped; letting winners run; hot streak', () => {
    const w1 = sumXp(awardTrade(trade({ r: 1, pnl: 100 }), ctx));
    const w2 = sumXp(awardTrade(trade({ r: 2, pnl: 200 }), ctx));
    const w50 = awardTrade(trade({ r: 50, pnl: 5000 }), ctx);
    expect(w2).toBeGreaterThan(w1);
    expect(w50.find((x) => x.icon === '💰')!.amount).toBe(TRADE_XP.winCap);
    expect(w50.some((x) => x.reason === 'Let a winner run')).toBe(true);
    const hot = awardTrade(trade({ r: 1, pnl: 100 }), { ...ctx, streak: 4 });
    expect(hot.some((x) => x.icon === '🔥')).toBe(true);
  });

  test('risk > 2% gets no sane-risk bonus; explicit riskPct overrides', () => {
    expect(awardTrade(trade({ r: 1, pnl: 500, pnlPct: 5 }), ctx).some((x) => x.reason.includes('Sane'))).toBe(false);
    expect(awardTrade(trade({ r: 1, pnl: 500 }), { ...ctx, riskPct: 1 }).some((x) => x.reason.includes('Sane'))).toBe(true);
  });

  test('XP is never negative', () => {
    for (const pnl of [-1e6, -1, 0, 1, 1e6]) {
      for (const r of [undefined, -10, -1, 0, 1, 10, NaN]) {
        for (const a of awardTrade(trade({ pnl, r }), ctx)) expect(a.amount).toBeGreaterThan(0);
      }
    }
  });
});

describe('rating', () => {
  const p = { rating: 1000 };
  test('bounded to +-40 per session', () => {
    expect(Math.abs(ratingUpdate(p, GREAT(10_000), 'live'))).toBeLessThanOrEqual(RATING_MAX_DELTA);
    expect(Math.abs(ratingUpdate(p, AWFUL(10_000), 'live'))).toBeLessThanOrEqual(RATING_MAX_DELTA);
    expect(ratingUpdate({ rating: 100 }, AWFUL(10_000), 'live')).toBe(0); // floor
    expect(ratingUpdate({ rating: 110 }, AWFUL(10_000), 'live')).toBeGreaterThanOrEqual(-10);
  });

  test('confidence-weighted: 5 lucky trades barely move it', () => {
    const five = ratingUpdate(p, GREAT(5), 'arcade');
    const hundred = ratingUpdate(p, GREAT(100), 'arcade');
    expect(five).toBeGreaterThan(0);
    expect(five).toBeLessThanOrEqual(10);
    expect(hundred).toBeGreaterThan(five * 2);
    expect(ratingUpdate(p, metrics({ trades: 0 }), 'arcade')).toBe(0);
  });

  test('losses are gentler than gains', () => {
    expect(Math.abs(ratingUpdate(p, AWFUL(100), 'arcade'))).toBeLessThan(ratingUpdate(p, GREAT(100), 'arcade'));
    expect(ratingUpdate(p, AWFUL(100), 'arcade')).toBeLessThan(0);
  });

  test('Elo feel: a high rating gains less for the same session', () => {
    expect(ratingUpdate({ rating: 1600 }, GREAT(100), 'arcade')).toBeLessThan(ratingUpdate(p, GREAT(100), 'arcade'));
  });

  test('tiers', () => {
    expect(ratingTier(1000).name).toBe('Bronze');
    expect(ratingTier(1100).name).toBe('Silver');
    expect(ratingTier(1800).name).toBe('Master');
  });
});

describe('dailyStreak', () => {
  const base = createProfile('p', 'Ann', NOW);
  test('first ever, same day, consecutive, gap', () => {
    expect(dailyStreak(base, '2026-10-10')).toEqual({ days: 1, firstToday: true, continued: false });
    const played = { ...base, streakDays: 4, lastPlayedDay: '2026-10-10' };
    expect(dailyStreak(played, '2026-10-10')).toEqual({ days: 4, firstToday: false, continued: false });
    expect(dailyStreak(played, '2026-10-11')).toEqual({ days: 5, firstToday: true, continued: true });
    expect(dailyStreak(played, '2026-10-13')).toEqual({ days: 1, firstToday: true, continued: false });
    // month / year boundaries
    expect(dailyStreak({ streakDays: 2, lastPlayedDay: '2026-12-31' }, '2027-01-01').days).toBe(3);
    expect(dailyStreak({ streakDays: 2, lastPlayedDay: '2028-02-28' }, '2028-02-29').days).toBe(3);
  });
});

function summary(over: Partial<Omit<SessionSummary, 'xpEarned' | 'ratingDelta'>> = {}): Omit<SessionSummary, 'xpEarned' | 'ratingDelta'> {
  return { id: 's', t: NOW, mode: 'arcade', symbol: 'SPY', timeframe: '5m', metrics: metrics(), ...over };
}

describe('applySession', () => {
  test('immutable update and stat accumulation', () => {
    const p0 = createProfile('p', 'Ann', NOW);
    const frozen = JSON.stringify(p0);
    const trades = [
      trade({ pnl: 100, r: 1 }), trade({ pnl: -50, pnlPct: -0.5, r: -0.5, exitReason: 'stop' }),
      trade({ pnl: 300, pnlPct: 3, r: 3, hadStop: false }),
    ];
    const m = metrics({ trades: 3, wins: 2, losses: 1, netProfit: 350, netProfitPct: 3.5, profitFactor: 8, expectancyR: 0.5, maxDrawdownPct: 0.5, sqn: 2 });
    const r1 = applySession(p0, { summary: summary({ metrics: m }), trades, today: '2026-10-10' }, NOW);
    expect(JSON.stringify(p0)).toBe(frozen);
    expect(r1.profile).not.toBe(p0);
    const s = r1.profile.stats;
    expect(s.sessions).toBe(1);
    expect(s.trades).toBe(3);
    expect(s.wins).toBe(2);
    expect(s.losses).toBe(1);
    expect(s.netProfit).toBe(350);
    expect(s.bestTrade).toBe(300);
    expect(s.worstTrade).toBe(-50);
    expect(s.tradesWithStop).toBe(2);
    expect(r1.profile.xp).toBe(sumXp(r1.awards));
    expect(r1.profile.history[0]!.xpEarned).toBe(r1.profile.xp);
    expect(r1.profile.history[0]!.ratingDelta).toBe(r1.ratingDelta);
    expect(r1.profile.rating).toBe(1000 + r1.ratingDelta);
    expect(r1.levelUp).toBe(r1.profile.level);
    expect(r1.profile.level).toBeGreaterThan(1);
    expect(r1.profile.streakDays).toBe(1);
    expect(r1.awards.some((a) => a.reason === 'First session today')).toBe(true);

    const r2 = applySession(r1.profile, { summary: summary({ metrics: m, id: 's2' }), trades, today: '2026-10-10' }, NOW + 1000);
    expect(r2.profile.stats.trades).toBe(6);
    expect(r2.profile.stats.netProfit).toBe(700);
    expect(r2.profile.history.map((h) => h.id)).toEqual(['s2', 's']);
    expect(r2.awards.some((a) => a.reason === 'First session today')).toBe(false);
    expect(r2.profile.xp).toBeGreaterThan(r1.profile.xp);
    expect(r1.profile.stats.trades).toBe(3); // r1 untouched
  });

  test('history capped at 200, most recent first; events and grades tracked', () => {
    let p: Profile = createProfile('p', 'Ann', NOW);
    for (let i = 0; i < 205; i++) {
      p = applySession(p, { summary: summary({ id: `s${i}` }), trades: [], event: i % 2 ? 'evolution' : 'strategyBuilt' }, NOW + i).profile;
    }
    expect(p.history).toHaveLength(200);
    expect(p.history[0]!.id).toBe('s204');
    expect(p.stats.strategiesBuilt).toBe(103);
    expect(p.stats.evolutionsRun).toBe(102);
    p = applySession(p, { summary: summary(), trades: [], report: report({ grade: 'A' }), event: 'stressTest' }, NOW).profile;
    p = applySession(p, { summary: summary(), trades: [], report: report({ grade: 'C' }), event: 'stressTest' }, NOW).profile;
    expect(p.stats.bestGrade).toBe('A');
    expect(p.stats.stressTestsRun).toBe(2);
  });

  test('streak continues across days', () => {
    let p = createProfile('p', 'Ann', NOW);
    for (const d of ['2026-10-01', '2026-10-02', '2026-10-03']) p = applySession(p, { summary: summary(), trades: [], today: d }, NOW).profile;
    expect(p.streakDays).toBe(3);
    expect(p.achievements['streak_3']).toBeDefined();
    p = applySession(p, { summary: summary(), trades: [], today: '2026-10-07' }, NOW).profile;
    expect(p.streakDays).toBe(1);
  });
});

describe('achievements', () => {
  test('30+ unique ids, some secret', () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(30);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
    expect(ACHIEVEMENTS.filter((a) => a.secret).length).toBeGreaterThanOrEqual(3);
    for (const a of ACHIEVEMENTS) expect((a as object as Record<string, unknown>)['check']).toBeUndefined();
  });

  test('fire once only', () => {
    let p = createProfile('p', 'Ann', NOW);
    const trades = [trade({ pnl: -100, pnlPct: -1, r: -1, exitReason: 'stop' })];
    const s = summary({ metrics: metrics({ trades: 1, losses: 1, netProfit: -100, netProfitPct: -1 }) });
    const r1 = applySession(p, { summary: s, trades }, NOW);
    const ids1 = r1.achievements.map((a) => a.id);
    expect(ids1).toContain('first_trade');
    expect(ids1).toContain('first_stop');
    expect(ids1).toContain('first_lesson');
    expect(r1.profile.achievements['first_trade']).toBe(NOW);
    p = r1.profile;
    const r2 = applySession(p, { summary: s, trades }, NOW + 5);
    for (const id of ids1) expect(r2.achievements.map((a) => a.id)).not.toContain(id);
    expect(r2.profile.achievements['first_trade']).toBe(NOW);
    expect(checkAchievements(r2.profile, { trades }).map((a) => a.id)).not.toContain('first_lesson');
  });

  test('representative unlocks', () => {
    const p = createProfile('p', 'Ann', NOW);
    const ids = (ctx: Parameters<typeof checkAchievements>[1], prof = p) => checkAchievements(prof, ctx).map((a) => a.id);
    expect(ids({ trades: [trade({ pnl: 500, barsHeld: 60 })] })).toContain('diamond_patience');
    expect(ids({ trades: [trade({ pnl: -30, r: -0.3, exitReason: 'manual' })] })).toContain('cut_quick');
    const bounce = [trade({ pnl: -10, pnlPct: -0.1 }), trade({ pnl: -10, pnlPct: -0.1 }), trade({ pnl: -10, pnlPct: -0.1 }), trade({ pnl: 40 })];
    expect(ids({ trades: bounce })).toContain('unbreakable');
    // equity 10k -> 8.9k (11% dd) -> 10k
    const comeback = [trade({ pnl: -1100, pnlPct: -11, r: -1 }), trade({ pnl: 1200, pnlPct: (1200 / 8900) * 100 })];
    expect(ids({ trades: comeback, initialCash: 10_000 })).toContain('comeback_kid');
    const isGreat = metrics({ netProfit: 5000, profitFactor: 3 });
    expect(ids({ trades: [], report: report({ grade: 'D', inSample: isGreat }) })).toContain('overfit_detective');
    expect(ids({ trades: [trade()], localHour: 2 })).toContain('night_owl');
    const month = [trade({ entryT: 0, exitT: 1 }), trade({ entryT: 29 * 86_400_000, exitT: 30 * 86_400_000 })];
    expect(ids({ trades: month, summary: { mode: 'arcade', metrics: metrics({ netProfit: 10 }) } })).toContain('profitable_month');
    const scientist = { ...p, stats: { ...p.stats, stressTestsRun: 10 } };
    expect(ids({ trades: [] }, scientist)).toContain('scientist');
  });
});
