import type { AccountState, Metrics, Position, RobustnessReport, Trade } from '../types.ts';

let n = 0;
export function trade(over: Partial<Trade> = {}): Trade {
  n++;
  return {
    id: `t${n}`, side: 'long', qty: 10, entryT: 0, entryPrice: 100, exitT: 3_600_000, exitPrice: 101,
    pnl: 100, pnlPct: 1, r: 1, commission: 1, mae: -20, mfe: 120, barsHeld: 5, exitReason: 'target',
    actor: 'manual', hadStop: true, ...over,
  };
}

export function metrics(over: Partial<Metrics> = {}): Metrics {
  return {
    netProfit: 0, netProfitPct: 0, trades: 0, wins: 0, losses: 0, winRate: 0, profitFactor: 1, avgWin: 0,
    avgLoss: 0, payoff: 0, expectancy: 0, expectancyR: 0, maxDrawdown: 0, maxDrawdownPct: 0, sharpe: 0,
    sortino: 0, calmar: 0, cagr: 0, exposure: 0, avgBarsHeld: 0, maxConsecWins: 0, maxConsecLosses: 0,
    recoveryFactor: 0, sqn: 0, ...over,
  };
}

export const GREAT = (trades: number) => metrics({
  trades, wins: Math.round(trades * 0.55), losses: trades - Math.round(trades * 0.55), netProfit: 2000, netProfitPct: 20,
  profitFactor: 2.5, expectancyR: 0.8, maxDrawdownPct: 2, sqn: 3.5,
});
export const AWFUL = (trades: number) => metrics({
  trades, wins: 1, losses: trades - 1, netProfit: -3000, netProfitPct: -30, profitFactor: 0.2,
  expectancyR: -0.9, maxDrawdownPct: 35, sqn: -3,
});

export function report(over: Partial<RobustnessReport> = {}): RobustnessReport {
  return {
    grade: 'B', score: 60, inSample: metrics(), outOfSample: metrics(),
    monteCarlo: {
      runs: 100, finalEquity: { p5: 0, p25: 0, p50: 0, p75: 0, p95: 0 },
      maxDrawdownPct: { p5: 0, p25: 0, p50: 0, p75: 0, p95: 0 }, probabilityOfProfit: 0.5, riskOfRuin: 0, sampleCurves: [],
    },
    reasons: [], ...over,
  };
}

export function position(over: Partial<Position> = {}): Position {
  return {
    side: 'long', qty: 10, avgPrice: 100, openedAt: 0, openedIndex: 0, stopLoss: 99, initialRisk: 100,
    unrealized: 0, mae: 0, mfe: 0, barsHeld: 0, actor: 'manual', ...over,
  };
}

export function account(over: Partial<AccountState> = {}): AccountState {
  return {
    t: 0, index: 0, cash: 10_000, equity: 10_000, realized: 0, position: null, workingOrders: [],
    peakEquity: 10_000, drawdown: 0, drawdownPct: 0, ...over,
  };
}
