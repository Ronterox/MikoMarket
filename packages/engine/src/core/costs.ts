import type { CostModel, Instrument } from '../types.ts';

/**
 * CostModel plus an optional minimum commission per order (IBKR-style "min $1").
 * `minCommission` is an engine extension that is not in types.ts yet. A plain
 * CostModel works everywhere, since the field is optional.
 */
export interface CostModelExt extends CostModel {
  minCommission?: number;
}

/** Stock-like defaults: $0.005/share, $1 minimum per order, 1 tick slippage, 1 tick spread. */
export const DEFAULT_COSTS: CostModelExt = {
  commissionPerUnit: 0.005,
  commissionPerOrder: 0,
  slippageTicks: 1,
  spreadTicks: 1,
  minCommission: 1,
};

/** Sensible retail costs for an instrument kind. */
export function costsFor(instrument: Instrument): CostModelExt {
  switch (instrument.kind) {
    case 'future':
      return { commissionPerUnit: 2.5, commissionPerOrder: 0, slippageTicks: 1, spreadTicks: 1 };
    case 'stock':
    case 'etf':
      return { ...DEFAULT_COSTS };
    case 'crypto':
    case 'fx':
    case 'index':
      return { commissionPerUnit: 0, commissionPerOrder: 0, slippageTicks: 1, spreadTicks: 2 };
  }
}

/** Commission for one order of `qty` units: max(min, qty*perUnit) + perOrder. */
export function commissionFor(costs: CostModel, qty: number): number {
  const min = costs.minCommission ?? 0;
  return Math.max(min, qty * costs.commissionPerUnit) + costs.commissionPerOrder;
}

/** Leverage allowed on notional: futures ≈ 10% margin, everything else 4x intraday. */
export function leverageFor(instrument: Instrument): number {
  return instrument.kind === 'future' ? 10 : 4;
}
