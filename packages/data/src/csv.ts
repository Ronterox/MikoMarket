import { basename, extname } from 'node:path';
import { TIMEFRAME_MS, type Bar, type BarSeries, type Instrument, type Timeframe } from '@miko/engine';
import { instrumentFor } from './instruments.ts';
import { dedupeBars, sessionOpenUtc } from './resample.ts';
import { timeframeForMs } from './timeframes.ts';
import { NEW_YORK, localParts, zonedToUtc } from './tz.ts';

/**
 * Bar CSV formats we understand:
 *  - 'ib'           ",date,open,high,low,close,volume,average,barCount" (pandas dump of IB bars),
 *                   tz-aware ISO dates stamping the bar OPEN.
 *  - 'sqx'          "Date,Time,Open,High,Low,Close,Volume" with "2015.01.01,18:01",
 *                   New York time stamping the bar CLOSE (TradeStation convention).
 *  - 'tradestation' TradeStation File > Export Data: "MM/DD/YYYY,HH:MM,O,H,L,C,Up,Down"
 *                   (Up + Down = volume), New York time stamping the bar CLOSE.
 *  - 'miko'         our own "t,o,h,l,c,v" with t = epoch ms of the bar open.
 */
export type CsvFormat = 'ib' | 'sqx' | 'tradestation' | 'miko';

export interface CsvOptions {
  format?: CsvFormat;
  /** Time zone of naive timestamps (sqx / tradestation). Default America/New_York. */
  tz?: string;
  /** What naive timestamps mark. Default: 'close' for sqx/tradestation, 'open' otherwise. */
  stamp?: 'open' | 'close';
  symbol?: string;
  instrument?: Instrument;
  /** Bar length; detected from the data when omitted. */
  timeframe?: Timeframe;
  /** Keep only bars with t >= since / t <= until (epoch ms). */
  since?: number;
  until?: number;
}

export interface ParsedCsv {
  format: CsvFormat;
  timeframe: Timeframe;
  bars: Bar[];
}

const DAY = 86_400_000;
const DETECT_ROWS = 500;

interface Layout {
  format: CsvFormat;
  idx: { date: number; time: number; o: number; h: number; l: number; c: number; v: number; v2: number };
}

function clean(cell: string): string {
  let s = cell.trim();
  if (s.length > 1 && s.charCodeAt(0) === 34 && s.charCodeAt(s.length - 1) === 34) s = s.slice(1, -1);
  return s;
}

function splitLine(line: string): string[] {
  return line.split(',').map(clean);
}

const RE_ISO = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}.*)?$/;
const RE_SQX = /^\d{4}\.\d{2}\.\d{2}$/;
const RE_US = /^\d{1,2}\/\d{1,2}\/\d{4}$/;
const RE_TIME = /^\d{1,2}:\d{2}(:\d{2})?$/;

/** Work out the format from the header (may be null) and the first data row. */
export function detectCsvFormat(header: string[] | null, row: string[]): Layout | null {
  const h = header?.map((c) => c.replace(/^﻿/, '').trim().toLowerCase()) ?? null;
  const col = (...names: string[]): number => (h ? h.findIndex((c) => names.includes(c)) : -1);

  if (h && h[0] === 't' && h[1] === 'o' && h[2] === 'h') {
    return { format: 'miko', idx: { date: 0, time: -1, o: 1, h: 2, l: 3, c: 4, v: 5, v2: -1 } };
  }
  const c0 = row[0] ?? '';
  const c1 = row[1] ?? '';
  if (RE_SQX.test(c0) && RE_TIME.test(c1)) {
    return { format: 'sqx', idx: { date: 0, time: 1, o: 2, h: 3, l: 4, c: 5, v: 6, v2: -1 } };
  }
  if (RE_US.test(c0) && RE_TIME.test(c1)) {
    // "Up","Down" (or headerless 8 columns) => volume is the sum of both.
    const up = col('up', 'upvol', 'upvolume');
    const down = col('down', 'downvol', 'downvolume');
    const hasPair = h ? up >= 0 && down >= 0 : row.length >= 8;
    return { format: 'tradestation', idx: { date: 0, time: 1, o: 2, h: 3, l: 4, c: 5, v: hasPair && h ? up : 6, v2: hasPair ? (h ? down : 7) : -1 } };
  }
  const dateCol = h ? col('date', 'datetime', 'time', 'timestamp') : row.findIndex((c) => RE_ISO.test(c));
  if (dateCol >= 0 && RE_ISO.test(row[dateCol] ?? '')) {
    if (h) {
      return {
        format: 'ib',
        idx: { date: dateCol, time: -1, o: col('open'), h: col('high'), l: col('low'), c: col('close'), v: col('volume', 'vol'), v2: -1 },
      };
    }
    const d = dateCol;
    return { format: 'ib', idx: { date: d, time: -1, o: d + 1, h: d + 2, l: d + 3, c: d + 4, v: d + 5, v2: -1 } };
  }
  return null;
}

interface RawRow extends Bar {
  dateOnly: boolean;
}

/** Most common positive gap between consecutive timestamps. */
function modalGap(rows: readonly { t: number }[]): number {
  const counts = new Map<number, number>();
  for (let i = 1; i < rows.length; i++) {
    const d = rows[i]!.t - rows[i - 1]!.t;
    if (d > 0) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  let best = 0;
  let bestN = 0;
  for (const [d, n] of counts) if (n > bestN || (n === bestN && d < best)) { best = d; bestN = n; }
  return best;
}

/**
 * Incremental parser: feed lines, then `end()`. Used both for small strings
 * and for streaming multi-hundred-MB files without holding the text in memory.
 */
export class CsvBarReader {
  private layout: Layout | null = null;
  private header: string[] | null = null;
  private sawFirst = false;
  private pending: RawRow[] | null = [];
  private shift = 0;
  private daily = false;
  private tfMs = 0;
  private readonly out: Bar[] = [];
  private readonly tz: string;
  private readonly instrument: Instrument | undefined;
  rowsRead = 0;
  rowsSkipped = 0;

  constructor(private readonly opts: CsvOptions = {}) {
    this.tz = opts.tz ?? NEW_YORK;
    this.instrument = opts.instrument ?? (opts.symbol ? instrumentFor(opts.symbol) : undefined);
    this.layout = null;
  }

  line(raw: string): void {
    if (!raw || raw.length < 3) return;
    const line = raw.charCodeAt(raw.length - 1) === 13 ? raw.slice(0, -1) : raw;
    if (!line.trim()) return;
    const cells = splitLine(line);
    if (!this.sawFirst) {
      this.sawFirst = true;
      const first = (cells[0] ?? '').replace(/^﻿/, '');
      const second = cells[1] ?? '';
      const looksData = /^\d/.test(first) || (first === '' ? false : RE_ISO.test(first)) || (/^\d/.test(second) && RE_ISO.test(second));
      if (!looksData) { this.header = cells; return; }
    }
    if (!this.layout) {
      this.layout = this.opts.format ? this.forced(this.opts.format, cells) : detectCsvFormat(this.header, cells);
      if (!this.layout) throw new Error(`Unrecognised CSV format (header: ${this.header?.join(',') ?? 'none'})`);
    }
    const row = this.parseRow(cells);
    if (!row) { this.rowsSkipped++; return; }
    this.rowsRead++;
    if (this.pending) {
      this.pending.push(row);
      if (this.pending.length >= DETECT_ROWS) this.flushPending();
    } else {
      this.emit(row);
    }
  }

  end(): ParsedCsv {
    if (this.pending) this.flushPending();
    if (!this.layout) throw new Error('CSV has no data rows');
    const tf = this.opts.timeframe ?? timeframeForMs(this.tfMs);
    if (!tf) throw new Error(`Could not tell the timeframe (bars ${this.tfMs / 60_000} minutes apart); pass timeframe explicitly`);
    return { format: this.layout.format, timeframe: tf, bars: dedupeBars(this.out) };
  }

  get format(): CsvFormat | null {
    return this.layout?.format ?? null;
  }

  private forced(format: CsvFormat, cells: string[]): Layout {
    const detected = detectCsvFormat(this.header, cells);
    if (detected && detected.format === format) return detected;
    const base = { date: 0, time: 1, o: 2, h: 3, l: 4, c: 5, v: 6, v2: -1 };
    if (format === 'tradestation') return { format, idx: { ...base, v2: cells.length >= 8 ? 7 : -1 } };
    if (format === 'sqx') return { format, idx: base };
    if (format === 'miko') return { format, idx: { date: 0, time: -1, o: 1, h: 2, l: 3, c: 4, v: 5, v2: -1 } };
    return { format, idx: { date: 1, time: -1, o: 2, h: 3, l: 4, c: 5, v: 6, v2: -1 } };
  }

  private parseRow(cells: string[]): RawRow | null {
    const { format, idx } = this.layout!;
    let t: number;
    let dateOnly = false;
    const d = cells[idx.date] ?? '';
    if (format === 'miko') {
      t = Number(d);
    } else if (format === 'ib') {
      if (d.length === 10) {
        dateOnly = true;
        t = zonedToUtc(+d.slice(0, 4), +d.slice(5, 7), +d.slice(8, 10), 0, 0, this.tz);
      } else {
        t = Date.parse(d.length > 10 && d[10] === ' ' ? `${d.slice(0, 10)}T${d.slice(11)}` : d);
      }
    } else {
      const tm = cells[idx.time] ?? '';
      const colon = tm.indexOf(':');
      const hh = colon > 0 ? +tm.slice(0, colon) : 0;
      const mi = colon > 0 ? +tm.slice(colon + 1, colon + 3) : 0;
      let y: number, mo: number, dd: number;
      if (format === 'sqx') {
        y = +d.slice(0, 4); mo = +d.slice(5, 7); dd = +d.slice(8, 10);
      } else {
        const a = d.indexOf('/');
        const b = d.indexOf('/', a + 1);
        mo = +d.slice(0, a); dd = +d.slice(a + 1, b); y = +d.slice(b + 1);
      }
      t = zonedToUtc(y, mo, dd, hh, mi, this.tz);
    }
    const o = +cells[idx.o]!;
    const h = +cells[idx.h]!;
    const l = +cells[idx.l]!;
    const c = +cells[idx.c]!;
    let v = idx.v >= 0 ? +(cells[idx.v] ?? 0) : 0;
    if (idx.v2 >= 0) v += +(cells[idx.v2] ?? 0);
    if (!Number.isFinite(t) || !Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) return null;
    if (!Number.isFinite(v) || v < 0) v = 0; // IB writes -1 when it has no volume
    return { t, o, h, l, c, v, dateOnly };
  }

  private flushPending(): void {
    const rows = this.pending!;
    this.pending = null;
    const format = this.layout?.format;
    this.tfMs = this.opts.timeframe ? TIMEFRAME_MS[this.opts.timeframe] : modalGap(rows);
    this.daily = this.tfMs >= DAY || rows.some((r) => r.dateOnly);
    const stamp = this.opts.stamp ?? (format === 'sqx' || format === 'tradestation' ? 'close' : 'open');
    this.shift = !this.daily && stamp === 'close' ? this.tfMs : 0;
    for (const r of rows) this.emit(r);
  }

  private emit(r: RawRow): void {
    let t = r.t - this.shift;
    if (this.daily) {
      const p = localParts(r.t, this.tz);
      t = sessionOpenUtc(p.y, p.mo, p.d, this.instrument);
    }
    if (this.opts.since !== undefined && t < this.opts.since) return;
    if (this.opts.until !== undefined && t > this.opts.until) return;
    this.out.push({ t, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v });
  }
}

/** Parse CSV text (any supported format). */
export function parseCsv(text: string, opts: CsvOptions = {}): ParsedCsv {
  const reader = new CsvBarReader(opts);
  let start = 0;
  while (start < text.length) {
    let nl = text.indexOf('\n', start);
    if (nl < 0) nl = text.length;
    reader.line(text.slice(start, nl));
    start = nl + 1;
  }
  return reader.end();
}

/** Stream a file line by line without loading it all into memory. */
export async function forEachLine(path: string, onLine: (line: string) => void): Promise<void> {
  const decoder = new TextDecoder();
  let rest = '';
  for await (const chunk of Bun.file(path).stream()) {
    const text = rest + decoder.decode(chunk, { stream: true });
    let start = 0;
    let nl: number;
    while ((nl = text.indexOf('\n', start)) >= 0) {
      onLine(text.slice(start, nl));
      start = nl + 1;
    }
    rest = text.slice(start);
  }
  rest += decoder.decode();
  if (rest) onLine(rest);
}

/** Guess a symbol from a file name: "20260713_105D_15mins_SPY.csv", "NQ_M1.csv", "SPY_5m.csv". */
export function inferSymbolFromPath(path: string): string {
  const base = basename(path, extname(path));
  const ib = /_\d+(?:mins?|secs?|hours?|days?)_([A-Za-z@.]+)$/.exec(base);
  if (ib) return instrumentFor(ib[1]!).symbol;
  const tagged = /^(@?[A-Za-z0-9.]+?)_(?:M\d+|H\d+|D1|W1|\d+[mhdw])$/i.exec(base);
  if (tagged) return instrumentFor(tagged[1]!).symbol;
  return instrumentFor(base).symbol;
}

/** Load a bar CSV of any supported format into a BarSeries (streamed, so big files are fine). */
export async function loadCsv(path: string, opts: CsvOptions = {}): Promise<BarSeries & { format: CsvFormat }> {
  const instrument = opts.instrument ?? instrumentFor(opts.symbol ?? inferSymbolFromPath(path));
  const reader = new CsvBarReader({ ...opts, instrument });
  await forEachLine(path, (l) => reader.line(l));
  const parsed = reader.end();
  return { instrument, timeframe: parsed.timeframe, bars: parsed.bars, format: parsed.format };
}

/** Our own CSV ("t,o,h,l,c,v", t = open time in epoch ms). */
export function toMikoCsv(bars: readonly Bar[]): string {
  let s = 't,o,h,l,c,v\n';
  for (const b of bars) s += `${b.t},${b.o},${b.h},${b.l},${b.c},${b.v}\n`;
  return s;
}
