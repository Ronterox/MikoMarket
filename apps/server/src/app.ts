import { existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { STRATEGY_TEMPLATES, listIndicators } from '@miko/engine';
import {
  FileProfileStore, INSTRUMENTS, TradeStationClient, availableTimeframes, dataPaths, getBars, instrumentFor,
  listDatasets, withProxies, parseTimeframe, profileProblems, isValidProfileId, tradeStationConfig,
} from '@miko/data';
import type { Profile } from '@miko/engine';

export interface AppOptions {
  /** Data directory (cache/, import/, profiles/). Default: repo data/ or MIKO_DATA_DIR. */
  dataDir?: string;
  /** Built web app to serve; null disables. Default apps/web/dist when it exists. */
  webDir?: string | null;
  /** TradeStation client; undefined = from env, null = offline only. */
  client?: TradeStationClient | null;
  /** Responses larger than this (bytes) are gzipped when the client accepts it. */
  gzipOver?: number;
  log?: (message: string) => void;
}

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?$/;
const MAX_BARS = 200_000;
const MAX_PROFILE_BYTES = 2 * 1024 * 1024;

function cors(req: Request, headers: Headers): void {
  const origin = req.headers.get('origin');
  if (origin && LOCAL_ORIGIN.test(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type');
    headers.append('Vary', 'Origin');
  }
}

function safeJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => (typeof v === 'number' && !Number.isFinite(v) ? null : v));
}

/** The request handler, separate from Bun.serve so tests and other hosts can reuse it. */
export function createApp(opts: AppOptions = {}): { fetch: (req: Request) => Promise<Response>; client: TradeStationClient | null } {
  const paths = dataPaths(opts.dataDir);
  const store = new FileProfileStore(paths.profiles);
  const client = opts.client === undefined ? TradeStationClient.fromEnv() : opts.client;
  const tsReason = client ? undefined : opts.client === null ? 'disabled' : tradeStationConfig().reason;
  const defaultWeb = resolve(import.meta.dir, '../../web/dist');
  const webDir = opts.webDir === undefined ? (existsSync(defaultWeb) ? defaultWeb : null) : opts.webDir;
  const gzipOver = opts.gzipOver ?? 32 * 1024;
  const log = opts.log ?? ((m: string) => console.error(m));

  const json = (req: Request, body: unknown, status = 200): Response => {
    const text = safeJson(body);
    const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8' });
    let payload: string | Uint8Array = text;
    if (text.length > gzipOver && /\bgzip\b/.test(req.headers.get('accept-encoding') ?? '')) {
      payload = Bun.gzipSync(new TextEncoder().encode(text));
      headers.set('Content-Encoding', 'gzip');
      headers.set('Vary', 'Accept-Encoding');
    }
    return new Response(payload, { status, headers });
  };
  const error = (req: Request, status: number, message: string, extra: Record<string, unknown> = {}): Response =>
    json(req, { error: message, ...extra }, status);

  async function bars(req: Request, url: URL): Promise<Response> {
    const symbol = url.searchParams.get('symbol') ?? 'SPY';
    let timeframe;
    try { timeframe = parseTimeframe(url.searchParams.get('tf') ?? '5m'); } catch (e) { return error(req, 400, (e as Error).message); }
    const n = Number(url.searchParams.get('bars') ?? 5000);
    if (!Number.isFinite(n) || n <= 0) return error(req, 400, 'bars must be a positive number');
    const num = (k: string): number | undefined => {
      const v = url.searchParams.get(k);
      if (!v) return undefined;
      const t = /^\d+$/.test(v) ? Number(v) : Date.parse(v);
      return Number.isFinite(t) ? t : undefined;
    };
    try {
      const s = await getBars(
        { symbol, timeframe, bars: Math.min(n, MAX_BARS), from: num('from'), to: num('to') },
        { dataDir: opts.dataDir, client, log },
      );
      return json(req, { instrument: s.instrument, timeframe: s.timeframe, bars: s.bars, source: s.source, derivedFrom: s.derivedFrom, pricedFrom: s.pricedFrom });
    } catch (e) {
      return error(req, 404, (e as Error).message);
    }
  }

  function stream(req: Request, url: URL): Response {
    if (!client) {
      return error(req, 404, 'Live data needs TradeStation, which is not configured on this server. Replays still work offline.', {
        hint: 'Set TRADESTATION_ENV_FILE=/path/to/your.env (or TRADESTATION_API_KEY, TRADESTATION_SECRET, TRADESTATION_TOKEN) and restart the server.',
        reason: tsReason,
      });
    }
    const symbol = instrumentFor(url.searchParams.get('symbol') ?? 'SPY').symbol;
    let tf;
    try { tf = parseTimeframe(url.searchParams.get('tf') ?? '1m'); } catch (e) { return error(req, 400, (e as Error).message); }
    const ac = new AbortController();
    req.signal.addEventListener('abort', () => ac.abort(), { once: true });
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(ctrl) {
        let open = true;
        const write = (s: string): void => { if (open) { try { ctrl.enqueue(enc.encode(s)); } catch { open = false; ac.abort(); } } };
        const send = (event: string, data: unknown): void => write(`event: ${event}\ndata: ${safeJson(data)}\n\n`);
        const ping = setInterval(() => write(': ping\n\n'), 15_000);
        send('hello', { symbol, timeframe: tf, instrument: instrumentFor(symbol) });
        client.streamBarsTf(symbol, tf, (bar, info) => send('bar', { ...bar, closed: info.closed }), ac.signal, {
          barsback: Number(url.searchParams.get('barsback') ?? 1) || 1,
          onStatus: (s) => { if (s !== 'heartbeat') send('status', { status: s }); },
        })
          .catch((e: Error) => send('error', { error: e.message }))
          .finally(() => {
            clearInterval(ping);
            if (open) { open = false; try { ctrl.close(); } catch { /* already closed */ } }
          });
      },
      cancel() { ac.abort(); },
    });
    return new Response(body, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' },
    });
  }

  async function profile(req: Request, id: string): Promise<Response> {
    if (!isValidProfileId(id)) return error(req, 400, 'profile id must be 1-64 chars of [A-Za-z0-9_-]');
    if (req.method === 'GET') {
      const p = await store.load(id);
      return p ? json(req, p) : error(req, 404, `No profile "${id}" yet`);
    }
    if (req.method === 'PUT') {
      const len = Number(req.headers.get('content-length') ?? 0);
      if (len > MAX_PROFILE_BYTES) return error(req, 413, 'profile too large');
      let body: unknown;
      try { body = await req.json(); } catch { return error(req, 400, 'body must be JSON'); }
      const problems = profileProblems(body);
      if (problems.length) return error(req, 400, 'not a valid profile', { problems });
      if ((body as Profile).id !== id) return error(req, 400, `profile id "${(body as Profile).id}" does not match the URL "${id}"`);
      await store.save(body as Profile);
      return json(req, { ok: true, id });
    }
    return error(req, 405, 'use GET or PUT');
  }

  function serveStatic(req: Request, url: URL): Response | null {
    if (!webDir) return null;
    let rel: string;
    try { rel = decodeURIComponent(url.pathname); } catch { return null; }
    const target = normalize(join(webDir, rel));
    if (target !== webDir && !target.startsWith(webDir + sep)) return null;
    try {
      if (statSync(target).isFile()) {
        const cache = /\/assets\//.test(rel) ? 'public, max-age=31536000, immutable' : 'no-cache';
        return new Response(Bun.file(target), { headers: { 'Cache-Control': cache } });
      }
    } catch { /* fall through to SPA */ }
    if (extname(rel) && extname(rel) !== '.html') return null;
    const index = join(webDir, 'index.html');
    return existsSync(index) ? new Response(Bun.file(index), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' } }) : null;
  }

  async function route(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname.replace(/\/+$/, '') || '/';
    if (req.method === 'OPTIONS') return new Response(null, { status: 204 });

    if (p.startsWith('/api/')) {
      const prof = /^\/api\/profile\/([^/]+)$/.exec(p);
      if (prof) return profile(req, decodeURIComponent(prof[1]!));
      if (req.method !== 'GET') return error(req, 405, 'method not allowed');
      switch (p) {
        case '/api/health':
          return json(req, { ok: true, service: 'mikomarket', tradestation: Boolean(client), web: Boolean(webDir) });
        case '/api/instruments':
          return json(req, INSTRUMENTS);
        case '/api/indicators':
          return json(req, listIndicators());
        case '/api/templates':
          return json(req, STRATEGY_TEMPLATES);
        case '/api/bars':
          return bars(req, url);
        case '/api/stream':
          return stream(req, url);
        case '/api/datasets': {
          const datasets = withProxies(await listDatasets(opts.dataDir));
          return json(req, {
            datasets: datasets.map(({ file: _file, ...d }) => d),
            available: availableTimeframes(datasets),
            tradestation: { configured: Boolean(client), reason: tsReason },
          });
        }
        default:
          return error(req, 404, `No such endpoint ${p}`);
      }
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      const res = serveStatic(req, url);
      if (res) return res;
      if (!webDir && p === '/') {
        return new Response('MikoMarket API is running. The web app is not built yet: bun run --filter @miko/web build\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    }
    return new Response('Not found\n', { status: 404 });
  }

  return {
    client,
    async fetch(req: Request): Promise<Response> {
      let res: Response;
      try {
        res = await route(req);
      } catch (e) {
        log(`server error: ${(e as Error).stack ?? e}`);
        res = Response.json({ error: 'internal error' }, { status: 500 });
      }
      cors(req, res.headers);
      return res;
    },
  };
}
