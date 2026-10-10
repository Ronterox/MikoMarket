import { create } from 'zustand';
import {
  awardTrade, COACH_LINES, planQuickTrade, Session, sumXp,
  type BarSeries, type EngineEvent, type Instrument, type OrderAction, type Params, type StrategySpec, type Timeframe, type Trade, type XpAward,
} from '@miko/engine';
import { coachV2, comboKind, tipsFor } from '../lib/coachV2.ts';
import { fetchInstruments, loadSeries } from '../lib/api.ts';
import { LOCAL_INSTRUMENTS, startingCash } from '../lib/instruments.ts';
import { sound } from '../lib/sound.ts';
import { fx } from '../lib/fx.ts';
import { signedMoney } from '../lib/format.ts';
import { lsGet, lsSet } from '../lib/storage.ts';
import { token } from '../lib/theme.ts';
import type { IndStyle } from '../lib/indStyle.ts';
import { coach, todayLocal, useApp, type ResultsData } from './app.ts';

/** 0 = pause, 1 = 🐢 slow, 2 = ▶, 3 = ▶▶, 4 = ▶▶▶. */
export type Speed = 0 | 1 | 2 | 3 | 4;
export type RiskPct = 0.5 | 1 | 2;
/** Stop distance in ATR multiples: Tight / Normal / Wide. */
export type StopMult = 1 | 2 | 3;
export type CandleMode = 'candles' | 'ha';

/** ms per bar for each speed. */
export const SPEED_MS: Record<Speed, number> = { 0: 0, 1: 3000, 2: 1400, 3: 600, 4: 180 };
export const STOP_LABEL: Record<StopMult, string> = { 1: 'Tight', 2: 'Normal', 3: 'Wide' };
/** Most indicators drawn at once (the chip row itself can hold more). */
export const MAX_ACTIVE = 4;
export const DEFAULT_ROW = ['ema', 'sma', 'bb', 'vwap', 'supertrend', 'rsi', 'macd', 'donchian'];
const ROUND_BARS = 240;
const HISTORY_BARS = 160;

interface Prefs {
  symbol: string; tf: Timeframe; indicators: string[]; riskPct: RiskPct; mystery: boolean;
  chipRow?: string[]; lastSpeed?: Speed; stopMult?: StopMult; candleMode?: CandleMode;
}
const prefs: Prefs = { symbol: 'SPY', tf: '5m', indicators: ['ema'], riskPct: 1, mystery: false, ...(lsGet<Partial<Prefs>>('miko.play') ?? {}) };
const savePrefs = (p: Partial<Prefs>) => lsSet('miko.play', { ...(lsGet<Prefs>('miko.play') ?? prefs), ...p });
const savedParams = lsGet<Record<string, Params>>('miko.indParams') ?? {};
const savedStyle = lsGet<Record<string, IndStyle>>('miko.indStyle') ?? {};
const initialRow = (() => {
  const row = Array.isArray(prefs.chipRow) ? prefs.chipRow.filter((x) => typeof x === 'string') : DEFAULT_ROW.slice();
  for (const id of prefs.indicators) if (!row.includes(id)) row.unshift(id);
  return row;
})();

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
  /** Last non-zero speed (remembered across sessions). */
  lastSpeed: Exclude<Speed, 0>;
  mystery: boolean;
  /** Indicators drawn on the chart, in slot order. */
  indicators: string[];
  /** The user-curated chip row (present in the row, not necessarily on the chart). */
  chipRow: string[];
  /** Custom params per indicator id (defaults when absent). */
  indParams: Record<string, Params>;
  /** Line colours and bars-vs-line per indicator id (defaults when absent). */
  indStyle: Record<string, IndStyle>;
  riskPct: RiskPct;
  stopMult: StopMult;
  candleMode: CandleMode;
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
  addChip(id: string): void;
  removeChip(id: string): void;
  setIndParams(id: string, params: Params | null): void;
  /** Merge a style change; null clears it back to defaults. */
  setIndStyle(id: string, patch: IndStyle | null): void;
  /** Lets Miko comment on a finished params change (call once the slider settles). */
  commitIndParams(id: string): void;
  setMystery(on: boolean): void;
  setRisk(r: RiskPct): void;
  setStopMult(m: StopMult): void;
  setCandleMode(m: CandleMode): void;
  removeStop(): void;
  restoreStop(): void;
  moveToBreakeven(): void;
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
let haExplained = false;

/** Saves the deployed bot's round as its own 'bot' session (played forward, so it counts as trading results). */
function commitBotRound(bot: Session, spec: StrategySpec | null, now: Date) {
  const metrics = bot.result().metrics;
  const res = useApp.getState().commitSession({
    summary: {
      id: `b-${now.getTime()}`, t: now.getTime(), mode: 'bot', playedForward: true,
      symbol: bot.instrument.symbol, timeframe: bot.timeframe, metrics,
    },
    trades: bot.trades,
    initialCash: bot.initialCash,
    today: todayLocal(now),
    localHour: now.getHours(),
  });
  return { res, metrics, icon: spec?.icon ?? '🤖' };
}

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
    sound.play(trade.exitReason === 'stop' || trade.exitReason === 'trail' ? 'stopHit' : 'loss');
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
    recentBars: session.series.bars.slice(Math.max(0, session.index - 20), session.index + 1),
    startEquity: session.initialCash,
  });
  const say = (tip: ReturnType<typeof coachV2.onClock>) => { if (tip) useApp.getState().say(tip); };

  /** Tell Miko the indicator set changed, and give her a visual reaction to the combo. */
  const indicatorsChanged = (id: string, action: 'add' | 'remove' | 'params') => {
    const { indicators, indParams } = get();
    say(coachV2.onIndicators(indicators.map((x) => ({ id: x, params: indParams[x] ?? {} })), { id, action }, get().tf));
    if (action !== 'add') return;
    const kind = comboKind(indicators);
    if (kind === 'unusual' || kind === 'redundant') useApp.getState().mikoReact('surprise');
    else if (kind === 'classic') useApp.getState().mikoReact('sparkle');
  };

  const wire = (session: Session) => {
    unsub?.();
    unsub = session.on('*', (e: EngineEvent) => {
      if (e.type === 'bar') {
        const s = get();
        if (!s.mystery) say(coachV2.onClock(e.bar.t));
        // A gentle clock, only at the calm speeds.
        if (!s.live && (s.speed === 1 || s.speed === 2)) sound.play('bar', e.bar.c >= e.bar.o ? 1 : -1);
      } else if (e.type === 'equity') {
        say(coachV2.onPerformance(coachCtx(session)));
      } else if (e.type === 'fill') {
        // Entries get the "click-ding"; exits already have close / win / loss / stopHit.
        const open = session.state.position;
        if (!open || (open.side === 'long') === (e.fill.action === 'buy')) sound.play('fill', 1);
      } else if (e.type === 'positionOpened' && e.position.actor === 'manual') {
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
        if (combo === 3 || (combo >= 5 && combo % 5 === 0)) setTimeout(() => sound.play('streak'), 380);
        else if (combo >= 2) setTimeout(() => sound.play('combo', combo), 380);
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
    lastSpeed: prefs.lastSpeed && prefs.lastSpeed > 0 && prefs.lastSpeed <= 4 ? prefs.lastSpeed as Exclude<Speed, 0> : 2,
    mystery: prefs.mystery,
    indicators: prefs.indicators.filter((id) => initialRow.includes(id)).slice(0, MAX_ACTIVE),
    chipRow: initialRow,
    indParams: savedParams,
    indStyle: savedStyle,
    riskPct: prefs.riskPct,
    stopMult: prefs.stopMult === 1 || prefs.stopMult === 3 ? prefs.stopMult : 2,
    candleMode: prefs.candleMode === 'ha' ? 'ha' : 'candles',
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

    setSpeed: (speed) => {
      const { session, live } = get();
      if (speed > 0 && get().speed === 0 && session && !live && session.index === session.startIndex) sound.play('roundStart');
      else sound.play(speed === 0 ? 'pause' : 'speed', speed);
      if (speed > 0) { savePrefs({ lastSpeed: speed }); set({ speed, lastSpeed: speed as Exclude<Speed, 0> }); }
      else set({ speed });
    },

    trade: (action, from) => {
      const { session, riskPct, live, stopMult } = get();
      if (!session || (session.done && !live)) return;
      if (session.state.workingOrders.some((o) => o.actor === 'manual' && o.type === 'market')) return;
      const pos = session.state.position;
      // Same-direction position already open: ignore (one position at a time keeps it simple).
      if (pos && ((pos.side === 'long' && action === 'buy') || (pos.side === 'short' && action === 'sell'))) {
        sound.play('error');
        useApp.getState().sayText('You already have that trade on. Let it work! 🌱', 'teaching', 30);
        return;
      }
      say(coachV2.onAction(action, coachCtx(session)));
      if (pos) session.flatten('manual');
      const plan = planQuickTrade(session, action, { riskPct, atrMult: stopMult });
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
      sound.play(action === 'buy' ? 'buy' : 'sell');
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
      say(coachV2.onAction('close', coachCtx(session)));
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
      const on = cur.includes(id);
      const next = on ? cur.filter((x) => x !== id) : [...cur, id].slice(-MAX_ACTIVE);
      sound.play(on ? 'chipOff' : 'chipOn');
      savePrefs({ indicators: next });
      set({ indicators: next });
      indicatorsChanged(id, on ? 'remove' : 'add');
    },

    addChip: (id) => {
      const { chipRow } = get();
      if (!chipRow.includes(id)) {
        const row = [...chipRow, id];
        savePrefs({ chipRow: row });
        set({ chipRow: row });
      }
      if (!get().indicators.includes(id)) get().toggleIndicator(id);
    },

    removeChip: (id) => {
      const { chipRow, indicators } = get();
      const row = chipRow.filter((x) => x !== id);
      const next = indicators.filter((x) => x !== id);
      sound.play('chipOff');
      savePrefs({ chipRow: row, indicators: next });
      set({ chipRow: row, indicators: next });
      if (next.length !== indicators.length) indicatorsChanged(id, 'remove');
    },

    setIndParams: (id, params) => {
      const all = { ...get().indParams };
      if (params && Object.keys(params).length > 0) all[id] = params; else delete all[id];
      lsSet('miko.indParams', all);
      set({ indParams: all });
    },

    setIndStyle: (id, patch) => {
      const all = { ...get().indStyle };
      const next: IndStyle = patch ? { ...all[id], ...patch, colors: patch.colors ? { ...all[id]?.colors, ...patch.colors } : all[id]?.colors } : {};
      if (!next.colors || Object.keys(next.colors).length === 0) delete next.colors;
      if (next.bars === undefined) delete next.bars;
      if (Object.keys(next).length) all[id] = next; else delete all[id];
      lsSet('miko.indStyle', all);
      set({ indStyle: all });
    },

    commitIndParams: (id) => { if (get().indicators.includes(id)) indicatorsChanged(id, 'params'); },

    setMystery: (mystery) => {
      savePrefs({ mystery });
      set({ mystery });
      get().newRound();
    },

    setRisk: (riskPct) => { sound.play('select'); savePrefs({ riskPct }); set({ riskPct }); },

    setStopMult: (stopMult) => { sound.play('select'); savePrefs({ stopMult }); set({ stopMult }); },

    setCandleMode: (candleMode) => {
      if (candleMode !== get().candleMode) sound.play('swap');
      savePrefs({ candleMode });
      set({ candleMode });
      if (candleMode === 'ha' && !haExplained) {
        haExplained = true;
        const line = tipsFor('ha')[0];
        useApp.getState().sayText(line ?? 'Heikin-Ashi smooths candles to show the trend. Your fills still use the real price 🕯️', 'teaching', 45);
      }
    },

    removeStop: () => {
      const { session } = get();
      if (!session?.state.position) return;
      session.setBracket({ stopLoss: null, trailDistance: null });
      sound.play('warn');
      const lines = COACH_LINES.no_stop ?? [];
      const text = lines.length ? lines[Math.floor(Math.random() * lines.length)]!({}) : 'No stop now ⚠️ Decide where you are wrong before the market does.';
      useApp.getState().say({ id: 'no_stop_ui', mood: 'worried', priority: 99, text });
      useApp.getState().mikoReact('surprise');
      bump();
    },

    restoreStop: () => {
      const { session, stopMult, riskPct } = get();
      const pos = session?.state.position;
      if (!session || !pos) return;
      const plan = planQuickTrade(session, pos.side === 'long' ? 'buy' : 'sell', { riskPct, atrMult: stopMult });
      session.setBracket({ stopLoss: plan.stopLoss });
      sound.play('toggleOn');
      bump();
    },

    moveToBreakeven: () => {
      const { session } = get();
      const pos = session?.state.position;
      if (!session || !pos || pos.unrealized <= 0) return;
      const tick = session.series.instrument.tickSize;
      const last = session.cols.c[session.index]!;
      const be = Math.round(pos.avgPrice / tick) * tick;
      // Only when breakeven is still on the safe side of the last price (otherwise it would fill instantly).
      if (pos.side === 'long' ? be >= last : be <= last) return;
      session.setBracket({ stopLoss: be, trailDistance: null });
      sound.play('breakeven');
      const { x, y } = fx.centerOf(document.querySelector('[data-fx="pnl"]'));
      fx.float('🛡️ Breakeven', x, y, token('--up'), 22);
      bump();
    },

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
      // Close anything open, yours and the bot's: the market order fills on the next bar (no peeking, no free exits).
      const closeYou = !!session.state.position && !session.done && !live;
      const closeBot = !!botSession?.state.position && !botSession.done;
      if (closeYou) session.flatten('manual');
      if (closeBot) botSession!.flatten('manual');
      if (closeYou || closeBot) {
        if (!session.done) session.step();
        if (botSession && !botSession.done) botSession.step();
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
      // The bot you sent from the Lab traded the same unseen bars: its trades are your results too.
      const botRes = botSession && botSession.trades.length > 0 ? commitBotRound(botSession, get().botSpec, now) : null;
      const awards = botRes ? [...res.awards, ...botRes.res.awards.map((w) => ({ ...w, reason: `Bot: ${w.reason}` }))] : res.awards;
      const achievements = botRes ? [...res.achievements, ...botRes.res.achievements] : res.achievements;
      const levelUp = botRes?.res.levelUp ?? res.levelUp;
      const tip = coach.onSessionEnd(result.metrics, awards);
      const data: ResultsData = {
        title: result.metrics.trades === 0 ? (botRes ? 'Your bot raced!' : 'Patient round') : result.metrics.netProfit >= 0 ? 'Round cleared!' : 'Round complete',
        awards, ratingDelta: res.ratingDelta + (botRes?.res.ratingDelta ?? 0), achievements, levelUp,
        tip, netProfit: result.metrics.netProfit, trades: result.metrics.trades, wins: result.metrics.wins,
        xpBefore, xpAfter: useApp.getState().profile.xp, demo,
        ...(botRes ? { bot: { icon: botRes.icon, netProfit: botRes.metrics.netProfit, trades: botRes.metrics.trades, wins: botRes.metrics.wins } } : {}),
      };
      bump();
      sound.play('roundEnd');
      const results = { kind: 'results' as const, data };
      app.setOverlay(levelUp ? { kind: 'levelUp', level: levelUp, then: results } : results);
      if (levelUp) app.say(coach.onLevelUp(levelUp));
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
        es.addEventListener('hello', () => { sound.play('live'); set({ liveStatus: 'live' }); });
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
