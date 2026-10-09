import type { AccountState, EngineEvent, Grade, Metrics, Mood, Profile, RobustnessReport, SessionSummary, Tip, Trade, XpAward } from '../types.ts';
import { createRng, type Rng } from '../util/rng.ts';
import { rankFor } from './levels.ts';
import { dailyStreak } from './profile.ts';
import { sumXp } from './xp.ts';

/** What Miko can see when an engine event arrives. */
export interface CoachContext {
  state: AccountState;
  /** Closed trades of this session, chronological (most recent LAST). May or may not include the trade in a tradeClosed event. */
  recentTrades: readonly Trade[];
  barsSinceLastTrade: number;
  mode: SessionSummary['mode'];
  /** Index of the last closed bar. This is the coach's clock for cooldowns. */
  index: number;
  /** Lifetime closed trades BEFORE this session (from profile.stats.trades). Enables the first-trade tip. */
  lifetimeTrades?: number;
  /** Risk of the position just opened, as % of equity, when the caller knows it. */
  riskPct?: number;
  /** True when the current bar is at/after the strategy's flatAt time (the caller knows the exchange timezone). */
  pastFlatAt?: boolean;
}

/** Values that line templates may interpolate. */
export interface LineParams {
  risk?: number;    // % of equity at risk
  r?: number;       // R multiple
  dd?: number;      // drawdown %
  xp?: number;
  wins?: number;
  trades?: number;
  level?: number;
  name?: string;
  streak?: number;
}

type Line = (p: LineParams) => string;

export interface CoachTipMeta { mood: Mood; priority: number; cooldown: number }

/** Priority >= this ignores the global "one tip per N bars" gap (cooldowns still apply). */
export const HIGH_PRIORITY = 80;

export const TIP_META: Record<string, CoachTipMeta> = {
  revenge: { mood: 'thinking', priority: 95, cooldown: 30 },
  no_stop: { mood: 'worried', priority: 90, cooldown: 20 },
  loss_streak: { mood: 'thinking', priority: 88, cooldown: 30 },
  too_big: { mood: 'worried', priority: 85, cooldown: 20 },
  flat_at: { mood: 'worried', priority: 85, cooldown: 30 },
  drawdown: { mood: 'worried', priority: 80, cooldown: 150 },
  big_win: { mood: 'excited', priority: 75, cooldown: 20 },
  first_trade: { mood: 'excited', priority: 70, cooldown: Infinity },
  stop_hit: { mood: 'teaching', priority: 60, cooldown: 15 },
  new_high: { mood: 'proud', priority: 40, cooldown: 100 },
  nice_win: { mood: 'happy', priority: 30, cooldown: 15 },
  idle_long: { mood: 'sleepy', priority: 20, cooldown: 120 },
};

const f1 = (x: number | undefined) => (x === undefined || !Number.isFinite(x) ? '?' : x.toFixed(1));
const f0 = (x: number | undefined) => (x === undefined || !Number.isFinite(x) ? '?' : Math.round(x).toString());
/** % loss after four full-risk losers in a row (compounded). */
const fourLosses = (risk = 0) => 100 * (1 - Math.pow(1 - Math.min(risk, 100) / 100, 4));
/** % gain needed to recover a drawdown of dd %. */
const recoverNeed = (dd = 0) => (dd >= 100 ? Infinity : (dd / (100 - dd)) * 100);
const rTag = (r?: number) => (r !== undefined && Number.isFinite(r) ? ` +${r.toFixed(1)}R!` : '');
const shortName = (n?: string) => (n ? (n.length > 16 ? `${n.slice(0, 15)}…` : n) : 'trader');

export const COACH_LINES: Record<string, Line[]> = {
  first_trade: [
    () => 'Your first trade! 🎉 Welcome to the market. Win or lose, you will learn something today.',
    () => 'And we are live! ✨ First trade placed. Watch how price moves between your stop and target.',
    () => 'First trade, yay! 🌱 Every legend started with exactly this click.',
  ],
  no_stop: [
    () => 'No stop on this one! 😳 Set one now so a bad move cannot snowball. A wide ATR stop beats none.',
    () => 'Heads up: no stop-loss yet. Decide where your idea is wrong before the market decides for you. 🛡️',
    () => 'A ninja never fights without armor 🥷 Add a stop where your trade idea stops making sense.',
  ],
  too_big: [
    (p) => `Whoa, ~${f1(p.risk)}% of your account is at risk. Many pros risk 0.5-2% per trade. 🛡️`,
    (p) => `Big size! Four losers like this in a row would cost ~${f0(fourLosses(p.risk))}%. Smaller size, longer game. ⚖️`,
    (p) => `Risking ~${f1(p.risk)}% here. Size from your stop distance so each trade risks 1-2%. 📏`,
  ],
  revenge: [
    () => 'Jumping right back in, and bigger? 🤔 That is how revenge trades start. Breathe, then trade your plan.',
    () => 'Quick re-entry with more size after a loss... is this the setup, or the sting talking? 💭',
    () => 'Hey, slow down a sec 🍵 Upsizing right after a loss is a classic trap. Same size, same plan.',
  ],
  loss_streak: [
    () => '3 losses in a row happens to every strategy. Short breather? 🍵 Your stops kept them small.',
    () => 'Rough patch! Even a 60% win-rate system hits 3 losers in a row regularly. Stretch, then reset. 🌸',
    () => 'Three reds is variance, not failure 💪 A tiny pause now keeps your next decision clean.',
  ],
  big_win: [
    (p) => `Huge win!${rTag(p.r)} ✨ Enjoy it, then keep the same size. One big win does not change your edge.`,
    () => 'Nice one! 🎉 Big winners pay for many small losses. Stay humble and stick to the plan.',
    () => 'WOW ✨ That is a big one! Overconfidence loves a hot hand, so next trade: same risk.',
  ],
  nice_win: [
    () => 'Nice one! ✨ Green trade banked.',
    () => 'Clean win! 💚 Process first, profits follow.',
    () => 'Ka-ching! 💰 Well played.',
  ],
  stop_hit: [
    () => 'Stopped out, and that is okay! The stop did its job: a small, planned loss. 📘',
    () => 'Stop hit = risk controlled ✅ Small losses are the cost of doing business.',
    () => 'Ouch, but tidy! 🛡️ Your stop capped this loss. That is exactly how pros survive.',
  ],
  drawdown: [
    (p) => `You are down ${f1(p.dd)}% from your peak. Consider halving size until you are back on track. 🛡️`,
    (p) => `Down ${f1(p.dd)}% from peak, so it takes +${f1(recoverNeed(p.dd))}% to recover. Smaller risk protects the comeback.`,
    (p) => `Rough stretch (${f1(p.dd)}% drawdown). Breathe 🌸 Smaller size and A+ setups only. You can climb out.`,
  ],
  new_high: [
    () => 'New equity high! 📈 That is what consistency looks like. ✨',
    () => 'Fresh peak! 🏔️ Above every previous high. Keep doing what works.',
    () => 'New high for this run! 🎉 Proud of you. Same plan, same risk.',
  ],
  idle_long: [
    () => 'Waiting for a good setup is a skill! 🧘 No trade beats a forced trade.',
    () => 'Quiet market? 😴 Patience is a position. I am here when you spot something.',
    () => 'Still watching? 👀 Ask yourself: what exactly would make me enter?',
  ],
  flat_at: [
    () => 'Past your flat time and still in a trade! ⏰ Your day-trade plan says close before the session ends.',
    () => 'Clock check ⏰ Your plan says be flat by now. Overnight gaps can jump right over a stop.',
  ],
};

export const REPORT_LINES: Record<Grade, Line[]> = {
  S: [
    () => 'S-grade! 🌟 It held up out-of-sample and under Monte Carlo. That is a seriously robust bot!',
    () => 'S-tier bot! ✨ Strong on unseen data too. Paper trade it live before trusting it with money.',
  ],
  A: [
    () => 'Grade A! 🏅 Solid out-of-sample results. A walk-forward test would make it even more convincing.',
    () => 'An A! 🎉 It kept working on data it never saw. Check it on another symbol too.',
  ],
  B: [
    () => 'Grade B: decent! 👍 Read the reasons below to see what held it back.',
    () => 'B-grade bot 🙂 Promising. Fewer, simpler rules often survive new data better.',
  ],
  C: [
    () => 'Grade C. It works in places but is not robust yet. 🧪 Try simpler rules or wider parameters.',
    () => 'C for now 🌱 Out-of-sample results slipped. More data or fewer genes may help.',
  ],
  D: [
    () => 'Grade D: likely overfit. Great catch BEFORE risking money! 🕵️ Simplify and retest.',
    () => 'D-grade: it memorised the past. Finding that out in the lab is a win! 📘 Simplify and retry.',
  ],
};

export const SESSION_LINES: Record<'flat' | 'green' | 'red', Line[]> = {
  flat: [
    (p) => `No trades this time, and that is fine! Patience still earned you ${f0(p.xp)} XP. 🧘`,
    (p) => `Sat it out? Smart if nothing looked good. +${f0(p.xp)} XP for showing up. 🌸`,
  ],
  green: [
    (p) => `Green session! ✨ ${f0(p.wins)}/${f0(p.trades)} winners and +${f0(p.xp)} XP. Same process next time!`,
    (p) => `Profit day! 🎉 +${f0(p.xp)} XP. Remember: a good process repeated is what pays.`,
  ],
  red: [
    (p) => `Red session, but +${f0(p.xp)} XP of lessons 📘 ${f0(p.wins)}/${f0(p.trades)} winners. Small losses = progress.`,
    (p) => `Not every day is green, even for pros 🌸 You earned +${f0(p.xp)} XP. Review one trade and go again!`,
  ],
};

export const LEVEL_LINES: Line[] = [
  (p) => `Level ${f0(p.level)}! 🎉 You are now a ${rankFor(p.level ?? 1).icon} ${rankFor(p.level ?? 1).title}. Keep stacking good habits!`,
  (p) => `LEVEL UP! ✨ Level ${f0(p.level)} reached. Your discipline is paying off!`,
  (p) => `Ding! 🔔 Level ${f0(p.level)}. ${rankFor(p.level ?? 1).icon} Miko is proud of you!`,
];

export const GREET_LINES: Record<'new' | 'streak' | 'back' | 'again', Line[]> = {
  new: [
    (p) => `Hi ${shortName(p.name)}! I am Miko ✨ Let's learn to trade the smart way: small risk, clear stops.`,
    (p) => `Welcome, ${shortName(p.name)}! 🌸 I am Miko. I will cheer you on and share tips as you trade.`,
  ],
  streak: [
    (p) => `Welcome back, ${shortName(p.name)}! 🔥 Day ${f0(p.streak)} of your streak. Let's keep it going!`,
    (p) => `${shortName(p.name)}! 🔥 ${f0(p.streak)} days in a row. Consistency is the real edge.`,
  ],
  back: [
    (p) => `Welcome back, ${shortName(p.name)}! 🌸 Fresh start today. Let's go!`,
    (p) => `Yay, ${shortName(p.name)} is back! ✨ Ready for a calm, disciplined session?`,
  ],
  again: [
    (p) => `Round two, ${shortName(p.name)}? 💪 Same plan, same risk.`,
    (p) => `Back for more, ${shortName(p.name)}! ✨ Remember: quality setups over quantity.`,
  ],
};

/** Rotating educational micro-tips. Each is a real, correct concept in one breath. */
export const IDLE_TIPS: readonly string[] = [
  'ATR stops adapt to volatility: a 2x ATR stop gives a wild market more room and a calm one less. 📏',
  'Position size = money at risk / stop distance. Wider stop? Fewer shares, same risk. ⚖️',
  'Overfitting = a bot that memorised the past. More rules and more tuning raise the risk. 🧠',
  'Out-of-sample data is the exam your bot never studied for. Trust it more than in-sample. 📝',
  'Monte Carlo reshuffles your trades to show drawdowns that luck alone could have dealt you. 🎲',
  'Win rate is not everything: 35% winners at 3:1 payoff beats 70% winners at 1:3. 🧮',
  'Heikin-Ashi candles average prices to smooth noise. Great for trend colour, not real fill prices. 🕯️',
  'Bollinger squeeze: very narrow bands mean low volatility, which often expands soon after. 🎈',
  'RSI divergence: price makes a higher high but RSI a lower high. Momentum may be fading. 📉',
  'Revenge trading means chasing a loss back fast. It usually makes the hole deeper. 🍵',
  'R-multiple = profit / initial risk. +2R means you made twice what you risked. 📐',
  'Lose 50% and you need +100% to get back. Small losses keep you in the game. 🛡️',
  'Expectancy = win% x avg win - loss% x avg loss. Positive means an edge over many trades. 📊',
  'Walk-forward: tune on one window, test on the next, repeat. A tougher, fairer test. 🚶',
  'A few lucky trades prove little. Judge a system on 30+ trades, ideally many more. 🔢',
  'Costs are real: a strategy that only works with zero slippage and commission does not work. 💸',
  'Trend following wins rarely but big; mean reversion wins often but small. Know which you run. 🔄',
  'Moving a stop further away mid-trade turns a small loss into a big one. Let it work. 🧱',
];

export interface CoachOptions {
  seed?: number;
  /** At most one tip per this many bars, except tips with priority >= HIGH_PRIORITY. Default 8. */
  minGapBars?: number;
}

interface Candidate { id: string; params: LineParams }

/** Miko's brain. Deterministic for a given seed and event sequence. */
export class Coach {
  private rng: Rng;
  private readonly minGap: number;
  private lastShown = new Map<string, number>();
  private lastVariant = new Map<string, number>();
  private lastTipIndex = -Infinity;
  private peak: number | undefined;
  private startEquity: number | undefined;
  private idleOrder: number[];
  private idlePos = 0;

  constructor(opts: CoachOptions | number = {}) {
    const o = typeof opts === 'number' ? { seed: opts } : opts;
    this.rng = createRng(o.seed ?? 1);
    this.minGap = o.minGapBars ?? 8;
    this.idleOrder = IDLE_TIPS.map((_, i) => i);
    for (let i = this.idleOrder.length - 1; i > 0; i--) {
      const j = this.rng.int(0, i);
      [this.idleOrder[i], this.idleOrder[j]] = [this.idleOrder[j]!, this.idleOrder[i]!];
    }
  }

  /** Forget cooldowns and equity tracking (call at the start of a new session). */
  reset(): void {
    this.lastShown.clear();
    this.lastTipIndex = -Infinity;
    this.peak = undefined;
    this.startEquity = undefined;
  }

  observe(event: EngineEvent, ctx: CoachContext): Tip | null {
    const candidates = this.candidates(event, ctx);
    candidates.sort((a, b) => TIP_META[b.id]!.priority - TIP_META[a.id]!.priority);
    for (const c of candidates) {
      const meta = TIP_META[c.id]!;
      const last = this.lastShown.get(c.id);
      if (last !== undefined && ctx.index - last < meta.cooldown) continue;
      if (meta.priority < HIGH_PRIORITY && ctx.index - this.lastTipIndex < this.minGap) continue;
      this.lastShown.set(c.id, ctx.index);
      this.lastTipIndex = ctx.index;
      return { id: c.id, mood: meta.mood, priority: meta.priority, text: this.say(c.id, COACH_LINES[c.id]!, c.params) };
    }
    return null;
  }

  onReport(report: RobustnessReport): Tip {
    const mood: Mood = report.grade === 'S' || report.grade === 'A' ? 'proud' : report.grade === 'B' ? 'happy' : 'teaching';
    return { id: `report_${report.grade}`, mood, priority: 70, text: this.say(`report_${report.grade}`, REPORT_LINES[report.grade], {}) };
  }

  onSessionEnd(metrics: Metrics, awards: readonly XpAward[]): Tip {
    const kind = metrics.trades === 0 ? 'flat' : metrics.netProfit > 0 ? 'green' : 'red';
    const mood: Mood = kind === 'green' ? 'proud' : kind === 'red' ? 'cheer' : 'happy';
    const params = { xp: sumXp(awards), wins: metrics.wins, trades: metrics.trades };
    return { id: `session_${kind}`, mood, priority: 60, text: this.say(`session_${kind}`, SESSION_LINES[kind], params) };
  }

  onLevelUp(level: number): Tip {
    return { id: 'level_up', mood: 'excited', priority: 90, text: this.say('level_up', LEVEL_LINES, { level }) };
  }

  greet(profile: Profile, today: string): Tip {
    const ds = dailyStreak(profile, today);
    const kind = profile.stats.sessions === 0 && !profile.lastPlayedDay ? 'new' : !ds.firstToday ? 'again' : ds.continued ? 'streak' : 'back';
    return { id: `greet_${kind}`, mood: kind === 'streak' ? 'excited' : 'happy', priority: 50, text: this.say(`greet_${kind}`, GREET_LINES[kind], { name: profile.name, streak: ds.days }) };
  }

  /** Next educational micro-tip, cycling through all of them in a seeded order. */
  idle(): Tip {
    const i = this.idleOrder[this.idlePos % this.idleOrder.length]!;
    this.idlePos++;
    return { id: `idle_${i}`, mood: 'teaching', priority: 10, text: IDLE_TIPS[i]! };
  }

  private say(key: string, lines: readonly Line[], params: LineParams): string {
    let i = this.rng.int(0, lines.length - 1);
    if (lines.length > 1 && this.lastVariant.get(key) === i) i = (i + 1) % lines.length;
    this.lastVariant.set(key, i);
    return lines[i]!(params);
  }

  private candidates(event: EngineEvent, ctx: CoachContext): Candidate[] {
    const out: Candidate[] = [];
    const manual = ctx.mode !== 'bot';
    switch (event.type) {
      case 'positionOpened': {
        const pos = event.position;
        if (manual && (ctx.lifetimeTrades ?? 1) === 0 && ctx.recentTrades.length === 0) out.push({ id: 'first_trade', params: {} });
        if (pos.stopLoss === undefined) {
          out.push({ id: 'no_stop', params: {} });
        } else {
          const risk = ctx.riskPct ?? (pos.initialRisk !== undefined && ctx.state.equity > 0 ? (pos.initialRisk / ctx.state.equity) * 100 : undefined);
          if (risk !== undefined && risk > 3) out.push({ id: 'too_big', params: { risk } });
        }
        const last = ctx.recentTrades[ctx.recentTrades.length - 1];
        if (manual && pos.actor === 'manual' && last && last.pnl < 0 && ctx.barsSinceLastTrade <= 2 && pos.qty > last.qty) {
          out.push({ id: 'revenge', params: {} });
        }
        break;
      }
      case 'tradeClosed': {
        const t = event.trade;
        const trades = ctx.recentTrades[ctx.recentTrades.length - 1]?.id === t.id ? ctx.recentTrades : [...ctx.recentTrades, t];
        const last3 = trades.slice(-3);
        if (t.pnl < 0 && last3.length === 3 && last3.every((x) => x.pnl < 0)) out.push({ id: 'loss_streak', params: {} });
        if (t.pnl < 0 && t.hadStop && (t.exitReason === 'stop' || t.exitReason === 'trail')) out.push({ id: 'stop_hit', params: {} });
        if (t.pnl > 0) {
          const big = (t.r !== undefined && t.r >= 3) || t.pnlPct >= 3;
          out.push(big ? { id: 'big_win', params: { r: t.r } } : { id: 'nice_win', params: {} });
        }
        break;
      }
      case 'equity': {
        if (this.peak === undefined || this.startEquity === undefined) {
          this.peak = event.equity;
          this.startEquity = event.equity;
          break;
        }
        if (event.drawdownPct > 10) out.push({ id: 'drawdown', params: { dd: event.drawdownPct } });
        if (event.equity > this.peak) {
          this.peak = event.equity;
          if (event.equity >= this.startEquity * 1.01) out.push({ id: 'new_high', params: {} });
        }
        break;
      }
      case 'bar': {
        if (ctx.pastFlatAt && ctx.state.position) out.push({ id: 'flat_at', params: {} });
        if (manual && !ctx.state.position && ctx.barsSinceLastTrade >= 60) out.push({ id: 'idle_long', params: {} });
        break;
      }
      default:
        break;
    }
    return out;
  }
}
