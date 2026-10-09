import type {
  BacktestResult, BarSeries, CostModel, FitnessKind, GAGeneration, GAOptions, GAResult, GeneSpec,
  Grade, Metrics, MonteCarloOptions, RobustnessReport, StrategySpec, Trade,
} from '../types.ts';
import { runBacktest } from '../backtest/index.ts';
import { applyGenome, autoGenes, getAtPointer, validateStrategy } from '../strategy/index.ts';
import { fitnessOf, splitInOut } from './fitness.ts';
import { evolve } from './ga.ts';
import { monteCarlo } from './montecarlo.ts';

interface RunOpts {
  initialCash?: number;
  costs?: CostModel;
}

export interface EvolveStrategyOptions extends RunOpts {
  fitness?: FitnessKind;
  ga?: Partial<GAOptions>;
  oosFraction?: number;
  onGeneration?: (g: GAGeneration) => void | boolean;
}

export interface EvolveStrategyResult {
  best: StrategySpec;
  ga: GAResult;
  inSample: BacktestResult;
  outOfSample: BacktestResult;
}

export interface WalkForwardSegment {
  inSample: [number, number];
  outOfSample: [number, number];
  best: StrategySpec;
  bestGenome: number[];
  inSampleMetrics: Metrics;
  outOfSampleMetrics: Metrics;
}

export interface WalkForwardOptions extends RunOpts {
  windows?: number;
  oosFraction?: number;
  fitness?: FitnessKind;
  ga?: Partial<GAOptions>;
}

export interface WalkForwardResult {
  segments: WalkForwardSegment[];
  oosTrades: Trade[];
  efficiency: number;
}

export interface StressTestOptions extends RunOpts {
  oosFraction?: number;
  monteCarlo?: Partial<MonteCarloOptions>;
  /** From a previous walkForward() run; adds a walk-forward term to the score. */
  walkForwardEfficiency?: number;
}

function prepare(spec: StrategySpec): { spec: StrategySpec; genes: GeneSpec[] } {
  const errors = validateStrategy(spec);
  if (errors.length) throw new Error(`Invalid strategy: ${errors.join('; ')}`);
  const genes = spec.genes?.length ? spec.genes : autoGenes(spec);
  return { spec: { ...spec, genes }, genes };
}

function currentGenome(spec: StrategySpec, genes: GeneSpec[]): number[] | null {
  const values = genes.map((g) => Number(getAtPointer(spec, g.path)));
  return values.every(Number.isFinite) ? values : null;
}

/** GA restricted to [start, end]: no bar outside that range can influence selection. */
function optimiseRange(
  series: BarSeries, spec: StrategySpec, genes: GeneSpec[], range: [number, number],
  kind: FitnessKind, ga: Partial<GAOptions> | undefined, run: RunOpts,
  onGeneration?: (g: GAGeneration) => void | boolean,
): GAResult {
  const initial = currentGenome(spec, genes);
  return evolve(
    genes,
    (values) => {
      const r = runBacktest(series, applyGenome(spec, values), {
        startIndex: range[0], endIndex: range[1], initialCash: run.initialCash, costs: run.costs,
      });
      return fitnessOf(r.metrics, kind);
    },
    { ...ga, initial: initial ? [initial] : [] },
    onGeneration,
  );
}

/**
 * Optimise on the in-sample range only, then evaluate the winner ONCE on the
 * out-of-sample range (the most recent `oosFraction` of bars, default 0.3).
 * The current spec values seed generation 0, so the IS fitness never gets worse.
 */
export function evolveStrategy(
  series: BarSeries, spec: StrategySpec, opts: EvolveStrategyOptions = {},
): EvolveStrategyResult {
  const { spec: base, genes } = prepare(spec);
  const { inSample: is, outOfSample: oos } = splitInOut(series, opts.oosFraction ?? 0.3);
  const run = { initialCash: opts.initialCash, costs: opts.costs };
  const ga = optimiseRange(series, base, genes, is, opts.fitness ?? 'robust', opts.ga, run, opts.onGeneration);
  const best = applyGenome(base, ga.bestGenome);
  return {
    best,
    ga,
    inSample: runBacktest(series, best, { startIndex: is[0], endIndex: is[1], ...run }),
    outOfSample: runBacktest(series, best, { startIndex: oos[0], endIndex: oos[1], ...run }),
  };
}

/**
 * Rolling walk-forward. Window k: IS = [k·oosLen, k·oosLen + isLen − 1], OOS = the
 * next oosLen bars, with oosLen / (isLen + oosLen) = oosFraction and
 * isLen + windows·oosLen = n, so the OOS segments tile the end of the series
 * without overlap. Each IS window is optimised on its own (GA seed + k).
 * efficiency = mean OOS return per bar / mean IS return per bar (= ratio of
 * annualised returns, the annualisation constant cancels); 0 if IS return <= 0.
 */
export function walkForward(
  series: BarSeries, spec: StrategySpec, opts: WalkForwardOptions = {},
): WalkForwardResult {
  const { spec: base, genes } = prepare(spec);
  const n = series.bars.length;
  const windows = Math.max(1, Math.floor(opts.windows ?? 4));
  const f = Math.min(0.9, Math.max(0.05, opts.oosFraction ?? 0.25));
  const isLen = Math.floor(n / (1 + (windows * f) / (1 - f)));
  const oosLen = Math.floor((n - isLen) / windows);
  if (isLen < 2 || oosLen < 1) return { segments: [], oosTrades: [], efficiency: 0 };
  const run = { initialCash: opts.initialCash, costs: opts.costs };
  const kind = opts.fitness ?? 'robust';
  const seed = opts.ga?.seed ?? 42;

  const segments: WalkForwardSegment[] = [];
  const oosTrades: Trade[] = [];
  let isRate = 0;
  let oosRate = 0;
  for (let k = 0; k < windows; k++) {
    const isR: [number, number] = [k * oosLen, k * oosLen + isLen - 1];
    const oosEnd = k === windows - 1 ? n - 1 : isR[1] + oosLen;
    const oosR: [number, number] = [isR[1] + 1, oosEnd];
    const ga = optimiseRange(series, base, genes, isR, kind, { ...opts.ga, seed: seed + k }, run);
    const best = applyGenome(base, ga.bestGenome);
    const isRes = runBacktest(series, best, { startIndex: isR[0], endIndex: isR[1], ...run });
    const oosRes = runBacktest(series, best, { startIndex: oosR[0], endIndex: oosR[1], ...run });
    segments.push({
      inSample: isR, outOfSample: oosR, best, bestGenome: ga.bestGenome,
      inSampleMetrics: isRes.metrics, outOfSampleMetrics: oosRes.metrics,
    });
    oosTrades.push(...oosRes.trades);
    isRate += finite(isRes.metrics.netProfitPct) / (isR[1] - isR[0] + 1);
    oosRate += finite(oosRes.metrics.netProfitPct) / (oosR[1] - oosR[0] + 1);
  }
  oosTrades.sort((a, b) => a.entryT - b.entryT);
  const efficiency = isRate > 0 ? finite(oosRate / isRate) : 0;
  return { segments, oosTrades, efficiency };
}

const finite = (x: number, fallback = 0) => (Number.isFinite(x) ? x : fallback);
const lerp01 = (x: number, from: number, to: number) =>
  Math.min(1, Math.max(0, (x - from) / (to - from)));

/**
 * Grades the spec AS-IS (no optimisation): IS + OOS backtests, then Monte Carlo
 * ('bootstrap' by default) on all trades.
 *
 * Scoring table (base, 0..100):
 *   OOS profit factor    20 pts  linear PF 1.0 → 0 … 2.0 → 20 (no OOS trades → 0)
 *   OOS Sharpe           20 pts  linear 0 → 0 … 2.0 → 20
 *   OOS vs IS stability  20 pts  r = OOS Sharpe / IS Sharpe: r 0 → 0 … 0.8 → 20
 *                                (IS Sharpe <= 0: 5 if OOS Sharpe > 0, else 0)
 *   MC profit chance     15 pts  linear P(profit) 0.5 → 0 … 1.0 → 15
 *   MC p95 drawdown      10 pts  linear 50% → 0 … 10% → 10
 *   Trade count          15 pts  15·sqrt(min(trades,100)/100), 0 if < 10 trades
 * Walk-forward (only when walkForwardEfficiency is given):
 *   score = base·0.85 + 15·lerp(WFE, 0 → 0 … 0.6 → 15)
 * Caps: < 10 total trades → max 45; OOS or IS net loss → max 54; MC risk of ruin > 5% → max 69;
 *       MC P(profit) < 50% → max 49.
 * Grade: S ≥ 85, A ≥ 70, B ≥ 55, C ≥ 40, else D.
 */
export function stressTest(
  series: BarSeries, spec: StrategySpec, opts: StressTestOptions = {},
): RobustnessReport {
  const errors = validateStrategy(spec);
  if (errors.length) throw new Error(`Invalid strategy: ${errors.join('; ')}`);
  const { inSample: is, outOfSample: oos } = splitInOut(series, opts.oosFraction ?? 0.3);
  const run = { initialCash: opts.initialCash, costs: opts.costs };
  const isRes = runBacktest(series, spec, { startIndex: is[0], endIndex: is[1], ...run });
  const oosRes = runBacktest(series, spec, { startIndex: oos[0], endIndex: oos[1], ...run });
  const cash = isRes.initialCash;
  // Bootstrap by default: 'shuffle' keeps the final equity fixed, which would make
  // "chance of profit" meaningless for grading. Shuffle is still available explicitly.
  const mc = monteCarlo([...isRes.trades, ...oosRes.trades], cash, { method: 'bootstrap', ...opts.monteCarlo });

  const I = isRes.metrics;
  const O = oosRes.metrics;
  const trades = isRes.trades.length + oosRes.trades.length;
  const oosTrades = oosRes.trades.length;
  const isSharpe = finite(I.sharpe);
  const oosSharpe = finite(O.sharpe);
  const oosPf = oosTrades === 0 ? 0 : Number.isNaN(O.profitFactor) ? 0 : O.profitFactor;
  const ratio = isSharpe > 0 ? oosSharpe / isSharpe : NaN;

  let score =
    20 * lerp01(oosPf, 1, 2) +
    20 * lerp01(oosSharpe, 0, 2) +
    (isSharpe > 0 ? 20 * lerp01(ratio, 0, 0.8) : oosSharpe > 0 ? 5 : 0) +
    15 * lerp01(mc.probabilityOfProfit, 0.5, 1) +
    10 * lerp01(-mc.maxDrawdownPct.p95, -50, -10) +
    (trades < 10 ? 0 : 15 * Math.sqrt(Math.min(trades, 100) / 100));
  const wfe = opts.walkForwardEfficiency;
  const hasWfe = wfe !== undefined && Number.isFinite(wfe);
  if (hasWfe) score = score * 0.85 + 15 * lerp01(wfe, 0, 0.6);
  if (trades < 10) score = Math.min(score, 45);
  if (oosTrades > 0 && finite(O.netProfit) < 0) score = Math.min(score, 54);
  if (mc.riskOfRuin > 0.05) score = Math.min(score, 69);
  // Losing on the training data means a good unseen stretch is most likely luck,
  // and an overall edge that loses in most random replays is no edge at all.
  if (isRes.trades.length > 0 && finite(I.netProfit) < 0) score = Math.min(score, 54);
  if (trades > 0 && mc.probabilityOfProfit < 0.5) score = Math.min(score, 49);
  score = Math.round(Math.min(100, Math.max(0, finite(score))));
  const grade: Grade = score >= 85 ? 'S' : score >= 70 ? 'A' : score >= 55 ? 'B' : score >= 40 ? 'C' : 'D';

  // reasons, most important first
  const reasons: string[] = [];
  if (trades < 10) reasons.push(`Only ${trades} trade${trades === 1 ? '' : 's'} — too few to trust yet`);
  if (oosTrades === 0) reasons.push('Never traded on the unseen data 🤷');
  else if (isSharpe > 0 && ratio < 0.3) reasons.push('Looks great on the past but fades on new data (overfit?)');
  else if (finite(O.netProfit) < 0) reasons.push('Lost money on the unseen data 📉');
  else if (isRes.trades.length > 0 && finite(I.netProfit) < 0) reasons.push('Lost on the training data, so the unseen win may be luck 🍀');
  else if (oosPf > 1 && ratio >= 0.7) reasons.push('Held up on unseen data 💪');
  if (mc.riskOfRuin > 0.05) reasons.push(`${pct(mc.riskOfRuin)} chance of losing half the account 💥`);
  else if (mc.maxDrawdownPct.p95 >= 35) reasons.push(`Bad luck could mean a ${Math.round(mc.maxDrawdownPct.p95)}% drop 😬`);
  else if (trades > 0 && mc.maxDrawdownPct.p95 <= 15) reasons.push('Drops stay small even with bad luck 🛡️');
  if (trades > 0) {
    if (mc.probabilityOfProfit >= 0.9) reasons.push(`Profitable in ${pct(mc.probabilityOfProfit)} of random replays 🎲`);
    else if (mc.probabilityOfProfit <= 0.6) reasons.push('Close to a coin flip in random replays 🪙');
  }
  if (hasWfe) {
    if (wfe >= 0.6) reasons.push('Kept working as the market changed 🔁');
    else if (wfe < 0.3) reasons.push('Struggled when re-tested over time');
  }
  if (trades >= 100) reasons.push('Plenty of trades — the results mean something');
  if (reasons.length < 2) {
    reasons.push(grade === 'S' || grade === 'A' ? 'Solid all round — nice work 👍'
      : grade === 'B' ? 'Decent — a little tuning could help 🔧'
      : 'Needs work — try tweaking the rules 🔧');
  }

  const report: RobustnessReport = {
    grade, score, inSample: I, outOfSample: O, monteCarlo: mc, reasons: reasons.slice(0, 5),
  };
  if (hasWfe) report.walkForwardEfficiency = wfe;
  return report;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
