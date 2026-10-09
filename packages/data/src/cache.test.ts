import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Bar } from '@miko/engine';
import { BarCache, decodeBars, encodeBars } from './cache.ts';
import { getBars, listDatasets, withProxies } from './getBars.ts';
import { FileProfileStore, profileProblems } from './profiles.ts';

const bar = (t: number, c: number): Bar => ({ t, o: c, h: c + 1, l: c - 1, c, v: 1 });
const T0 = Date.UTC(2026, 6, 6, 13, 30);
const M = 60_000;

describe('BarCache', () => {
  test('encode/decode round trip', () => {
    const bars = [bar(T0, 1), bar(T0 + M, 2.5)];
    const back = decodeBars(encodeBars('SPY', '1m', bars));
    expect(back.bars).toEqual(bars);
    expect(back.symbol).toBe('SPY');
  });

  test('merge sorts, dedupes by t, newer wins, and lists from headers', async () => {
    const cache = new BarCache(mkdtempSync(join(tmpdir(), 'miko-cache-')));
    await cache.write('@NQ', '1m', [bar(T0 + 2 * M, 3), bar(T0, 1)]);
    const merged = await cache.merge('@NQ', '1m', [bar(T0 + M, 2), bar(T0 + 2 * M, 30)]);
    expect(merged.map((b) => b.c)).toEqual([1, 2, 30]);
    expect((await cache.read('@NQ', '1m'))!.map((b) => b.t)).toEqual([T0, T0 + M, T0 + 2 * M]);
    const list = await cache.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ symbol: '@NQ', timeframe: '1m', bars: 3, from: T0, to: T0 + 2 * M });
    expect(await cache.read('SPY', '1m')).toBeNull();
  });
});

describe('getBars (offline)', () => {
  test('cache first, then import, resampling from finer data, clear error otherwise', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'miko-data-'));
    const imp = new BarCache(join(dataDir, 'import'));
    await imp.write('SPY', '1m', Array.from({ length: 30 }, (_, i) => bar(T0 + i * M, 100 + i)));
    const s1 = await getBars({ symbol: 'spy', timeframe: '1m', bars: 10 }, { dataDir, client: null });
    expect(s1.source).toBe('import');
    expect(s1.bars).toHaveLength(10);
    expect(s1.bars[9]!.c).toBe(129);

    const s5 = await getBars({ symbol: 'SPY', timeframe: '5m' }, { dataDir, client: null });
    expect(s5.derivedFrom).toBe('1m');
    expect(s5.bars).toHaveLength(6);
    expect(s5.bars[0]).toMatchObject({ o: 100, c: 104, v: 5 });

    await new BarCache(join(dataDir, 'cache')).write('SPY', '1m', [bar(T0, 7)]);
    const sc = await getBars({ symbol: 'SPY', timeframe: '1m' }, { dataDir, client: null });
    expect(sc.source).toBe('cache');
    expect(sc.bars).toHaveLength(30); // merged with the imported history, not hidden by it
    expect(sc.bars[0]!.c).toBe(7);    // the cache wins on equal t

    // a raw CSV dropped into data/import works too
    mkdirSync(join(dataDir, 'import'), { recursive: true });
    writeFileSync(join(dataDir, 'import', 'QQQ_1m.csv'), 'Date,Time,Open,High,Low,Close,Volume\n2026.07.06,09:31,1,2,0.5,1.5,10\n2026.07.06,09:32,1.5,2,1,1.8,5\n');
    const q = await getBars({ symbol: 'QQQ', timeframe: '1m' }, { dataDir, client: null });
    expect(q.bars).toHaveLength(2);

    await expect(getBars({ symbol: 'TSLA', timeframe: '5m' }, { dataDir, client: null })).rejects.toThrow(/miko|import|TradeStation/i);
    const ds = await listDatasets(dataDir);
    expect(ds.map((d) => `${d.source}:${d.symbol}:${d.timeframe}`).sort()).toEqual(['cache:SPY:1m', 'import:QQQ:1m', 'import:SPY:1m']);
  });
});

describe('FileProfileStore', () => {
  test('roundtrip, unknown id is null, bad ids rejected', async () => {
    const store = new FileProfileStore(mkdtempSync(join(tmpdir(), 'miko-prof-')));
    expect(await store.load('nobody')).toBeNull();
    const p = {
      id: 'p1', name: 'Miko', createdAt: 1, xp: 10, level: 1, rating: 1000, streakDays: 0,
      stats: {}, achievements: {}, strategies: [], history: [], settings: { sound: true, music: true, assistant: true, reducedMotion: false },
    } as never;
    expect(profileProblems(p)).toEqual([]);
    await store.save(p);
    expect(await store.load('p1')).toEqual(p);
    await expect(store.load('../etc')).rejects.toThrow();
    expect(profileProblems({ id: 'x' }).length).toBeGreaterThan(0);
  });
});

describe('micro futures price proxy', () => {
  test('@MNQ is served from @NQ prices with the micro instrument', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'miko-proxy-'));
    const bars: Bar[] = Array.from({ length: 10 }, (_, i) => ({ t: 1_700_000_000_000 + i * 300_000, o: 20000 + i, h: 20002 + i, l: 19999 + i, c: 20001 + i, v: 100 }));
    await new BarCache(join(dataDir, 'cache')).merge('@NQ', '5m', bars);
    const s = await getBars({ symbol: '@MNQ', timeframe: '5m' }, { dataDir, client: null });
    expect(s.instrument.symbol).toBe('@MNQ');
    expect(s.instrument.pointValue).toBe(2);
    expect(s.pricedFrom).toBe('@NQ');
    expect(s.bars).toHaveLength(10);
    const listed = withProxies(await listDatasets(dataDir)).map((d) => d.symbol);
    expect(listed).toContain('@MNQ');
  });
});
