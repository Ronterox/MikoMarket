import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Bar } from '@miko/engine';
import { BarCache } from '@miko/data';
import { startServer } from './main.ts';

const T0 = Date.UTC(2026, 6, 6, 13, 30);
let base = '';
let stop: () => void = () => {};

beforeAll(async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'miko-server-'));
  const bars: Bar[] = Array.from({ length: 6000 }, (_, i) => ({ t: T0 + i * 300_000, o: 100 + i * 0.01, h: 101, l: 99, c: 100.5, v: 10 }));
  await new BarCache(join(dataDir, 'cache')).write('SPY', '5m', bars);
  const webDir = join(dataDir, 'web');
  mkdirSync(join(webDir, 'assets'), { recursive: true });
  writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>Miko</title>');
  writeFileSync(join(webDir, 'assets', 'app.js'), 'console.log(1)');
  const { server } = startServer({ port: 0, dataDir, webDir, client: null, log: () => {} });
  base = `http://localhost:${server.port}`;
  stop = () => server.stop(true);
});

afterAll(() => stop());

describe('server', () => {
  test('GET /api/health', async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, tradestation: false });
  });

  test('GET /api/instruments', async () => {
    const list = (await (await fetch(`${base}/api/instruments`)).json()) as { symbol: string; pointValue: number }[];
    expect(list.find((i) => i.symbol === '@MNQ')?.pointValue).toBe(2);
    expect(list.find((i) => i.symbol === 'SPY')).toBeTruthy();
  });

  test('GET /api/bars from the cache, gzipped when large', async () => {
    const res = await fetch(`${base}/api/bars?symbol=SPY&tf=5m&bars=5000`, { headers: { 'Accept-Encoding': 'gzip' }, decompress: false } as RequestInit);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-encoding')).toBe('gzip');
    const body = JSON.parse(new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(await res.arrayBuffer())))) as { instrument: { symbol: string }; timeframe: string; bars: Bar[]; source: string };
    expect(body.instrument.symbol).toBe('SPY');
    expect(body.timeframe).toBe('5m');
    expect(body.bars).toHaveLength(5000);
    expect(body.source).toBe('cache');

    const r15 = (await (await fetch(`${base}/api/bars?symbol=SPY&tf=15m&bars=10`)).json()) as { bars: Bar[] };
    expect(r15.bars).toHaveLength(10);
  });

  test('GET /api/bars errors are friendly', async () => {
    const missing = await fetch(`${base}/api/bars?symbol=TSLA&tf=5m`);
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: string }).error).toMatch(/import/);
    expect((await fetch(`${base}/api/bars?symbol=SPY&tf=7m`)).status).toBe(400);
  });

  test('GET /api/stream is a friendly 404 without TradeStation', async () => {
    const res = await fetch(`${base}/api/stream?symbol=SPY&tf=1m`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toMatch(/TradeStation/);
  });

  test('profile roundtrip', async () => {
    expect((await fetch(`${base}/api/profile/p1`)).status).toBe(404);
    const profile = {
      id: 'p1', name: 'Miko', createdAt: 1, xp: 42, level: 1, rating: 1000, streakDays: 1,
      stats: { sessions: 1 }, achievements: {}, strategies: [], history: [],
      settings: { sound: true, music: false, assistant: true, reducedMotion: false },
    };
    const put = await fetch(`${base}/api/profile/p1`, { method: 'PUT', body: JSON.stringify(profile), headers: { 'Content-Type': 'application/json' } });
    expect(put.status).toBe(200);
    expect(await (await fetch(`${base}/api/profile/p1`)).json()).toEqual(profile);
    const bad = await fetch(`${base}/api/profile/p1`, { method: 'PUT', body: JSON.stringify({ id: 'p1' }) });
    expect(bad.status).toBe(400);
    const mismatch = await fetch(`${base}/api/profile/p2`, { method: 'PUT', body: JSON.stringify(profile) });
    expect(mismatch.status).toBe(400);
  });

  test('GET /api/datasets, indicators, templates', async () => {
    const ds = (await (await fetch(`${base}/api/datasets`)).json()) as { datasets: { symbol: string; timeframe: string }[]; available: Record<string, string[]> };
    expect(ds.datasets).toEqual([expect.objectContaining({ symbol: 'SPY', timeframe: '5m', source: 'cache' })]);
    expect(ds.available.SPY).toContain('1h');
    expect(((await (await fetch(`${base}/api/indicators`)).json()) as unknown[]).length).toBeGreaterThan(10);
    expect(((await (await fetch(`${base}/api/templates`)).json()) as unknown[]).length).toBeGreaterThan(3);
  });

  test('CORS for localhost dev origins only', async () => {
    const ok = await fetch(`${base}/api/health`, { headers: { Origin: 'http://localhost:5173' } });
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    const pre = await fetch(`${base}/api/profile/p1`, { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:5173' } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-methods')).toContain('PUT');
    const evil = await fetch(`${base}/api/health`, { headers: { Origin: 'https://evil.example' } });
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
  });

  test('static files with SPA fallback', async () => {
    expect(await (await fetch(`${base}/assets/app.js`)).text()).toBe('console.log(1)');
    const spa = await fetch(`${base}/bot-lab/strategies`);
    expect(spa.status).toBe(200);
    expect(await spa.text()).toContain('<title>Miko</title>');
    expect((await fetch(`${base}/assets/missing.js`)).status).toBe(404);
    expect((await fetch(`${base}/api/nope`)).status).toBe(404);
  });
});
