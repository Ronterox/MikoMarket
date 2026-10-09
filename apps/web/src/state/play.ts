import { create } from 'zustand';
import {
  awardTrade, planQuickTrade, Session, sumXp,
  type BarSeries, type EngineEvent, type Instrument, type OrderAction, type StrategySpec, type Timeframe, type Trade, type XpAward,
} from '@miko/engine';
import { fetchInstruments, loadSeries } from '../lib/api.ts';
import { LOCAL_INSTRUMENTS, startingCash } from '../lib/instruments.ts';
import { sound } from '../lib/sound.ts';
import { fx } from '../lib/fx.ts';
import { signedMoney } from '../lib/format.ts';
import { lsGet, lsSet } from '../lib/storage.ts';
import { token } from '../lib/theme.ts';
import { coach, todayLocal, useApp, type ResultsData } from './app.ts';

export type Speed = 0 | 1 | 2 | 3;
export type RiskPct = 0.5 | 1 | 2;

/** ms per bar for each speed. */
export const SPEED_MS: Record<Speed, number> = { 0: 0, 1: 1400, 2: 600, 3: 180 };
const ROUND_BARS = 240;
const HISTORY_BARS = 160;

interface Prefs { symbol: string; tf: Timeframe; indicators: string[]; riskPct: RiskPct; mystery: boolean }
const prefs: Prefs = { symbol: 'SPY', tf: '5m', indicators: ['ema'], riskPct: 1, mystery: false, ...(lsGet<Partial<Prefs>>('miko.play') ?? {}) };
const savePrefs = (p: Partial<Prefs>) => lsSet('miko.play', { ...(lsGet<Prefs>('miko.play') ?? prefs), ...p });

interface PlayState {
  instruments: Instrument[];
  instrument: Instrument;
  tf: Timeframe;
  loading: boolean;
  demo: boolean;
  series: BarSeries | null;
  session: Session | null;
  botSession: Session | null;
  botSpec: StrategySpec | null;
  /** Bumped whenever the session changes, so React re-reads session getters. */
  version: number;
  /** Bumped when a brand-new round starts (chart does a full reset). */
  round: number;
  speed: Speed;
  mystery: boolean;
  indicators: string[];
  riskPct: RiskPct;
  combo: number;
  liveAwards: XpAward[];
  tradeContext: { riskPct?: number; followedPlan?: boolean }[];
  startedAt: number;
  lastTradeIndex: number;
  finishing: boolean;
  /** Live mode: real-time bars from /api/stream appended to the session. */
  live: boolean;
  liveStatus: string;

  init(): Promise<void>;
  setMarket(inst: Instrument, tf: Timeframe): Promise<void>;
  newRound(): void;
  step(): void;
  setSpeed(s: Speed): void;
  trade(action: OrderAction, from?: Element | null): void;
  close(from?: Element | null): void;
  moveBracket(kind: 'stop' | 'target', price: number): void;
  toggleIndicator(id: string): void;
  setMystery(on: boolean): void;
  setRisk(r: RiskPct): void;
  sendBot(spec: StrategySpec): void;
  clearBot(): void;
  finish(): void;
  goLive(): void;
  stopLive(): void;
}

let unsub: (() => void) | null = null;
let initStarted = false;
let demoTold = false;
let liveSource: EventSource | null = null;
let pendingRiskPct: number | undefined;

function seededStart(n: number): number {
  const lo = Math.min(n - ROUND_BARS - 2, HISTORY_BARS + 60);
  const hi = Math.max(lo + 1, n - ROUND_BARS - 2);
  return Math.floor(lo + Math.random() * (hi - lo));
}

function juiceFor(trade: Trade, awards: XpAward[]) {
  const anchor = document.querySelector('[data-fx="pnl"]') ?? document.querySelector('[data-fx="chart"]');
  const { x, y } = fx.centerOf(anchor);
  const xp = sumXp(awards);
  if (trade.pnl > 0) {
    sound.play('win', 1 + Math.min(1, (trade.r ?? 1) / 3));
    fx.burst(x, y, 'win', trade.r && trade.r >= 2 ? 40 : 26);
    fx.float(`${signedMoney(trade.pnl)}`, x, y - 10, token('--up'), 34);
    setTimeout(() => fx.float(`+${xp} XP`, x, y + 26, token('--brand-2'), 22), 260);
  } else {
    sound.play('loss');
    fx.burst(x, y, 'lesson', 12);
    fx.float(`📘 Lesson +${xp} XP`, x, y, token('--info'), 24);
  }
}

export const usePlay = create<PlayState>((set, get) => {
  const bump = () => set((s) => ({ version: s.version + 1 }));

  const coachCtx = (session: Session) => ({
    state: session.state,
    recentTrades: session.trades,
    barsSinceLastTrade: session.index - get().lastTradeIndex,
    mode: (get().live ? 'live' : 'arcade') as 'live' | 'arcade',
    index: session.index,
    lifetimeTrades: useApp.getState().profile.stats.trades,
    riskPct: pendingRiskPct,
  });

  const wire = (session: Session) => {
    unsub?.();
    unsub = session.on('*', (e: EngineEvent) => {
      if (e.type === 'fill') {
        // fill sounds for exits are handled by tradeClosed juice
      } else if (e.type === 'positionOpened' && e.position.actor === 'manual') {
        sound.play(e.position.side === 'long' ? 'buy' : 'sell');
        const { x, y } = fx.centerOf(document.querySelector('[data-fx="chart"]'));
        fx.float(e.position.side === 'long' ? '▲ LONG' : '▼ SHORT', x, y, e.position.side === 'long' ? token('--up') : token('--down'), 28);
        set((s) => ({ tradeContext: [...s.tradeContext, { riskPct: pendingRiskPct, followedPlan: true }] }));
      } else if (e.type === 'tradeClosed' && e.trade.actor === 'manual') {
        const t = e.trade;
        const ctx = get().tradeContext[session.trades.length - 1];
        const combo = t.pnl > 0 ? get().combo + 1 : 0;
        const equityBefore = session.state.equity - t.pnl;
        const awards = awardTrade(t, { equityBefore, riskPct: ctx?.riskPct, followedPlan: ctx?.followedPlan, streak: combo });
        set((s) => ({ combo, liveAwards: [...s.liveAwards, ...awards], lastTradeIndex: session.index }));
        juiceFor(t, awards);
        if (combo >= 2) setTimeout(() => sound.play('combo', combo), 380);
      }
      const tip = coach.observe(e, coachCtx(session));
      if (tip) useApp.getState().say(tip);
    });
  };

  const makeSessions = (series: BarSeries, botSpec: StrategySpec | null) => {
    liveSource?.close();
    liveSource = null;
    const startIndex = seededStart(series.bars.length);
    const endIndex = startIndex + ROUND_BARS;
    const cash = startingCash(series.instrument);
    const session = new Session({ series, startIndex, endIndex, initialCash: cash });
    let botSession: Session | null = null;
    if (botSpec) {
      try { botSession = new Session({ series, startIndex, endIndex, initialCash: cash, strategy: botSpec }); }
      catch { botSession = null; }
    }
    coach.reset();
    wire(session);
    pendingRiskPct = undefined;
    set((s) => ({
      session, botSession, speed: 0, combo: 0, liveAwards: [], tradeContext: [], startedAt: Date.now(),
      lastTradeIndex: startIndex, version: s.version + 1, round: s.round + 1, finishing: false, live: false, liveStatus: '',
    }));
  };

  return {
    instruments: LOCAL_INSTRUMENTS,
    instrument: LOCAL_INSTRUMENTS.find((i) => i.symbol === prefs.symbol) ?? LOCAL_INSTRUMENTS[0]!,
    tf: prefs.tf,
    loading: true,
    demo: false,
    series: null,
    session: null,
    botSession: null,
    botSpec: null,
    version: 0,
    round: 0,
    speed: 0,
    mystery: prefs.mystery,
    indicators: prefs.indicators.slice(0, 2),
    riskPct: prefs.riskPct,
    combo: 0,
    liveAwards: [],
    tradeContext: [],
    startedAt: Date.now(),
    lastTradeIndex: 0,
    finishing: false,
    live: false,
    liveStatus: '',

    init: async () => {
      if (initStarted) return;
      initStarted = true;
      const instruments = await fetchInstruments();
      const instrument = instruments.find((i) => i.symbol === get().instrument.symbol) ?? instruments[0]!;
      set({ instruments, instrument });
      await get().setMarket(instrument, get().tf);
    },

    setMarket: async (instrument, tf) => {
      set({ loading: true, instrument, tf, speed: 0 });
      savePrefs({ symbol: instrument.symbol, tf });
      const { series, demo } = await loadSeries(instrument, tf);
      set({ series, demo, loading: false, instrument: series.instrument });
      makeSessions(series, get().botSpec);
      if (demo && !demoTold) {
        demoTold = true;
        useApp.getState().sayText('Server is napping, so this is demo data 🧪. Same rules, same XP!', 'teaching', 30);
      }
    },

    newRound: () => {
      const { series, botSpec } = get();
      if (series) makeSessions(series, botSpec);
    },

    step: () => {
      const { session, botSession } = get();
      if (!session || session.done || get().live) return;
      session.step();
      botSession?.step();
      bump();
      if (session.done) {
        set({ speed: 0 });
        setTimeout(() => get().finish(), 500);
      }
    },

    setSpeed: (speed) => { sound.play('tick'); set({ speed }); },

    trade: (action, from) => {
      const { session, riskPct, live } = get();
      if (!session || (session.done && !live)) return;
      if (session.state.workingOrders.some((o) => o.actor === 'manual' && o.type === 'market')) return;
      const pos = session.state.position;
      // Same-direction position already open: ignore (one position at a time keeps it simple).
      if (pos && ((pos.side === 'long' && action === 'buy') || (pos.side === 'short' && action === 'sell'))) {
        sound.play('error');
        useApp.getState().sayText('You already have that trade on. Let it work! 🌱', 'teaching', 30);
        return;
      }
      if (pos) session.flatten('manual');
      const plan = planQuickTrade(session, action, { riskPct });
      if (plan.qty < 1) {
        sound.play('error');
        useApp.getState().sayText('Not enough buying power for even 1 unit here. Try a cheaper market 🍎', 'worried', 60);
        return;
      }
      pendingRiskPct = riskPct;
      const order = session.submit({ action, qty: plan.qty, type: 'market', stopLoss: plan.stopLoss, takeProfit: plan.takeProfit, actor: 'manual', tag: 'quick' });
      if (order.status === 'rejected') {
        sound.play('error');
        useApp.getState().sayText(order.reason ?? 'Order rejected', 'worried', 60);
        return;
      }
      sound.play('tick');
      const { x, y } = fx.centerOf(from);
      fx.burst(x, y, 'spark', 10);
      // When paused, reveal the next bar so the order fills immediately: instant feedback.
      if (get().speed === 0 && !live) get().step(); else bump();
    },

    close: (from) => {
      const { session } = get();
      if (!session) return;
      const working = session.state.workingOrders.length > 0;
      if (!session.state.position && !working) { sound.play('error'); return; }
      session.flatten('manual');
      sound.play('close');
      const { x, y } = fx.centerOf(from);
      fx.burst(x, y, 'spark', 8);
      if (get().speed === 0 && session.state.position && !get().live) get().step(); else bump();
    },

    moveBracket: (kind, price) => {
      const { session } = get();
      if (!session?.state.position) return;
      session.setBracket(kind === 'stop' ? { stopLoss: price } : { takeProfit: price });
      bump();
    },

    toggleIndicator: (id) => {
      const cur = get().indicators;
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(-2);
      sound.play('tick');
      savePrefs({ indicators: next });
      set({ indicators: next });
    },

    setMystery: (mystery) => {
      savePrefs({ mystery });
      set({ mystery });
      get().newRound();
    },

    setRisk: (riskPct) => { sound.play('tick'); savePrefs({ riskPct }); set({ riskPct }); },

    sendBot: (spec) => {
      set({ botSpec: spec });
      const { series } = get();
      if (series) makeSessions(series, spec);
    },

    clearBot: () => {
      set({ botSpec: null });
      const { series } = get();
      if (series) makeSessions(series, null);
    },

    finish: () => {
      const { session, finishing, tradeContext, startedAt, demo, botSession, live } = get();
      if (!session || finishing) return;
      liveSource?.close();
      liveSource = null;
      set({ finishing: true, speed: 0 });
      // Close anything open: the market order fills on the next bar (no peeking, no free exits).
      if (session.state.position && !session.done && !live) {
        session.flatten('manual');
        session.step();
        botSession?.step();
      }
      const result = session.result();
      const now = new Date();
      const app = useApp.getState();
      const xpBefore = app.profile.xp;
      const res = app.commitSession({
        summary: {
          id: `s-${now.getTime()}`, t: now.getTime(), mode: live ? 'live' : 'arcade',
          symbol: session.instrument.symbol, timeframe: session.timeframe, metrics: result.metrics,
        },
        trades: session.trades,
        initialCash: session.initialCash,
        minutesPlayed: Math.round((Date.now() - startedAt) / 60000),
        today: todayLocal(now),
        localHour: now.getHours(),
        tradeContext,
      });
      const tip = coach.onSessionEnd(result.metrics, res.awards);
      const data: ResultsData = {
        title: result.metrics.trades === 0 ? 'Patient round' : result.metrics.netProfit >= 0 ? 'Round cleared!' : 'Round complete',
        awards: res.awards, ratingDelta: res.ratingDelta, achievements: res.achievements, levelUp: res.levelUp,
        tip, netProfit: result.metrics.netProfit, trades: result.metrics.trades, wins: result.metrics.wins,
        xpBefore, xpAfter: res.profile.xp, demo,
      };
      bump();
      const results = { kind: 'results' as const, data };
      app.setOverlay(res.levelUp ? { kind: 'levelUp', level: res.levelUp, then: results } : results);
      if (res.levelUp) app.say(coach.onLevelUp(res.levelUp));
      app.say(tip);
    },

    goLive: () => {
      const { series, demo, instrument, tf } = get();
      if (!series || demo) return;
      makeSessions(series, null);
      const last = series.bars.length - 1;
      const session = new Session({ series, startIndex: last, initialCash: startingCash(series.instrument) });
      coach.reset();
      wire(session);
      set((s) => ({ session, botSession: null, live: true, liveStatus: 'connecting', speed: 0, version: s.version + 1, round: s.round + 1, lastTradeIndex: last }));
      try {
        const es = new EventSource(`/api/stream?${new URLSearchParams({ symbol: instrument.symbol, tf })}`);
        liveSource = es;
        es.addEventListener('bar', (ev) => {
          const bar = JSON.parse((ev as MessageEvent<string>).data) as { t: number; o: number; h: number; l: number; c: number; v: number; closed?: boolean };
          const cur = get().session;
          if (!cur || bar.closed === false) return;
          const lastT = cur.series.bars[cur.series.bars.length - 1]?.t ?? 0;
          if (bar.t <= lastT) return;
          cur.appendBar({ t: bar.t, o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v });
          cur.step();
          set((s) => ({ version: s.version + 1, liveStatus: 'live' }));
        });
        es.addEventListener('hello', () => set({ liveStatus: 'live' }));
        es.addEventListener('error', () => {
          set({ liveStatus: 'offline' });
          if (es.readyState === EventSource.CLOSED) useApp.getState().sayText('Live feed is offline right now. Replay is always open! 🎮', 'worried', 60);
        });
        useApp.getState().sayText('📡 Live market! Bars arrive in real time. Patience is a superpower.', 'excited', 60);
      } catch {
        set({ liveStatus: 'offline' });
      }
    },

    stopLive: () => {
      liveSource?.close();
      liveSource = null;
      get().newRound();
    },
  };
});

export const todayKey = todayLocal;
