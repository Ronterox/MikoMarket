import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { TIMEFRAME_MS, type Bar, type BarSeries, type Timeframe } from '@miko/engine';
import { BarCache, symbolFileKey, type DatasetInfo } from './cache.ts';
import { loadCsv } from './csv.ts';
import { instrumentFor } from './instruments.ts';
import { dataPaths } from './paths.ts';
import { mergeBars, resample } from './resample.ts';
import { TIMEFRAMES } from './timeframes.ts';
import { TradeStationClient, tradeStationConfig } from './tradestation.ts';

export interface GetBarsQuery {
  symbol: string;
  timeframe: Timeframe;
  /** Keep only the most recent N bars (after from/to filtering). */
  bars?: number;
  from?: number;
  to?: number;
}

export interface GetBarsOptions {
  dataDir?: string;
  /** TradeStation client; undefined = from env, null = never go online. */
  client?: TradeStationClient | null;
  /** Skip a remote fetch when the same symbol/timeframe was fetched this recently. Default 30s. */
  remoteTtlMs?: number;
  log?: (message: string) => void;
}

export type BarSource = 'tradestation' | 'cache' | 'import';

export interface LoadedSeries extends BarSeries {
  source: BarSource;
  /** Set when the bars were resampled from a finer stored timeframe. */
  derivedFrom?: Timeframe;
}

export interface OfflineDataset extends DatasetInfo {
  source: 'cache' | 'import';
}

const lastRemote = new Map<string, number>();
const derivedMemo = new Map<string, Bar[]>();
const csvMemo = new Map<string, { mtimeMs: number; bars: Bar[] }>();
const MEMO_LIMIT = 24;

function remember(key: string, bars: Bar[]): void {
  if (derivedMemo.size >= MEMO_LIMIT) derivedMemo.delete(derivedMemo.keys().next().value!);
  derivedMemo.set(key, bars);
}

function slice(bars: readonly Bar[], q: GetBarsQuery): Bar[] {
  let lo = 0;
  let hi = bars.length;
  if (q.from !== undefined) while (lo < hi && bars[lo]!.t < q.from) lo++;
  if (q.to !== undefined) while (hi > lo && bars[hi - 1]!.t > q.to) hi--;
  if (q.bars !== undefined && q.bars > 0 && hi - lo > q.bars) lo = hi - q.bars;
  return bars.slice(lo, hi);
}

/**
 * Stored bars for an exact symbol/timeframe. When both the cache (fetched) and
 * the import (history) hold some, they are merged so a small fresh fetch does
 * not hide a long imported history; cache bars win on equal t.
 */
async function exactOffline(cache: BarCache, imports: BarCache, symbol: string, tf: Timeframe): Promise<{ bars: Bar[]; source: 'cache' | 'import' } | null> {
  const fetched = await cache.read(symbol, tf);
  const history = await imports.read(symbol, tf);
  if (fetched?.length && history?.length) {
    const key = `merge|${cache.file(symbol, tf)}|${fetched.length}|${fetched[fetched.length - 1]!.t}|${history.length}|${history[history.length - 1]!.t}`;
    let bars = derivedMemo.get(key);
    if (!bars) { bars = mergeBars(history, fetched); remember(key, bars); }
    return { bars, source: 'cache' };
  }
  if (fetched?.length) return { bars: fetched, source: 'cache' };
  if (history?.length) return { bars: history, source: 'import' };
  return null;
}

/** Raw CSVs dropped into data/import/ as <SYMBOL>_<tf>.csv. */
async function importCsvs(dir: string): Promise<{ symbol: string; timeframe: Timeframe; file: string }[]> {
  let names: string[];
  try { names = await readdir(dir); } catch { return []; }
  const out: { symbol: string; timeframe: Timeframe; file: string }[] = [];
  for (const name of names) {
    const m = /^(.+)_([0-9]+[mhdw])\.csv$/i.exec(name);
    if (m && (TIMEFRAMES as string[]).includes(m[2]!.toLowerCase())) {
      out.push({ symbol: m[1]!.toUpperCase(), timeframe: m[2]!.toLowerCase() as Timeframe, file: join(dir, name) });
    }
  }
  return out;
}

async function readImportCsv(file: string, symbol: string, tf: Timeframe): Promise<Bar[]> {
  const st = await stat(file);
  const hit = csvMemo.get(file);
  if (hit && hit.mtimeMs === st.mtimeMs) return hit.bars;
  const series = await loadCsv(file, { symbol, timeframe: tf });
  csvMemo.set(file, { mtimeMs: st.mtimeMs, bars: series.bars });
  return series.bars;
}

/** Everything available without going online (cache first, then import). */
export async function listDatasets(dataDir?: string): Promise<OfflineDataset[]> {
  const paths = dataPaths(dataDir);
  const cache = (await new BarCache(paths.cache).list()).map((d) => ({ ...d, source: 'cache' as const }));
  const imported = (await new BarCache(paths.import).list()).map((d) => ({ ...d, source: 'import' as const }));
  const csvs = (await importCsvs(paths.import)).map((c) => ({ ...c, bars: -1, from: 0, to: 0, source: 'import' as const }));
  return [...cache, ...imported, ...csvs];
}

/** Timeframes each symbol can be served in offline, including ones derivable by resampling. */
export function availableTimeframes(datasets: readonly { symbol: string; timeframe: Timeframe }[]): Record<string, Timeframe[]> {
  const out: Record<string, Timeframe[]> = {};
  for (const d of datasets) {
    const src = TIMEFRAME_MS[d.timeframe];
    const set = new Set(out[d.symbol] ?? []);
    for (const tf of TIMEFRAMES) if (TIMEFRAME_MS[tf] >= src && (TIMEFRAME_MS[tf] % src === 0 || TIMEFRAME_MS[tf] >= TIMEFRAME_MS['1d'])) set.add(tf);
    out[d.symbol] = TIMEFRAMES.filter((tf) => set.has(tf));
  }
  return out;
}

function howToGetData(symbol: string, tf: Timeframe, available: Record<string, Timeframe[]>, tsReason?: string): string {
  const have = Object.entries(available).map(([s, tfs]) => `${s} (${tfs.join(', ')})`).join('; ') || 'nothing yet';
  return [
    `No bars for ${symbol} ${tf}.`,
    'Ways to get some:',
    `  1. TradeStation: set TRADESTATION_ENV_FILE=/path/to/your.env (or TRADESTATION_API_KEY, TRADESTATION_SECRET, TRADESTATION_TOKEN) and run: bun apps/cli/src/main.ts fetch --symbol ${symbol} --tf ${tf} --bars 20000` +
      (tsReason ? `\n     (TradeStation is not available: ${tsReason})` : ''),
    '  2. Import your existing CSVs: bun apps/cli/src/main.ts import --from /path/to/TechnicalAnalysis',
    `  3. Drop a CSV (IB, SQX or TradeStation export) into data/import/${symbolFileKey(symbol)}_${tf}.csv`,
    `Available offline: ${have}`,
  ].join('\n');
}

/**
 * Micro futures track their full-size contract tick for tick (same index, smaller
 * point value), so when a micro has no data of its own we serve the parent's
 * prices under the micro's instrument. This is what makes futures playable on a
 * $10k account: one NQ point is $20, one MNQ point is $2.
 */
export const PRICE_PROXIES: Record<string, string> = { '@MNQ': '@NQ', '@MES': '@ES', '@MYM': '@YM', '@M2K': '@RTY', '@MGC': '@GC', '@MCL': '@CL' };

export interface ProxiedSeries extends LoadedSeries {
  /** Set when prices came from the full-size contract. */
  pricedFrom?: string;
}

export async function getBars(q: GetBarsQuery, opts: GetBarsOptions = {}): Promise<ProxiedSeries> {
  const instrument = instrumentFor(q.symbol);
  const parent = PRICE_PROXIES[instrument.symbol];
  try {
    return await getBarsExact(q, opts);
  } catch (err) {
    if (!parent) throw err;
    const series = await getBarsExact({ ...q, symbol: parent }, opts);
    return { ...series, instrument, pricedFrom: parent };
  }
}

/** Symbols playable offline through a price proxy, alongside the real datasets. */
export function withProxies<T extends { symbol: string }>(datasets: readonly T[]): T[] {
  const out = [...datasets];
  for (const [micro, parent] of Object.entries(PRICE_PROXIES)) {
    const parentKey = symbolFileKey(parent);
    if (datasets.some((d) => d.symbol === micro || d.symbol === symbolFileKey(micro))) continue;
    for (const d of datasets) if (d.symbol === parent || d.symbol === parentKey) out.push({ ...d, symbol: d.symbol === parent ? micro : symbolFileKey(micro) });
  }
  return out;
}

/**
 * Bars for a symbol/timeframe: TradeStation (when configured; the result is
 * merged into the cache), else the cache, else imported data, resampling from
 * a finer stored timeframe when needed. Throws an Error explaining how to get
 * data when nothing is available.
 */
async function getBarsExact(q: GetBarsQuery, opts: GetBarsOptions): Promise<LoadedSeries> {
  const instrument = instrumentFor(q.symbol);
  const symbol = instrument.symbol;
  const tf = q.timeframe;
  if (!TIMEFRAME_MS[tf]) throw new Error(`Unknown timeframe "${tf}". Use one of: ${TIMEFRAMES.join(', ')}`);
  const paths = dataPaths(opts.dataDir);
  const cache = new BarCache(paths.cache);
  const imports = new BarCache(paths.import);
  const log = opts.log ?? ((m: string) => console.error(m));

  // 1. TradeStation
  let tsReason: string | undefined;
  const client = opts.client === undefined ? TradeStationClient.fromEnv() : opts.client;
  if (opts.client === undefined && !client) tsReason = tradeStationConfig().reason;
  if (client) {
    const key = `${client.config.baseUrl}|${symbol}|${tf}|${q.bars ?? ''}|${q.from ?? ''}|${q.to ?? ''}`;
    const ttl = opts.remoteTtlMs ?? 30_000;
    const recent = (lastRemote.get(key) ?? 0) > Date.now() - ttl;
    if (!recent) {
      try {
        const fresh = await client.fetchBars(symbol, tf, { bars: q.bars ?? 5000, from: q.from, to: q.to });
        lastRemote.set(key, Date.now());
        if (fresh.length) {
          await cache.merge(symbol, tf, fresh);
          const merged = await exactOffline(cache, imports, symbol, tf);
          return { instrument, timeframe: tf, bars: slice(merged?.bars ?? fresh, q), source: 'tradestation' };
        }
      } catch (err) {
        tsReason = (err as Error).message;
        log(`TradeStation unavailable for ${symbol} ${tf}, using offline data: ${tsReason}`);
      }
    }
  }

  // 2. exact timeframe offline: cache, then import (JSON, then raw CSV)
  const exact = await exactOffline(cache, imports, symbol, tf);
  if (exact) return { instrument, timeframe: tf, bars: slice(exact.bars, q), source: exact.source };
  const csvs = (await importCsvs(paths.import)).filter((c) => c.symbol === symbolFileKey(symbol));
  const exactCsv = csvs.find((c) => c.timeframe === tf);
  if (exactCsv) {
    const bars = await readImportCsv(exactCsv.file, symbol, tf);
    if (bars.length) return { instrument, timeframe: tf, bars: slice(bars, q), source: 'import' };
  }

  // 3. resample from the coarsest finer timeframe that divides this one
  const datasets = await listDatasets(opts.dataDir);
  const target = TIMEFRAME_MS[tf];
  const finer = datasets
    .filter((d) => d.symbol === symbolFileKey(symbol) || d.symbol === symbol)
    .filter((d) => {
      const src = TIMEFRAME_MS[d.timeframe];
      return src < target && (target % src === 0 || target >= TIMEFRAME_MS['1d']);
    })
    .sort((a, b) => TIMEFRAME_MS[b.timeframe] - TIMEFRAME_MS[a.timeframe] || (a.source === 'cache' ? -1 : 1));
  for (const d of finer) {
    let st;
    try { st = await stat(d.file); } catch { continue; }
    const memoKey = `${d.file}|${st.mtimeMs}|${tf}`;
    let bars = derivedMemo.get(memoKey);
    if (!bars) {
      const src = d.file.endsWith('.csv')
        ? await readImportCsv(d.file, symbol, d.timeframe)
        : await (d.source === 'cache' ? cache : imports).read(symbol, d.timeframe);
      if (!src?.length) continue;
      bars = resample({ instrument, timeframe: d.timeframe, bars: src }, tf).bars;
      remember(memoKey, bars);
    }
    return { instrument, timeframe: tf, bars: slice(bars, q), source: d.source, derivedFrom: d.timeframe };
  }

  throw new Error(howToGetData(symbol, tf, availableTimeframes(datasets), tsReason));
}
