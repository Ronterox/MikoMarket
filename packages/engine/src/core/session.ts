import type {
  AccountState, Actor, BacktestResult, Bar, BarSeries, Columns, CostModel, EngineEvent, EngineEventType,
  EquityPoint, ExitReason, Fill, Order, OrderAction, OrderRequest, OrderType, Position, Side, StrategySpec, Trade,
} from '../types.ts';
import { TIMEFRAME_MS } from '../types.ts';
import { toColumns } from '../util/columns.ts';
import { compileStrategy, type CompiledStrategy } from '../strategy/compile.ts';
import { computeMetrics } from '../backtest/metrics.ts';
import { commissionFor, costsFor, leverageFor } from './costs.ts';
import { isPastFlatAt } from './time.ts';

export interface SessionOptions {
  series: BarSeries;
  /** First visible (already closed) bar. Default 0. */
  startIndex?: number;
  /** Last bar to reveal (inclusive). Default: the end of the series, following appendBar. */
  endIndex?: number;
  initialCash?: number;
  costs?: CostModel;
  /** A spec, or an already compiled strategy (compiled against this series' columns). */
  strategy?: StrategySpec | CompiledStrategy;
  allowShort?: boolean;
  /**
   * Default true: when the last bar is revealed, any open position is closed at that bar's
   * close (exitReason 'end'), working orders are cancelled and 'end' is emitted. Live mode
   * should pass false so nothing is force-closed while waiting for new bars.
   */
  closeAtEnd?: boolean;
}

export interface OrderOptions {
  type?: OrderType;
  price?: number;
  stopLoss?: number;
  takeProfit?: number;
  trailDistance?: number;
  actor?: Actor;
  tag?: string;
}

export interface BracketUpdate {
  stopLoss?: number | null;
  takeProfit?: number | null;
  trailDistance?: number | null;
}

type AnyListener = (e: EngineEvent) => void;

interface BotBracket { stop: number; target: number; trail: number }

const EXIT_REASONS = new Set<string>(['stop', 'target', 'trail', 'signal', 'manual', 'time', 'eod', 'end', 'reverse']);

const colsCache = new WeakMap<readonly Bar[], Columns>();

/** Columns for a bar array, cached per array (the GA backtests the same bars thousands of times). */
export function columnsFor(bars: readonly Bar[]): Columns {
  const hit = colsCache.get(bars);
  if (hit && hit.c.length === bars.length) return hit;
  const cols = toColumns(bars);
  colsCache.set(bars, cols);
  return cols;
}

/**
 * The one simulation loop shared by manual play, bots and backtests.
 *
 * Accounting is margin-style: `cash` = initial cash + realised gross P&L − all commissions,
 * `equity` = cash + unrealised P&L. Slippage and half the spread are baked into fill prices.
 *
 * step() reveals bar i+1:
 *  1. working orders fill against it (market at open ± slippage; limit/stop when touched, gaps
 *     give the open when it is better for limits / worse for stops),
 *  2. brackets on the open position: stop (or trailing stop) first, then target; a gap through
 *     the stop fills at the open; the trailing stop ratchets from this bar's extreme only after
 *     this bar's check,
 *  3. MAE/MFE and barsHeld update from the bar,
 *  4. time exits (maxBars, flatAt) CLOSE AT THIS BAR'S CLOSE (minus slippage), exitReason
 *     'time' / 'eod'. flatAt triggers on the first bar whose close time (t + timeframe) in New
 *     York is at or after flatAt, and blocks new bot entries on such bars,
 *  5. mark to market, equity point, then the bot evaluates this closed bar and queues market
 *     orders that fill on the next bar.
 */
export class Session {
  private bars: Bar[];
  private ownBars = false;
  private _cols: Columns;
  readonly instrument: BarSeries['instrument'];
  readonly timeframe: BarSeries['timeframe'];
  readonly startIndex: number;
  readonly initialCash: number;
  readonly costs: CostModel;
  readonly allowShort: boolean;
  readonly closeAtEnd: boolean;
  private fixedEnd: number | undefined;
  private endIdx: number;
  private idx: number;
  private started = false;
  private ended = false;

  private spec: StrategySpec | null = null;
  private bot: CompiledStrategy | null = null;
  private afterFlat: Uint8Array | null = null;

  private st: AccountState;
  private pos: Position | null = null;
  private entryCommission = 0;
  private equityAtEntry = 0;
  private hadStop = false;
  private midBarEntryIndex = -1;

  private _trades: Trade[] = [];
  private _equity: EquityPoint[] = [];
  private orderSeq = 0;
  private tradeSeq = 0;
  private fillSeq = 0;
  private reduceOnly = new Set<string>();
  private botBrackets = new Map<string, BotBracket>();
  private listeners = new Map<string, AnyListener[]>();
  private star: AnyListener[] = [];

  private pv: number;
  private tick: number;
  private slip: number;   // per unit price slippage incl. half spread (market/stop fills)
  private half: number;   // half spread in price
  private lev: number;

  constructor(opts: SessionOptions) {
    const { series } = opts;
    this.bars = series.bars;
    this.instrument = series.instrument;
    this.timeframe = series.timeframe;
    this._cols = columnsFor(this.bars);
    const last = this.bars.length - 1;
    this.fixedEnd = opts.endIndex;
    this.endIdx = Math.min(opts.endIndex ?? last, last);
    this.startIndex = Math.max(0, Math.min(opts.startIndex ?? 0, Math.max(0, this.endIdx)));
    this.idx = this.startIndex;
    this.initialCash = opts.initialCash ?? 10_000;
    this.costs = opts.costs ?? costsFor(series.instrument);
    this.allowShort = opts.allowShort ?? true;
    this.closeAtEnd = opts.closeAtEnd ?? true;
    this.pv = series.instrument.pointValue;
    this.tick = series.instrument.tickSize;
    this.half = (this.costs.spreadTicks / 2) * this.tick;
    this.slip = this.costs.slippageTicks * this.tick + this.half;
    this.lev = leverageFor(series.instrument);

    if (opts.strategy) {
      if ('longEntry' in opts.strategy) {
        this.bot = opts.strategy;
        this.spec = opts.strategy.spec;
      } else {
        this.spec = opts.strategy;
        this.bot = compileStrategy(opts.strategy, this._cols);
      }
      this.buildFlatMask();
    }

    const t = this.bars.length ? this._cols.t[this.idx]! : 0;
    this.st = {
      t, index: this.idx, cash: this.initialCash, equity: this.initialCash, realized: 0, position: null,
      workingOrders: [], peakEquity: this.initialCash, drawdown: 0, drawdownPct: 0,
    };
    if (this.bars.length) this._equity.push({ t, equity: this.initialCash, drawdownPct: 0 });
  }

  // ───────────── public getters ─────────────

  get index(): number { return this.idx; }
  get state(): AccountState { return this.st; }
  get trades(): Trade[] { return this._trades; }
  get equity(): EquityPoint[] { return this._equity; }
  get done(): boolean { return this.idx >= this.endIdx; }
  get cols(): Columns { return this._cols; }
  get series(): BarSeries { return { instrument: this.instrument, timeframe: this.timeframe, bars: this.bars }; }
  get endIndex(): number { return this.endIdx; }
  get strategy(): StrategySpec | null { return this.spec; }

  /** Largest notional (currency) the account may hold: equity × leverage. */
  get buyingPower(): number { return Math.max(0, this.st.equity) * this.lev; }

  /** Max whole units affordable at `price` (default: last close), ignoring the current position. */
  maxQty(price = this._cols.c[this.idx]!): number {
    const unit = Math.abs(price) * this.pv;
    return unit > 0 ? Math.floor(this.buyingPower / unit + 1e-9) : 0;
  }

  on(type: EngineEventType | '*', listener: (e: EngineEvent) => void): () => void {
    if (type === '*') {
      this.star.push(listener);
      return () => { this.star = this.star.filter((l) => l !== listener); };
    }
    const arr = this.listeners.get(type) ?? [];
    arr.push(listener);
    this.listeners.set(type, arr);
    return () => {
      const a = this.listeners.get(type);
      if (a) this.listeners.set(type, a.filter((l) => l !== listener));
    };
  }

  private wants(type: EngineEventType): boolean {
    if (this.star.length) return true;
    const a = this.listeners.get(type);
    return a !== undefined && a.length > 0;
  }

  private emit(e: EngineEvent): void {
    const a = this.listeners.get(e.type);
    if (a) for (const l of a) l(e);
    for (const l of this.star) l(e);
  }

  // ───────────── stepping ─────────────

  step(): boolean {
    if (!this.started) {
      this.started = true;
      if (this.bot) this.runBot(this.idx);
    }
    if (this.idx >= this.endIdx) return false;
    const i = ++this.idx;
    const c = this._cols;
    const t = c.t[i]!, h = c.h[i]!, l = c.l[i]!, close = c.c[i]!;
    const st = this.st;
    st.t = t;
    st.index = i;
    if (this.wants('bar')) this.emit({ type: 'bar', index: i, bar: this.bars[i]! });

    // 1. working orders
    if (st.workingOrders.length) this.fillOrders(i);
    // 2. brackets
    if (this.pos) this.processBrackets(i);
    // 3. excursions
    let pos = this.pos;
    if (pos) {
      pos.barsHeld = i - pos.openedIndex + 1;
      const dir = pos.side === 'long' ? 1 : -1;
      const k = pos.qty * this.pv * dir;
      const a = (l - pos.avgPrice) * k, b = (h - pos.avgPrice) * k;
      const adverse = a < b ? a : b, fav = a < b ? b : a;
      if (adverse < pos.mae) pos.mae = adverse;
      if (fav > pos.mfe) pos.mfe = fav;
    }
    // 4. time exits
    const last = i >= this.endIdx;
    if (pos) {
      if (last && this.closeAtEnd) this.closeAtClose(i, 'end');
      else if (this.bot) {
        if (this.bot.maxBars !== undefined && pos.barsHeld >= this.bot.maxBars) this.closeAtClose(i, 'time');
        else if (this.afterFlat && this.afterFlat[i] === 1) this.closeAtClose(i, 'eod');
      }
    }
    // mark to market
    pos = this.pos;
    if (pos) {
      pos.unrealized = (close - pos.avgPrice) * pos.qty * this.pv * (pos.side === 'long' ? 1 : -1);
      st.equity = st.cash + pos.unrealized;
    } else {
      st.equity = st.cash;
    }
    if (st.equity > st.peakEquity) st.peakEquity = st.equity;
    st.drawdown = st.peakEquity - st.equity;
    st.drawdownPct = st.peakEquity > 0 ? (st.drawdown / st.peakEquity) * 100 : 0;
    this._equity.push({ t, equity: st.equity, drawdownPct: st.drawdownPct });
    if (this.wants('equity')) this.emit({ type: 'equity', t, equity: st.equity, drawdownPct: st.drawdownPct });

    // 5. bot
    if (last && this.closeAtEnd) {
      for (const o of st.workingOrders.slice()) this.cancelOrder(o, 'Session ended');
      this.ended = true;
      if (this.wants('end')) this.emit({ type: 'end', result: this.result() });
    } else if (this.bot) {
      this.runBot(i);
    }
    return true;
  }

  /** Steps until the end. */
  run(): this {
    while (this.step());
    return this;
  }

  // ───────────── orders ─────────────

  submit(req: OrderRequest): Order {
    return this.submitInternal(req, false, null);
  }

  buy(qty: number, opts: OrderOptions = {}): Order { return this.submit(this.req('buy', qty, opts)); }
  sell(qty: number, opts: OrderOptions = {}): Order { return this.submit(this.req('sell', qty, opts)); }

  private req(action: OrderAction, qty: number, o: OrderOptions): OrderRequest {
    const r: OrderRequest = { action, qty, type: o.type ?? 'market', actor: o.actor ?? 'manual' };
    if (o.price !== undefined) r.price = o.price;
    if (o.stopLoss !== undefined) r.stopLoss = o.stopLoss;
    if (o.takeProfit !== undefined) r.takeProfit = o.takeProfit;
    if (o.trailDistance !== undefined) r.trailDistance = o.trailDistance;
    if (o.tag !== undefined) r.tag = o.tag;
    return r;
  }

  /** Cancels all working orders and queues a market order closing the position on the next bar. */
  flatten(actor: Actor = 'manual'): Order | null {
    for (const o of this.st.workingOrders.slice()) this.cancelOrder(o, 'Flatten');
    const p = this.pos;
    if (!p) return null;
    return this.submitInternal(
      { action: p.side === 'long' ? 'sell' : 'buy', qty: p.qty, type: 'market', actor, tag: actor === 'manual' ? 'manual' : 'signal' },
      true, null,
    );
  }

  cancel(id: string): boolean {
    const o = this.st.workingOrders.find((x) => x.id === id);
    if (!o) return false;
    this.cancelOrder(o, 'Cancelled');
    return true;
  }

  /** Changes the open position's brackets. undefined keeps a value, null removes it. */
  setBracket(b: BracketUpdate): boolean {
    const p = this.pos;
    if (!p) return false;
    if (b.stopLoss !== undefined) { if (b.stopLoss === null) delete p.stopLoss; else p.stopLoss = b.stopLoss; }
    if (b.takeProfit !== undefined) { if (b.takeProfit === null) delete p.takeProfit; else p.takeProfit = b.takeProfit; }
    if (b.trailDistance !== undefined) {
      if (b.trailDistance === null || !(b.trailDistance > 0)) { delete p.trailDistance; delete p.trailStop; }
      else {
        p.trailDistance = b.trailDistance;
        const c = this._cols.c[this.idx]!;
        p.trailStop = p.side === 'long' ? c - b.trailDistance : c + b.trailDistance;
      }
    }
    return true;
  }

  private signedPos(): number {
    const p = this.pos;
    return p ? (p.side === 'long' ? p.qty : -p.qty) : 0;
  }

  private projected(): number {
    let q = this.signedPos();
    for (const o of this.st.workingOrders) q += o.action === 'buy' ? o.qty : -o.qty;
    return q;
  }

  private submitInternal(req: OrderRequest, reduceOnly: boolean, bracket: BotBracket | null): Order {
    const order: Order = { ...req, id: `o${++this.orderSeq}`, status: 'working', createdAt: this.st.t };
    const reject = (reason: string): Order => {
      order.status = 'rejected';
      order.reason = reason;
      if (this.wants('order')) this.emit({ type: 'order', order: { ...order } });
      return order;
    };
    if (!(req.qty > 0) || !Number.isFinite(req.qty)) return reject('Quantity must be greater than zero');
    if (req.type !== 'market' && !(req.price !== undefined && req.price > 0)) return reject('Limit and stop orders need a price');
    if (this.ended || (this.started && this.idx >= this.endIdx && this.closeAtEnd)) return reject('Session is finished');
    if (!reduceOnly) {
      const cur = this.projected();
      const after = cur + (req.action === 'buy' ? req.qty : -req.qty);
      if (!this.allowShort && after < 0) return reject('Short selling is disabled');
      if (Math.abs(after) > Math.abs(cur) || Math.sign(after) !== Math.sign(cur)) {
        const px = req.price ?? this._cols.c[this.idx]!;
        const notional = Math.abs(after) * px * this.pv;
        if (notional > this.buyingPower + 1e-9) {
          return reject(`Not enough buying power: needs $${notional.toFixed(0)}, you have $${this.buyingPower.toFixed(0)}`);
        }
      }
    }
    if (reduceOnly) this.reduceOnly.add(order.id);
    if (bracket) this.botBrackets.set(order.id, bracket);
    this.st.workingOrders.push(order);
    if (this.wants('order')) this.emit({ type: 'order', order: { ...order } });
    return order;
  }

  private cancelOrder(o: Order, reason: string): void {
    o.status = 'cancelled';
    o.reason = reason;
    this.st.workingOrders = this.st.workingOrders.filter((x) => x !== o);
    this.reduceOnly.delete(o.id);
    this.botBrackets.delete(o.id);
    if (this.wants('order')) this.emit({ type: 'order', order: { ...o } });
  }

  private fillOrders(i: number): void {
    const c = this._cols;
    const o = c.o[i]!, h = c.h[i]!, l = c.l[i]!;
    const working = this.st.workingOrders;
    const keep: Order[] = [];
    for (let k = 0; k < working.length; k++) {
      const ord = working[k]!;
      if (ord.status !== 'working') continue;
      const buy = ord.action === 'buy';
      let price = NaN, ref = NaN;
      if (ord.type === 'market') {
        ref = o;
        price = buy ? o + this.slip : o - this.slip;
      } else if (ord.type === 'limit') {
        const P = ord.price!;
        if (buy) { if (l + this.half <= P) { price = o + this.half <= P ? o + this.half : P; ref = price; } }
        else if (h - this.half >= P) { price = o - this.half >= P ? o - this.half : P; ref = price; }
      } else {
        const P = ord.price!;
        if (buy) { if (h >= P) { ref = o > P ? o : P; price = ref + this.slip; } }
        else if (l <= P) { ref = o < P ? o : P; price = ref - this.slip; }
      }
      if (price !== price) { keep.push(ord); continue; }
      let qty = ord.qty;
      if (this.reduceOnly.has(ord.id)) {
        this.reduceOnly.delete(ord.id);
        const p = this.pos;
        const closes = p !== null && (p.side === 'long') !== buy;
        if (!closes) {
          ord.status = 'cancelled';
          ord.reason = 'Nothing to close';
          this.botBrackets.delete(ord.id);
          if (this.wants('order')) this.emit({ type: 'order', order: { ...ord } });
          continue;
        }
        qty = Math.min(qty, p.qty);
        ord.qty = qty;
      }
      ord.status = 'filled';
      ord.filledAt = c.t[i]!;
      ord.fillPrice = price;
      this.applyFill(ord, qty, price, ref, i);
      if (this.wants('order')) this.emit({ type: 'order', order: { ...ord } });
    }
    this.st.workingOrders = keep;
  }

  private emitFill(orderId: string, action: OrderAction, qty: number, price: number, ref: number, commission: number, i: number): void {
    if (!this.wants('fill')) return;
    const fill: Fill = {
      orderId, t: this._cols.t[i]!, action, qty, price, commission,
      slippage: Math.abs(price - ref) * qty * this.pv,
    };
    this.emit({ type: 'fill', fill });
  }

  private applyFill(ord: Order, qty: number, price: number, ref: number, i: number): void {
    const commission = commissionFor(this.costs, qty);
    this.st.cash -= commission;
    this.emitFill(ord.id, ord.action, qty, price, ref, commission, i);
    const buy = ord.action === 'buy';
    const p = this.pos;
    const bracket = this.botBrackets.get(ord.id) ?? null;
    if (bracket) this.botBrackets.delete(ord.id);
    if (!p) {
      this.openPosition(buy ? 'long' : 'short', qty, price, commission, ord, bracket, i);
    } else if ((p.side === 'long') === buy) {
      this.addToPosition(qty, price, commission, ord, bracket);
    } else {
      const closeQty = Math.min(qty, p.qty);
      const commClose = (commission * closeQty) / qty;
      const reason: ExitReason = qty > p.qty ? 'reverse' : this.reasonFor(ord);
      this.closePart(closeQty, price, commClose, reason, i);
      const rem = qty - closeQty;
      if (rem > 0) this.openPosition(buy ? 'long' : 'short', rem, price, commission - commClose, ord, bracket, i);
    }
  }

  private reasonFor(ord: Order): ExitReason {
    if (ord.tag && EXIT_REASONS.has(ord.tag)) return ord.tag as ExitReason;
    return ord.actor === 'manual' ? 'manual' : 'signal';
  }

  private brackets(side: Side, price: number, ord: Order, bracket: BotBracket | null) {
    let stop: number | undefined, target: number | undefined, trail: number | undefined;
    const dir = side === 'long' ? 1 : -1;
    if (bracket) {
      if (bracket.stop > 0) stop = price - dir * bracket.stop;
      if (bracket.target > 0) target = price + dir * bracket.target;
      if (bracket.trail > 0) trail = bracket.trail;
    } else {
      stop = ord.stopLoss;
      target = ord.takeProfit;
      if (ord.trailDistance !== undefined && ord.trailDistance > 0) trail = ord.trailDistance;
    }
    return { stop, target, trail };
  }

  private openPosition(side: Side, qty: number, price: number, commission: number, ord: Order, bracket: BotBracket | null, i: number): void {
    const { stop, target, trail } = this.brackets(side, price, ord, bracket);
    const p: Position = {
      side, qty, avgPrice: price, openedAt: this._cols.t[i]!, openedIndex: i,
      unrealized: 0, mae: 0, mfe: 0, barsHeld: 0, actor: ord.actor,
    };
    if (stop !== undefined) {
      p.stopLoss = stop;
      p.initialRisk = Math.abs(price - stop) * qty * this.pv;
    }
    if (target !== undefined) p.takeProfit = target;
    if (trail !== undefined) {
      p.trailDistance = trail;
      p.trailStop = side === 'long' ? price - trail : price + trail;
    }
    this.pos = p;
    this.st.position = p;
    this.entryCommission = commission;
    this.equityAtEntry = this.st.equity;
    this.hadStop = stop !== undefined || trail !== undefined;
    if (p.initialRisk === undefined && trail !== undefined) p.initialRisk = trail * qty * this.pv;
    this.midBarEntryIndex = ord.type === 'market' ? -1 : i;
    if (this.wants('positionOpened')) this.emit({ type: 'positionOpened', position: { ...p } });
  }

  private addToPosition(qty: number, price: number, commission: number, ord: Order, bracket: BotBracket | null): void {
    const p = this.pos!;
    p.avgPrice = (p.avgPrice * p.qty + price * qty) / (p.qty + qty);
    p.qty += qty;
    this.entryCommission += commission;
    const { stop, target, trail } = this.brackets(p.side, price, ord, bracket);
    if (stop !== undefined) p.stopLoss = stop;
    if (target !== undefined) p.takeProfit = target;
    if (trail !== undefined) { p.trailDistance = trail; p.trailStop = p.side === 'long' ? price - trail : price + trail; }
    if (p.stopLoss !== undefined && this.hadStop) p.initialRisk = Math.abs(p.avgPrice - p.stopLoss) * p.qty * this.pv;
  }

  /** Closes `qty` of the position at `price`; the exit commission is already paid from cash. */
  private closePart(qty: number, price: number, commExit: number, reason: ExitReason, i: number): void {
    const p = this.pos!;
    const frac = qty / p.qty;
    const dir = p.side === 'long' ? 1 : -1;
    const gross = (price - p.avgPrice) * qty * this.pv * dir;
    const entryAlloc = this.entryCommission * frac;
    this.entryCommission -= entryAlloc;
    const pnl = gross - entryAlloc - commExit;
    this.st.cash += gross;
    this.st.realized += pnl;
    const grossFull = gross / frac;
    const trade: Trade = {
      id: `t${++this.tradeSeq}`,
      side: p.side,
      qty,
      entryT: p.openedAt,
      entryPrice: p.avgPrice,
      exitT: this._cols.t[i]!,
      exitPrice: price,
      pnl,
      pnlPct: this.equityAtEntry > 0 ? (pnl / this.equityAtEntry) * 100 : 0,
      commission: entryAlloc + commExit,
      mae: Math.min(p.mae, grossFull, 0) * frac,
      mfe: Math.max(p.mfe, grossFull, 0) * frac,
      barsHeld: i - p.openedIndex + 1,
      exitReason: reason,
      actor: p.actor,
      hadStop: this.hadStop,
    };
    if (this.hadStop && p.initialRisk !== undefined && p.initialRisk > 0) {
      trade.initialRisk = p.initialRisk * frac;
      trade.r = pnl / trade.initialRisk;
    }
    this._trades.push(trade);
    if (frac >= 1 - 1e-12) {
      this.pos = null;
      this.st.position = null;
      this.entryCommission = 0;
    } else {
      p.qty -= qty;
      p.mae *= 1 - frac;
      p.mfe *= 1 - frac;
      if (p.initialRisk !== undefined) p.initialRisk *= 1 - frac;
    }
    if (this.wants('tradeClosed')) this.emit({ type: 'tradeClosed', trade });
  }

  /** Synthetic exit (bracket / time / end): pays commission and records the fill. */
  private exitAt(price: number, ref: number, reason: ExitReason, i: number): void {
    const p = this.pos!;
    const commission = commissionFor(this.costs, p.qty);
    this.st.cash -= commission;
    this.emitFill(`${reason}#${++this.fillSeq}`, p.side === 'long' ? 'sell' : 'buy', p.qty, price, ref, commission, i);
    this.closePart(p.qty, price, commission, reason, i);
  }

  private closeAtClose(i: number, reason: ExitReason): void {
    const c = this._cols.c[i]!;
    const long = this.pos!.side === 'long';
    this.exitAt(long ? c - this.slip : c + this.slip, c, reason, i);
  }

  private processBrackets(i: number): void {
    const p = this.pos!;
    const c = this._cols;
    const o = c.o[i]!, h = c.h[i]!, l = c.l[i]!;
    const gapOk = this.midBarEntryIndex !== i || p.openedIndex !== i;
    const long = p.side === 'long';
    // effective stop: the tighter of stopLoss and trailStop
    let stop = p.stopLoss;
    let reason: ExitReason = 'stop';
    const ts = p.trailStop;
    if (ts !== undefined && (stop === undefined || (long ? ts > stop : ts < stop))) { stop = ts; reason = 'trail'; }
    if (stop !== undefined) {
      if (long) {
        if (gapOk && o <= stop) return this.exitAt(o - this.slip, o, reason, i);
        if (l <= stop) return this.exitAt(stop - this.slip, stop, reason, i);
      } else {
        if (gapOk && o >= stop) return this.exitAt(o + this.slip, o, reason, i);
        if (h >= stop) return this.exitAt(stop + this.slip, stop, reason, i);
      }
    }
    const tp = p.takeProfit;
    if (tp !== undefined && gapOk) {
      if (long) {
        if (o - this.half >= tp) return this.exitAt(o - this.half, o - this.half, 'target', i);
        if (h - this.half >= tp) return this.exitAt(tp, tp, 'target', i);
      } else {
        if (o + this.half <= tp) return this.exitAt(o + this.half, o + this.half, 'target', i);
        if (l + this.half <= tp) return this.exitAt(tp, tp, 'target', i);
      }
    }
    // trailing ratchets from this bar's extreme only after this bar's check
    if (p.trailDistance !== undefined && p.trailStop !== undefined) {
      if (long) { const n = h - p.trailDistance; if (n > p.trailStop) p.trailStop = n; }
      else { const n = l + p.trailDistance; if (n < p.trailStop) p.trailStop = n; }
    }
  }

  // ───────────── bot ─────────────

  private buildFlatMask(): void {
    const b = this.bot;
    if (!b || b.flatAt === undefined) { this.afterFlat = null; return; }
    if (TIMEFRAME_MS[this.timeframe] >= TIMEFRAME_MS['1d']) { this.afterFlat = null; return; }
    const t = this._cols.t;
    const m = new Uint8Array(t.length);
    const flat = b.flatAt;
    for (let i = 0; i < t.length; i++) m[i] = isPastFlatAt(t[i]!, flat, this.timeframe) ? 1 : 0;
    this.afterFlat = m;
  }

  private runBot(i: number): void {
    const b = this.bot!;
    const cur = this.projected();
    const blocked = this.afterFlat !== null && this.afterFlat[i] === 1;
    const wantLong = b.hasLong && !blocked && b.longEntry(i);
    const wantShort = b.hasShort && this.allowShort && !blocked && b.shortEntry(i);
    const exit = b.exitSignal(i);
    let flatAfter = cur === 0;
    if (cur > 0 && (exit || wantShort)) {
      this.botExit(cur, 'sell', exit ? 'signal' : 'reverse', 'long');
      flatAfter = true;
    } else if (cur < 0 && (exit || wantLong)) {
      this.botExit(-cur, 'buy', exit ? 'signal' : 'reverse', 'short');
      flatAfter = true;
    }
    if (!flatAfter) return;
    if (wantLong && cur <= 0) this.botEnter('long', i);
    else if (wantShort && cur >= 0) this.botEnter('short', i);
  }

  private botExit(qty: number, action: OrderAction, tag: ExitReason, side: Side): void {
    if (this.wants('signal')) this.emit({ type: 'signal', side, action: 'exit', reason: tag === 'signal' ? 'Exit rule fired' : 'Opposite entry' });
    this.submitInternal({ action, qty, type: 'market', actor: 'bot', tag }, true, null);
  }

  private botEnter(side: Side, i: number): void {
    const b = this.bot!;
    const entry = this._cols.c[i]!;
    const eq = this.st.equity;
    if (!(eq > 0) || !(entry > 0)) return;
    const sd = b.stopDistance(i, entry);
    const td = b.targetDistance(i, entry);
    const tr = b.trailDistance(i);
    const raw = b.size(i, eq, entry, sd, this.pv);
    const cap = this.maxQty(entry);
    let qty = Math.max(1, Math.floor(raw + 1e-9));
    if (qty > cap) qty = cap;
    if (qty < 1) return;
    if (this.wants('signal')) this.emit({ type: 'signal', side, action: 'enter', reason: side === 'long' ? 'Long entry rule fired' : 'Short entry rule fired' });
    const dir = side === 'long' ? 1 : -1;
    const req: OrderRequest = { action: side === 'long' ? 'buy' : 'sell', qty, type: 'market', actor: 'bot', tag: 'entry' };
    if (sd > 0) req.stopLoss = entry - dir * sd;
    if (td > 0) req.takeProfit = entry + dir * td;
    if (tr > 0) req.trailDistance = tr;
    this.submitInternal(req, false, { stop: sd, target: td, trail: tr });
  }

  // ───────────── live mode ─────────────

  /** Extends the series by one bar (live mode) and recompiles the strategy's indicators. */
  appendBar(bar: Bar): void {
    if (!this.ownBars) { this.bars = this.bars.slice(); this.ownBars = true; }
    this.bars.push(bar);
    this._cols = toColumns(this.bars);
    if (this.spec) {
      this.bot = compileStrategy(this.spec, this._cols);
      this.buildFlatMask();
    }
    if (this.fixedEnd === undefined) {
      this.endIdx = this.bars.length - 1;
      this.ended = false;
    }
  }

  // ───────────── results ─────────────

  result(): BacktestResult {
    return {
      strategyId: this.spec?.id ?? 'manual',
      symbol: this.instrument.symbol,
      timeframe: this.timeframe,
      startIndex: this.startIndex,
      endIndex: this.idx,
      initialCash: this.initialCash,
      trades: this._trades.slice(),
      equity: this._equity.slice(),
      metrics: computeMetrics(this._trades, this._equity, this.initialCash, this.timeframe),
    };
  }
}
