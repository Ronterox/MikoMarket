import { existsSync } from 'node:fs';
import { chmod, readFile, rename, stat, writeFile, mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { Bar, Instrument, Timeframe } from '@miko/engine';
import { readEnvFile } from './env.ts';
import { instrumentFor } from './instruments.ts';
import { dedupeBars, sessionOpenUtc } from './resample.ts';
import { timeframeForMs, tsInterval, type TsUnit } from './timeframes.ts';
import { localParts } from './tz.ts';

/**
 * TradeStation API v3 market data: OAuth refresh-token flow, barcharts (paged)
 * and the barcharts stream. Mirrors the behaviour of the Python integration
 * (webhook/auth.py): the token file is shared with other processes, so it is
 * re-read before deciding to refresh, the refreshed answer is MERGED over what
 * we hold (the reply carries no refresh_token), and it is written back
 * atomically through a temp file + rename.
 */

export const TS_LIVE_URL = 'https://api.tradestation.com';
export const TS_SIM_URL = 'https://sim-api.tradestation.com';
export const TS_AUTH_URL = 'https://signin.tradestation.com';
/** TradeStation serves at most this many intraday bars per request. */
export const TS_MAX_BARS = 57_600;

const ENV_KEYS = new Set([
  'TRADESTATION_API_KEY', 'TRADESTATION_SECRET', 'TRADESTATION_TOKEN', 'TRADESTATION_AUTH_URL',
  'TRADESTATION_SIM', 'TRADESTATION_TOKEN_MARGIN', 'TRADESTATION_BASE_URL',
]);

export interface TradeStationConfig {
  apiKey: string;
  secret: string;
  tokenPath: string;
  authUrl: string;
  baseUrl: string;
  /** Refresh when fewer than this many seconds are left on the access token. */
  marginSec: number;
  /** A 401 within this many seconds of the last forced refresh is not retried. */
  rejectCooldownSec: number;
  timeoutMs: number;
}

/** Raw bar as TradeStation sends it (numbers arrive as strings). */
export interface TsBar {
  High: string | number;
  Low: string | number;
  Open: string | number;
  Close: string | number;
  TimeStamp: string;          // bar CLOSE, UTC 'YYYY-MM-DDTHH:MM:SSZ'
  TotalVolume?: string | number;
  UpVolume?: string | number;
  DownVolume?: string | number;
  BarStatus?: 'Open' | 'Closed' | string;
  Epoch?: number;
  IsEndOfHistory?: boolean;
  IsRealtime?: boolean;
  [key: string]: unknown;
}

export interface BarchartsQuery {
  symbol: string;
  interval: number;
  unit: TsUnit;
  barsback?: number;
  firstdate?: string | number | Date;
  lastdate?: string | number | Date;
  sessiontemplate?: string;
  /** Keep the still-forming last bar (BarStatus 'Open'). Default false. */
  includeOpen?: boolean;
}

export class TradeStationError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'TradeStationError';
  }
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export interface TradeStationDeps {
  fetch?: FetchFn;
  now?: () => number;
  log?: (message: string) => void;
}

// ───────────────────────────── config ─────────────────────────────

function firstExisting(candidates: string[]): string {
  return candidates.find((p) => existsSync(p)) ?? candidates[0]!;
}

/**
 * Config from env: TRADESTATION_API_KEY, TRADESTATION_SECRET, TRADESTATION_TOKEN
 * (path to token.json), optionally TRADESTATION_ENV_FILE (a .env file such as
 * production/luis.env to take those keys from; real env vars win) and
 * TRADESTATION_SIM=1 for the simulator host. Returns a reason when incomplete.
 */
export function tradeStationConfig(env: Record<string, string | undefined> = process.env): { config: TradeStationConfig | null; reason?: string } {
  const merged: Record<string, string | undefined> = {};
  const envFile = env.TRADESTATION_ENV_FILE;
  if (envFile) {
    if (!existsSync(envFile)) return { config: null, reason: `TRADESTATION_ENV_FILE points at ${envFile}, which does not exist` };
    Object.assign(merged, readEnvFile(envFile, (k) => ENV_KEYS.has(k)));
  }
  for (const k of ENV_KEYS) if (env[k]) merged[k] = env[k];

  const apiKey = merged.TRADESTATION_API_KEY;
  const secret = merged.TRADESTATION_SECRET;
  if (!apiKey || !secret) {
    return { config: null, reason: 'TRADESTATION_API_KEY / TRADESTATION_SECRET are not set (set them, or TRADESTATION_ENV_FILE=path/to/your.env)' };
  }

  let tokenPath = merged.TRADESTATION_TOKEN;
  if (tokenPath && !isAbsolute(tokenPath)) {
    const roots = [process.cwd(), ...(envFile ? [dirname(resolve(envFile)), dirname(dirname(resolve(envFile)))] : [])];
    tokenPath = firstExisting(roots.map((r) => resolve(r, tokenPath!)));
  }
  if (!tokenPath && envFile) tokenPath = join(dirname(resolve(envFile)), 'token.json');
  if (!tokenPath) return { config: null, reason: 'TRADESTATION_TOKEN (path to token.json) is not set' };
  if (!existsSync(tokenPath)) return { config: null, reason: `token file ${tokenPath} does not exist (log in once with the TradeStation OAuth flow)` };

  const sim = /^(1|true|yes|on)$/i.test(merged.TRADESTATION_SIM ?? '');
  return {
    config: {
      apiKey, secret, tokenPath,
      authUrl: merged.TRADESTATION_AUTH_URL || TS_AUTH_URL,
      baseUrl: merged.TRADESTATION_BASE_URL || (sim ? TS_SIM_URL : TS_LIVE_URL),
      marginSec: Number(merged.TRADESTATION_TOKEN_MARGIN ?? 720) || 720,
      rejectCooldownSec: 30,
      timeoutMs: 30_000,
    },
  };
}

// ───────────────────────────── conversion ─────────────────────────────

/** The `exp` claim of a JWT (seconds), without verifying it. null if unreadable. */
export function jwtExpiry(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: unknown };
    const exp = Number(claims.exp);
    return Number.isFinite(exp) ? exp : null;
  } catch {
    return null;
  }
}

function isoUtc(v: string | number | Date): string {
  if (typeof v === 'string') return v;
  return new Date(v).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * TradeStation bar → engine Bar. TradeStation stamps the bar CLOSE; our `t` is
 * the OPEN: minute bars subtract their length, daily bars use the session open
 * of their trading date, weekly bars the session open of that week's Monday.
 * Volume = TotalVolume (or Up + Down when TotalVolume is missing).
 */
export function tsBarToBar(raw: TsBar, interval: number, unit: TsUnit, instrument?: Pick<Instrument, 'kind'>): Bar {
  const close = Date.parse(raw.TimeStamp);
  let t: number;
  if (unit === 'Minute') {
    t = close - interval * 60_000;
  } else {
    const p = localParts(close);
    let day = Date.UTC(p.y, p.mo - 1, p.d);
    if (unit === 'Weekly') day -= ((p.dow + 6) % 7) * 86_400_000;
    else if (unit === 'Monthly') day = Date.UTC(p.y, p.mo - 1, 1);
    const d = new Date(day);
    t = sessionOpenUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), instrument);
  }
  const total = raw.TotalVolume !== undefined ? Number(raw.TotalVolume) : Number(raw.UpVolume ?? 0) + Number(raw.DownVolume ?? 0);
  return {
    t,
    o: Number(raw.Open),
    h: Number(raw.High),
    l: Number(raw.Low),
    c: Number(raw.Close),
    v: Number.isFinite(total) ? total : 0,
  };
}

/** Same as tsBarToBar, using our Timeframe. */
export function tsBarToBarTf(raw: TsBar, tf: Timeframe, instrument?: Pick<Instrument, 'kind'>): Bar {
  const { interval, unit } = tsInterval(tf);
  return tsBarToBar(raw, interval, unit, instrument);
}

/**
 * Splits a chunked stream of concatenated JSON objects (newline-delimited or
 * not) into parsed values, tolerating objects split across chunks.
 */
export class JsonStreamSplitter {
  private buf = '';
  private pos = 0;
  private depth = 0;
  private inString = false;
  private escape = false;
  private start = -1;

  push(text: string): unknown[] {
    this.buf += text;
    const out: unknown[] = [];
    const s = this.buf;
    for (let i = this.pos; i < s.length; i++) {
      const ch = s.charCodeAt(i);
      if (this.inString) {
        if (this.escape) this.escape = false;
        else if (ch === 92) this.escape = true;         // backslash
        else if (ch === 34) this.inString = false;       // "
        continue;
      }
      if (ch === 34) { this.inString = true; continue; }
      if (ch === 123 || ch === 91) {                     // { [
        if (this.depth === 0) this.start = i;
        this.depth++;
      } else if (ch === 125 || ch === 93) {              // } ]
        this.depth--;
        if (this.depth === 0 && this.start >= 0) {
          const slice = s.slice(this.start, i + 1);
          try { out.push(JSON.parse(slice)); } catch { /* skip garbage */ }
          this.start = -1;
        }
        if (this.depth < 0) this.depth = 0;
      }
    }
    if (this.depth === 0) {
      this.buf = '';
      this.pos = 0;
    } else {
      this.buf = s.slice(this.start);
      this.pos = this.buf.length;
      this.start = 0;
    }
    return out;
  }
}

export interface StreamBarInfo {
  closed: boolean;
  raw: TsBar;
}

export interface StreamOptions {
  /** Bars of history to send on (re)connect. Default 1. */
  barsback?: number;
  sessiontemplate?: string;
  /** Reconnect when nothing (not even a heartbeat) arrived for this long. Default 45s. */
  idleMs?: number;
  /** Status / error notifications (connected, heartbeat, reconnecting...). */
  onStatus?: (status: string) => void;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((res) => {
    if (signal?.aborted) return res();
    const timer = setTimeout(res, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); res(); }, { once: true });
  });
}

// ───────────────────────────── client ─────────────────────────────

export class TradeStationClient {
  private token: Record<string, unknown> = {};
  private mtime: number | null = null;
  private renewing: Promise<void> | null = null;
  private lastReject = -Infinity;
  private readonly fetchFn: FetchFn;
  private readonly now: () => number;
  private readonly log: (message: string) => void;

  constructor(readonly config: TradeStationConfig, deps: TradeStationDeps = {}) {
    this.fetchFn = deps.fetch ?? ((input, init) => fetch(input, init));
    this.now = deps.now ?? (() => Date.now());
    this.log = deps.log ?? ((m) => console.error(m));
  }

  /** A client from env, or null when TradeStation isn't configured. */
  static fromEnv(env: Record<string, string | undefined> = process.env, deps?: TradeStationDeps): TradeStationClient | null {
    const { config } = tradeStationConfig(env);
    return config ? new TradeStationClient(config, deps) : null;
  }

  // ── token ──

  /** Seconds left on the access token we hold (0 when none or unreadable). */
  expiresIn(): number {
    const access = this.token.access_token;
    if (typeof access !== 'string' || !access) return 0;
    const exp = jwtExpiry(access);
    return exp === null ? 0 : Math.max(0, exp - this.now() / 1000);
  }

  /** Re-read the token file when it changed on disk (or when forced). */
  private async load(force = false): Promise<void> {
    let stamp: number | null = null;
    try { stamp = (await stat(this.config.tokenPath)).mtimeMs; } catch { stamp = null; }
    if (force || !this.token.access_token || stamp !== this.mtime) {
      try {
        const data = JSON.parse(await readFile(this.config.tokenPath, 'utf8')) as unknown;
        if (data && typeof data === 'object' && !Array.isArray(data)) {
          this.token = data as Record<string, unknown>;
          this.mtime = stamp;
        }
      } catch { /* unreadable: keep what we hold */ }
    }
  }

  private async writeToken(token: Record<string, unknown>): Promise<void> {
    const path = this.config.tokenPath;
    const tmp = `${path}.tmp`;
    await mkdir(dirname(path), { recursive: true });
    let mode: number | undefined;
    try { mode = (await stat(path)).mode & 0o777; } catch { mode = 0o600; }
    await writeFile(tmp, JSON.stringify(token, null, 2), { mode });
    if (mode !== undefined) await chmod(tmp, mode);
    await rename(tmp, path);
    try { this.mtime = (await stat(path)).mtimeMs; } catch { /* ignore */ }
  }

  /** One refresh_token grant. Throws on failure. */
  private async refreshGrant(): Promise<Record<string, unknown>> {
    const refreshToken = this.token.refresh_token;
    if (typeof refreshToken !== 'string' || !refreshToken) {
      throw new TradeStationError(`No refresh_token in ${this.config.tokenPath}; log in once with the TradeStation OAuth flow`);
    }
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.config.apiKey,
      client_secret: this.config.secret,
      refresh_token: refreshToken,
    });
    const res = await this.fetchFn(`${this.config.authUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });
    if (res.status !== 200) {
      const text = (await res.text()).slice(0, 200);
      throw new TradeStationError(`TradeStation refused the token refresh (${res.status}): ${text}`, res.status);
    }
    const fresh = (await res.json()) as unknown;
    if (!fresh || typeof fresh !== 'object' || typeof (fresh as Record<string, unknown>).access_token !== 'string') {
      throw new TradeStationError('TradeStation token refresh returned no access_token');
    }
    return fresh as Record<string, unknown>;
  }

  /**
   * Refresh under an in-process lock. The file is re-read first: another
   * process sharing it may already have refreshed, and then its token is ours.
   */
  private renew(force: boolean): Promise<void> {
    if (this.renewing) return this.renewing;
    this.renewing = (async () => {
      await this.load(true);
      if (!force && this.expiresIn() > this.config.marginSec) return;
      try {
        const fresh = await this.refreshGrant();
        this.token = { ...this.token, ...fresh };
        await this.writeToken(this.token);
      } catch (err) {
        // A failed refresh costs nothing while the token we hold still works.
        if (!force && this.expiresIn() > 0) {
          this.log(`TradeStation refresh failed, keeping the current token: ${(err as Error).message}`);
          return;
        }
        throw err;
      }
    })().finally(() => { this.renewing = null; });
    return this.renewing;
  }

  /** A valid access token, refreshed when within the margin of expiring. */
  async accessToken(): Promise<string> {
    await this.load();
    if (this.expiresIn() <= this.config.marginSec) await this.renew(false);
    const access = this.token.access_token;
    if (typeof access !== 'string' || !access) throw new TradeStationError(`No access_token in ${this.config.tokenPath}`);
    return access;
  }

  /**
   * The API refused `stale`. Adopt a token another process wrote, or force one
   * refresh (at most once per cooldown). null = do not retry.
   */
  private async rejected(stale: string): Promise<string | null> {
    await this.load(true);
    const held = this.token.access_token;
    if (typeof held === 'string' && held && held !== stale) return held;
    if (this.now() - this.lastReject < this.config.rejectCooldownSec * 1000) return null;
    this.lastReject = this.now();
    try { await this.renew(true); } catch (err) { this.log((err as Error).message); return null; }
    const fresh = this.token.access_token;
    return typeof fresh === 'string' && fresh !== stale ? fresh : null;
  }

  private async authedFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.accessToken();
    const go = (bearer: string): Promise<Response> =>
      this.fetchFn(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${bearer}` } });
    let res = await go(token);
    if (res.status === 401) {
      const fresh = await this.rejected(token);
      if (fresh) res = await go(fresh);
    }
    return res;
  }

  // ── bars ──

  private marketUrl(path: string, params: Record<string, string | number | undefined>): string {
    const q = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join('&');
    return `${this.config.baseUrl}/v3/marketdata/${path}${q ? `?${q}` : ''}`;
  }

  private static symbolPath(symbol: string): string {
    return encodeURIComponent(symbol).replace(/%40/g, '@');
  }

  /** One barcharts request, raw. [] when TradeStation says there is no data in the window. */
  async barchartsPage(q: Omit<BarchartsQuery, 'includeOpen'>): Promise<TsBar[]> {
    const url = this.marketUrl(`barcharts/${TradeStationClient.symbolPath(q.symbol)}`, {
      interval: q.interval,
      unit: q.unit,
      barsback: q.barsback,
      firstdate: q.firstdate !== undefined ? isoUtc(q.firstdate) : undefined,
      lastdate: q.lastdate !== undefined ? isoUtc(q.lastdate) : undefined,
      sessiontemplate: q.sessiontemplate,
    });
    const res = await this.authedFetch(url, { signal: AbortSignal.timeout(this.config.timeoutMs) });
    if (res.status === 404) {
      const text = await res.text();
      if (/no data/i.test(text)) return [];
      throw new TradeStationError(`TradeStation 404 for ${q.symbol}: ${text.slice(0, 200)}`, 404);
    }
    if (res.status !== 200) {
      throw new TradeStationError(`TradeStation said ${res.status} for ${q.symbol} barcharts: ${(await res.text()).slice(0, 200)}`, res.status);
    }
    const body = (await res.json()) as { Bars?: TsBar[] };
    return Array.isArray(body.Bars) ? body.Bars : [];
  }

  /**
   * Bars as engine `Bar`s, oldest first, deduped, closed bars only (unless
   * includeOpen). Pages automatically: barsback above 57,600 walks back with
   * lastdate; a firstdate..lastdate range is split into windows that each stay
   * under the per-request cap.
   */
  async barcharts(q: BarchartsQuery): Promise<Bar[]> {
    const instrument = instrumentFor(q.symbol);
    const raw: TsBar[] = [];
    const base = { symbol: q.symbol, interval: q.interval, unit: q.unit, sessiontemplate: q.sessiontemplate };

    if (q.firstdate !== undefined) {
      const first = new Date(q.firstdate).getTime();
      const last = q.lastdate !== undefined ? new Date(q.lastdate).getTime() : this.now();
      // ~30 days of round-the-clock 1-minute bars is ~43k, under the cap.
      const windowMs = q.unit === 'Minute' ? Math.min(30 * q.interval, 3650) * 86_400_000 : last - first + 1;
      for (let start = first; start < last; start += windowMs) {
        const stop = Math.min(start + windowMs, last);
        raw.push(...(await this.barchartsPage({ ...base, firstdate: start, lastdate: stop })));
      }
    } else {
      let remaining = Math.max(1, q.barsback ?? 1);
      let lastdate = q.lastdate;
      while (remaining > 0) {
        const n = Math.min(remaining, TS_MAX_BARS);
        const page = await this.barchartsPage({ ...base, barsback: n, lastdate });
        if (!page.length) break;
        raw.unshift(...page);
        remaining -= page.length;
        if (page.length < n) break;
        lastdate = Date.parse(page[0]!.TimeStamp) - 1000;
      }
    }

    const kept = q.includeOpen ? raw : raw.filter((b) => (b.BarStatus ?? 'Closed') === 'Closed');
    return dedupeBars(kept.map((b) => tsBarToBar(b, q.interval, q.unit, instrument)));
  }

  /** Convenience: bars for our Timeframe, by count or by date range. */
  async fetchBars(symbol: string, tf: Timeframe, opts: { bars?: number; from?: number | string | Date; to?: number | string | Date } = {}): Promise<Bar[]> {
    const { interval, unit } = tsInterval(tf);
    if (opts.from !== undefined) return this.barcharts({ symbol, interval, unit, firstdate: opts.from, lastdate: opts.to });
    return this.barcharts({ symbol, interval, unit, barsback: opts.bars ?? 5000, lastdate: opts.to });
  }

  /**
   * Live bars from /v3/marketdata/stream/barcharts/{symbol}. Calls onBar for
   * every update (the forming bar repeats with closed=false until it closes).
   * Handles heartbeats, stream errors and GoAway, and reconnects with backoff
   * until `signal` aborts. Resolves when aborted; rejects only on a fatal
   * error (bad symbol, unrecoverable auth).
   */
  async streamBars(
    symbol: string,
    interval: number,
    unit: TsUnit,
    onBar: (bar: Bar, info: StreamBarInfo) => void,
    signal?: AbortSignal,
    opts: StreamOptions = {},
  ): Promise<void> {
    const instrument = instrumentFor(symbol);
    const idleMs = opts.idleMs ?? 45_000;
    const status = opts.onStatus ?? (() => {});
    let attempt = 0;
    let first = true;

    while (!signal?.aborted) {
      const conn = new AbortController();
      const onAbort = (): void => conn.abort();
      signal?.addEventListener('abort', onAbort, { once: true });
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      const touch = (): void => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => conn.abort(), idleMs);
      };
      let fatal: Error | null = null;
      try {
        const url = this.marketUrl(`stream/barcharts/${TradeStationClient.symbolPath(symbol)}`, {
          interval, unit, barsback: first ? (opts.barsback ?? 1) : 2, sessiontemplate: opts.sessiontemplate,
        });
        touch();
        const res = await this.authedFetch(url, { signal: conn.signal });
        if (res.status === 400 || res.status === 404) {
          fatal = new TradeStationError(`TradeStation stream refused ${symbol}: ${(await res.text()).slice(0, 200)}`, res.status);
          throw fatal;
        }
        if (res.status !== 200 || !res.body) {
          throw new TradeStationError(`TradeStation stream said ${res.status}: ${(await res.text()).slice(0, 200)}`, res.status);
        }
        status('connected');
        first = false;
        const splitter = new JsonStreamSplitter();
        const decoder = new TextDecoder();
        const reader = res.body.getReader();
        conn.signal.addEventListener('abort', () => { reader.cancel().catch(() => {}); }, { once: true });
        for (;;) {
          const { done, value: chunk } = await reader.read();
          if (done) break;
          touch();
          for (const msg of splitter.push(decoder.decode(chunk, { stream: true }))) {
            if (!msg || typeof msg !== 'object') continue;
            const m = msg as Record<string, unknown>;
            if ('Heartbeat' in m) { status('heartbeat'); continue; }
            if ('Error' in m || 'GoAway' in m) {
              const text = String(m.Message ?? m.Error ?? 'GoAway');
              if (/invalid symbol/i.test(text)) { fatal = new TradeStationError(`TradeStation stream: ${text}`); throw fatal; }
              throw new TradeStationError(`TradeStation stream error: ${text}`);
            }
            if (typeof m.TimeStamp === 'string' && m.Close !== undefined) {
              attempt = 0;
              const raw = m as unknown as TsBar;
              onBar(tsBarToBar(raw, interval, unit, instrument), { closed: (raw.BarStatus ?? 'Closed') === 'Closed', raw });
            }
          }
        }
        status('ended');
      } catch (err) {
        if (fatal) throw fatal;
        if (signal?.aborted) break;
        status(`reconnecting: ${(err as Error).message}`);
      } finally {
        clearTimeout(idleTimer);
        signal?.removeEventListener('abort', onAbort);
      }
      if (signal?.aborted) break;
      const wait = Math.min(60_000, 1000 * 2 ** attempt);
      attempt++;
      await sleep(wait, signal);
    }
  }

  /** streamBars using our Timeframe. */
  streamBarsTf(symbol: string, tf: Timeframe, onBar: (bar: Bar, info: StreamBarInfo) => void, signal?: AbortSignal, opts?: StreamOptions): Promise<void> {
    const { interval, unit } = tsInterval(tf);
    return this.streamBars(symbol, interval, unit, onBar, signal, opts);
  }
}

/** Timeframe for a TradeStation interval/unit, or null when we have no matching one. */
export function timeframeForTs(interval: number, unit: TsUnit): Timeframe | null {
  if (unit === 'Daily' && interval === 1) return '1d';
  if (unit === 'Weekly' && interval === 1) return '1w';
  if (unit === 'Minute') return timeframeForMs(interval * 60_000);
  return null;
}

