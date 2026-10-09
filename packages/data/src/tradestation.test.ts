import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  JsonStreamSplitter, TradeStationClient, jwtExpiry, tradeStationConfig, tsBarToBar, tsBarToBarTf,
  type TradeStationConfig, type TsBar,
} from './tradestation.ts';
import { instrumentFor } from './instruments.ts';

const FIXTURE = {
  Bars: [
    { High: '581.5', Low: '580.1', Open: '580.2', Close: '581', TimeStamp: '2026-10-09T13:35:00Z', TotalVolume: '12345', DownTicks: 10, DownVolume: '5000', OpenInterest: '0', IsRealtime: false, IsEndOfHistory: false, TotalTicks: 30, UnchangedTicks: 0, UnchangedVolume: '0', UpTicks: 20, UpVolume: '7345', Epoch: 1791552900000, BarStatus: 'Closed' },
    { High: '582', Low: '580.9', Open: '581', Close: '581.8', TimeStamp: '2026-10-09T13:40:00Z', TotalVolume: '9000', BarStatus: 'Closed' },
    { High: '582.2', Low: '581.5', Open: '581.8', Close: '582.1', TimeStamp: '2026-10-09T13:45:00Z', TotalVolume: '100', BarStatus: 'Open' },
  ] as TsBar[],
};

function b64url(s: string): string {
  return Buffer.from(s).toString('base64url');
}
function jwt(exp: number): string {
  return `${b64url('{"alg":"none"}')}.${b64url(JSON.stringify({ exp, sub: 'test' }))}.sig`;
}

const NOW = Date.UTC(2026, 9, 10, 12, 0);

function setup(expInSec: number): { cfg: TradeStationConfig; tokenPath: string; stale: string } {
  const dir = mkdtempSync(join(tmpdir(), 'miko-ts-'));
  const tokenPath = join(dir, 'token.json');
  const stale = jwt(NOW / 1000 + expInSec);
  writeFileSync(tokenPath, JSON.stringify({ access_token: stale, refresh_token: 'refresh-abc', id_token: 'id', expires_in: 1200 }));
  const cfg: TradeStationConfig = {
    apiKey: 'key', secret: 'secret', tokenPath, authUrl: 'https://auth.test', baseUrl: 'https://api.test',
    marginSec: 720, rejectCooldownSec: 30, timeoutMs: 5000,
  };
  return { cfg, tokenPath, stale };
}

type Call = { url: string; init?: RequestInit };
function mockFetch(handler: (url: string, init: RequestInit | undefined, n: number) => Response | Promise<Response>): { fetch: (u: string, i?: RequestInit) => Promise<Response>; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return handler(url, init, calls.length);
    },
  };
}

describe('bar conversion', () => {
  test('minute bars: close stamp -> open time, TotalVolume', () => {
    const b = tsBarToBar(FIXTURE.Bars[0]!, 5, 'Minute');
    expect(b).toEqual({ t: Date.UTC(2026, 9, 9, 13, 30), o: 580.2, h: 581.5, l: 580.1, c: 581, v: 12345 });
    expect(tsBarToBarTf(FIXTURE.Bars[1]!, '5m').t).toBe(Date.UTC(2026, 9, 9, 13, 35));
  });

  test('daily bars use the session open of their date', () => {
    const raw = { ...FIXTURE.Bars[0]!, TimeStamp: '2026-10-09T20:00:00Z' };
    expect(tsBarToBarTf(raw, '1d', instrumentFor('SPY')).t).toBe(Date.UTC(2026, 9, 9, 13, 30)); // 09:30 EDT
    const fut = { ...FIXTURE.Bars[0]!, TimeStamp: '2026-10-09T21:00:00Z' };
    expect(tsBarToBarTf(fut, '1d', instrumentFor('@NQ')).t).toBe(Date.UTC(2026, 9, 8, 22, 0)); // 18:00 EDT the day before
  });

  test('weekly bars start on Monday', () => {
    const raw = { ...FIXTURE.Bars[0]!, TimeStamp: '2026-10-09T20:00:00Z' }; // Friday
    expect(tsBarToBarTf(raw, '1w', instrumentFor('SPY')).t).toBe(Date.UTC(2026, 9, 5, 13, 30));
  });

  test('JSON stream splitter handles split chunks, strings with braces and heartbeats', () => {
    const s = new JsonStreamSplitter();
    const text = '{"Heartbeat":1,"Timestamp":"x"}\n{"Close":"1","TimeStamp":"2026-10-09T13:35:00Z","Note":"a } b"}{"Error":"oops"}';
    const out: unknown[] = [];
    for (let i = 0; i < text.length; i += 7) out.push(...s.push(text.slice(i, i + 7)));
    expect(out).toHaveLength(3);
    expect((out[1] as { Note: string }).Note).toBe('a } b');
  });

  test('jwtExpiry reads exp and tolerates garbage', () => {
    expect(jwtExpiry(jwt(123))).toBe(123);
    expect(jwtExpiry('not-a-jwt')).toBeNull();
  });
});

describe('config', () => {
  test('reads only TRADESTATION_* keys from an env file and finds token.json beside it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'miko-env-'));
    writeFileSync(join(dir, 'x.env'), 'OTHER=1\nexport TRADESTATION_API_KEY="k"\nTRADESTATION_SECRET=s\n# c\n');
    writeFileSync(join(dir, 'token.json'), '{}');
    const { config } = tradeStationConfig({ TRADESTATION_ENV_FILE: join(dir, 'x.env') });
    expect(config?.apiKey).toBe('k');
    expect(config?.tokenPath).toBe(join(dir, 'token.json'));
    expect(config?.baseUrl).toBe('https://api.tradestation.com');
    expect(tradeStationConfig({}).config).toBeNull();
    expect(tradeStationConfig({ TRADESTATION_ENV_FILE: join(dir, 'x.env'), TRADESTATION_SIM: '1' }).config?.baseUrl).toBe('https://sim-api.tradestation.com');
  });
});

describe('token refresh', () => {
  test('refreshes within the margin, merges, writes atomically, single flight', async () => {
    const { cfg, tokenPath } = setup(100); // 100s left < 720s margin
    const fresh = jwt(NOW / 1000 + 1200);
    const m = mockFetch(async (url, init) => {
      expect(url).toBe('https://auth.test/oauth/token');
      const body = new URLSearchParams(String(init?.body));
      expect(body.get('grant_type')).toBe('refresh_token');
      expect(body.get('refresh_token')).toBe('refresh-abc');
      expect(body.get('client_id')).toBe('key');
      await Bun.sleep(5);
      return Response.json({ access_token: fresh, expires_in: 1200, id_token: 'id2' });
    });
    const client = new TradeStationClient(cfg, { fetch: m.fetch, now: () => NOW, log: () => {} });
    const tokens = await Promise.all([client.accessToken(), client.accessToken(), client.accessToken()]);
    expect(tokens).toEqual([fresh, fresh, fresh]);
    expect(m.calls).toHaveLength(1);
    const saved = JSON.parse(readFileSync(tokenPath, 'utf8'));
    expect(saved.access_token).toBe(fresh);
    expect(saved.refresh_token).toBe('refresh-abc'); // kept: the reply has none
    expect(saved.id_token).toBe('id2');
    expect(existsSync(`${tokenPath}.tmp`)).toBe(false);
  });

  test('does not refresh while far from expiry', async () => {
    const { cfg, stale } = setup(1100);
    const m = mockFetch(() => new Response('no', { status: 500 }));
    const client = new TradeStationClient(cfg, { fetch: m.fetch, now: () => NOW, log: () => {} });
    expect(await client.accessToken()).toBe(stale);
    expect(m.calls).toHaveLength(0);
  });

  test('adopts a token another process already refreshed', async () => {
    const { cfg, tokenPath } = setup(100);
    const other = jwt(NOW / 1000 + 1200);
    writeFileSync(tokenPath, JSON.stringify({ access_token: other, refresh_token: 'refresh-abc' }));
    const m = mockFetch(() => new Response('no', { status: 500 }));
    const client = new TradeStationClient(cfg, { fetch: m.fetch, now: () => NOW, log: () => {} });
    expect(await client.accessToken()).toBe(other);
    expect(m.calls).toHaveLength(0);
  });

  test('a failed refresh keeps a still-valid token; an expired one throws', async () => {
    const { cfg, stale } = setup(100);
    const m = mockFetch(() => new Response('denied', { status: 400 }));
    const client = new TradeStationClient(cfg, { fetch: m.fetch, now: () => NOW, log: () => {} });
    expect(await client.accessToken()).toBe(stale);

    const expired = setup(-10);
    const c2 = new TradeStationClient(expired.cfg, { fetch: m.fetch, now: () => NOW, log: () => {} });
    await expect(c2.accessToken()).rejects.toThrow(/refused the token refresh/);
  });

  test('a 401 forces one refresh and retries', async () => {
    const { cfg, stale } = setup(1100);
    const fresh = jwt(NOW / 1000 + 1200);
    const m = mockFetch((url, init) => {
      if (url.includes('/oauth/token')) return Response.json({ access_token: fresh });
      const auth = (init?.headers as Record<string, string>).Authorization;
      return auth === `Bearer ${stale}` ? new Response('Unauthorized', { status: 401 }) : Response.json(FIXTURE);
    });
    const client = new TradeStationClient(cfg, { fetch: m.fetch, now: () => NOW, log: () => {} });
    const bars = await client.fetchBars('SPY', '5m', { bars: 3 });
    expect(bars).toHaveLength(2); // the forming bar is dropped
    expect(m.calls.map((c) => (c.url.includes('oauth') ? 'auth' : 'bars'))).toEqual(['bars', 'auth', 'bars']);
  });
});

describe('barcharts paging', () => {
  test('barsback above 57,600 walks back with lastdate', async () => {
    const { cfg } = setup(1100);
    const m = mockFetch((url) => {
      const u = new URL(url);
      const n = Number(u.searchParams.get('barsback'));
      const last = u.searchParams.get('lastdate');
      const end = last ? Math.floor(Date.parse(last) / 60_000) * 60_000 : Date.UTC(2026, 9, 9, 20, 0); // lastdate is inclusive
      const bars = Array.from({ length: n }, (_, i) => ({
        Open: '1', High: '1', Low: '1', Close: '1', TotalVolume: '1', BarStatus: 'Closed',
        TimeStamp: new Date(end - (n - 1 - i) * 60_000).toISOString().replace('.000Z', 'Z'),
      }));
      return Response.json({ Bars: bars });
    });
    const client = new TradeStationClient(cfg, { fetch: m.fetch, now: () => NOW, log: () => {} });
    const bars = await client.barcharts({ symbol: '@NQ', interval: 1, unit: 'Minute', barsback: 60_000 });
    expect(m.calls).toHaveLength(2);
    expect(new URL(m.calls[0]!.url).searchParams.get('barsback')).toBe('57600');
    expect(new URL(m.calls[1]!.url).searchParams.get('barsback')).toBe('2400');
    expect(m.calls[0]!.url).toContain('/v3/marketdata/barcharts/@NQ?');
    expect(bars).toHaveLength(60_000);
    for (let i = 1; i < bars.length; i++) expect(bars[i]!.t - bars[i - 1]!.t).toBe(60_000);
  });

  test('date ranges are split into windows; 404 "No data" is an empty window', async () => {
    const { cfg } = setup(1100);
    const m = mockFetch((url) => {
      const first = new URL(url).searchParams.get('firstdate')!;
      if (first.startsWith('2026-01-01')) return new Response('{"Error":"NotFound","Message":"No data available."}', { status: 404 });
      return Response.json({ Bars: [{ Open: '1', High: '1', Low: '1', Close: '1', TotalVolume: '1', TimeStamp: first, BarStatus: 'Closed' }] });
    });
    const client = new TradeStationClient(cfg, { fetch: m.fetch, now: () => NOW, log: () => {} });
    const bars = await client.barcharts({ symbol: 'SPY', interval: 1, unit: 'Minute', firstdate: '2026-01-01T00:00:00Z', lastdate: '2026-03-15T00:00:00Z' });
    expect(m.calls).toHaveLength(3); // 30-day windows
    expect(bars).toHaveLength(2);
  });
});

describe('streaming', () => {
  test('emits bars, skips heartbeats, reconnects after a stream error, stops on abort', async () => {
    const { cfg } = setup(1100);
    let connections = 0;
    const ac = new AbortController();
    const m = mockFetch(() => {
      connections++;
      const enc = new TextEncoder();
      const lines = connections === 1
        ? ['{"Heartbeat":1}\n', '{"Open":"1","High":"2","Low":"0.5","Close":"1.5","TimeStamp":"2026-10-09T13:35:00Z","TotalVolume":"10","BarStatus":"Open"}\n', '{"Error":"Fail","Message":"temporary"}\n']
        : ['{"Open":"1","High":"2","Low":"0.5","Close":"1.7","TimeStamp":"2026-10-09T13:35:00Z","TotalVolume":"12","BarStatus":"Closed"}\n'];
      const body = new ReadableStream<Uint8Array>({
        start(ctrl) {
          for (const l of lines) ctrl.enqueue(enc.encode(l));
          if (connections > 1) setTimeout(() => ac.abort(), 5);
          else ctrl.close();
        },
      });
      return new Response(body, { status: 200 });
    });
    const client = new TradeStationClient(cfg, { fetch: m.fetch, now: () => NOW, log: () => {} });
    const got: { c: number; closed: boolean; t: number }[] = [];
    const statuses: string[] = [];
    await client.streamBars('SPY', 5, 'Minute', (bar, info) => got.push({ c: bar.c, closed: info.closed, t: bar.t }), ac.signal, { onStatus: (s) => statuses.push(s) });
    expect(got).toEqual([
      { c: 1.5, closed: false, t: Date.UTC(2026, 9, 9, 13, 30) },
      { c: 1.7, closed: true, t: Date.UTC(2026, 9, 9, 13, 30) },
    ]);
    expect(connections).toBe(2);
    expect(statuses.some((s) => s.startsWith('reconnecting'))).toBe(true);
  }, 10_000);
});
