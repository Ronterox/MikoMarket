import { comboVerdict, indicatorTips, type ActionKind, type ComboKind, type CoachContext, type Params, type Timeframe, type Tip } from '@miko/engine';
import { coach } from '../state/app.ts';

/**
 * Thin bridge to the engine's Coach v2 hooks. All of Miko's wording and decisions live in the
 * engine (ARCHITECTURE rule 4). This file only forwards the calls and never lets a coach error break the game.
 */
export interface ActiveIndicator { id: string; params: Params }
export interface IndicatorChange { id: string; action: 'add' | 'remove' | 'params' }

function safe(f: () => Tip | null): Tip | null {
  try { return f(); } catch { return null; }
}

export const coachV2 = {
  onAction: (action: ActionKind, ctx: CoachContext) => safe(() => coach.onAction(action, ctx)),
  onPerformance: (ctx: CoachContext) => safe(() => coach.onPerformance(ctx)),
  onClock: (barOpenTimeMs: number) => safe(() => coach.onClock(barOpenTimeMs)),
  onIndicators: (active: ActiveIndicator[], change: IndicatorChange, timeframe?: Timeframe) =>
    safe(() => coach.onIndicators(active, change, { timeframe })),
};

export function comboKind(ids: string[]): ComboKind | null {
  try { return comboVerdict(ids).kind; } catch { return null; }
}

/** Plain-language "how it works" lines for one indicator. */
export function tipsFor(id: string): string[] {
  try { return indicatorTips(id); } catch { return []; }
}
