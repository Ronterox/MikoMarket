#!/usr/bin/env bun
import { parseArgs } from 'node:util';
import { CliError, type Args } from './common.ts';
import {
  cmdBacktest, cmdEvolve, cmdFetch, cmdImport, cmdIndicators, cmdInstruments, cmdLeaderboard, cmdStress, cmdTemplates, cmdWalkForward,
} from './commands.ts';
import { cmdPlay } from './play.ts';
import { c, setColor } from './ui.ts';

const HELP = `${c.bold('miko')} — MikoMarket, headless

${c.bold('Data')}
  fetch        --symbol @NQ --tf 5m --bars 20000 [--from 2026-01-01 --to ...]   TradeStation → data/cache
  import       [--from <TechnicalAnalysis dir>] [--years 2]                      your CSVs → data/import
  instruments | indicators | templates                                            list them

${c.bold('Engine')}
  backtest     --symbol SPY --tf 15m --strategy <templateId | path.json> [--cash 10000]
  evolve       ... --pop 40 --gens 25 --fitness robust --seed 1 [--out best.json] [--oos 30]
  stress       ... [--runs 1000] [--seed 1]          S/A/B/C/D grade + reasons
  walkforward  ... [--windows 4] [--pop 24 --gens 12]
  play         --symbol SPY --tf 5m [--length 300] [--risk 1] [--script "b   f q"]
  leaderboard  [--week YYYY-MM-DD] [--symbol SPY,@MNQ]   weekly players + Miko's rival bots

${c.bold('Common')}
  --bars N  --from DATE  --to DATE  --offline (never call TradeStation)  --json  --no-color
  --env path/to/tradestation.env  (same as TRADESTATION_ENV_FILE)

Fitness: netProfit | sharpe | profitFactor | expectancy | robust`;

const OPTIONS = {
  symbol: { type: 'string' }, tf: { type: 'string' }, bars: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' },
  strategy: { type: 'string' }, cash: { type: 'string' }, json: { type: 'boolean' }, full: { type: 'boolean' },
  pop: { type: 'string' }, gens: { type: 'string' }, fitness: { type: 'string' }, seed: { type: 'string' }, out: { type: 'string' },
  oos: { type: 'string' }, runs: { type: 'string' }, windows: { type: 'string' }, years: { type: 'string' },
  length: { type: 'string' }, risk: { type: 'string' }, script: { type: 'string' }, profile: { type: 'string' },
  'no-save': { type: 'boolean' }, offline: { type: 'boolean' }, env: { type: 'string' }, 'no-color': { type: 'boolean' },
  verbose: { type: 'boolean' }, week: { type: 'string' }, help: { type: 'boolean', short: 'h' },
} as const;

const COMMANDS: Record<string, (args: Args) => Promise<void>> = {
  fetch: cmdFetch,
  import: cmdImport,
  instruments: cmdInstruments,
  indicators: cmdIndicators,
  templates: cmdTemplates,
  backtest: cmdBacktest,
  evolve: cmdEvolve,
  stress: cmdStress,
  walkforward: cmdWalkForward,
  'walk-forward': cmdWalkForward,
  play: cmdPlay,
  leaderboard: cmdLeaderboard,
};

export async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (err) {
    console.error(c.red((err as Error).message));
    console.error(HELP);
    return 2;
  }
  const args = parsed.values as Args;
  const [cmd] = parsed.positionals;
  if (args['no-color'] || args.json) setColor(false);
  if (typeof args.env === 'string') process.env.TRADESTATION_ENV_FILE = args.env;
  if (!cmd || args.help || cmd === 'help') {
    console.log(HELP);
    return cmd || args.help ? 0 : 1;
  }
  const run = COMMANDS[cmd];
  if (!run) {
    console.error(c.red(`Unknown command "${cmd}"`));
    console.error(HELP);
    return 2;
  }
  try {
    await run(args);
    return 0;
  } catch (err) {
    if (err instanceof CliError) console.error(c.red(err.message));
    else console.error(c.red(`${(err as Error).message}`), args.verbose ? (err as Error).stack : '');
    return 1;
  }
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
