import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Bar } from '@miko/engine';
import { BarCache } from '@miko/data';
import { resolveStrategy } from './common.ts';
import { main } from './main.ts';

const saved = { dir: process.env.MIKO_DATA_DIR, env: process.env.TRADESTATION_ENV_FILE };

/** Run the CLI capturing stdout/stderr. */
async function run(...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const log = console.log;
  const error = console.error;
  console.log = (...a: unknown[]) => { out.push(a.join(' ')); };
  console.error = (...a: unknown[]) => { err.push(a.join(' ')); };
  try {
    const code = await main(argv);
    return { code, out: out.join('\n'), err: err.join('\n') };
  } finally {
    console.log = log;
    console.error = error;
  }
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'miko-cli-'));
  process.env.MIKO_DATA_DIR = dir;
  delete process.env.TRADESTATION_ENV_FILE;
  // A deterministic zig-zag series so strategies actually trade.
  const t0 = Date.UTC(2026, 0, 5, 14, 30);
  const bars: Bar[] = Array.from({ length: 1500 }, (_, i) => {
    const c = 100 + 5 * Math.sin(i / 25) + i * 0.002;
    return { t: t0 + i * 900_000, o: c - 0.1, h: c + 0.6, l: c - 0.6, c, v: 1000 };
  });
  await new BarCache(join(dir, 'cache')).write('SPY', '15m', bars);
});

afterAll(() => {
  if (saved.dir === undefined) delete process.env.MIKO_DATA_DIR; else process.env.MIKO_DATA_DIR = saved.dir;
  if (saved.env !== undefined) process.env.TRADESTATION_ENV_FILE = saved.env;
});

describe('cli', () => {
  test('help and unknown commands', async () => {
    expect((await run('--help')).code).toBe(0);
    expect((await run('frobnicate')).code).toBe(2);
    expect((await run('backtest', '--bogus')).code).toBe(2);
  });

  test('templates / instruments --json', async () => {
    const t = await run('templates', '--json');
    expect(t.code).toBe(0);
    expect((JSON.parse(t.out) as { id: string }[]).some((s) => s.id === 'tpl_ema_cross')).toBe(true);
    const i = await run('instruments', '--json');
    const list = JSON.parse(i.out) as { symbol: string; offline: string[] }[];
    expect(list.find((x) => x.symbol === 'SPY')?.offline).toContain('1h');
  });

  test('strategy resolution', () => {
    expect(resolveStrategy('ema_cross').id).toBe('tpl_ema_cross');
    expect(resolveStrategy('tpl_rsi_bounce').id).toBe('tpl_rsi_bounce');
    expect(() => resolveStrategy('nope')).toThrow(/Unknown strategy/);
  });

  test('backtest --json runs offline on cached bars', async () => {
    const r = await run('backtest', '--symbol', 'SPY', '--tf', '15m', '--strategy', 'ema_cross', '--offline', '--json');
    expect(r.code).toBe(0);
    const body = JSON.parse(r.out) as { source: string; result: { metrics: { trades: number } } };
    expect(body.source).toBe('cache');
    expect(body.result.metrics.trades).toBeGreaterThan(0);
  });

  test('missing data gives a helpful error', async () => {
    const r = await run('backtest', '--symbol', 'TSLA', '--tf', '5m', '--strategy', 'ema_cross', '--offline');
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/import/);
  });

  test('play with a key script', async () => {
    const r = await run('play', '--symbol', 'SPY', '--tf', '15m', '--offline', '--no-save', '--no-color', '--script', 'b' + ' '.repeat(30) + 'fq');
    expect(r.code).toBe(0);
    expect(r.out).toContain('BUY');
    expect(r.out).toContain('Session over');
    expect(r.out).toMatch(/XP/);
  });

  test('leaderboard without 5m data lists nobody and says why', async () => {
    const r = await run('leaderboard', '--week', '2026-01-07', '--offline', '--json');
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toEqual({ week: '2026-01-05', dataWeek: null, entries: [] });
    expect((await run('leaderboard', '--week', 'soon', '--offline')).code).not.toBe(0);
  });
});
