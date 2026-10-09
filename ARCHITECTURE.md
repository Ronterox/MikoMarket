# MikoMarket — Architecture

An anime-flavoured, honest trading simulator. The **engine** does the trading. Every other
part, the web game included, is just one way to drive it and show what it reports.

```
            ┌──────────────────────── @miko/engine (pure TS, 0 deps) ───────────────────────┐
            │ indicators/  core/ (Session, broker sim)  strategy/ (block cards → compiled)  │
            │ backtest/ (runner, metrics)  optimize/ (GA, Monte Carlo, OOS, walk-forward)   │
            │ game/ (XP, levels, rating, achievements, Coach tips)    types.ts = contracts  │
            └───────────────▲──────────────────────────▲──────────────────────────▲─────────┘
                            │                          │                          │
     @miko/data (Bun/Node)  │        apps/cli          │      apps/web (Vite+React)
     TradeStation client,   │        headless:         │      engine runs in-page / in a
     CSV import, cache,     │        backtest, evolve, │      Web Worker; UI only renders
     resample, instruments  │        stress, fetch     │      EngineEvents + game state
            ▲               │                          │                          │
            └──────── apps/server (Bun.serve): /api/bars, /api/stream (SSE), /api/profile ──┘
```

## Hard rules

1. **Engine purity.** `packages/engine` imports nothing outside itself: no DOM, no `fs`, no
   `Date.now()`, no `Math.random()`. Time comes from bars, and randomness from `createRng(seed)`.
   That keeps it deterministic and lets the same code run in Bun, Node, browsers and Workers.
2. **No lookahead.** Indicators are causal (see `IndicatorDef`). Orders submitted on bar *i*
   fill on bar *i+1* or later. If a stop and a target are both touched inside one bar, the
   **stop fills first**. A gap through a stop fills at the open.
3. **Contracts live in `packages/engine/src/types.ts`.** Modules talk only through those
   types and the module index exports listed below. Change a contract there first.
4. **The UI never computes trading logic.** It renders `EngineEvent`s, `Metrics`, `Tip`s and
   `XpAward`s. Anything a headless user would also want belongs in the engine.
5. Tests: `bun test`, colocated as `*.test.ts`.

## Module APIs (index exports)

### `indicators/` → `src/indicators/index.ts`
- `INDICATORS: IndicatorDef[]`, `getIndicator(id): IndicatorDef`, `listIndicators(): IndicatorMeta[]`
- `computeIndicator(cols, id, params?): Record<string, Float64Array>` (fills defaults, memo-free)
- Primitive helpers (exported): `sma, ema, wma, rma, stdev, highest, lowest, trueRange, atr, heikinAshi`
- Catalog (at least): SMA, EMA, WMA, HMA, DEMA, TEMA, VWMA, KAMA, RSI, Stoch, StochRSI, MACD,
  CCI, ROC, Momentum, Williams %R, MFI, ADX(+DI/−DI), Aroon, ATR, NATR, Bollinger Bands
  (+%B, bandwidth), Keltner, Donchian, StdDev, SuperTrend, Parabolic SAR, Ichimoku (no chikou),
  VWAP (session-anchored), OBV, CMF, Volume SMA, Heikin-Ashi (OHLC outputs), Linear Regression
  slope, Z-Score, Chop index, Previous Day High/Low.

### `core/` → `src/core/index.ts`
- `class Session` — the one simulation loop shared by manual play, bots and backtests:
  ```ts
  new Session({ series, startIndex?, endIndex?, initialCash = 10_000, costs?, strategy?, allowShort = true })
  .index            // last CLOSED bar the player can see
  .state            // AccountState
  .trades / .equity / .done / .cols (Columns) / .series
  .on(type | '*', listener) => unsubscribe
  .step(): boolean  // reveal the next bar: fill working orders on it, mark to market at its close,
                    // then run the bot (if a strategy is set); bot orders fill on the bar after
  .submit(req: OrderRequest): Order
  .buy(qty, opts?) / .sell(qty, opts?) / .flatten(actor?) / .cancel(id) / .setBracket({stopLoss?, takeProfit?})
  .appendBar(bar)   // live mode
  .result(): BacktestResult
  ```
- `DEFAULT_COSTS: CostModel`, `costsFor(instrument): CostModel`
- `planQuickTrade(session, action, { riskPct = 1, atrMult = 2, rr = 2 })` → `{ qty, stopLoss, takeProfit }`.
  This is what the big BUY/SELL buttons use, so beginners always trade with a stop and sane size.

### `strategy/` → `src/strategy/index.ts`
- `compileStrategy(spec, cols): CompiledStrategy` with `longEntry(i)`, `shortEntry(i)`,
  `exitSignal(i)`, `stopDistance(i, entry)`, `targetDistance(i, entry)`, `trailDistance(i)`, `flatAt`, `maxBars`
- `validateStrategy(spec): string[]` (empty = OK)
- `getAtPointer(obj, path)`, `setAtPointer(obj, path, value)` (immutable), `applyGenome(spec, values)` using `spec.genes`
- `describeCondition(c): string` / `describeStrategy(spec): string[]` — plain-English one-liners
- `BLOCK_CATALOG` — card definitions for the builder UI (id, icon, label, a template Condition, and genes)
- `STRATEGY_TEMPLATES: StrategySpec[]` — 6–10 classic starters (EMA cross, RSI bounce, BB mean
  reversion, Donchian breakout, SuperTrend follow, HA trend + EMA filter, MACD momentum, RKBB-style BB+HA)
- `autoGenes(spec): GeneSpec[]` — derive sensible genes from the numeric leaves of a spec

### `backtest/` → `src/backtest/index.ts`
- `runBacktest(series, spec, { startIndex?, endIndex?, initialCash?, costs?, onEvent? }): BacktestResult`
- `computeMetrics(trades, equity, initialCash, timeframe): Metrics`
- `emptyMetrics(): Metrics`

### `optimize/` → `src/optimize/index.ts`
- `evolve(genes, fitness: (values) => number, opts?: Partial<GAOptions>, onGeneration?): GAResult`. Generic, knows nothing about trading.
- `monteCarlo(trades, initialCash, opts?: Partial<MonteCarloOptions>): MonteCarloResult`
- `fitnessOf(metrics, kind: FitnessKind): number`. `robust` penalises few trades and deep drawdowns.
- `splitInOut(series, oosFraction = 0.3)` → `{ inSample: [start, end], outOfSample: [start, end] }`
- `evolveStrategy(series, spec, { fitness?, ga?, oosFraction?, onGeneration? })` → `{ best: StrategySpec, ga: GAResult, inSample: BacktestResult, outOfSample: BacktestResult }`
- `walkForward(series, spec, { windows = 4, oosFraction = 0.25, ga? })` → `{ segments, oosTrades, efficiency }`
- `stressTest(series, spec, { oosFraction?, monteCarlo? }): RobustnessReport` → S/A/B/C/D grade plus friendly reasons

### `game/` → `src/game/index.ts`
- `createProfile(id, name, now): Profile`
- `xpForLevel(level)`, `levelForXp(xp)`, `rankFor(level) → { title, icon, color }`
- `awardTrade(trade, ctx): XpAward[]`. Process beats outcome: XP for using stops, sane risk and
  following the plan, and "lesson" XP for disciplined losses. Losing never means a dead end.
- `applySession(profile, input, now)` → `{ profile, awards, achievements: AchievementDef[], levelUp?: number, ratingDelta }` (pure, returns a new profile)
- `ratingUpdate(profile, metrics, mode)`: a skill rating (start 1000) that rewards risk-adjusted consistency, not luck
- `ACHIEVEMENTS: AchievementDef[]` plus `checkAchievements(profile, ctx)`
- `class Coach`: `observe(event: EngineEvent, ctx): Tip | null` and `onReport(report)`, `onSessionEnd(...)`,
  with cooldowns. It is Miko the assistant's brain: short, warm, correct tips.
- `dailyStreak(profile, today)`

## Packages and apps

- `@miko/data`: `TradeStationClient` (OAuth refresh-token flow, `barcharts`, `streamBars`),
  `loadCsv(path)` (TradeStation export, SQX `yyyy.mm.dd,hh:mm`, IB-style CSV), `resample`,
  `INSTRUMENTS`, `BarCache` (JSON files under `data/cache/`), `FileProfileStore`.
  Config is read from env (`TRADESTATION_API_KEY`, `TRADESTATION_SECRET`, `TRADESTATION_TOKEN`
  pointing at a token.json holding a `refresh_token`). `getBars()` falls back to the cache and
  then to imported CSVs, so the game works offline.
- `apps/cli`: `miko fetch | import | backtest | evolve | stress | walkforward | play`. JSON output with `--json`.
- `apps/server`: Bun.serve. `GET /api/instruments`, `GET /api/bars?symbol&tf&bars`,
  `GET /api/stream?symbol&tf` (SSE live bars), `GET|PUT /api/profile/:id`, and the built web app.
- `apps/web`: Vite + React + TradingView `lightweight-charts`. Mobile-first and portrait-friendly,
  with 3 tabs (Play, Bot Lab, Me) and a few big buttons. Sounds are synthesised with WebAudio, so
  there are no asset files. Effects run on canvas and CSS. Miko is an inline SVG character with moods.
