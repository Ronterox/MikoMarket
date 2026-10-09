import type { AchievementDef, Profile, RobustnessReport, SessionSummary, Trade } from '../types.ts';
import { equityBeforeEach, maxConsecutive } from './helpers.ts';

export type GameEvent = 'strategyBuilt' | 'evolution' | 'stressTest';

/**
 * What happened in the session being checked. `checkAchievements` expects the profile
 * AFTER the session's stats were applied (applySession does this for you).
 */
export interface AchievementContext {
  trades: readonly Trade[];   // this session, chronological
  summary?: Pick<SessionSummary, 'mode' | 'metrics'>;
  report?: RobustnessReport;
  event?: GameEvent;
  /** Player's local hour 0..23 (the caller knows the timezone). */
  localHour?: number;
  /** Starting equity of the session, used for drawdown-based checks. */
  initialCash?: number;
}

type Check = (p: Profile, c: AchievementContext) => boolean;
interface Entry extends AchievementDef { check: Check }

const isWin = (t: Trade) => t.pnl > 0;
const isLoss = (t: Trade) => t.pnl < 0;
const hasR = (t: Trade): t is Trade & { r: number } => t.r !== undefined && Number.isFinite(t.r);
const DAY = 86_400_000;

/** 3+ losses in a row, then a win later in the same session. */
function bouncedBack(trades: readonly Trade[]): boolean {
  let run = 0;
  let survived = false;
  for (const t of trades) {
    if (isLoss(t)) { run++; if (run >= 3) survived = true; }
    else { run = 0; if (survived && isWin(t)) return true; }
  }
  return false;
}

/** Equity fell 10%+ from a peak and later got back to that peak. */
function recoveredDrawdown(trades: readonly Trade[], initialCash?: number, depthPct = 10): boolean {
  if (trades.length === 0) return false;
  const before = equityBeforeEach(trades, initialCash);
  let peak = before[0]!;
  let troughPeak = NaN;   // the peak we fell from, once the drawdown got deep enough
  for (let i = 0; i < trades.length; i++) {
    const eq = before[i]! + trades[i]!.pnl;
    if (Number.isFinite(troughPeak) && eq >= troughPeak) return true;
    if (eq > peak) peak = eq;
    if (peak > 0 && ((peak - eq) / peak) * 100 >= depthPct && !Number.isFinite(troughPeak)) troughPeak = peak;
  }
  return false;
}

const ENTRIES: Entry[] = [
  // ── First steps ──
  { id: 'first_trade', name: 'First Steps', icon: '🎉', desc: 'Close your very first trade.', check: (p) => p.stats.trades >= 1 },
  { id: 'first_stop', name: 'Safety Net', icon: '🛡️', desc: 'Close a trade that had a stop-loss.', check: (p) => p.stats.tradesWithStop >= 1 },
  { id: 'first_win', name: 'First Green', icon: '💚', desc: 'Close a winning trade.', check: (p) => p.stats.wins >= 1 },
  { id: 'first_lesson', name: 'First Lesson', icon: '📘', desc: 'Take a loss with a stop in place. The stop worked!', check: (_p, c) => c.trades.some((t) => isLoss(t) && t.hadStop) },
  { id: 'first_short', name: 'Bear Whisperer', icon: '🐻', desc: 'Win a short trade.', check: (_p, c) => c.trades.some((t) => t.side === 'short' && isWin(t)) },
  // ── Volume ──
  { id: 'trades_10', name: 'Warming Up', icon: '🔟', desc: 'Close 10 trades.', check: (p) => p.stats.trades >= 10 },
  { id: 'trades_100', name: 'Centurion', icon: '💯', desc: 'Close 100 trades.', check: (p) => p.stats.trades >= 100 },
  { id: 'trades_500', name: 'Tape Veteran', icon: '🏯', desc: 'Close 500 trades.', check: (p) => p.stats.trades >= 500 },
  { id: 'sessions_10', name: 'Regular', icon: '🎮', desc: 'Play 10 sessions.', check: (p) => p.stats.sessions >= 10 },
  // ── Discipline ──
  { id: 'stops_25', name: 'Stop Gang', icon: '🧱', desc: 'Close 25 trades with a stop-loss.', check: (p) => p.stats.tradesWithStop >= 25 },
  { id: 'by_the_book', name: 'By the Book', icon: '📋', desc: 'A session of 5+ trades, every one with a stop.', check: (_p, c) => c.trades.length >= 5 && c.trades.every((t) => t.hadStop) },
  { id: 'calm_waters', name: 'Calm Waters', icon: '🌊', desc: 'A session of 5+ trades with drawdown under 3%.', check: (_p, c) => c.trades.length >= 5 && !!c.summary && c.summary.metrics.maxDrawdownPct < 3 },
  { id: 'cut_quick', name: 'Cut It Quick', icon: '✂️', desc: 'Close a loser at half your planned risk or less.', check: (_p, c) => c.trades.some((t) => isLoss(t) && hasR(t) && t.r >= -0.5) },
  { id: 'edge_finder', name: 'Edge Finder', icon: '🧭', desc: 'A session of 10+ trades with expectancy above +0.2R.', check: (_p, c) => !!c.summary && c.summary.metrics.trades >= 10 && c.summary.metrics.expectancyR > 0.2 },
  // ── Patience & winners ──
  { id: 'diamond_patience', name: 'Diamond Patience', icon: '💎', desc: 'Hold a winner for more than 50 bars.', check: (_p, c) => c.trades.some((t) => isWin(t) && t.barsHeld > 50) },
  { id: 'triple_threat', name: 'Triple Threat', icon: '🎯', desc: 'Win a 3R+ trade.', check: (_p, c) => c.trades.some((t) => hasR(t) && t.r >= 3) },
  { id: 'moonshot', name: 'Moonshot', icon: '🚀', desc: 'Win a 5R+ trade.', check: (_p, c) => c.trades.some((t) => hasR(t) && t.r >= 5) },
  { id: 'win_streak_5', name: 'On Fire', icon: '🔥', desc: 'Win 5 trades in a row.', check: (p, c) => p.stats.biggestWinStreak >= 5 || maxConsecutive(c.trades, isWin) >= 5 },
  // ── Resilience ──
  { id: 'unbreakable', name: 'Unbreakable', icon: '🦅', desc: 'Survive 3 losses in a row, then bounce back with a win.', check: (_p, c) => bouncedBack(c.trades) },
  { id: 'comeback_kid', name: 'Comeback Kid', icon: '🦸', desc: 'Recover from a 10% drawdown to your old high.', check: (_p, c) => recoveredDrawdown(c.trades, c.initialCash) },
  { id: 'profitable_month', name: 'Good Month', icon: '📅', desc: 'Finish a replay spanning a month or more in profit.', check: (_p, c) => {
    if (!c.summary || c.summary.mode !== 'arcade' || c.trades.length === 0) return false;
    const span = c.trades[c.trades.length - 1]!.exitT - c.trades[0]!.entryT;
    return span >= 28 * DAY && c.summary.metrics.netProfit > 0;
  } },
  // ── Bot Lab ──
  { id: 'bot_built', name: 'Bot Whisperer', icon: '🤖', desc: 'Build your first bot.', check: (p) => p.stats.strategiesBuilt >= 1 },
  { id: 'bots_5', name: 'Bot Factory', icon: '🏭', desc: 'Build 5 bots.', check: (p) => p.stats.strategiesBuilt >= 5 },
  { id: 'first_evolution', name: 'Natural Selection', icon: '🧬', desc: 'Run your first evolution.', check: (p) => p.stats.evolutionsRun >= 1 },
  { id: 'evolutions_10', name: 'Evolution Theory', icon: '🦕', desc: 'Run 10 evolutions.', check: (p) => p.stats.evolutionsRun >= 10 },
  { id: 'scientist', name: 'Scientist', icon: '🔬', desc: 'Run 10 stress tests.', check: (p) => p.stats.stressTestsRun >= 10 },
  { id: 'grade_a', name: 'A-Team', icon: '🅰️', desc: 'Get a bot graded A or better.', check: (p) => p.stats.bestGrade === 'A' || p.stats.bestGrade === 'S' },
  { id: 'grade_s', name: 'S-Tier', icon: '🌟', desc: 'Get a bot graded S.', check: (p) => p.stats.bestGrade === 'S' },
  { id: 'overfit_detective', name: 'Overfit Detective', icon: '🕵️', desc: 'Catch a bot that looked great in-sample but graded D.', secret: true, check: (_p, c) =>
    !!c.report && c.report.grade === 'D' && c.report.inSample.netProfit > 0 && c.report.inSample.profitFactor >= 1.5 },
  // ── Habits ──
  { id: 'streak_3', name: 'Habit Forming', icon: '📆', desc: 'Play 3 days in a row.', check: (p) => p.streakDays >= 3 },
  { id: 'streak_7', name: 'Weekly Warrior', icon: '🗓️', desc: 'Play 7 days in a row.', check: (p) => p.streakDays >= 7 },
  { id: 'streak_30', name: 'Iron Habit', icon: '🏆', desc: 'Play 30 days in a row.', check: (p) => p.streakDays >= 30 },
  { id: 'level_5', name: 'Leveled Up', icon: '🎖️', desc: 'Reach level 5.', check: (p) => p.level >= 5 },
  { id: 'level_10', name: 'Double Digits', icon: '🏅', desc: 'Reach level 10.', check: (p) => p.level >= 10 },
  { id: 'rating_1200', name: 'Rising Star', icon: '⭐', desc: 'Reach a skill rating of 1200.', check: (p) => p.rating >= 1200 },
  { id: 'into_the_wild', name: 'Into the Wild', icon: '📡', desc: 'Play a live session.', check: (_p, c) => c.summary?.mode === 'live' },
  // ── Secret ──
  { id: 'night_owl', name: 'Night Owl', icon: '🦉', desc: 'Trade between midnight and 4am.', secret: true, check: (_p, c) => c.trades.length > 0 && c.localHour !== undefined && c.localHour >= 0 && c.localHour < 4 },
  { id: 'early_bird', name: 'Early Bird', icon: '🌅', desc: 'Trade between 5am and 7am.', secret: true, check: (_p, c) => c.trades.length > 0 && c.localHour !== undefined && c.localHour >= 5 && c.localHour < 7 },
  { id: 'sniper', name: 'Sniper', icon: '🎯', desc: 'One trade all session: a 2R+ winner with a stop.', secret: true, check: (_p, c) =>
    c.trades.length === 1 && c.trades[0]!.hadStop && hasR(c.trades[0]!) && c.trades[0]!.r >= 2 },
  { id: 'zen', name: 'Zen Master', icon: '🧘', desc: 'Sit out a whole session. Not trading is a position too.', secret: true, check: (_p, c) =>
    c.trades.length === 0 && !c.event && !c.report && !!c.summary && c.summary.mode !== 'bot' },
];

export const ACHIEVEMENTS: AchievementDef[] = ENTRIES.map(({ check: _c, ...def }) => def);

/** Defs newly unlocked by this session: not already in profile.achievements, unique by id. */
export function checkAchievements(profile: Profile, ctx: AchievementContext): AchievementDef[] {
  const out: AchievementDef[] = [];
  for (const e of ENTRIES) {
    if (profile.achievements[e.id] !== undefined) continue;
    if (e.check(profile, ctx)) {
      const { check: _c, ...def } = e;
      out.push(def);
    }
  }
  return out;
}
