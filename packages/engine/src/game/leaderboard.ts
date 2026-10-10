/**
 * Weekly leaderboard: players from their profile history plus honest NPC rivals whose
 * results come from real backtests of the strategy templates on that week's bars.
 */
import type { BarSeries, Profile, SessionSummary } from '../types.ts';
import { runBacktest } from '../backtest/run.ts';
import { STRATEGY_TEMPLATES } from '../strategy/index.ts';
import { nyClock } from './clock.ts';

const DAY = 86_400_000;

/** Fewer closed trades than this in a week = listed, but unranked. */
export const MIN_RANKED_TRADES = 3;
export const RIVALS_LABEL = "Miko's rival bots";

export interface LeaderboardEntry {
  id: string;
  name: string;
  avatar?: string;
  kind: 'player' | 'rival';
  trades: number;
  wins: number;
  /** 0..1 */
  winRate: number;
  /** Net $ (after costs). */
  profit: number;
  /** Sum of the per-session (players) or per-instrument (rivals) % returns. */
  profitPct: number;
  /** Gross $ won: the sum of the winning trades' P&L. */
  winnings: number;
  level?: number;
  /** 1-based; undefined = unranked (fewer than MIN_RANKED_TRADES trades). */
  rank?: number;
  /** Rivals: the strategy template they run. */
  strategy?: string;
}

/** 'YYYY-MM-DD' of the New York Monday of the week containing `t` (epoch ms). */
export function weekKey(t: number): string {
  const { day, dow } = nyClock(t);
  const monday = day - ((dow + 6) % 7);
  return new Date(monday * DAY).toISOString().slice(0, 10);
}

/** True for sessions that are real trading results: arcade, live, and bot rounds played forward. */
export const countsAsTrading = (s: SessionSummary): boolean =>
  s.mode === 'arcade' || s.mode === 'live' || (s.mode === 'bot' && s.playedForward === true);

/**
 * A player's results for one week. Arcade, live and the player's bots played forward on Play count;
 * Bot Lab events and history backtests do not. Null when none.
 */
export function weeklyStats(profile: Profile, week: string): LeaderboardEntry | null {
  const rows = (profile.history ?? []).filter(
    (s) => countsAsTrading(s) && Number.isFinite(s.t) && s.metrics && weekKey(s.t) === week,
  );
  if (rows.length === 0) return null;
  let trades = 0, wins = 0, profit = 0, profitPct = 0, winnings = 0;
  for (const s of rows) {
    const m = s.metrics;
    trades += m.trades || 0;
    wins += m.wins || 0;
    profit += Number.isFinite(m.netProfit) ? m.netProfit : 0;
    profitPct += Number.isFinite(m.netProfitPct) ? m.netProfitPct : 0;
    winnings += s.grossWins ?? Math.max(Number.isFinite(m.netProfit) ? m.netProfit : 0, 0);
  }
  return {
    id: profile.id, name: profile.name, kind: 'player', trades, wins, winRate: trades > 0 ? wins / trades : 0,
    profit, profitPct, winnings, level: profile.level,
  };
}

const byResult = (a: LeaderboardEntry, b: LeaderboardEntry) =>
  b.profit - a.profit || b.winRate - a.winRate || b.trades - a.trades || a.name.localeCompare(b.name);

/**
 * Sorted by profit, then win rate, then trades. Entries with at least MIN_RANKED_TRADES trades get
 * ranks 1..n; the rest follow, unranked (rank undefined). Returns new objects.
 */
export function rankLeaderboard(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  const ranked = entries.filter((e) => e.trades >= MIN_RANKED_TRADES).sort(byResult);
  const unranked = entries.filter((e) => !(e.trades >= MIN_RANKED_TRADES)).sort(byResult);
  return [
    ...ranked.map((e, i) => ({ ...e, rank: i + 1 })),
    ...unranked.map(({ rank: _rank, ...e }) => ({ ...e })),
  ];
}

/** Every week (newest first) that has at least one bar in any of the series. */
export function weeksWithData(series: readonly BarSeries[]): string[] {
  const set = new Set<string>();
  for (const s of series) {
    let lastDay = NaN;
    for (const b of s.bars) {
      const d = Math.floor(b.t / DAY);
      if (d === lastDay) continue;
      lastDay = d;
      set.add(weekKey(b.t));
    }
  }
  return [...set].sort().reverse();
}

export interface RivalDef {
  id: string;
  name: string;
  avatar: string;
  /** STRATEGY_TEMPLATES id. */
  templateId: string;
}

/** Miko's rival bots. Clearly bots, and every number they post is a real backtest. */
export const RIVALS: readonly RivalDef[] = [
  { id: 'rival_sakura', name: 'Sakura', avatar: '⚡', templateId: 'tpl_ema_cross' },
  { id: 'rival_kitsune', name: 'Kitsune', avatar: '🦊', templateId: 'tpl_rsi_bounce' },
  { id: 'rival_tanuki', name: 'Tanuki', avatar: '🍃', templateId: 'tpl_bb_reversion' },
  { id: 'rival_ronin', name: 'Ronin', avatar: '🗡️', templateId: 'tpl_donchian' },
  { id: 'rival_neko', name: 'Neko', avatar: '🐱', templateId: 'tpl_supertrend' },
  { id: 'rival_oni', name: 'Oni', avatar: '👹', templateId: 'tpl_macd' },
  { id: 'rival_usagi', name: 'Usagi', avatar: '🐰', templateId: 'tpl_ha_ema' },
  { id: 'rival_hana', name: 'Hana', avatar: '🌸', templateId: 'tpl_rkbb' },
];

export interface RivalOptions {
  /** Starting cash per instrument. Default 10,000. */
  initialCash?: number;
  /** Bars before the week given to indicators as warm-up (no trading). Default 600. */
  warmupBars?: number;
  rivals?: readonly RivalDef[];
}

/**
 * Runs each rival's template with its own `initialCash` account on each series, trading only the
 * bars of `week` (earlier bars are indicator warm-up). Results are summed across series.
 * Returns [] when no series has bars in that week.
 */
export function rivalEntries(series: readonly BarSeries[], week: string, opts: RivalOptions = {}): LeaderboardEntry[] {
  const cash = opts.initialCash ?? 10_000;
  const warm = opts.warmupBars ?? 600;
  const windows: { sub: BarSeries; startIndex: number }[] = [];
  for (const s of series) {
    let lo = -1, hi = -1;
    for (let i = 0; i < s.bars.length; i++) {
      if (weekKey(s.bars[i]!.t) === week) {
        if (lo < 0) lo = i;
        hi = i;
      } else if (lo >= 0) break;
    }
    if (lo < 0) continue;
    const from = Math.max(0, lo - warm);
    windows.push({ sub: { ...s, bars: s.bars.slice(from, hi + 1) }, startIndex: lo - from });
  }
  if (windows.length === 0) return [];
  const out: LeaderboardEntry[] = [];
  for (const r of opts.rivals ?? RIVALS) {
    const spec = STRATEGY_TEMPLATES.find((t) => t.id === r.templateId);
    if (!spec) continue;
    let trades = 0, wins = 0, profit = 0, profitPct = 0, winnings = 0;
    for (const w of windows) {
      const res = runBacktest(w.sub, spec, { startIndex: w.startIndex, initialCash: cash });
      trades += res.metrics.trades;
      wins += res.metrics.wins;
      profit += res.metrics.netProfit;
      profitPct += res.metrics.netProfitPct;
      for (const t of res.trades) if (t.pnl > 0) winnings += t.pnl;
    }
    out.push({
      id: r.id, name: r.name, avatar: r.avatar, kind: 'rival', trades, wins, winRate: trades > 0 ? wins / trades : 0,
      profit, profitPct, winnings, strategy: spec.name,
    });
  }
  return out;
}
