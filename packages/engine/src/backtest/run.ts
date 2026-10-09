import type { BacktestResult, BarSeries, CostModel, EngineEvent, StrategySpec } from '../types.ts';
import { compileStrategy } from '../strategy/compile.ts';
import { Session, columnsFor } from '../core/session.ts';

export interface BacktestOptions {
  /** Default: the strategy's warm-up (first bar where every indicator is defined). */
  startIndex?: number;
  endIndex?: number;
  initialCash?: number;
  costs?: CostModel;
  allowShort?: boolean;
  onEvent?: (e: EngineEvent) => void;
}

/** Runs `spec` over `series` with the same Session the game uses. */
export function runBacktest(series: BarSeries, spec: StrategySpec, opts: BacktestOptions = {}): BacktestResult {
  const cols = columnsFor(series.bars);
  const compiled = compileStrategy(spec, cols);
  const s = new Session({
    series,
    strategy: compiled,
    startIndex: opts.startIndex ?? compiled.warmup,
    ...(opts.endIndex !== undefined ? { endIndex: opts.endIndex } : {}),
    ...(opts.initialCash !== undefined ? { initialCash: opts.initialCash } : {}),
    ...(opts.costs !== undefined ? { costs: opts.costs } : {}),
    ...(opts.allowShort !== undefined ? { allowShort: opts.allowShort } : {}),
  });
  if (opts.onEvent) s.on('*', opts.onEvent);
  while (s.step());
  return s.result();
}
