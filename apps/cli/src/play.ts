import {
  Coach, Session, applySession, awardTrade, costsFor, createProfile, levelForXp, planQuickTrade, rankFor,
  type EngineEvent, type Mood, type Tip, type Trade, type XpAward,
} from '@miko/engine';
import { FileProfileStore } from '@miko/data';
import { int, loadSeries, str, type Args } from './common.ts';
import { c, date, money, num, signedMoney } from './ui.ts';

const MOOD_FACE: Record<Mood, string> = {
  happy: '(^_^)', excited: '(≧▽≦)', thinking: '(・_・?)', worried: '(°_°;)', proud: '(￣▽￣)ゞ',
  teaching: '(・ω・)ノ', cheer: '\\(^o^)/', sleepy: '(-_-)zzZ',
};

function say(tip: Tip | null): void {
  if (tip) console.log(`  ${c.pink(`Miko ${MOOD_FACE[tip.mood] ?? ''}`)} ${tip.text}`);
}

function xpLine(awards: readonly XpAward[]): void {
  for (const a of awards) console.log(`  ${c.yellow(`+${a.amount} XP`)} ${a.icon} ${a.reason}`);
}

const HELP = `${c.bold('Keys:')} ${c.green('b')} buy  ${c.red('s')} sell  ${c.cyan('f')} flatten  ${c.bold('space')} next bar  ${c.gray('n')} 10 bars  ${c.gray('q')} quit`;

/**
 * A terminal replay of real bars: the same Session, quick-trade planner,
 * Coach and XP rules the web game uses, with no GUI at all.
 * `--script "b    f q"` (or piped stdin) drives it non-interactively.
 */
export async function cmdPlay(args: Args): Promise<void> {
  const series = await loadSeries(args, { tf: '5m' });
  if (series.bars.length < 60) throw new Error(`Need at least 60 bars to play, got ${series.bars.length}`);
  const length = int(args, 'length', 300)!;
  const startIndex = Math.max(50, series.bars.length - length - 1);
  const initialCash = int(args, 'cash', 10_000)!;
  const riskPct = int(args, 'risk', 1)!;
  const session = new Session({ series, startIndex, initialCash, costs: costsFor(series.instrument) });
  const coach = new Coach({ seed: int(args, 'seed', 1)! });
  const store = new FileProfileStore();
  const profileId = str(args, 'profile', 'cli')!;
  const profile = (await store.load(profileId)) ?? createProfile(profileId, 'Terminal Trader', Date.now());
  const started = Date.now();
  const today = new Date().toISOString().slice(0, 10);

  const tradeRisk = new Map<number, number>(); // trades.length at open -> riskPct
  let lastTradeIndex = session.index;
  let streak = 0;
  let pendingRisk: number | undefined;

  const ctx = () => ({
    state: session.state,
    recentTrades: session.trades,
    barsSinceLastTrade: session.index - lastTradeIndex,
    mode: 'arcade' as const,
    index: session.index,
    lifetimeTrades: profile.stats.trades,
    riskPct: pendingRisk,
  });

  session.on('*', (ev: EngineEvent) => {
    switch (ev.type) {
      case 'fill':
        console.log(`  ${c.cyan('FILL')} ${ev.fill.action} ${ev.fill.qty} @ ${num(ev.fill.price)} ${c.gray(`(fees ${money(ev.fill.commission + ev.fill.slippage)})`)}`);
        break;
      case 'positionOpened': {
        const p = ev.position;
        console.log(`  ${c.bold('OPEN')} ${p.side === 'long' ? c.green('LONG') : c.red('SHORT')} ${p.qty} @ ${num(p.avgPrice)}  stop ${num(p.stopLoss)}  target ${num(p.takeProfit)}`);
        if (pendingRisk !== undefined) tradeRisk.set(session.trades.length, pendingRisk);
        break;
      }
      case 'tradeClosed': {
        const t: Trade = ev.trade;
        lastTradeIndex = session.index;
        streak = t.pnl > 0 ? streak + 1 : 0;
        const risk = tradeRisk.get(session.trades.length - 1); // the trade is already in session.trades
        const equityBefore = session.state.equity - t.pnl;
        console.log(`  ${c.bold('CLOSED')} ${t.side} ${signedMoney(t.pnl)} ${t.r !== undefined ? c.gray(`(${num(t.r)} R)`) : ''} ${c.gray(`exit: ${t.exitReason}`)}`);
        const awards = awardTrade(t, { equityBefore, riskPct: risk, followedPlan: true, streak });
        xpLine(awards);
        break;
      }
      default:
        break;
    }
    if (ev.type !== 'bar' && ev.type !== 'equity') say(coach.observe(ev, ctx()));
  });

  const status = (): void => {
    const b = series.bars[session.index]!;
    const st = session.state;
    const pos = st.position;
    const posStr = pos
      ? `${pos.side === 'long' ? c.green('LONG') : c.red('SHORT')} ${pos.qty} ${signedMoney(pos.unrealized)}`
      : c.gray('flat');
    const chg = b.c - b.o;
    const candle = chg >= 0 ? c.green('▲') : c.red('▼');
    console.log(`${c.gray(`#${session.index - startIndex}`.padStart(5))} ${date(b.t)} ${candle} O ${num(b.o)} H ${num(b.h)} L ${num(b.l)} C ${c.bold(num(b.c))}  | ${posStr} | equity ${money(st.equity)}`);
  };

  const trade = (action: 'buy' | 'sell'): void => {
    const pos = session.state.position;
    if (pos && ((pos.side === 'long' && action === 'sell') || (pos.side === 'short' && action === 'buy'))) {
      session.flatten('manual');
      console.log(`  ${c.cyan('closing')} ${pos.side} at the next bar's open`);
      return;
    }
    if (pos) { console.log(c.gray('  already in a position: f to flatten')); return; }
    const plan = planQuickTrade(session, action, { riskPct });
    if (plan.qty < 1) { console.log(c.yellow('  not enough buying power for even one unit')); return; }
    const equity = session.state.equity;
    pendingRisk = equity > 0 ? (Math.abs(series.bars[session.index]!.c - plan.stopLoss) * plan.qty * series.instrument.pointValue / equity) * 100 : undefined;
    const order = action === 'buy'
      ? session.buy(plan.qty, { stopLoss: plan.stopLoss, takeProfit: plan.takeProfit })
      : session.sell(plan.qty, { stopLoss: plan.stopLoss, takeProfit: plan.takeProfit });
    if (order.status === 'rejected') { console.log(c.red(`  rejected: ${order.reason}`)); return; }
    console.log(`  ${action === 'buy' ? c.green('BUY') : c.red('SELL')} ${plan.qty} at market, stop ${num(plan.stopLoss)}, target ${num(plan.takeProfit)} ${c.gray(`(risk ≈ ${num(pendingRisk, 1)}% of equity, fills next bar)`)}`);
  };

  const step = (n = 1): void => {
    for (let k = 0; k < n && !session.done; k++) {
      session.step();
      if (n === 1 || k === n - 1) status();
    }
  };

  let finished = false;
  const finish = async (): Promise<void> => {
    if (finished) return;
    finished = true;
    if (session.state.position) { session.flatten('manual'); if (!session.done) session.step(); }
    const result = session.result();
    const m = result.metrics;
    console.log(`\n${c.bold('Session over')}: ${m.trades} trades, ${signedMoney(m.netProfit)}, win rate ${num(m.winRate * 100, 0)}%`);
    const now = Date.now();
    const applied = applySession(profile, {
      summary: { id: `cli-${now}`, t: now, mode: 'arcade', symbol: series.instrument.symbol, timeframe: series.timeframe, metrics: m },
      trades: result.trades,
      initialCash,
      today,
      localHour: new Date().getHours(),
      minutesPlayed: Math.max(1, Math.round((now - started) / 60_000)),
      tradeContext: result.trades.map((_, i) => ({ riskPct: tradeRisk.get(i), followedPlan: true })),
    }, now);
    xpLine(applied.awards);
    for (const a of applied.achievements) console.log(`  ${c.magenta('ACHIEVEMENT')} ${a.icon} ${a.name}: ${a.desc}`);
    if (applied.levelUp) { console.log(`  ${c.yellow(c.bold(`LEVEL UP → ${applied.levelUp}`))}`); say(coach.onLevelUp(applied.levelUp)); }
    say(coach.onSessionEnd(m, applied.awards)); // applySession already re-awards every trade
    const p = applied.profile;
    const rank = rankFor(levelForXp(p.xp));
    console.log(`  ${rank.icon} ${c.bold(rank.title)}  level ${p.level}, ${p.xp} XP, rating ${Math.round(p.rating)} (${applied.ratingDelta >= 0 ? '+' : ''}${Math.round(applied.ratingDelta)})`);
    if (!args['no-save']) {
      await store.save(p);
      console.log(c.gray(`  profile saved to ${store.dir}/${p.id}.json`));
    }
  };

  console.log(`${c.bold('MikoMarket terminal replay')}  ${series.instrument.emoji ?? ''} ${series.instrument.symbol} ${series.timeframe}  ${c.gray(`${series.bars.length - startIndex - 1} bars to play, cash ${money(initialCash)}, risk ${riskPct}%/trade`)}`);
  say(coach.greet(profile, today));
  console.log(HELP);
  status();

  const handle = async (key: string): Promise<boolean> => {
    switch (key) {
      case 'b': trade('buy'); break;
      case 's': trade('sell'); break;
      case 'f': {
        if (session.state.position) { session.flatten('manual'); console.log(`  ${c.cyan('flatten')} at the next bar's open`); } else console.log(c.gray('  nothing to flatten'));
        break;
      }
      case ' ': case '\r': case '\n': step(1); break;
      case 'n': step(10); break;
      case 'h': case '?': console.log(HELP); break;
      case 'q': case '\u0003': await finish(); return true;
      default: break;
    }
    if (session.done) { console.log(c.gray('  end of data')); await finish(); return true; }
    return false;
  };

  const script = str(args, 'script');
  if (script !== undefined) {
    for (const key of script) if (await handle(key)) return;
    await finish();
    return;
  }

  const stdin = process.stdin;
  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.setEncoding('utf8');
  await new Promise<void>((resolve) => {
    let busy = Promise.resolve();
    const onData = (chunk: string): void => {
      busy = busy.then(async () => {
        if (finished) return;
        for (const key of chunk) {
          if (await handle(key)) {
            stdin.off('data', onData);
            if (stdin.isTTY) stdin.setRawMode(false);
            stdin.pause();
            resolve();
            return;
          }
        }
      });
    };
    stdin.on('data', onData);
    stdin.on('end', () => { busy = busy.then(async () => { await finish(); resolve(); }); });
    stdin.resume();
  });
}
