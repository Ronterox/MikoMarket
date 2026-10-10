/**
 * @miko/engine — shared contracts.
 *
 * Every module in the engine (and every consumer: CLI, server, web) codes
 * against these types. The engine is pure TypeScript: no DOM, no Node APIs,
 * no dependencies, no wall-clock reads, no Math.random (use util/rng.ts).
 * Same inputs + same seed => same outputs, everywhere.
 *
 * Time is always epoch milliseconds UTC. A bar's `t` is its OPEN time.
 */

// ───────────────────────────── Market data ─────────────────────────────

export interface Bar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export type Timeframe = '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w';

export const TIMEFRAME_MS: Record<Timeframe, number> = {
  '1m': 60_000,
  '3m': 180_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
  '1w': 604_800_000,
};

export type InstrumentKind = 'stock' | 'etf' | 'future' | 'crypto' | 'fx' | 'index';

export interface Instrument {
  symbol: string;            // TradeStation spelling: "SPY", "@NQ", "MNQZ26"
  name: string;              // "Nasdaq 100 E-mini"
  kind: InstrumentKind;
  pointValue: number;        // currency per 1.0 price move per unit (stocks 1, NQ 20, ES 50)
  tickSize: number;          // 0.01 stocks, 0.25 NQ/ES
  emoji?: string;            // UI flavour only
}

export interface BarSeries {
  instrument: Instrument;
  timeframe: Timeframe;
  bars: Bar[];
}

/** Columnar view of a series — what indicators consume. Same length as bars. */
export interface Columns {
  t: Float64Array;
  o: Float64Array;
  h: Float64Array;
  l: Float64Array;
  c: Float64Array;
  v: Float64Array;
}

export type Source = 'open' | 'high' | 'low' | 'close' | 'hl2' | 'hlc3' | 'ohlc4' | 'volume';

// ───────────────────────────── Indicators ─────────────────────────────

export type ParamValue = number | string;
export type Params = Record<string, ParamValue>;

export interface ParamSpec {
  key: string;
  label: string;
  type: 'int' | 'float' | 'source' | 'enum';
  default: ParamValue;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];       // for 'enum' / 'source'
}

export type IndicatorCategory = 'trend' | 'momentum' | 'volatility' | 'volume' | 'candles' | 'price';

export interface IndicatorMeta {
  id: string;               // stable key: 'rsi', 'bb', 'ema'
  name: string;             // display: 'RSI'
  icon: string;             // single emoji for the mobile-game UI
  category: IndicatorCategory;
  blurb: string;            // ONE short friendly sentence for non-traders
  params: ParamSpec[];
  outputs: { key: string; label: string }[]; // first output is the default
  overlay: boolean;         // true: drawn on the price chart; false: own pane
  range?: [number, number]; // bounded oscillators (RSI 0..100) — used for threshold sliders
  levels?: number[];        // conventional reference lines (RSI 30/70)
}

/**
 * CAUSALITY CONTRACT: output[i] may depend only on bars[0..i]. No centered
 * windows, no forward shifts (Ichimoku chikou excluded), no repainting.
 * Warm-up values are NaN. Output arrays have the same length as the input.
 */
export interface IndicatorDef extends IndicatorMeta {
  compute(cols: Columns, params: Params): Record<string, Float64Array>;
}

// ───────────────────────────── Strategy blocks ─────────────────────────────
// A strategy is plain JSON built from "cards". The UI shows each node as a
// card; GA tunes numeric leaves through GeneSpec JSON pointers.

export type Operand =
  | { kind: 'price'; source: Source; offset?: number }
  | { kind: 'indicator'; id: string; params: Params; output?: string; offset?: number }
  | { kind: 'const'; value: number };
// offset = bars ago (0 = current closed bar)

export type CompareOp = '>' | '<' | '>=' | '<=';

export type CandlePattern =
  | 'bullish' | 'bearish'
  | 'ha_bullish' | 'ha_bearish'          // Heikin-Ashi colour
  | 'doji' | 'hammer' | 'shooting_star'
  | 'engulfing_bull' | 'engulfing_bear'
  | 'inside_bar' | 'outside_bar';

export type Condition =
  | { kind: 'compare'; left: Operand; op: CompareOp; right: Operand }
  | { kind: 'cross'; left: Operand; dir: 'above' | 'below'; right: Operand }
  | { kind: 'rising' | 'falling'; operand: Operand; bars: number }
  | { kind: 'candle'; pattern: CandlePattern }
  | { kind: 'time'; from: string; to: string; tz?: string } // 'HH:MM', default tz America/New_York
  | { kind: 'all'; of: Condition[] }
  | { kind: 'any'; of: Condition[] }
  | { kind: 'not'; of: Condition };

export type Distance =
  | { kind: 'atr'; mult: number; period: number }
  | { kind: 'percent'; value: number }   // % of entry price
  | { kind: 'points'; value: number };   // price units

export interface ExitRules {
  stopLoss?: Distance;
  takeProfit?: Distance | { kind: 'rr'; ratio: number }; // rr = multiple of stop distance
  trailing?: Distance;
  maxBars?: number;
  exitWhen?: Condition;     // signal exit for an open position (either side)
  flatAt?: string;          // 'HH:MM' exchange time: close everything (day-trading)
}

export type Sizing =
  | { kind: 'fixed'; qty: number }
  | { kind: 'risk'; percent: number }          // risk % of equity per trade, needs a stopLoss
  | { kind: 'percentEquity'; percent: number }; // notional % of equity

export interface GeneSpec {
  path: string;             // RFC 6901 JSON pointer into StrategySpec: "/long/enter/of/0/right/value"
  linked?: { path: string; scale?: number; offset?: number }[]; // extra leaves driven by this gene: offset + scale*v (mirror RSI 30<->70: scale -1, offset 100)
  label: string;
  min: number;
  max: number;
  step?: number;
  int?: boolean;
}

export interface StrategySpec {
  id: string;
  name: string;
  icon?: string;
  version: 1;
  long?: { enter: Condition };
  short?: { enter: Condition };
  exits: ExitRules;
  sizing: Sizing;
  genes?: GeneSpec[];
}

// ───────────────────────────── Orders, fills, positions ─────────────────────────────

export type Side = 'long' | 'short';
export type OrderAction = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop';
export type Actor = 'manual' | 'bot';

export interface OrderRequest {
  action: OrderAction;
  qty: number;
  type: OrderType;
  price?: number;           // limit / stop trigger
  stopLoss?: number;        // absolute price bracket attached on fill
  takeProfit?: number;
  trailDistance?: number;   // price units
  actor: Actor;
  tag?: string;
}

export type OrderStatus = 'working' | 'filled' | 'cancelled' | 'rejected';

export interface Order extends OrderRequest {
  id: string;
  status: OrderStatus;
  createdAt: number;        // bar time when submitted
  filledAt?: number;
  fillPrice?: number;
  reason?: string;          // reject / cancel reason
}

export interface Fill {
  orderId: string;
  t: number;
  action: OrderAction;
  qty: number;
  price: number;            // after slippage
  commission: number;
  slippage: number;         // currency cost of slippage
}

export interface Position {
  side: Side;
  qty: number;
  avgPrice: number;
  openedAt: number;
  openedIndex: number;
  stopLoss?: number;
  takeProfit?: number;
  trailDistance?: number;
  trailStop?: number;
  initialRisk?: number;     // currency at risk at entry (for R multiples)
  unrealized: number;
  mae: number;              // max adverse excursion, currency (<= 0)
  mfe: number;              // max favourable excursion, currency (>= 0)
  barsHeld: number;
  actor: Actor;
}

export type ExitReason = 'stop' | 'target' | 'trail' | 'signal' | 'manual' | 'time' | 'eod' | 'end' | 'reverse';

export interface Trade {
  id: string;
  side: Side;
  qty: number;
  entryT: number;
  entryPrice: number;
  exitT: number;
  exitPrice: number;
  pnl: number;              // net currency, after commission & slippage
  pnlPct: number;           // pnl / equity at entry * 100
  r?: number;               // R multiple when initial risk was known
  initialRisk?: number;     // currency at risk at entry (stop distance × qty × pointValue)
  commission: number;
  mae: number;
  mfe: number;
  barsHeld: number;
  exitReason: ExitReason;
  actor: Actor;
  hadStop: boolean;
}

export interface CostModel {
  commissionPerUnit: number;   // per share / per contract, each side
  commissionPerOrder: number;  // flat per order
  slippageTicks: number;       // adverse ticks on market & stop fills
  spreadTicks: number;         // half applied each side
  minCommission?: number;      // floor per order (e.g. $1 for US stocks)
}

export interface AccountState {
  t: number;
  index: number;
  cash: number;
  equity: number;
  realized: number;
  position: Position | null;
  workingOrders: Order[];
  peakEquity: number;
  drawdown: number;         // currency, >= 0
  drawdownPct: number;      // %, >= 0
}

// ───────────────────────────── Backtest results ─────────────────────────────

export interface Metrics {
  netProfit: number;
  netProfitPct: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;          // 0..1
  profitFactor: number;     // Infinity when no losses, 0 when no wins
  avgWin: number;
  avgLoss: number;          // negative
  payoff: number;           // avgWin / |avgLoss|
  expectancy: number;       // currency per trade
  expectancyR: number;      // NaN when no R available
  maxDrawdown: number;      // currency >= 0
  maxDrawdownPct: number;   // % >= 0
  sharpe: number;           // annualised, per-bar returns
  sortino: number;
  calmar: number;
  cagr: number;             // %
  exposure: number;         // 0..1 fraction of bars in market
  avgBarsHeld: number;
  maxConsecWins: number;
  maxConsecLosses: number;
  recoveryFactor: number;
  sqn: number;
}

export interface EquityPoint {
  t: number;
  equity: number;
  drawdownPct: number;
}

export interface BacktestResult {
  strategyId: string;
  symbol: string;
  timeframe: Timeframe;
  startIndex: number;
  endIndex: number;         // inclusive
  initialCash: number;
  trades: Trade[];
  equity: EquityPoint[];    // one per bar in [startIndex, endIndex]
  metrics: Metrics;
}

// ───────────────────────────── Engine events ─────────────────────────────
// The engine NEVER renders. It emits events; a UI draws them, a CLI logs them.

export type EngineEvent =
  | { type: 'bar'; index: number; bar: Bar }
  | { type: 'order'; order: Order }
  | { type: 'fill'; fill: Fill }
  | { type: 'positionOpened'; position: Position }
  | { type: 'tradeClosed'; trade: Trade }
  | { type: 'equity'; t: number; equity: number; drawdownPct: number }
  | { type: 'signal'; side: Side; action: 'enter' | 'exit'; reason: string }
  | { type: 'end'; result: BacktestResult };

export type EngineEventType = EngineEvent['type'];
export type Listener<E extends { type: string }> = (event: E) => void;

// ───────────────────────────── Optimisation ─────────────────────────────

export type FitnessKind = 'netProfit' | 'sharpe' | 'profitFactor' | 'expectancy' | 'robust';

export interface GAOptions {
  population: number;       // default 40
  generations: number;      // default 25
  eliteCount: number;       // default 2
  mutationRate: number;     // default 0.15 per gene
  crossoverRate: number;    // default 0.8
  tournamentSize: number;   // default 3
  seed: number;            // default 42
}

export interface GAGeneration {
  generation: number;
  best: number;             // best fitness seen so far (monotonic)
  mean: number;             // mean fitness of this generation
  bestGenome: number[];
}

export interface GAResult {
  bestGenome: number[];
  bestFitness: number;
  history: GAGeneration[];
  evaluations: number;
}

export interface MonteCarloOptions {
  runs: number;             // default 1000
  method: 'shuffle' | 'bootstrap' | 'skip';
  skipPct?: number;         // for 'skip': PERCENT chance each trade is dropped (default 10)
  ruinPct?: number;         // drawdown PERCENT counted as ruin (default 50)
  seed: number;
}

export interface MonteCarloResult {
  runs: number;
  finalEquity: { p5: number; p25: number; p50: number; p75: number; p95: number };
  maxDrawdownPct: { p5: number; p25: number; p50: number; p75: number; p95: number };
  probabilityOfProfit: number;   // 0..1
  riskOfRuin: number;            // 0..1
  sampleCurves: number[][];      // a few equity curves (per trade) for drawing
}

export type Grade = 'S' | 'A' | 'B' | 'C' | 'D';

export interface RobustnessReport {
  grade: Grade;
  score: number;            // 0..100
  inSample: Metrics;
  outOfSample: Metrics;
  monteCarlo: MonteCarloResult;
  walkForwardEfficiency?: number; // OOS annualised / IS annualised
  reasons: string[];        // short, friendly, one line each
}

// ───────────────────────────── Game layer ─────────────────────────────

export type Mood = 'happy' | 'excited' | 'thinking' | 'worried' | 'proud' | 'teaching' | 'cheer' | 'sleepy';

export interface Tip {
  id: string;               // stable id (for "don't show again" and cooldowns)
  mood: Mood;
  text: string;             // max ~120 chars, friendly, actionable
  priority: number;         // higher wins when several fire at once
}

export interface XpAward {
  amount: number;
  reason: string;           // "Used a stop-loss", "Lesson learned"
  icon: string;
}

export interface AchievementDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  secret?: boolean;
}

export interface LifetimeStats {
  sessions: number;
  trades: number;
  wins: number;
  losses: number;
  netProfit: number;
  bestTrade: number;
  worstTrade: number;
  tradesWithStop: number;
  biggestWinStreak: number;
  strategiesBuilt: number;
  evolutionsRun: number;
  stressTestsRun: number;
  bestGrade?: Grade;
  minutesPlayed: number;
}

export interface SessionSummary {
  id: string;
  t: number;                // when played (wall clock, supplied by caller)
  mode: 'arcade' | 'bot' | 'live';
  symbol: string;
  timeframe: Timeframe;
  metrics: Metrics;
  xpEarned: number;
  ratingDelta: number;
  /** Sum of the winning trades' P&L (gross $ won). Optional: older rows lack it. */
  grossWins?: number;
}

export interface SavedStrategy {
  spec: StrategySpec;
  createdAt: number;
  report?: RobustnessReport;
}

export interface Profile {
  id: string;
  name: string;
  createdAt: number;
  xp: number;
  level: number;
  rating: number;           // trader skill rating, starts 1000
  streakDays: number;
  lastPlayedDay?: string;   // 'YYYY-MM-DD'
  stats: LifetimeStats;
  achievements: Record<string, number>; // id -> unlocked at
  strategies: SavedStrategy[];
  history: SessionSummary[]; // most recent first, capped
  settings: { sound: boolean; music: boolean; assistant: boolean; reducedMotion: boolean };
}

/** Persistence port — implemented by the data package (files) and the web app (localStorage/IndexedDB). */
export interface ProfileStore {
  load(id: string): Promise<Profile | null>;
  save(profile: Profile): Promise<void>;
}
