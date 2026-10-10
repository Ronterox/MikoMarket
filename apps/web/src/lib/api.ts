import type { Bar, BarSeries, Instrument, Timeframe } from '@miko/engine';
import { DEMO_PRICE, LOCAL_INSTRUMENTS } from './instruments.ts';
import { runInWorker } from '../workers/client.ts';

export async function fetchJson<T>(url: string, init: RequestInit = {}, timeoutMs = 4000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('json')) throw new Error('not json');
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchInstruments(): Promise<Instrument[]> {
  try {
    const raw = await fetchJson<Instrument[] | { instruments: Instrument[] }>('/api/instruments', {}, 2500);
    const list = Array.isArray(raw) ? raw : raw.instruments;
    if (!Array.isArray(list) || list.length === 0) return LOCAL_INSTRUMENTS;
    // The server knows what it has data for: use its list (local emoji as a fallback).
    return list.map((i) => ({ ...i, emoji: i.emoji ?? LOCAL_INSTRUMENTS.find((l) => l.symbol === i.symbol)?.emoji }));
  } catch {
    return LOCAL_INSTRUMENTS;
  }
}

export interface LoadedSeries {
  series: BarSeries;
  demo: boolean;
}

function isBar(b: unknown): b is Bar {
  const x = b as Bar;
  return !!x && typeof x.t === 'number' && typeof x.o === 'number' && typeof x.c === 'number';
}

/** Real bars from the API; otherwise a synthetic demo series made in the worker. */
export async function loadSeries(instrument: Instrument, timeframe: Timeframe, count = 5000): Promise<LoadedSeries> {
  try {
    const q = new URLSearchParams({ symbol: instrument.symbol, tf: timeframe, bars: String(count) });
    // Deep history (Bot Lab) can take a while to come from TradeStation the first time.
    const raw = await fetchJson<BarSeries | Bar[] | { bars: Bar[] }>(`/api/bars?${q}`, {}, count > 5000 ? 45_000 : 8000);
    const bars = Array.isArray(raw) ? raw : raw.bars;
    if (Array.isArray(bars) && bars.length >= 300 && bars.every(isBar)) {
      const inst = !Array.isArray(raw) && 'instrument' in raw && raw.instrument ? { ...instrument, ...raw.instrument } : instrument;
      return { series: { instrument: inst, timeframe, bars }, demo: false };
    }
  } catch {
    /* fall through to demo data */
  }
  const seed = hash(`${instrument.symbol}:${timeframe}`);
  const series = await runInWorker({
    kind: 'demo', instrument, timeframe, count, seed, startPrice: DEMO_PRICE[instrument.symbol] ?? 100,
  });
  return { series, demo: true };
}

export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
