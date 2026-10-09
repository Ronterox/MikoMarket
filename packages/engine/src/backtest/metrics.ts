import type { EquityPoint, Metrics, Timeframe, Trade } from '../types.ts';

/**
 * Bars per year used to annualise per-bar Sharpe/Sortino. Intraday values assume a US stock
 * session: 252 trading days × 6.5 hours (390 minutes). 4h ≈ 1.625 bars/day. Simple and
 * documented rather than exact for 23h futures sessions.
 */
export const BARS_PER_YEAR: Record<Timeframe, number> = {
  '1m': 252 * 390,
  '3m': 252 * 130,
  '5m': 252 * 78,
  '15m': 252 * 26,
  '30m': 252 * 13,
  '1h': 252 * 6.5,
  '4h': 252 * 1.625,
  '1d': 252,
  '1w': 52,
};

const YEAR_MS = 365.25 * 86_400_000;

export function emptyMetrics(): Metrics {
  return {
    netProfit: 0, netProfitPct: 0, trades: 0, wins: 0, losses: 0, winRate: 0, profitFactor: 0,
    avgWin: 0, avgLoss: 0, payoff: 0, expectancy: 0, expectancyR: NaN, maxDrawdown: 0, maxDrawdownPct: 0,
    sharpe: 0, sortino: 0, calmar: 0, cagr: 0, exposure: 0, avgBarsHeld: 0, maxConsecWins: 0,
    maxConsecLosses: 0, recoveryFactor: 0, sqn: 0,
  };
}

const div = (a: number, b: number): number => (b !== 0 && Number.isFinite(b) ? a / b : 0);

/**
 * Trade stats come from `trades` (netProfit = Σ pnl). Drawdown, Sharpe, Sortino, CAGR and
 * exposure come from the per-bar `equity` curve. Wins are pnl > 0, losses pnl < 0.
 */
export function computeMetrics(trades: readonly Trade[], equity: readonly EquityPoint[], initialCash: number, timeframe: Timeframe): Metrics {
  const m = emptyMetrics();
  const n = trades.length;
  m.trades = n;

  let grossWin = 0, grossLoss = 0, net = 0, bars = 0;
  let cw = 0, cl = 0;
  let sumR = 0, nR = 0;
  for (const t of trades) {
    net += t.pnl;
    bars += t.barsHeld;
    if (t.pnl > 0) { m.wins++; grossWin += t.pnl; cw++; cl = 0; if (cw > m.maxConsecWins) m.maxConsecWins = cw; }
    else if (t.pnl < 0) { m.losses++; grossLoss += t.pnl; cl++; cw = 0; if (cl > m.maxConsecLosses) m.maxConsecLosses = cl; }
    else { cw = 0; cl = 0; }
    if (t.r !== undefined && Number.isFinite(t.r)) { sumR += t.r; nR++; }
  }
  m.netProfit = net;
  m.netProfitPct = div(net, initialCash) * 100;
  m.winRate = div(m.wins, n);
  m.profitFactor = grossLoss < 0 ? grossWin / -grossLoss : grossWin > 0 ? Infinity : 0;
  m.avgWin = div(grossWin, m.wins);
  m.avgLoss = div(grossLoss, m.losses);
  m.payoff = m.avgLoss < 0 ? m.avgWin / -m.avgLoss : m.avgWin > 0 ? Infinity : 0;
  m.expectancy = div(net, n);
  m.expectancyR = nR > 0 ? sumR / nR : NaN;
  m.avgBarsHeld = div(bars, n);

  // SQN on R multiples when every trade has one, otherwise on pnl.
  if (n >= 2) {
    const useR = nR === n;
    let s = 0;
    for (const t of trades) s += useR ? t.r! : t.pnl;
    const mean = s / n;
    let v = 0;
    for (const t of trades) { const d = (useR ? t.r! : t.pnl) - mean; v += d * d; }
    const sd = Math.sqrt(v / (n - 1));
    m.sqn = sd > 0 ? (Math.sqrt(n) * mean) / sd : 0;
  }

  // Equity-curve stats.
  const E = equity.length;
  if (E > 0) {
    let peak = initialCash, maxDd = 0, maxDdPct = 0;
    for (let i = 0; i < E; i++) {
      const e = equity[i]!.equity;
      if (e > peak) peak = e;
      const dd = peak - e;
      if (dd > maxDd) maxDd = dd;
      const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
      if (ddPct > maxDdPct) maxDdPct = ddPct;
    }
    m.maxDrawdown = maxDd;
    m.maxDrawdownPct = maxDdPct;
    m.exposure = Math.min(1, div(bars, E));

    if (E > 1) {
      let s = 0, cnt = 0;
      for (let i = 1; i < E; i++) {
        const a = equity[i - 1]!.equity;
        if (a > 0) { s += equity[i]!.equity / a - 1; cnt++; }
      }
      if (cnt > 1) {
        const mean = s / cnt;
        let v = 0, dn = 0;
        for (let i = 1; i < E; i++) {
          const a = equity[i - 1]!.equity;
          if (!(a > 0)) continue;
          const r = equity[i]!.equity / a - 1;
          v += (r - mean) * (r - mean);
          if (r < 0) dn += r * r;
        }
        const sd = Math.sqrt(v / (cnt - 1));
        const dd = Math.sqrt(dn / cnt);
        const ann = Math.sqrt(BARS_PER_YEAR[timeframe]);
        m.sharpe = sd > 1e-15 ? (mean / sd) * ann : 0;
        m.sortino = dd > 1e-15 ? (mean / dd) * ann : 0;
      }
      const years = (equity[E - 1]!.t - equity[0]!.t) / YEAR_MS;
      const final = equity[E - 1]!.equity;
      if (years > 0 && initialCash > 0) {
        m.cagr = final > 0 ? (Math.pow(final / initialCash, 1 / years) - 1) * 100 : -100;
      }
    }
  }
  m.calmar = m.maxDrawdownPct > 0 ? m.cagr / m.maxDrawdownPct : 0;
  m.recoveryFactor = m.maxDrawdown > 0 ? m.netProfit / m.maxDrawdown : 0;
  return m;
}
