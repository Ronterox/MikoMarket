import type { Metrics, Profile, SessionSummary } from '../types.ts';

/**
 * Skill rating: the honest "how good are you overall" number. Starts at 1000.
 *
 * 1. Score the session on four risk-adjusted components, each clamped to [-1, 1]:
 *      edge        = expectancyR / 0.5            (0.5R per trade is excellent)
 *                    (fallback when R is unknown: netProfitPct / 5, at half weight)
 *      profit      = profitFactor - 1             (PF 2 => +1, PF 0 => -1)
 *      drawdown    = 1 - maxDrawdownPct / 10      (0% => +1, 10% => 0, 20% => -1)
 *      consistency = SQN / 2.5                    (Van Tharp's system quality number)
 *    score = 0.35 edge + 0.20 profit + 0.25 drawdown + 0.20 consistency   in [-1, 1]
 * 2. Elo feel: performance p = (score + 1) / 2 is compared with the performance a player
 *    of this rating is expected to show, E = 1 / (1 + 10^((1000 - rating) / 400)).
 *    At 1000, E = 0.5 (break-even play holds the rating). At 1400, E ~ 0.91, so a high
 *    rating needs consistently strong sessions to keep climbing. Ratings converge to skill.
 * 3. raw = K * (p - E) * confidence * modeWeight,  K = 80
 *      confidence = trades / (trades + 20)        (5 trades => 0.2, 20 => 0.5, 100 => 0.83)
 *      modeWeight = arcade 1, live 1.25, bot 0.6  (backtests are easy to overfit)
 * 4. Losses are softened (x0.5), a session with score <= 0 never raises the rating (even near the floor),
 *    the result is bounded to +-40 per session, rounded,
 *    and the rating never drops below the floor of 100.
 */

export const RATING_START = 1000;
export const RATING_FLOOR = 100;
export const RATING_MAX_DELTA = 40;
export const RATING_K = 80;
export const RATING_CONFIDENCE_HALF = 20;
export const MODE_WEIGHT: Record<SessionSummary['mode'], number> = { arcade: 1, live: 1.25, bot: 0.6 };

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Session quality score in [-1, 1]. Exported so the UI can show the breakdown. */
export function sessionScore(m: Metrics): { score: number; edge: number; profit: number; drawdown: number; consistency: number } {
  let edge: number;
  let edgeWeight = 0.35;
  if (Number.isFinite(m.expectancyR)) {
    edge = clamp(m.expectancyR / 0.5, -1, 1);
  } else {
    edge = Number.isFinite(m.netProfitPct) ? clamp(m.netProfitPct / 5, -1, 1) : 0;
    edgeWeight = 0.175;
  }
  let profit: number;
  if (m.profitFactor === Infinity) profit = m.wins > 0 ? 1 : 0;
  else profit = Number.isFinite(m.profitFactor) ? clamp(m.profitFactor - 1, -1, 1) : 0;
  const drawdown = Number.isFinite(m.maxDrawdownPct) ? clamp(1 - m.maxDrawdownPct / 10, -1, 1) : 0;
  const consistency = Number.isFinite(m.sqn) ? clamp(m.sqn / 2.5, -1, 1) : 0;
  const score = edgeWeight * edge + 0.2 * profit + 0.25 * drawdown + 0.2 * consistency;
  return { score: clamp(score, -1, 1), edge, profit, drawdown, consistency };
}

export function ratingConfidence(trades: number): number {
  const n = Math.max(0, trades);
  return n / (n + RATING_CONFIDENCE_HALF);
}

export function ratingUpdate(profile: Pick<Profile, 'rating'>, metrics: Metrics, mode: SessionSummary['mode']): number {
  if (!(metrics.trades > 0)) return 0;
  const rating = Number.isFinite(profile.rating) ? profile.rating : RATING_START;
  const { score } = sessionScore(metrics);
  const p = (score + 1) / 2;
  const expected = 1 / (1 + Math.pow(10, (RATING_START - rating) / 400));
  let raw = RATING_K * (p - expected) * ratingConfidence(metrics.trades) * (MODE_WEIGHT[mode] ?? 1);
  if (raw < 0) raw *= 0.5;
  if (score <= 0) raw = Math.min(0, raw); // a losing-quality session never raises the rating
  let delta = Math.round(clamp(raw, -RATING_MAX_DELTA, RATING_MAX_DELTA));
  if (rating + delta < RATING_FLOOR) delta = Math.max(delta, Math.min(0, RATING_FLOOR - rating));
  if (Object.is(delta, -0)) delta = 0;
  return delta;
}

export const RATING_TIERS: readonly { name: string; icon: string; min: number }[] = [
  { name: 'Bronze', icon: '🥉', min: -Infinity },
  { name: 'Silver', icon: '🥈', min: 1100 },
  { name: 'Gold', icon: '🥇', min: 1250 },
  { name: 'Platinum', icon: '💠', min: 1400 },
  { name: 'Diamond', icon: '💎', min: 1550 },
  { name: 'Master', icon: '🌟', min: 1700 },
];

export function ratingTier(rating: number): { name: string; icon: string } {
  let t = RATING_TIERS[0]!;
  for (const tier of RATING_TIERS) if (rating >= tier.min) t = tier;
  return { name: t.name, icon: t.icon };
}
