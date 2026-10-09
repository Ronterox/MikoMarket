import { mkdir, open, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Bar, Timeframe } from '@miko/engine';
import { dedupeBars, mergeBars } from './resample.ts';
import { TIMEFRAMES } from './timeframes.ts';

export interface DatasetInfo {
  symbol: string;
  timeframe: Timeframe;
  bars: number;
  from: number;
  to: number;
  file: string;
}

/**
 * Compact columnar JSON on disk: meta first (so listing reads only the head
 * of each file), then t as deltas and one array per field.
 *   {"v":1,"symbol":"@NQ","timeframe":"5m","count":3,"from":..,"to":..,"t":[t0,d1,d2],"o":[..],...}
 */
interface CacheFile {
  v: 1;
  symbol: string;
  timeframe: Timeframe;
  count: number;
  from: number;
  to: number;
  t: number[];
  o: number[];
  h: number[];
  l: number[];
  c: number[];
  v_: number[];
}

/** File-system-safe key for a symbol ("@NQ" stays "@NQ", "BRK.B" stays, spaces etc. become "_"). */
export function symbolFileKey(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/[^A-Z0-9@._-]/g, '_');
}

export function encodeBars(symbol: string, timeframe: Timeframe, bars: readonly Bar[]): string {
  const n = bars.length;
  const t = new Array<number>(n);
  const o = new Array<number>(n), h = new Array<number>(n), l = new Array<number>(n), c = new Array<number>(n), v = new Array<number>(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const b = bars[i]!;
    t[i] = b.t - prev; prev = b.t;
    o[i] = b.o; h[i] = b.h; l[i] = b.l; c[i] = b.c; v[i] = b.v;
  }
  const file: CacheFile = {
    v: 1, symbol, timeframe, count: n, from: bars[0]?.t ?? 0, to: bars[n - 1]?.t ?? 0,
    t, o, h, l, c, v_: v,
  };
  return JSON.stringify(file);
}

export function decodeBars(json: string): { symbol: string; timeframe: Timeframe; bars: Bar[] } {
  const f = JSON.parse(json) as CacheFile;
  if (f.v !== 1 || !Array.isArray(f.t)) throw new Error('Not a MikoMarket bar cache file');
  const bars = new Array<Bar>(f.t.length);
  let t = 0;
  for (let i = 0; i < f.t.length; i++) {
    t += f.t[i]!;
    bars[i] = { t, o: f.o[i]!, h: f.h[i]!, l: f.l[i]!, c: f.c[i]!, v: f.v_[i] ?? 0 };
  }
  return { symbol: f.symbol, timeframe: f.timeframe, bars };
}

/** Bars per symbol/timeframe under `dir`, merged and deduped by t, memoised in memory by mtime. */
export class BarCache {
  private memo = new Map<string, { mtimeMs: number; size: number; bars: Bar[] }>();

  constructor(readonly dir: string) {}

  file(symbol: string, tf: Timeframe): string {
    return join(this.dir, `${symbolFileKey(symbol)}_${tf}.json`);
  }

  async read(symbol: string, tf: Timeframe): Promise<Bar[] | null> {
    const path = this.file(symbol, tf);
    let st;
    try { st = await stat(path); } catch { return null; }
    const hit = this.memo.get(path);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.bars;
    const { bars } = decodeBars(await readFile(path, 'utf8'));
    this.memo.set(path, { mtimeMs: st.mtimeMs, size: st.size, bars });
    return bars;
  }

  /** Replace the stored bars (sorted + deduped first). Atomic. */
  async write(symbol: string, tf: Timeframe, bars: readonly Bar[]): Promise<Bar[]> {
    const clean = dedupeBars(bars);
    await mkdir(this.dir, { recursive: true });
    const path = this.file(symbol, tf);
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, encodeBars(symbol.toUpperCase(), tf, clean));
    await rename(tmp, path);
    this.memo.delete(path);
    return clean;
  }

  /** Merge new bars into what is stored (new ones win on equal t) and save. */
  async merge(symbol: string, tf: Timeframe, bars: readonly Bar[]): Promise<Bar[]> {
    const existing = (await this.read(symbol, tf)) ?? [];
    return this.write(symbol, tf, mergeBars(existing, bars));
  }

  /** Everything stored, from each file's header (cheap: does not parse the bars). */
  async list(): Promise<DatasetInfo[]> {
    let names: string[];
    try { names = await readdir(this.dir); } catch { return []; }
    const out: DatasetInfo[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const path = join(this.dir, name);
      try {
        const fh = await open(path, 'r');
        const buf = Buffer.alloc(400);
        const { bytesRead } = await fh.read(buf, 0, 400, 0);
        await fh.close();
        const head = buf.subarray(0, bytesRead).toString('utf8');
        const m = /"symbol":"([^"]+)","timeframe":"([^"]+)","count":(\d+),"from":(-?\d+),"to":(-?\d+)/.exec(head);
        if (!m || !(TIMEFRAMES as string[]).includes(m[2]!)) continue;
        out.push({ symbol: m[1]!, timeframe: m[2] as Timeframe, bars: Number(m[3]), from: Number(m[4]), to: Number(m[5]), file: path });
      } catch { /* skip unreadable */ }
    }
    return out.sort((a, b) => a.symbol.localeCompare(b.symbol) || a.timeframe.localeCompare(b.timeframe));
  }
}
