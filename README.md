# MikoMarket 🌸📈

A trading simulator that plays like an anime mobile game and runs on real market data. You trade
real history, build bots from cards, evolve them with a genetic algorithm, and stress-test them
with Monte Carlo and out-of-sample data. Miko, the assistant, cheers you on and teaches good habits.

The trading engine is a headless TypeScript library. The web game is one skin over it and the CLI
is another. See [ARCHITECTURE.md](ARCHITECTURE.md).

## Quick start

```bash
bun install
bun run cli import                 # pull your TechnicalAnalysis CSVs into data/import (offline play)
cd apps/web && bunx vite build && cd ../..
bun apps/server/src/main.ts        # http://localhost:8787  (API + game)
```

Dev mode with hot reload: run `bun apps/server/src/main.ts` and `cd apps/web && bunx vite`
(http://localhost:5173, proxies `/api`).

### Real TradeStation data

```bash
export TRADESTATION_ENV_FILE=/path/to/your.env   # holds TRADESTATION_API_KEY / _SECRET; token.json next to it
bun run cli fetch --symbol @NQ --tf 5m --bars 20000
```

When TradeStation is configured, the server fetches live bars and streams them (`/api/stream`). The
refreshed token is written back atomically, so other tools that share `token.json` keep working.
Micro futures (@MNQ, @MES…) are priced from their full-size contract when they have no data of their own.

## Headless CLI

```bash
bun run cli templates
bun run cli backtest --symbol SPY --tf 15m --strategy rkbb
bun run cli evolve   --symbol SPY --tf 15m --strategy rsi_bounce --pop 40 --gens 25 --out best.json
bun run cli stress   --symbol @MNQ --tf 15m --strategy best.json     # S/A/B/C/D grade + reasons
bun run cli walkforward --symbol @MNQ --tf 1h --strategy ema_cross
bun run cli play     --symbol SPY --tf 5m                            # terminal trading: b / s / f / space / q
```

Add `--json` for machine-readable output.

## Tests

```bash
bun run test        # engine, data, CLI, server
bun run typecheck
```

## Honesty rules the engine enforces

- Orders fill on the next bar, with slippage, spread and commissions.
- If the stop and the target are both hit inside one bar, the stop wins. A gap through a stop fills at the open.
- Indicators are causal, and a test checks every one of them for lookahead.
- The genetic algorithm only ever sees in-sample data. Grades are capped when the bot loses on the
  training data, on the unseen data, or in most Monte Carlo replays.
