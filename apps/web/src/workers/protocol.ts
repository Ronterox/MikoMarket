import type {
  BacktestResult, BarSeries, GAGeneration, GAResult, Instrument, RobustnessReport, StrategySpec, Timeframe,
} from '@miko/engine';

/** Messages between the UI and engine.worker.ts. The worker only calls engine functions. */
export type WorkerRequest =
  | { kind: 'demo'; instrument: Instrument; timeframe: Timeframe; count: number; seed: number; startPrice: number }
  | { kind: 'backtest'; series: BarSeries; spec: StrategySpec; range?: 'in' | 'out' | 'all' }
  | { kind: 'evolve'; series: BarSeries; spec: StrategySpec; generations: number; population: number; seed: number }
  | { kind: 'stress'; series: BarSeries; spec: StrategySpec; seed: number };

export interface EvolveOutput {
  best: StrategySpec;
  ga: GAResult;
  before: BacktestResult;
  inSample: BacktestResult;
  outOfSample: BacktestResult;
}

export interface WorkerResultMap {
  demo: BarSeries;
  backtest: BacktestResult;
  evolve: EvolveOutput;
  stress: RobustnessReport;
}

export type WorkerProgress = { kind: 'generation'; gen: GAGeneration; total: number } | { kind: 'stage'; label: string; pct: number };

export type WorkerMessage =
  | { id: number; type: 'progress'; progress: WorkerProgress }
  | { id: number; type: 'done'; result: unknown }
  | { id: number; type: 'error'; message: string };
