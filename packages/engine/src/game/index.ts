export { xpForLevel, levelForXp, levelProgress, rankFor, RANKS, MAX_LEVEL, XP_BASE, XP_EXPONENT } from './levels.ts';
export type { LevelProgress, Rank } from './levels.ts';
export { awardTrade, impliedRiskPct, sumXp, TRADE_XP, SANE_RISK_PCT, CUT_LOSS_R } from './xp.ts';
export type { AwardContext } from './xp.ts';
export {
  ratingUpdate, ratingTier, sessionScore, ratingConfidence, RATING_TIERS, RATING_START, RATING_FLOOR,
  RATING_MAX_DELTA, RATING_K, MODE_WEIGHT,
} from './rating.ts';
export { ACHIEVEMENTS, checkAchievements } from './achievements.ts';
export type { AchievementContext, GameEvent } from './achievements.ts';
export { createProfile, dailyStreak, applySession, HISTORY_CAP, SESSION_XP, GRADE_XP } from './profile.ts';
export type { DailyStreak, ApplySessionInput, ApplySessionResult } from './profile.ts';
export {
  Coach, COACH_LINES, REPORT_LINES, SESSION_LINES, LEVEL_LINES, GREET_LINES, IDLE_TIPS, TIP_META, HIGH_PRIORITY,
  ACTION_LINES, ACTION_RATE, ACTION_COOLDOWN, PERFORMANCE_LINES, PERF_META, PERF_GAP, CLOCK_RATE, CLOCK_GAP,
} from './coach.ts';
export type { ActionKind, CoachContext, CoachOptions, CoachTipMeta, LineParams } from './coach.ts';
export { CLOCK_MOMENTS, nyClock } from './clock.ts';
export type { ClockMoment, NyClock } from './clock.ts';
export { INDICATOR_TIPS, indicatorTips, comboVerdict, analyzeCombo, MOVING_AVERAGES, MOMENTUM_OSCILLATORS } from './indicatorTips.ts';
export type { ComboKind, ComboVerdict, ComboAnalysis } from './indicatorTips.ts';
export {
  weekKey, weeklyStats, rankLeaderboard, weeksWithData, rivalEntries, RIVALS, MIN_RANKED_TRADES, RIVALS_LABEL,
} from './leaderboard.ts';
export type { LeaderboardEntry, RivalDef, RivalOptions } from './leaderboard.ts';
