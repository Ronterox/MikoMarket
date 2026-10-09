import type { Trade, XpAward } from '../types.ts';

/**
 * Trade XP: PROCESS beats OUTCOME.
 *
 * Every closed trade earns the base. Trades without a stop earn ONLY the base, because
 * there is nothing to reward beyond showing up. Trades with a stop unlock the process
 * bonuses (stop, sane risk, following the plan) and the outcome bonuses: a win scales with
 * its R multiple (capped), a loss pays "Lesson learned" because the stop did its job, and
 * keeping a loss within 1R pays "Cut losses". XP is never negative.
 */

export const TRADE_XP = {
  base: 10,
  stop: 10,
  saneRisk: 10,       // risk <= 2% of equity
  plan: 10,
  winBase: 5,
  winPerR: 5,
  winCap: 25,         // win XP cap (reached at 4R)
  letRun: 10,         // R >= 2
  lesson: 10,         // loss with a stop in place
  cutLoss: 8,         // loss within 1R (10% slippage tolerance)
  streakPer: 5,       // per win beyond the 2nd in a row
  streakCap: 20,
} as const;

export const SANE_RISK_PCT = 2;
/** A loss counts as "within 1R" up to -1.1R, since slippage on a stop fill is normal. */
export const CUT_LOSS_R = -1.1;

export interface AwardContext {
  equityBefore: number;
  /** Risk at entry as % of equity. When missing it is derived from trade.r and trade.pnl. */
  riskPct?: number;
  followedPlan?: boolean;
  /** Consecutive winning trades INCLUDING this one (0 when this trade is not a win). */
  streak: number;
}

/** Risk at entry as % of equity, from the R multiple: risk = pnl / r. */
export function impliedRiskPct(trade: Trade, equityBefore: number): number | undefined {
  if (!(equityBefore > 0)) return undefined;
  if (trade.initialRisk !== undefined && trade.initialRisk > 0) return (trade.initialRisk / equityBefore) * 100;
  if (trade.r === undefined || !Number.isFinite(trade.r) || trade.r === 0) return undefined;
  const risk = Math.abs(trade.pnl / trade.r);
  return Number.isFinite(risk) ? (risk / equityBefore) * 100 : undefined;
}

export function awardTrade(trade: Trade, ctx: AwardContext): XpAward[] {
  const awards: XpAward[] = [{ amount: TRADE_XP.base, reason: 'Trade completed', icon: '✅' }];
  if (!trade.hadStop) return awards;

  awards.push({ amount: TRADE_XP.stop, reason: 'Used a stop-loss', icon: '🛡️' });

  const riskPct = ctx.riskPct ?? impliedRiskPct(trade, ctx.equityBefore);
  if (riskPct !== undefined && Number.isFinite(riskPct) && riskPct > 0 && riskPct <= SANE_RISK_PCT) {
    awards.push({ amount: TRADE_XP.saneRisk, reason: 'Sane risk (2% or less)', icon: '⚖️' });
  }
  if (ctx.followedPlan) awards.push({ amount: TRADE_XP.plan, reason: 'Followed the plan', icon: '📋' });

  const r = trade.r !== undefined && Number.isFinite(trade.r) ? trade.r : undefined;
  if (trade.pnl > 0) {
    const winXp = Math.min(TRADE_XP.winCap, Math.round(TRADE_XP.winBase + TRADE_XP.winPerR * Math.max(0, r ?? 0)));
    awards.push({ amount: winXp, reason: r !== undefined ? `Winner (+${r.toFixed(1)}R)` : 'Winner', icon: '💰' });
    if (r !== undefined && r >= 2) awards.push({ amount: TRADE_XP.letRun, reason: 'Let a winner run', icon: '🏄' });
    if (ctx.streak >= 3) {
      const s = Math.min(TRADE_XP.streakCap, TRADE_XP.streakPer * (ctx.streak - 2));
      awards.push({ amount: s, reason: `Hot streak x${ctx.streak}`, icon: '🔥' });
    }
  } else if (trade.pnl < 0) {
    awards.push({ amount: TRADE_XP.lesson, reason: 'Lesson learned: the stop did its job', icon: '📘' });
    if (r !== undefined && r >= CUT_LOSS_R) {
      awards.push({ amount: TRADE_XP.cutLoss, reason: 'Cut the loss within 1R', icon: '✂️' });
    }
  }
  return awards;
}

export function sumXp(awards: readonly XpAward[]): number {
  let s = 0;
  for (const a of awards) s += Math.max(0, a.amount);
  return s;
}
