import { readdirSync, writeFileSync } from 'node:fs';
import {
  RIVALS_LABEL, rankLeaderboard, rivalEntries, weekKey, weeklyStats, weeksWithData, type BarSeries, type LeaderboardEntry,
  STRATEGY_TEMPLATES, costsFor, describeStrategy, evolveStrategy, getAtPointer, listIndicators, runBacktest,
  stressTest, walkForward, type BacktestResult, type FitnessKind, type Metrics, type StrategySpec,
} from '@miko/engine';
import {
  FileProfileStore, getBars, isValidProfileId,
  BarCache, DEFAULT_TECHNICAL_ANALYSIS_DIR, INSTRUMENTS, TradeStationClient, availableTimeframes, dataPaths,
  importFromTechnicalAnalysis, listDatasets, parseTimeframe, tradeStationConfig, type LoadedSeries,
} from '@miko/data';
import { CliError, int, loadSeries, resolveStrategy, str, toJson, type Args } from './common.ts';
import { GRADE_COLOR, bar, c, date, day, kv, money, num, pct, signedMoney, signedPct, table } from './ui.ts';

const FITNESS: FitnessKind[] = ['netProfit', 'sharpe', 'profitFactor', 'expectancy', 'robust'];

function out(args: Args, json: unknown, human: () => void): void {
  if (args.json) console.log(toJson(json));
  else human();
}

function seriesLine(s: LoadedSeries): string {
  const first = s.bars[0]?.t ?? 0;
  const last = s.bars[s.bars.length - 1]?.t ?? 0;
  const src = s.derivedFrom ? `${s.source}, resampled from ${s.derivedFrom}` : s.source;
  return `${c.bold(s.instrument.symbol)} ${s.instrument.emoji ?? ''} ${s.timeframe}  ${s.bars.length.toLocaleString()} bars  ${c.gray(`${date(first)} → ${date(last)} UTC (${src})`)}`;
}

function metricsPairs(m: Metrics): [string, string][] {
  return [
    ['Net profit', `${signedMoney(m.netProfit)} (${signedPct(m.netProfitPct)})`],
    ['Trades', `${m.trades} (${m.wins} W / ${m.losses} L)`],
    ['Win rate', pct(m.winRate * 100, 1)],
    ['Profit factor', num(m.profitFactor)],
    ['Payoff', num(m.payoff)],
    ['Expectancy', `${money(m.expectancy)} / trade  (${num(m.expectancyR)} R)`],
    ['Max drawdown', `${money(m.maxDrawdown)} (${pct(m.maxDrawdownPct)})`],
    ['Sharpe / Sortino', `${num(m.sharpe)} / ${num(m.sortino)}`],
    ['CAGR', pct(m.cagr)],
    ['Exposure', pct(m.exposure * 100, 1)],
    ['SQN', num(m.sqn)],
  ];
}

function compareTable(a: Metrics, b: Metrics, la: string, lb: string): string {
  const row = (k: string, f: (m: Metrics) => string): string[] => [k, f(a), f(b)];
  return table(['Metric', `>${la}`, `>${lb}`], [
    row('Net profit', (m) => signedMoney(m.netProfit)),
    row('Trades', (m) => String(m.trades)),
    row('Win rate', (m) => pct(m.winRate * 100, 1)),
    row('Profit factor', (m) => num(m.profitFactor)),
    row('Max DD %', (m) => pct(m.maxDrawdownPct)),
    row('Sharpe', (m) => num(m.sharpe)),
    row('Expectancy', (m) => money(m.expectancy)),
  ]);
}

function genesOf(spec: StrategySpec): { label: string; value: unknown }[] {
  return (spec.genes ?? []).map((g) => ({ label: g.label, value: getAtPointer(spec, g.path) }));
}

function runOpts(args: Args, s: LoadedSeries): { initialCash: number; costs: ReturnType<typeof costsFor> } {
  return { initialCash: int(args, 'cash', 10_000)!, costs: costsFor(s.instrument) };
}

function gaOpts(args: Args): { population: number; generations: number; seed: number } {
  return { population: int(args, 'pop', 40)!, generations: int(args, 'gens', 25)!, seed: int(args, 'seed', 1)! };
}

function fitnessArg(args: Args): FitnessKind {
  const f = str(args, 'fitness', 'robust') as FitnessKind;
  if (!FITNESS.includes(f)) throw new CliError(`--fitness must be one of ${FITNESS.join(', ')}`);
  return f;
}

// ───────────────────────────── data commands ─────────────────────────────

export async function cmdFetch(args: Args): Promise<void> {
  const symbol = str(args, 'symbol', 'SPY')!;
  const tf = parseTimeframe(str(args, 'tf', '5m')!);
  const client = TradeStationClient.fromEnv();
  if (!client) throw new CliError(`TradeStation is not configured: ${tradeStationConfig().reason}`);
  const bars = int(args, 'bars', 20_000)!;
  const from = str(args, 'from');
  const to = str(args, 'to');
  if (!args.json) console.error(c.gray(`fetching ${symbol} ${tf} from TradeStation (${from ? `${from} → ${to ?? 'now'}` : `${bars} bars`})...`));
  const fresh = await client.fetchBars(symbol, tf, from ? { from, to } : { bars, to });
  const merged = await new BarCache(dataPaths().cache).merge(symbol, tf, fresh);
  const info = { symbol: symbol.toUpperCase(), timeframe: tf, fetched: fresh.length, cached: merged.length, from: merged[0]?.t, to: merged[merged.length - 1]?.t };
  out(args, info, () => {
    console.log(`${c.green('✓')} ${c.bold(info.symbol)} ${tf}: fetched ${fresh.length.toLocaleString()} bars, cache now ${merged.length.toLocaleString()} ` +
      c.gray(`(${info.from ? date(info.from) : '-'} → ${info.to ? date(info.to) : '-'} UTC)`));
  });
}

export async function cmdImport(args: Args): Promise<void> {
  const from = str(args, 'from', DEFAULT_TECHNICAL_ANALYSIS_DIR)!;
  const years = int(args, 'years', 2)!;
  const started = Date.now();
  const report = await importFromTechnicalAnalysis(from, {
    years,
    onProgress: (m) => { if (!args.json && (args.verbose || !m.startsWith('  '))) console.error(c.gray(m)); },
  });
  out(args, report, () => {
    console.log(`${c.bold('Imported')} from ${report.root} into ${dataPaths().import} ${c.gray(`in ${((Date.now() - started) / 1000).toFixed(1)}s`)}`);
    console.log(table(['Symbol', 'TF', '>Bars', 'From', 'To', '>Files', 'Note'], report.datasets.map((d) => [
      c.bold(d.symbol), d.timeframe, d.bars.toLocaleString(), day(d.from), day(d.to), d.files, d.derivedFrom ? c.gray(`resampled from ${d.derivedFrom}`) : '',
    ])));
    if (report.skipped.length) console.log(c.gray(`\nSkipped ${report.skipped.length} non-bar files (trade lists etc.). Use --verbose --json to see them.`));
  });
}

export async function cmdInstruments(args: Args): Promise<void> {
  const avail = availableTimeframes(await listDatasets());
  out(args, INSTRUMENTS.map((i) => ({ ...i, offline: avail[i.symbol] ?? [] })), () => {
    console.log(table(['', 'Symbol', 'Name', 'Kind', '>Point $', '>Tick', 'Offline data'], INSTRUMENTS.map((i) => [
      i.emoji ?? '', c.bold(i.symbol), i.name, i.kind, i.pointValue, i.tickSize, (avail[i.symbol] ?? []).join(' ') || c.gray('none'),
    ])));
    const extra = Object.keys(avail).filter((s) => !INSTRUMENTS.some((i) => i.symbol === s));
    if (extra.length) console.log(c.gray(`\nAlso available offline: ${extra.map((s) => `${s} (${avail[s]!.join(' ')})`).join(', ')}`));
  });
}

export async function cmdIndicators(args: Args): Promise<void> {
  const list = listIndicators();
  out(args, list, () => {
    console.log(table(['', 'Id', 'Name', 'Category', 'Params', 'What it tells you'], list.map((m) => [
      m.icon, c.bold(m.id), m.name, m.category, m.params.map((p) => `${p.key}=${p.default}`).join(' '), c.gray(m.blurb),
    ])));
  });
}

export async function cmdTemplates(args: Args): Promise<void> {
  out(args, STRATEGY_TEMPLATES, () => {
    for (const t of STRATEGY_TEMPLATES) {
      console.log(`${t.icon ?? '•'} ${c.bold(t.name)} ${c.gray(t.id)}`);
      for (const line of describeStrategy(t)) console.log(`    ${line}`);
    }
  });
}

// ───────────────────────────── engine commands ─────────────────────────────

function printBacktest(s: LoadedSeries, spec: StrategySpec, r: BacktestResult): void {
  console.log(seriesLine(s));
  console.log(`${spec.icon ?? '•'} ${c.bold(spec.name)} ${c.gray(`${spec.id}, bars ${r.startIndex}..${r.endIndex}`)}\n`);
  console.log(kv(metricsPairs(r.metrics)));
  if (r.trades.length) {
    console.log(`\n${c.bold('Last trades')}`);
    console.log(table(['Side', 'Entry (UTC)', '>Entry', '>Exit', '>Qty', '>P&L', '>R', 'Exit'], r.trades.slice(-10).map((t) => [
      t.side === 'long' ? c.green('long') : c.red('short'), date(t.entryT), num(t.entryPrice), num(t.exitPrice), t.qty, signedMoney(t.pnl), num(t.r), t.exitReason,
    ])));
  }
}

export async function cmdBacktest(args: Args): Promise<void> {
  const s = await loadSeries(args);
  const spec = resolveStrategy(str(args, 'strategy'));
  const r = runBacktest(s, spec, runOpts(args, s));
  out(args, { symbol: s.instrument.symbol, timeframe: s.timeframe, source: s.source, bars: s.bars.length, strategy: spec, result: { ...r, equity: args.full ? r.equity : undefined } }, () => printBacktest(s, spec, r));
}

export async function cmdEvolve(args: Args): Promise<void> {
  const s = await loadSeries(args);
  const spec = resolveStrategy(str(args, 'strategy'));
  const ga = gaOpts(args);
  const fitness = fitnessArg(args);
  if (!args.json) {
    console.log(seriesLine(s));
    console.log(`🧬 Evolving ${c.bold(spec.name)}: population ${ga.population}, ${ga.generations} generations, fitness ${fitness}, seed ${ga.seed}\n`);
  }
  const started = Date.now();
  const res = evolveStrategy(s, spec, {
    ...runOpts(args, s),
    fitness,
    ga,
    oosFraction: int(args, 'oos') !== undefined ? int(args, 'oos')! / 100 : undefined,
    onGeneration: (g) => {
      if (args.json) return;
      const line = `  gen ${String(g.generation + 1).padStart(3)}/${ga.generations} ${bar((g.generation + 1) / ga.generations)} best ${num(g.best, 3).padStart(9)}  mean ${num(g.mean, 3).padStart(9)}`;
      if (process.stdout.isTTY) process.stdout.write(`\r${line}`);
      else console.log(line);
    },
  });
  if (process.stdout.isTTY && !args.json) process.stdout.write('\n');
  const outPath = str(args, 'out');
  if (outPath) writeFileSync(outPath, toJson(res.best));
  out(args, { best: res.best, ga: res.ga, inSample: res.inSample.metrics, outOfSample: res.outOfSample.metrics }, () => {
    console.log(`\n${c.bold('Best genes')} ${c.gray(`(fitness ${num(res.ga.bestFitness, 3)}, ${res.ga.evaluations} backtests, ${((Date.now() - started) / 1000).toFixed(1)}s)`)}`);
    console.log(kv(genesOf(res.best).map((g) => [g.label, typeof g.value === 'number' ? num(g.value, 2) : String(g.value)])));
    console.log(`\n${compareTable(res.inSample.metrics, res.outOfSample.metrics, 'In-sample', 'Out-of-sample')}`);
    const oos = res.outOfSample.metrics;
    console.log(oos.netProfit > 0
      ? c.green('\nIt also made money on data it never saw. Next: run `stress` on it.')
      : c.yellow('\nIt did not hold up on unseen data. That is the honest answer: try another idea or fewer knobs.'));
    if (outPath) console.log(c.gray(`Saved best strategy to ${outPath}`));
  });
}

export async function cmdStress(args: Args): Promise<void> {
  const s = await loadSeries(args);
  const spec = resolveStrategy(str(args, 'strategy'));
  const rep = stressTest(s, spec, {
    ...runOpts(args, s),
    oosFraction: int(args, 'oos') !== undefined ? int(args, 'oos')! / 100 : undefined,
    monteCarlo: { seed: int(args, 'seed', 1)!, runs: int(args, 'runs', 1000)! },
  });
  out(args, rep, () => {
    console.log(seriesLine(s));
    console.log(`${spec.icon ?? '•'} ${c.bold(spec.name)}\n`);
    const paint = GRADE_COLOR[rep.grade] ?? ((x: string) => x);
    console.log(`  Grade ${paint(` ${rep.grade} `)}  score ${num(rep.score, 0)}/100 ${bar(rep.score / 100)}\n`);
    for (const r of rep.reasons) console.log(`  • ${r}`);
    console.log(`\n${compareTable(rep.inSample, rep.outOfSample, 'In-sample', 'Out-of-sample')}`);
    const mc = rep.monteCarlo;
    console.log(`\n${c.bold('Monte Carlo')} ${c.gray(`(${mc.runs} bootstrap resamples of the trades)`)}`);
    console.log(kv([
      ['Final equity p5 / p50 / p95', `${money(mc.finalEquity.p5, 0)} / ${money(mc.finalEquity.p50, 0)} / ${money(mc.finalEquity.p95, 0)}`],
      ['Max drawdown p50 / p95', `${pct(mc.maxDrawdownPct.p50)} / ${pct(mc.maxDrawdownPct.p95)}`],
      ['Chance of profit', pct(mc.probabilityOfProfit * 100, 1)],
      ['Risk of ruin', pct(mc.riskOfRuin * 100, 1)],
    ]));
  });
}

export async function cmdWalkForward(args: Args): Promise<void> {
  const s = await loadSeries(args);
  const spec = resolveStrategy(str(args, 'strategy'));
  const ga = gaOpts(args);
  if (!args.json) console.error(c.gray(`walk-forward: ${int(args, 'windows', 4)} windows, GA ${ga.population}x${ga.generations} each...`));
  const res = walkForward(s, spec, {
    ...runOpts(args, s),
    windows: int(args, 'windows', 4),
    oosFraction: int(args, 'oos') !== undefined ? int(args, 'oos')! / 100 : undefined,
    fitness: fitnessArg(args),
    ga,
  });
  out(args, res, () => {
    console.log(seriesLine(s));
    console.log(`${spec.icon ?? '•'} ${c.bold(spec.name)}  walk-forward\n`);
    const t = (i: number): string => day(s.bars[Math.min(i, s.bars.length - 1)]?.t ?? 0);
    console.log(table(['#', 'Optimised on', 'Tested on', '>IS net', '>OOS net', '>OOS trades', '>OOS PF'], res.segments.map((g, i) => [
      i + 1, `${t(g.inSample[0])} → ${t(g.inSample[1])}`, `${t(g.outOfSample[0])} → ${t(g.outOfSample[1])}`,
      signedMoney(g.inSampleMetrics.netProfit), signedMoney(g.outOfSampleMetrics.netProfit), g.outOfSampleMetrics.trades, num(g.outOfSampleMetrics.profitFactor),
    ])));
    const oosNet = res.oosTrades.reduce((a, tr) => a + tr.pnl, 0);
    console.log(`\n  Out-of-sample: ${res.oosTrades.length} trades, ${signedMoney(oosNet)}`);
    const eff = res.efficiency;
    const effStr = Number.isFinite(eff) ? pct(eff * 100, 0) : 'n/a';
    console.log(`  Walk-forward efficiency: ${eff >= 0.5 ? c.green(effStr) : eff > 0 ? c.yellow(effStr) : c.red(effStr)} ${c.gray('(>50% is good: unseen periods kept most of the optimised edge)')}`);
  });
}

// ───────────────────────────── leaderboard ─────────────────────────────

export async function cmdLeaderboard(args: Args): Promise<void> {
  const q = str(args, 'week');
  if (q && !/^\d{4}-\d{2}-\d{2}$/.test(q)) throw new CliError('--week must be YYYY-MM-DD');
  const week = weekKey(q ? Date.parse(`${q}T12:00:00Z`) : Date.now());
  const series: BarSeries[] = [];
  for (const symbol of (str(args, 'symbol') ?? 'SPY,@MNQ').split(',')) {
    try {
      const s = await getBars({ symbol: symbol.trim(), timeframe: '5m' }, { client: args.offline ? null : undefined, log: () => {} });
      if (s.bars.length) series.push(s);
    } catch { /* no data for this symbol */ }
  }
  const weeks = weeksWithData(series);
  const dataWeek = weeks.includes(week) ? week : (weeks.find((w) => w < week) ?? weeks[0] ?? null);
  const store = new FileProfileStore();
  const players: LeaderboardEntry[] = [];
  let files: string[] = [];
  try { files = readdirSync(store.dir); } catch { /* no profiles yet */ }
  for (const f of files) {
    const id = f.replace(/\.json$/, '');
    if (!f.endsWith('.json') || !isValidProfileId(id)) continue;
    try {
      const p = await store.load(id);
      const e = p && Array.isArray(p.history) ? weeklyStats(p, week) : null;
      if (e) players.push(e);
    } catch { /* unreadable profile */ }
  }
  const entries = rankLeaderboard([...players, ...(dataWeek ? rivalEntries(series, dataWeek) : [])]);
  out(args, { week, dataWeek, entries }, () => {
    console.log(`${c.bold('Weekly leaderboard')} — week of ${week}`);
    if (dataWeek !== week) console.log(c.gray(dataWeek ? `No market data for that week: ${RIVALS_LABEL} traded the week of ${dataWeek}.` : 'No market data: the rival bots are resting.'));
    console.log(table(['>#', '', 'Name', 'Kind', '>Trades', '>Win rate', '>Profit', '>Winnings'], entries.map((e) => [
      e.rank ?? c.gray('-'), e.avatar ?? '', c.bold(e.name) + (e.strategy ? c.gray(` (${e.strategy})`) : ''),
      e.kind === 'rival' ? c.gray('bot') : 'player', e.trades, pct(e.winRate * 100, 0), signedMoney(e.profit), money(e.winnings),
    ])));
    console.log(c.gray(`${RIVALS_LABEL}: real backtests of the starter templates, $10,000 each on ${series.map((s) => s.instrument.symbol).join(' + ') || 'no data'} 5m. Fewer than 3 trades = unranked.`));
  });
}
