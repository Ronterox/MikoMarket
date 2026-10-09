import { describe, expect, test } from 'bun:test';
import type { Bar, BarSeries } from '@miko/engine';
import { instrumentFor } from './instruments.ts';
import { resample } from './resample.ts';
import { parseTimeframe, tsInterval } from './timeframes.ts';

function minuteBars(startUtc: number, n: number): Bar[] {
  return Array.from({ length: n }, (_, i) => ({ t: startUtc + i * 60_000, o: 100 + i, h: 101 + i, l: 99 + i, c: 100.5 + i, v: 10 }));
}

describe('resample', () => {
  test('1m -> 5m aligns on 5-minute boundaries and aggregates OHLCV', () => {
    // 13:32 UTC start: first bucket 13:30 holds 3 bars, then 5 per bucket
    const series: BarSeries = { instrument: instrumentFor('SPY'), timeframe: '1m', bars: minuteBars(Date.UTC(2026, 6, 6, 13, 32), 13) };
    const r = resample(series, '5m');
    expect(r.timeframe).toBe('5m');
    expect(r.bars.map((b) => new Date(b.t).toISOString().slice(11, 16))).toEqual(['13:30', '13:35', '13:40']);
    expect(r.bars[0]).toEqual({ t: Date.UTC(2026, 6, 6, 13, 30), o: 100, h: 103, l: 99, c: 102.5, v: 30 });
    expect(r.bars[1]).toEqual({ t: Date.UTC(2026, 6, 6, 13, 35), o: 103, h: 108, l: 102, c: 107.5, v: 50 });
    expect(r.bars[2]!.v).toBe(50);
  });

  test('1h buckets start on the (New York) hour', () => {
    const series: BarSeries = { instrument: instrumentFor('SPY'), timeframe: '1m', bars: minuteBars(Date.UTC(2026, 6, 6, 13, 30), 90) };
    const r = resample(series, '1h');
    expect(r.bars.map((b) => new Date(b.t).toISOString().slice(11, 16))).toEqual(['13:00', '14:00']);
    expect(r.bars[0]!.v).toBe(300);
    expect(r.bars[1]!.v).toBe(600);
  });

  test('futures daily bars roll at 18:00 New York', () => {
    const inst = instrumentFor('@NQ');
    const bars: Bar[] = [
      { t: Date.UTC(2026, 6, 6, 20, 0), o: 1, h: 2, l: 0.5, c: 1.5, v: 1 },  // 16:00 ET Mon -> Mon session
      { t: Date.UTC(2026, 6, 6, 22, 0), o: 2, h: 3, l: 1.5, c: 2.5, v: 1 },  // 18:00 ET Mon -> Tue session
      { t: Date.UTC(2026, 6, 7, 13, 0), o: 3, h: 4, l: 2.5, c: 3.5, v: 1 },  // 09:00 ET Tue -> Tue session
    ];
    const r = resample({ instrument: inst, timeframe: '1h', bars }, '1d');
    expect(r.bars).toHaveLength(2);
    expect(r.bars[1]).toEqual({ t: Date.UTC(2026, 6, 6, 22, 0), o: 2, h: 4, l: 1.5, c: 3.5, v: 2 });
  });

  test('refuses to resample to a finer timeframe', () => {
    expect(() => resample({ instrument: instrumentFor('SPY'), timeframe: '5m', bars: [] }, '1m')).toThrow();
  });
});

describe('timeframes', () => {
  test('mapping to TradeStation interval/unit', () => {
    expect(tsInterval('5m')).toEqual({ interval: 5, unit: 'Minute' });
    expect(tsInterval('4h')).toEqual({ interval: 240, unit: 'Minute' });
    expect(tsInterval('1d')).toEqual({ interval: 1, unit: 'Daily' });
    expect(tsInterval('1w')).toEqual({ interval: 1, unit: 'Weekly' });
  });

  test('lenient parsing', () => {
    expect(parseTimeframe('m5')).toBe('5m');
    expect(parseTimeframe('15mins')).toBe('15m');
    expect(parseTimeframe('60')).toBe('1h');
    expect(parseTimeframe('H4')).toBe('4h');
    expect(parseTimeframe('daily')).toBe('1d');
    expect(() => parseTimeframe('7m')).toThrow();
  });
});
