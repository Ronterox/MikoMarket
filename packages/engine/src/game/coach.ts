import type {
  AccountState, Bar, EngineEvent, Grade, Metrics, Mood, Params, Profile, RobustnessReport, SessionSummary, Timeframe, Tip, Trade, XpAward,
} from '../types.ts';
import { listIndicators } from '../indicators/index.ts';
import { createRng, type Rng } from '../util/rng.ts';
import { CLOCK_MOMENTS, nyClock, type ClockMoment } from './clock.ts';
import { analyzeCombo, INDICATOR_TIPS, MOVING_AVERAGES } from './indicatorTips.ts';
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
  /** Recent CLOSED bars, oldest first (20+ is plenty). Lets onAction spot dips, rips and new highs. */
  recentBars?: readonly Bar[];
  /** Equity at the start of the session. Default: the equity first seen by onPerformance. */
  startEquity?: number;
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
  pnl?: number;     // currency
  pct?: number;     // % change
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

const money = (x: number | undefined) => (x === undefined || !Number.isFinite(x) ? '$?' : `$${Math.abs(x).toFixed(0)}`);

export type ActionKind = 'buy' | 'sell' | 'close';
/** Chance that a button press gets a reaction (when not on cooldown). */
export const ACTION_RATE = 0.45;
/** Bars after a reaction before the same button reacts again. */
export const ACTION_COOLDOWN = 3;

/** Reactions to pressing BUY / SELL / CLOSE. Keys are tip ids. */
export const ACTION_LINES: Record<string, Line[]> = {
  action_buy: [
    () => 'Buy button go brrr 🚀 Stop is set, let the trade breathe!',
    () => 'Long and strong! 💪 Now the hardest part: doing nothing while it works.',
    () => 'Bought! ✨ Remember where you are wrong, and let the plan handle the rest.',
    () => 'Ikuzo! 🌸 Long position away. May the candles be green.',
  ],
  action_buy_dip: [
    () => 'Buying after 3 red candles? Brave dip catcher 🗡️ Keep that stop tight in case it keeps falling.',
    () => 'Catching a falling knife? 🔪 Could be the bounce! Just let the stop do its job if not.',
  ],
  action_buy_breakout: [
    () => 'Buying the breakout at a fresh high 🚀 Breakouts on real volume are the ones that stick.',
    () => 'New high, new long ⛰️ Momentum gang! Watch for a quick fake-out back into the range.',
  ],
  action_cover: [
    () => 'Covering the short 🙌 Buying back is how shorts take profit or cut risk. Clean click.',
    () => 'Short covered! ✨ Back to neutral and clear-headed.',
  ],
  action_sell: [
    () => 'Short and sweet 😼 Shorts profit when price falls. Stop above, plan in place!',
    () => 'Sell order away! 📉 Going short takes guts. Respect the stop.',
    () => 'Bearish mode activated 🐻 Remember: shorts can squeeze up fast, so size small.',
  ],
  action_sell_high: [
    () => 'Shorting a brand new high? Bold! 😳 Fading strength works best with a stop just above the high.',
    () => 'Selling the top tick? 👀 Gutsy contrarian move. Trends can run further than they look.',
  ],
  action_sell_rip: [
    () => 'Fading 3 green candles 🧊 Mean-reversion vibes! Keep the stop above the recent high.',
    () => 'Three greens and you sell? Contrarian ninja 🥷 Stretched moves often snap back... sometimes.',
  ],
  action_sell_breakdown: [
    () => 'Selling the breakdown at a fresh low 📉 Momentum shorts like this need room, so trust the stop.',
  ],
  action_take: [
    () => 'Selling to close the long ✅ Locking it in is never a bad habit.',
    () => 'Long reduced 👍 Taking chips off the table is a skill too.',
  ],
  action_close_win: [
    (p) => `Closed green, about +${money(p.pnl)} 💚 Banked! Profit is only real once you take it.`,
    () => 'Cha-ching! 💰 Closing a winner on your terms. Love to see it.',
    () => 'Profit secured ✨ Now breathe and wait for the next clean setup.',
  ],
  action_close_paper: [
    () => 'Out already? Paper hands? 🧻 jk, profit is profit! Just check that the plan said to exit.',
    () => 'Quick scalp! ⚡ Tiny wins add up, but cutting winners early can starve your edge.',
  ],
  action_close_loss: [
    () => 'Cutting a loser takes courage 🛡️ Small loss now beats a big one later. Proud of you.',
    (p) => `Closed for about -${money(p.pnl)} 📘 A planned small loss is just business. Next!`,
    () => 'Ouch, but smart 🌸 Losses are tuition. You stayed in control.',
  ],
  action_close_flat: [
    () => 'Scratch trade ⚖️ Out near breakeven. Sometimes "no harm done" is the win.',
    () => 'Flat close 🍃 No idea is wrong if you exit before it costs much.',
  ],
};

/** Session-performance remarks (fired rarely, on meaningful changes). */
export const PERFORMANCE_LINES: Record<string, Line[]> = {
  perf_hot: [
    (p) => `${f0(p.streak)} wins in a row! 🔥 You are cooking. Same size, same plan: hot hands get sloppy.`,
    (p) => `Hot streak x${f0(p.streak)} ✨ Sugoi! Stay humble, the market does not know about streaks.`,
    (p) => `${f0(p.streak)} straight winners 🔥 Keep the risk the same and let the process keep working.`,
  ],
  perf_up: [
    (p) => `Session up ${f1(p.pct)}%! 📈 Lovely. Protecting gains is a skill too: no need to size up.`,
    (p) => `+${f1(p.pct)}% today ✨ That is a great session. Many pros ease off after a strong run.`,
    (p) => `Up ${f1(p.pct)}% 🎉 Profits feel great, but keep following the plan, not the feeling.`,
  ],
  perf_recover: [
    (p) => `Comeback arc! 🌸 You climbed back from a ${f1(p.dd)}% dip. That is real resilience.`,
    () => 'Back near your peak after a drawdown 💪 Patience and small size paid off. Shonen protagonist energy!',
  ],
  perf_down: [
    (p) => `Down ${f1(p.pct)}% this session. It happens to everyone 🌸 Halve your size, A+ setups only.`,
    () => 'Tough session 🫂 One idea: pause 5 minutes, then trade smaller. Losses are tuition, not a verdict.',
    () => 'Red days are part of trading 🍵 Your stops are your friends. Smaller size buys time to recover.',
  ],
  perf_flat: [
    () => 'Flat as a pancake 🥞 after a long while. Totally fine: no edge, no trade. Patience is a position.',
    () => 'Still around breakeven 🧘 Choppy days happen. Waiting for a clear setup beats forcing one.',
  ],
};

export const PERF_META: Record<string, { mood: Mood; cooldown: number; priority: number }> = {
  perf_recover: { mood: 'proud', cooldown: 60, priority: 45 },
  perf_down: { mood: 'cheer', cooldown: 80, priority: 44 },
  perf_hot: { mood: 'excited', cooldown: 40, priority: 42 },
  perf_up: { mood: 'proud', cooldown: 40, priority: 40 },
  perf_flat: { mood: 'sleepy', cooldown: 150, priority: 20 },
};
/** Minimum bars between any two performance remarks. */
export const PERF_GAP = 25;

/** Chance a clock moment gets a comment (once per moment per NY day). */
export const CLOCK_RATE = 0.45;
/** At most one clock comment per this many onClock calls (bars). */
export const CLOCK_GAP = 20;

const REMOVE_LINES: Line[] = [
  (p) => `Bye ${p.name ?? 'indicator'} 👋 A cleaner chart is a calmer mind.`,
  (p) => `${p.name ?? 'Indicator'} removed ✂️ Less is often more.`,
  () => 'Decluttering ✨ Marie Kondo would be proud.',
];

type ParamCheck = (p: Params, tf?: Timeframe) => { key: string; text: string } | null;
const num = (p: Params, k: string): number => (typeof p[k] === 'number' ? (p[k] as number) : Number(p[k]));
const tfMinutes = (tf?: Timeframe): number => (tf ? ({ '1m': 1, '3m': 3, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '4h': 240, '1d': 1440, '1w': 10080 })[tf] : NaN);

function maPeriodCheck(name: string): ParamCheck {
  return (p, tf) => {
    const n = num(p, 'period');
    if (n <= 3) return { key: 'ma_tiny', text: `${name} ${n}? 🤏 That is basically the price itself. It will flip on every wiggle.` };
    if (n >= 200) {
      const mins = tfMinutes(tf);
      if (tf === '1d') return { key: 'ma_200d', text: `${name} ${n} on daily 👑 The big-boss trend line that funds watch. Classic!` };
      if (mins <= 5) return { key: 'ma_200_intraday', text: `${name} ${n} on a ${tf} chart 🤔 That is only ~${((n * mins) / 60).toFixed(0)}h of data, not the famous daily 200.` };
      return { key: 'ma_200', text: `${name} ${n} 🐢 Very slow line. Remember the famous 200 is a DAILY average, not intraday.` };
    }
    return null;
  };
}

const PARAM_CHECKS: Record<string, ParamCheck> = {
  ...Object.fromEntries(MOVING_AVERAGES.map((id) => [id, maPeriodCheck(id.toUpperCase())])),
  rsi: (p) => {
    const n = num(p, 'period');
    if (n <= 3) return { key: 'rsi_twitchy', text: `RSI ${n}? Super twitchy 😳 It will slam between 0 and 100 constantly. Connors fans only!` };
    if (n >= 50) return { key: 'rsi_slow', text: `RSI ${n} 🐢 So smooth it will rarely reach 30 or 70. Try levels like 45/55 instead.` };
    return null;
  },
  bb: (p) => {
    const m = num(p, 'mult');
    if (m >= 3) return { key: 'bb_wide', text: `BB at ${m} std devs 😮 Price will almost never touch those bands. Super rare signals.` };
    if (m <= 1) return { key: 'bb_narrow', text: `BB at ${m} std dev 🤏 Price will poke outside all the time. The bands lose meaning.` };
    if (num(p, 'period') <= 5) return { key: 'bb_short', text: 'Very short Bollinger period ⚡ The bands will jitter around price. 20 is the classic.' };
    return null;
  },
  keltner: (p) => (num(p, 'mult') >= 4 ? { key: 'kc_wide', text: 'Keltner that wide 😮 Only huge moves will reach it. Fine for extremes, not daily signals.' } : null),
  macd: (p) => (num(p, 'fast') >= num(p, 'slow') ? { key: 'macd_inverted', text: 'MACD fast >= slow? 😳 That flips the meaning upside down. Fast should be shorter (12/26).' } : null),
  stoch: (p) => (num(p, 'kPeriod') <= 3 ? { key: 'stoch_twitchy', text: 'Stochastic that short is pure noise 🌀 Expect %K to bounce wall to wall.' } : null),
  supertrend: (p) => {
    const m = num(p, 'mult');
    if (m <= 1) return { key: 'st_tight', text: `SuperTrend x${m} 🤏 So tight it will flip on normal noise. 2-3 ATR is typical.` };
    if (m >= 5) return { key: 'st_loose', text: `SuperTrend x${m} 🐢 Very loose: it catches only the big trends and gives back a lot.` };
    return null;
  },
  atr: (p) => (num(p, 'period') <= 3 ? { key: 'atr_short', text: 'ATR that short jumps with every candle 📏 14 gives steadier stop distances.' } : null),
  adx: (p) => (num(p, 'period') <= 5 ? { key: 'adx_short', text: 'Very short ADX ⚡ It spikes on any burst. 14 is the standard.' } : null),
  donchian: (p) => (num(p, 'period') >= 100 ? { key: 'dc_long', text: 'A very long Donchian 🧱 Breakouts will be rare but meaningful. The Turtles used 20 and 55.' } : null),
};

function strHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const INDICATOR_NAMES: Record<string, string> = Object.fromEntries(listIndicators().map((m) => [m.id, m.name]));

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
  private readonly seed: number;
  /** Latest bar index seen in any context (indicator cooldowns use it). */
  private clockIndex = -Infinity;
  // onAction
  private lastAction = new Map<ActionKind, number>();
  // onPerformance
  private perf = Coach.freshPerf();
  // onClock
  private clockDay = NaN;
  private clockDone = new Set<string>();
  private clockBars = 0;
  private lastClockBar = -Infinity;
  // onIndicators
  private indCalls = 0;
  private lastIndCall = -Infinity;
  private lastIndIndex = -Infinity;
  private lastComboRule = '';
  private praised = new Set<string>();
  private taught = new Map<string, number>();
  private paramWarned = new Set<string>();

  private static freshPerf() {
    return {
      start: undefined as number | undefined, lastFire: -Infinity, lastByKind: new Map<string, number>(),
      upBand: 0, downFired: false, maxDd: 0, flatSince: undefined as number | undefined, flatFired: false, streakSeen: 0,
    };
  }

  constructor(opts: CoachOptions | number = {}) {
    const o = typeof opts === 'number' ? { seed: opts } : opts;
    this.seed = o.seed ?? 1;
    this.rng = createRng(this.seed);
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
    this.lastAction.clear();
    this.perf = Coach.freshPerf();
    this.clockDay = NaN;
    this.clockDone.clear();
    this.clockBars = 0;
    this.lastClockBar = -Infinity;
  }

  observe(event: EngineEvent, ctx: CoachContext): Tip | null {
    this.seeIndex(ctx.index);
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

  /**
   * A short reaction to pressing BUY / SELL / CLOSE. Fires on ~45% of presses, with a per-button
   * cooldown of ACTION_COOLDOWN bars after a reaction. Call it with the context at the moment of the
   * press (the position, if any, is the one BEFORE the order fills).
   */
  onAction(kind: ActionKind, ctx: CoachContext): Tip | null {
    this.seeIndex(ctx.index);
    const pos = ctx.state.position;
    if (kind === 'close' && !pos) return null;
    const last = this.lastAction.get(kind);
    if (last !== undefined && ctx.index - last < ACTION_COOLDOWN) return null;
    if (this.rng.next() >= ACTION_RATE) return null;

    const bars = ctx.recentBars ?? [];
    const last3 = bars.slice(-3);
    const reds3 = last3.length === 3 && last3.every((b) => b.c < b.o);
    const greens3 = last3.length === 3 && last3.every((b) => b.c > b.o);
    const lb = bars[bars.length - 1];
    const prior = bars.slice(-21, -1);
    const newHigh = !!lb && prior.length >= 10 && lb.h >= Math.max(...prior.map((b) => b.h));
    const newLow = !!lb && prior.length >= 10 && lb.l <= Math.min(...prior.map((b) => b.l));

    let id: string;
    const params: LineParams = {};
    if (kind === 'buy') {
      id = pos?.side === 'short' ? 'action_cover' : reds3 ? 'action_buy_dip' : newHigh ? 'action_buy_breakout' : 'action_buy';
    } else if (kind === 'sell') {
      id = pos?.side === 'long' ? 'action_take' : newHigh ? 'action_sell_high' : greens3 ? 'action_sell_rip' : newLow ? 'action_sell_breakdown' : 'action_sell';
    } else {
      const pnl = pos!.unrealized;
      const equity = ctx.state.equity > 0 ? ctx.state.equity : 10_000;
      const scratch = Math.abs(pnl) < equity * 0.0005;
      params.pnl = pnl;
      id = scratch ? 'action_close_flat' : pnl > 0 ? (pos!.barsHeld <= 2 ? 'action_close_paper' : 'action_close_win') : 'action_close_loss';
    }
    this.lastAction.set(kind, ctx.index);
    this.lastTipIndex = Math.max(this.lastTipIndex, ctx.index);
    const mood: Mood = id === 'action_close_loss' ? 'cheer' : id === 'action_close_paper' ? 'happy' : id.includes('dip') || id.includes('high') ? 'thinking' : 'excited';
    return { id, mood, priority: 35, text: this.say(id, ACTION_LINES[id]!, params) };
  }

  /**
   * Call after every bar. Rarely remarks on how the session is going: a hot streak, up 2%+,
   * a comeback from a drawdown, a rough patch (kindly), or a long flat stretch. Edge-triggered,
   * with per-kind cooldowns and at least PERF_GAP bars between remarks.
   */
  onPerformance(ctx: CoachContext): Tip | null {
    this.seeIndex(ctx.index);
    const P = this.perf;
    const eq = ctx.state.equity;
    if (!Number.isFinite(eq)) return null;
    if (P.start === undefined) P.start = ctx.startEquity ?? eq;
    const start = ctx.startEquity ?? P.start;
    if (!(start > 0)) return null;
    const pct = (eq / start - 1) * 100;
    const dd = ctx.state.drawdownPct;

    // Update edge-trigger state and collect what is newly true.
    const want: { id: string; params: LineParams; commit: () => void }[] = [];
    let streak = 0;
    for (let i = ctx.recentTrades.length - 1; i >= 0 && ctx.recentTrades[i]!.pnl > 0; i--) streak++;
    if (streak < P.streakSeen) P.streakSeen = streak;
    if (streak >= 3 && P.streakSeen < 3) want.push({ id: 'perf_hot', params: { streak }, commit: () => { P.streakSeen = streak; } });
    else if (streak >= 5 && P.streakSeen < 5) want.push({ id: 'perf_hot', params: { streak }, commit: () => { P.streakSeen = streak; } });

    if (pct < 1) P.upBand = 0;
    const band = Math.floor(pct / 2);
    if (pct >= 2 && band > P.upBand) want.push({ id: 'perf_up', params: { pct }, commit: () => { P.upBand = band; } });

    if (pct > -2 && dd < 2) P.downFired = false;
    if (!P.downFired && (pct <= -4 || dd >= 5)) want.push({ id: 'perf_down', params: { pct: Math.abs(Math.min(pct, -dd)) }, commit: () => { P.downFired = true; } });

    P.maxDd = Math.max(P.maxDd, dd);
    if (P.maxDd >= 3 && dd <= 0.5) want.push({ id: 'perf_recover', params: { dd: P.maxDd }, commit: () => { P.maxDd = 0; } });

    if (Math.abs(pct) < 0.3) {
      P.flatSince ??= ctx.index;
      if (!P.flatFired && ctx.index - P.flatSince >= 150) want.push({ id: 'perf_flat', params: {}, commit: () => { P.flatFired = true; } });
    } else {
      P.flatSince = undefined;
      P.flatFired = false;
    }

    if (want.length === 0) return null;
    if (ctx.index - P.lastFire < PERF_GAP || ctx.index - this.lastTipIndex < this.minGap) return null;
    want.sort((a, b) => PERF_META[b.id]!.priority - PERF_META[a.id]!.priority);
    for (const w of want) {
      const meta = PERF_META[w.id]!;
      const lastKind = P.lastByKind.get(w.id);
      if (lastKind !== undefined && ctx.index - lastKind < meta.cooldown) continue;
      w.commit();
      P.lastFire = ctx.index;
      P.lastByKind.set(w.id, ctx.index);
      this.lastTipIndex = ctx.index;
      return { id: w.id, mood: meta.mood, priority: meta.priority, text: this.say(w.id, PERFORMANCE_LINES[w.id]!, w.params) };
    }
    return null;
  }

  /**
   * Market-clock banter in New York time. `t` is the bar's OPEN time (epoch ms); call once per bar.
   * Each moment is considered on the first bar at/after it (within its window), at most once per NY day,
   * fires with probability CLOCK_RATE (deterministic per seed, day and moment), and clock tips are
   * at least CLOCK_GAP bars apart.
   */
  onClock(t: number): Tip | null {
    if (!Number.isFinite(t)) return null;
    this.clockBars++;
    const { day, minute, dow } = nyClock(t);
    if (day !== this.clockDay) {
      this.clockDay = day;
      this.clockDone.clear();
    }
    let pick: ClockMoment | undefined;
    for (const m of CLOCK_MOMENTS) {
      if (m.minute > minute || this.clockDone.has(m.id)) continue;
      this.clockDone.add(m.id);
      if (m.days.includes(dow) && minute < m.minute + m.window) pick = m; // time-ordered: the latest wins
    }
    if (!pick) return null;
    if (this.clockBars - this.lastClockBar < CLOCK_GAP) return null;
    const roll = createRng((Math.imul(this.seed, 2654435761) ^ Math.imul(day, 40503) ^ strHash(pick.id)) >>> 0);
    if (roll.next() >= CLOCK_RATE) return null;
    this.lastClockBar = this.clockBars;
    return { id: `clock_${pick.id}`, mood: pick.mood, priority: 25, text: pick.lines[Math.floor(roll.next() * pick.lines.length)]! };
  }

  /**
   * React to the indicator panel changing. `active` is the list AFTER the change.
   * 'add' teaches how the indicator works, or reacts to a classic / redundant / unusual combination;
   * 'params' comments on unusual settings; 'remove' occasionally says bye. Fast swapping is muted.
   */
  onIndicators(
    active: { id: string; params?: Params }[],
    change: { id: string; action: 'add' | 'remove' | 'params' },
    opts: { timeframe?: Timeframe } = {},
  ): Tip | null {
    this.indCalls++;
    const barsSince = Number.isFinite(this.clockIndex) ? this.clockIndex - this.lastIndIndex : 0;
    const muted = this.indCalls - this.lastIndCall < 2 && barsSince < 5;
    const ids = active.map((a) => a.id);
    const name = INDICATOR_NAMES[change.id] ?? change.id;
    const shown = (tip: Tip): Tip => {
      this.lastIndCall = this.indCalls;
      this.lastIndIndex = this.clockIndex;
      return tip;
    };
    const combo = analyzeCombo(ids);
    if (combo.kind !== 'redundant' && combo.kind !== 'unusual') this.lastComboRule = '';

    if (change.action === 'add') {
      if ((combo.kind === 'redundant' || combo.kind === 'unusual') && combo.ids.includes(change.id) && combo.rule !== this.lastComboRule) {
        this.lastComboRule = combo.rule;
        return shown({ id: `ind_combo_${combo.rule}`, mood: 'thinking', priority: 45, text: combo.text });
      }
      if (combo.kind === 'classic' && combo.ids.includes(change.id) && !this.praised.has(combo.rule)) {
        this.praised.add(combo.rule);
        return shown({ id: `ind_combo_${combo.rule}`, mood: 'excited', priority: 45, text: combo.text });
      }
      if (muted) return null;
      const tips = INDICATOR_TIPS[change.id];
      if (!tips?.length) return null;
      const n = this.taught.get(change.id) ?? 0;
      if (n > 0 && this.rng.next() < 0.5) return null; // re-adding: teach only sometimes
      this.taught.set(change.id, n + 1);
      return shown({ id: `ind_teach_${change.id}`, mood: 'teaching', priority: 30, text: tips[n % tips.length]! });
    }

    if (change.action === 'params') {
      const check = PARAM_CHECKS[change.id];
      const entry = [...active].reverse().find((a) => a.id === change.id);
      const hit = check && entry ? check(entry.params ?? {}, opts.timeframe) : null;
      // forget warnings that no longer apply, so a slider drag only warns once per crossing
      for (const k of [...this.paramWarned]) if (k.startsWith(`${change.id}:`) && k !== `${change.id}:${hit?.key}`) this.paramWarned.delete(k);
      if (!hit) return null;
      const key = `${change.id}:${hit.key}`;
      if (this.paramWarned.has(key)) return null;
      this.paramWarned.add(key);
      return shown({ id: `ind_params_${hit.key}`, mood: hit.key === 'ma_200d' ? 'happy' : 'thinking', priority: 35, text: hit.text });
    }

    // remove
    for (const k of [...this.paramWarned]) if (k.startsWith(`${change.id}:`)) this.paramWarned.delete(k);
    if (muted || this.rng.next() >= 0.3) return null;
    return shown({ id: 'ind_remove', mood: 'happy', priority: 10, text: this.say('ind_remove', REMOVE_LINES, { name }) });
  }

  private seeIndex(index: number): void {
    if (Number.isFinite(index) && index > this.clockIndex) this.clockIndex = index;
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
