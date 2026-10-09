import { existsSync } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { TIMEFRAME_MS, type Bar, type Timeframe } from '@miko/engine';
import { BarCache } from './cache.ts';
import { CsvBarReader, forEachLine, inferSymbolFromPath, type CsvFormat } from './csv.ts';
import { instrumentFor } from './instruments.ts';
import { dataPaths } from './paths.ts';
import { mergeBars, resample } from './resample.ts';

export const DEFAULT_TECHNICAL_ANALYSIS_DIR = '/home/rontero/Documents/Projects/PythonProjects/TechnicalAnalysis';

export interface ImportOptions {
  dataDir?: string;
  /** For big files (minute history), keep only the most recent N years. Default 2. */
  years?: number;
  /** Files larger than this are streamed and trimmed to `years`. Default 20 MB. */
  bigFileBytes?: number;
  /** Timeframes to derive from 1-minute history. Default 5m, 15m, 1h. */
  derive?: Timeframe[];
  onProgress?: (message: string) => void;
}

export interface ImportedDataset {
  symbol: string;
  timeframe: Timeframe;
  bars: number;
  from: number;
  to: number;
  files: number;
  derivedFrom?: Timeframe;
}

export interface ImportReport {
  root: string;
  datasets: ImportedDataset[];
  skipped: string[];
}

const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv']);

async function walk(dir: string, depth: number, out: string[]): Promise<void> {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (depth > 0 && !SKIP_DIRS.has(e.name)) await walk(p, depth - 1, out);
    } else if (/\.(csv|txt)$/i.test(e.name)) {
      out.push(p);
    }
  }
}

async function readHead(path: string, bytes = 4096): Promise<string> {
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead).toString('utf8');
  } finally { await fh.close(); }
}

async function readTail(path: string, size: number, bytes = 4096): Promise<string> {
  const fh = await open(path, 'r');
  try {
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(Math.min(bytes, size));
    const { bytesRead } = await fh.read(buf, 0, buf.length, start);
    return buf.subarray(0, bytesRead).toString('utf8');
  } finally { await fh.close(); }
}

/** Format of a file from its first lines, or null when it is not bar data. */
function sniff(head: string): CsvFormat | null {
  const lines = head.split('\n').slice(0, 12).filter((l) => l.trim());
  if (lines.length < 2) return null;
  try {
    const r = new CsvBarReader({ timeframe: '1m' });
    for (const l of lines.slice(0, -1)) r.line(l); // last line may be cut off
    return r.rowsRead > 0 ? r.format : null;
  } catch {
    return null;
  }
}

/** Timestamp of the last bar of a big file, from its header + tail. */
async function lastBarTime(path: string, size: number, headerLine: string): Promise<number | null> {
  const tail = (await readTail(path, size)).split('\n').filter((l) => l.trim()).slice(1); // first may be partial
  try {
    const r = new CsvBarReader({ timeframe: '1m', stamp: 'open' });
    r.line(headerLine);
    for (const l of tail.slice(-3)) r.line(l);
    const bars = r.end().bars;
    return bars.length ? bars[bars.length - 1]!.t : null;
  } catch {
    return null;
  }
}

/**
 * Import the user's existing CSV history (IB dumps under data/<SYMBOL>/, the
 * SQX NQ_M1.csv, TradeStation exports) into data/import/, normalised to our
 * compact format. Files are merged per symbol/timeframe (newer files override
 * older ones on equal bar times, so overlapping snapshots dedupe cleanly).
 * Big minute files are streamed, trimmed to the last `years`, and also
 * resampled to 5m/15m/1h.
 */
export async function importFromTechnicalAnalysis(rootDir: string = DEFAULT_TECHNICAL_ANALYSIS_DIR, opts: ImportOptions = {}): Promise<ImportReport> {
  const progress = opts.onProgress ?? (() => {});
  const years = opts.years ?? 2;
  const bigBytes = opts.bigFileBytes ?? 20 * 1024 * 1024;
  const derive = opts.derive ?? ['5m', '15m', '1h'];
  const candidates = [join(rootDir, 'mirror', 'data'), join(rootDir, 'data'), rootDir];
  const root = candidates.find((c) => existsSync(c));
  if (!root) throw new Error(`Nothing to import: ${rootDir} does not exist`);

  const files: string[] = [];
  await walk(root, 3, files);
  files.sort((a, b) => basename(a).localeCompare(basename(b)) || a.localeCompare(b));

  const groups = new Map<string, { symbol: string; timeframe: Timeframe; bars: Bar[]; files: number; big: boolean }>();
  const skipped: string[] = [];

  for (const file of files) {
    const rel = relative(root, file);
    const st = await stat(file);
    const head = await readHead(file);
    const format = sniff(head);
    if (!format) { skipped.push(rel); continue; }

    const symbol = inferSymbolFromPath(file);
    const instrument = instrumentFor(symbol);
    const big = st.size > bigBytes;
    let since: number | undefined;
    if (big) {
      const headerLine = head.split('\n')[0] ?? '';
      const last = await lastBarTime(file, st.size, headerLine);
      if (last !== null) since = last - years * 365.25 * 86_400_000;
      progress(`streaming ${rel} (${(st.size / 1e6).toFixed(0)} MB${since ? `, keeping since ${new Date(since).toISOString().slice(0, 10)}` : ''})...`);
    }

    try {
      const reader = new CsvBarReader({ instrument, since });
      await forEachLine(file, (l) => reader.line(l));
      const parsed = reader.end();
      if (!parsed.bars.length) { skipped.push(`${rel} (no bars in range)`); continue; }
      const key = `${instrument.symbol}|${parsed.timeframe}`;
      const g = groups.get(key);
      if (g) {
        g.bars = mergeBars(g.bars, parsed.bars);
        g.files++;
        g.big ||= big;
      } else {
        groups.set(key, { symbol: instrument.symbol, timeframe: parsed.timeframe, bars: parsed.bars, files: 1, big });
      }
      progress(`  ${rel}: ${parsed.format} ${instrument.symbol} ${parsed.timeframe} ${parsed.bars.length} bars`);
    } catch (err) {
      skipped.push(`${rel} (${(err as Error).message})`);
    }
  }

  const store = new BarCache(dataPaths(opts.dataDir).import);
  const datasets: ImportedDataset[] = [];
  const save = async (symbol: string, timeframe: Timeframe, bars: Bar[], files: number, derivedFrom?: Timeframe): Promise<void> => {
    const clean = await store.write(symbol, timeframe, bars);
    datasets.push({ symbol, timeframe, bars: clean.length, from: clean[0]?.t ?? 0, to: clean[clean.length - 1]?.t ?? 0, files, derivedFrom });
  };

  for (const g of groups.values()) {
    await save(g.symbol, g.timeframe, g.bars, g.files);
    if (g.big || g.timeframe === '1m') {
      const instrument = instrumentFor(g.symbol);
      for (const tf of derive) {
        const src = TIMEFRAME_MS[g.timeframe];
        const dst = TIMEFRAME_MS[tf];
        if (dst <= src || dst % src !== 0 || groups.has(`${g.symbol}|${tf}`)) continue;
        await save(g.symbol, tf, resample({ instrument, timeframe: g.timeframe, bars: g.bars }, tf).bars, g.files, g.timeframe);
      }
    }
  }

  datasets.sort((a, b) => a.symbol.localeCompare(b.symbol) || TIMEFRAME_MS[a.timeframe] - TIMEFRAME_MS[b.timeframe]);
  return { root, datasets, skipped };
}
