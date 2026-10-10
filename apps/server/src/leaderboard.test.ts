import { beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RIVALS, createProfile, type Bar, type LeaderboardEntry, type Profile, type SessionSummary } from '@miko/engine';
import { BarCache, FileProfileStore } from '@miko/data';
import { createApp } from './app.ts';

const NOW = Date.UTC(2026, 6, 15, 18); // Wed 15 Jul 2026 (no bars that week)
let app: ReturnType<typeof createApp>;

const session = (t: number, mode: SessionSummary['mode'], trades: number, wins: number, netProfit: number, grossWins?: number): SessionSummary => ({
  id: `s${t}${mode}`, t, mode, symbol: 'SPY', timeframe: '5m', xpEarned: 10, ratingDelta: 0,
  metrics: {
    netProfit, netProfitPct: netProfit / 100, trades, wins, losses: trades - wins, winRate: trades ? wins / trades : 0, profitFactor: 1,
    avgWin: 0, avgLoss: 0, payoff: 0, expectancy: 0, expectancyR: 0, maxDrawdown: 0, maxDrawdownPct: 0, sharpe: 0, sortino: 0,
    calmar: 0, cagr: 0, exposure: 0, avgBarsHeld: 0, maxConsecWins: 0, maxConsecLosses: 0, recoveryFactor: 0, sqn: 0,
  },
  ...(grossWins !== undefined ? { grossWins } : {}),
});

beforeAll(async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'miko-lb-'));
  // Two weeks of SPY 5m regular-hours bars: 29 Jun - 10 Jul 2026.
  const bars: Bar[] = [];
  let k = 0;
  let p = 100;
  for (let d = 0; d < 12; d++) {
    const day = Date.UTC(2026, 5, 29 + d, 13, 30);
    const dow = new Date(day).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    for (let i = 0; i < 78; i++, k++) {
      const o = p;
      p = 100 + 5 * Math.sin(k / 35) + 1.5 * Math.sin(k / 6);
      bars.push({ t: day + i * 300_000, o, h: Math.max(o, p) + 0.15, l: Math.min(o, p) - 0.15, c: p, v: 1000 + (k % 11) * 40 });
    }
  }
  await new BarCache(join(dataDir, 'cache')).write('SPY', '5m', bars);

  const store = new FileProfileStore(join(dataDir, 'profiles'));
  const inWeek = Date.UTC(2026, 6, 7, 15); // Tue 7 Jul
  const ana: Profile = {
    ...createProfile('ana', 'Ana', 0), level: 3,
    history: [session(inWeek, 'arcade', 5, 4, 420, 600), session(inWeek, 'bot', 40, 30, 5000, 9000), session(Date.UTC(2026, 5, 30, 15), 'arcade', 3, 3, 999)],
  };
  const ben: Profile = { ...createProfile('ben', 'Ben', 0), history: [session(inWeek, 'live', 2, 1, 50)] };
  const cat: Profile = { ...createProfile('cat', 'Cat', 0), history: [session(Date.UTC(2026, 6, 15, 15), 'arcade', 4, 2, -30)] };
  await store.save(ana);
  await store.save(ben);
  await store.save(cat);
  writeFileSync(join(dataDir, 'profiles', 'broken.json'), '{nope');

  app = createApp({ dataDir, webDir: null, client: null, log: () => {}, now: () => NOW });
});

const get = async (path: string) => {
  const res = await app.fetch(new Request(`http://localhost${path}`));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

describe('GET /api/leaderboard', () => {
  test('players and real rival backtests for a week with data', async () => {
    const { status, body } = await get('/api/leaderboard?week=2026-07-08');
    expect(status).toBe(200);
    expect(body.week).toBe('2026-07-06');
    expect(body.dataWeek).toBe('2026-07-06');
    expect(body.note).toBeUndefined();
    expect(typeof body.generatedAt).toBe('number');
    const entries = body.entries as LeaderboardEntry[];
    const ana = entries.find((e) => e.id === 'ana')!;
    expect(ana).toMatchObject({ kind: 'player', trades: 5, wins: 4, profit: 420, winnings: 600, level: 3 });
    expect(ana.rank).toBeGreaterThanOrEqual(1);
    const ben = entries.find((e) => e.id === 'ben')!;
    expect(ben.rank).toBeUndefined(); // 2 trades: unranked
    expect(entries.find((e) => e.id === 'cat')).toBeUndefined(); // played another week
    const rivals = entries.filter((e) => e.kind === 'rival');
    expect(rivals).toHaveLength(RIVALS.length);
    expect(rivals.every((r) => r.strategy && r.avatar)).toBe(true);
    // ranked entries first, ordered by profit
    const ranked = entries.filter((e) => e.rank !== undefined);
    expect(ranked.map((e) => e.rank)).toEqual(ranked.map((_, i) => i + 1));
    for (let i = 1; i < ranked.length; i++) expect(ranked[i - 1]!.profit).toBeGreaterThanOrEqual(ranked[i]!.profit);
    expect(entries.slice(ranked.length).every((e) => e.rank === undefined)).toBe(true);
    expect((body.rivals as { label: string; symbols: string[] }).symbols).toEqual(['SPY']);

    const again = await get('/api/leaderboard?week=2026-07-06');
    expect((again.body.entries as LeaderboardEntry[]).filter((e) => e.kind === 'rival')).toEqual(rivals);
  });

  test('default week = current week; without data the rivals use the latest week and say so', async () => {
    const { body } = await get('/api/leaderboard');
    expect(body.week).toBe('2026-07-13');
    expect(body.dataWeek).toBe('2026-07-06');
    expect(String(body.note)).toMatch(/2026-07-06/);
    const entries = body.entries as LeaderboardEntry[];
    expect(entries.find((e) => e.id === 'cat')).toMatchObject({ trades: 4, profit: -30, rank: expect.any(Number) });
    expect(entries.filter((e) => e.kind === 'rival')).toHaveLength(RIVALS.length);
  });

  test('older week falls back to the closest earlier week with data', async () => {
    const { body } = await get('/api/leaderboard?week=2026-06-30');
    expect(body.week).toBe('2026-06-29');
    expect(body.dataWeek).toBe('2026-06-29');
    expect((body.entries as LeaderboardEntry[]).find((e) => e.id === 'ana')?.profit).toBe(999);
  });

  test('bad week is a 400', async () => {
    expect((await get('/api/leaderboard?week=last-week')).status).toBe(400);
  });

  test('GET /api/leaderboard/weeks', async () => {
    const { status, body } = await get('/api/leaderboard/weeks');
    expect(status).toBe(200);
    expect(body.current).toBe('2026-07-13');
    expect(body.dataWeeks).toEqual(['2026-07-06', '2026-06-29']);
    expect(body.weeks).toEqual(['2026-07-13', '2026-07-06', '2026-06-29']);
  });
});
