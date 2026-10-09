import type { AchievementDef, Grade, Profile, RobustnessReport, SessionSummary, Trade, XpAward } from '../types.ts';
import { checkAchievements, type GameEvent } from './achievements.ts';
import { betterGrade, dayOf, daysBetween, equityBeforeEach, maxConsecutive } from './helpers.ts';
import { levelForXp } from './levels.ts';
import { RATING_START, ratingUpdate } from './rating.ts';
import { awardTrade, sumXp } from './xp.ts';

export const HISTORY_CAP = 200;

/** Session-level XP. Showing up, consistency and honest testing all pay. */
export const SESSION_XP = {
  complete: 20,          // finished a session with at least one trade
  showedUp: 10,          // finished a session with no trades (patience is a position)
  firstToday: 25,
  streakPerDay: 5,       // x streak days, capped
  streakCap: 50,
  disciplined: 25,       // 5+ trades, all with stops
  calmDrawdown: 15,      // 3+ trades, max drawdown under 5%
  strategyBuilt: 30,
  evolution: 25,
  stressTest: 30,
  achievement: 25,       // per achievement unlocked
} as const;

export const GRADE_XP: Record<Grade, number> = { S: 100, A: 60, B: 30, C: 15, D: 15 };

export function createProfile(id: string, name: string, now: number): Profile {
  return {
    id,
    name,
    createdAt: now,
    xp: 0,
    level: 1,
    rating: RATING_START,
    streakDays: 0,
    stats: {
      sessions: 0, trades: 0, wins: 0, losses: 0, netProfit: 0, bestTrade: 0, worstTrade: 0,
      tradesWithStop: 0, biggestWinStreak: 0, strategiesBuilt: 0, evolutionsRun: 0, stressTestsRun: 0,
      minutesPlayed: 0,
    },
    achievements: {},
    strategies: [],
    history: [],
    settings: { sound: true, music: true, assistant: true, reducedMotion: false },
  };
}

export interface DailyStreak {
  days: number;          // streak length after playing `today`
  firstToday: boolean;   // true when this is the first session of `today`
  continued: boolean;    // true when yesterday was played too
}

/**
 * Streak after playing on `today` ('YYYY-MM-DD'). Same day: unchanged. The day after
 * lastPlayedDay: +1. A gap (or a first ever session): back to 1. Pure: does not mutate.
 */
export function dailyStreak(profile: Pick<Profile, 'streakDays' | 'lastPlayedDay'>, today: string): DailyStreak {
  const last = profile.lastPlayedDay;
  if (!last) return { days: 1, firstToday: true, continued: false };
  const gap = daysBetween(last, today);
  if (gap === 0) return { days: Math.max(1, profile.streakDays), firstToday: false, continued: false };
  if (gap === 1) return { days: Math.max(1, profile.streakDays) + 1, firstToday: true, continued: true };
  // gap > 1, malformed dates, or a clock that went backwards: start a fresh streak.
  return { days: 1, firstToday: gap !== 0, continued: false };
}

export interface ApplySessionInput {
  summary: Omit<SessionSummary, 'xpEarned' | 'ratingDelta'>;
  trades: Trade[];
  report?: RobustnessReport;
  event?: GameEvent;
  /** The player's local day 'YYYY-MM-DD'. Default: the UTC day of `now`. */
  today?: string;
  /** The player's local hour 0..23 (for time-of-day achievements). */
  localHour?: number;
  /** Starting equity of the session (default: derived from trades, else 10,000). */
  initialCash?: number;
  minutesPlayed?: number;
  /** Per-trade context the caller knows (same order as `trades`). */
  tradeContext?: { riskPct?: number; followedPlan?: boolean }[];
}

export interface ApplySessionResult {
  profile: Profile;
  awards: XpAward[];
  achievements: AchievementDef[];
  levelUp?: number;
  ratingDelta: number;
}

export function applySession(profile: Profile, input: ApplySessionInput, now: number): ApplySessionResult {
  const { summary, trades, report, event } = input;
  const awards: XpAward[] = [];

  // ── Trade XP ──
  const initialCash = input.initialCash ?? impliedInitialCash(summary.metrics.netProfit, summary.metrics.netProfitPct);
  const equityBefore = equityBeforeEach(trades, initialCash);
  let winStreak = 0;
  trades.forEach((t, i) => {
    winStreak = t.pnl > 0 ? winStreak + 1 : 0;
    const tc = input.tradeContext?.[i];
    awards.push(...awardTrade(t, {
      equityBefore: equityBefore[i]!,
      riskPct: tc?.riskPct,
      followedPlan: tc?.followedPlan,
      streak: winStreak,
    }));
  });

  // ── Session XP ──
  const streak = dailyStreak(profile, input.today ?? dayOf(now));
  if (trades.length > 0) awards.push({ amount: SESSION_XP.complete, reason: 'Session complete', icon: '🎮' });
  else awards.push({ amount: SESSION_XP.showedUp, reason: 'Showed up and stayed patient', icon: '🧘' });
  if (streak.firstToday) awards.push({ amount: SESSION_XP.firstToday, reason: 'First session today', icon: '☀️' });
  if (streak.firstToday && streak.days >= 2) {
    awards.push({ amount: Math.min(SESSION_XP.streakCap, SESSION_XP.streakPerDay * streak.days), reason: `${streak.days}-day streak`, icon: '📆' });
  }
  if (trades.length >= 5 && trades.every((t) => t.hadStop)) {
    awards.push({ amount: SESSION_XP.disciplined, reason: 'Every trade had a stop', icon: '🧱' });
  }
  if (trades.length >= 3 && summary.metrics.maxDrawdownPct < 5) {
    awards.push({ amount: SESSION_XP.calmDrawdown, reason: 'Drawdown kept under 5%', icon: '🌊' });
  }
  if (event === 'strategyBuilt') awards.push({ amount: SESSION_XP.strategyBuilt, reason: 'Built a bot', icon: '🤖' });
  if (event === 'evolution') awards.push({ amount: SESSION_XP.evolution, reason: 'Ran an evolution', icon: '🧬' });
  if (event === 'stressTest' || report) awards.push({ amount: SESSION_XP.stressTest, reason: 'Stress-tested a bot', icon: '🔬' });
  if (report) {
    awards.push(report.grade === 'D'
      ? { amount: GRADE_XP.D, reason: 'Caught a fragile bot before it cost money', icon: '🕵️' }
      : { amount: GRADE_XP[report.grade], reason: `Bot graded ${report.grade}`, icon: report.grade === 'S' ? '🌟' : '🏅' });
  }

  // ── Stats ──
  const s = profile.stats;
  let net = 0;
  let wins = 0;
  let losses = 0;
  let withStop = 0;
  let best = s.trades > 0 ? s.bestTrade : -Infinity;
  let worst = s.trades > 0 ? s.worstTrade : Infinity;
  for (const t of trades) {
    net += t.pnl;
    if (t.pnl > 0) wins++;
    else if (t.pnl < 0) losses++;
    if (t.hadStop) withStop++;
    best = Math.max(best, t.pnl);
    worst = Math.min(worst, t.pnl);
  }
  const totalTrades = s.trades + trades.length;
  const stats = {
    ...s,
    sessions: s.sessions + 1,
    trades: totalTrades,
    wins: s.wins + wins,
    losses: s.losses + losses,
    netProfit: s.netProfit + net,
    bestTrade: totalTrades > 0 ? best : 0,
    worstTrade: totalTrades > 0 ? worst : 0,
    tradesWithStop: s.tradesWithStop + withStop,
    biggestWinStreak: Math.max(s.biggestWinStreak, maxConsecutive(trades, (t) => t.pnl > 0)),
    strategiesBuilt: s.strategiesBuilt + (event === 'strategyBuilt' ? 1 : 0),
    evolutionsRun: s.evolutionsRun + (event === 'evolution' ? 1 : 0),
    stressTestsRun: s.stressTestsRun + (event === 'stressTest' || report ? 1 : 0),
    bestGrade: betterGrade(s.bestGrade, report?.grade),
    minutesPlayed: s.minutesPlayed + Math.max(0, input.minutesPlayed ?? 0),
  };

  // ── Rating ──
  const ratingDelta = ratingUpdate(profile, summary.metrics, summary.mode);

  let xp = profile.xp + sumXp(awards);
  let next: Profile = {
    ...profile,
    xp,
    level: levelForXp(xp),
    rating: profile.rating + ratingDelta,
    streakDays: streak.days,
    lastPlayedDay: input.today ?? dayOf(now),
    stats,
  };

  // ── Achievements (each pays a little XP) ──
  const unlocked = checkAchievements(next, {
    trades, summary, report, event, localHour: input.localHour, initialCash,
  });
  const achievements = { ...profile.achievements };
  for (const a of unlocked) {
    achievements[a.id] = now;
    awards.push({ amount: SESSION_XP.achievement, reason: `Achievement: ${a.name}`, icon: a.icon });
  }
  xp = profile.xp + sumXp(awards);

  const xpEarned = xp - profile.xp;
  const entry: SessionSummary = { ...summary, xpEarned, ratingDelta };
  next = {
    ...next,
    xp,
    level: levelForXp(xp),
    achievements,
    history: [entry, ...profile.history].slice(0, HISTORY_CAP),
  };

  const result: ApplySessionResult = { profile: next, awards, achievements: unlocked, ratingDelta };
  if (next.level > profile.level) result.levelUp = next.level;
  return result;
}

function impliedInitialCash(netProfit: number, netProfitPct: number): number {
  const v = netProfitPct !== 0 ? (netProfit * 100) / netProfitPct : NaN;
  return Number.isFinite(v) && v > 0 ? v : 10_000;
}
