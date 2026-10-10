import type { Session } from '@miko/engine';
import { arrow, signedMoney, num, priceFmt, money } from '../../lib/format.ts';
import { AnimatedNumber } from '../../components/AnimatedNumber.tsx';
import { STOP_LABEL, usePlay, type StopMult } from '../../state/play.ts';

/** Open-position card: big unrealised P&L, R multiple, stop/target, and the stop controls. */
export function PositionCard({ session, botSession }: { session: Session; botSession: Session | null }) {
  const stopMult = usePlay((s) => s.stopMult);
  const setStopMult = usePlay((s) => s.setStopMult);
  const removeStop = usePlay((s) => s.removeStop);
  const restoreStop = usePlay((s) => s.restoreStop);
  const toBreakeven = usePlay((s) => s.moveToBreakeven);
  const pos = session.state.position;
  const working = session.state.workingOrders.filter((o) => o.actor === 'manual');
  const botPnl = botSession ? botSession.state.equity - botSession.initialCash : null;

  if (!pos) {
    return (
      <div className="pos-card idle" data-fx="pnl">
        <div className="pos-idle">
          {working.length > 0 ? <><span className="spinner" /> Order on the way…</> : <><span className="pos-idle-ico">🎯</span> Flat</>}
        </div>
        {botPnl !== null && <BotChip pnl={botPnl} open={!!botSession?.state.position} />}
        {working.length === 0 && <div className="stop-pick" role="radiogroup" aria-label="Stop-loss distance for the next trade">
          <span className="stop-pick-lbl">🛡️ Stop</span>
          {([1, 2, 3] as StopMult[]).map((m) => (
            <button key={m} role="radio" aria-checked={stopMult === m} className={`stop-opt ${stopMult === m ? 'on' : ''}`}
              onClick={() => setStopMult(m)} title={`${m}× ATR away from entry`}>
              {STOP_LABEL[m]}
            </button>
          ))}
        </div>}
      </div>
    );
  }

  const inst = session.series.instrument;
  const last = session.cols.c[session.index]!;
  const r = pos.initialRisk && pos.initialRisk > 0 ? pos.unrealized / pos.initialRisk : NaN;
  const stop = pos.trailStop ?? pos.stopLoss;
  const target = pos.takeProfit;
  const long = pos.side === 'long';
  let progress = 0.5;
  if (stop !== undefined && target !== undefined && target !== stop) progress = Math.max(0, Math.min(1, (last - stop) / (target - stop)));
  const up = pos.unrealized >= 0;
  // $ lost if the stop fills from here (negative = locked-in profit).
  const atRisk = stop !== undefined ? (long ? pos.avgPrice - stop : stop - pos.avgPrice) * pos.qty * inst.pointValue : NaN;
  const atBe = stop !== undefined && (long ? stop >= pos.avgPrice : stop <= pos.avgPrice);
  const beSafe = long ? pos.avgPrice < last : pos.avgPrice > last;
  const canBe = stop !== undefined && !atBe && pos.unrealized > 0 && beSafe;

  return (
    <div className={`pos-card ${up ? 'up' : 'down'} ${stop === undefined ? 'nostop' : ''}`} data-fx="pnl">
      <div className="pos-top">
        <span className={`side-tag ${pos.side}`}>{long ? '▲ LONG' : '▼ SHORT'} <b className="num">×{pos.qty}</b></span>
        <AnimatedNumber className="pos-pnl" value={pos.unrealized} duration={300} format={(v) => `${arrow(v)} ${signedMoney(v)}`} />
        <span className="r-chip num">{Number.isFinite(r) ? `${r >= 0 ? '+' : ''}${num(r, 1)}R` : '—'}</span>
      </div>
      <div className="pos-bar" aria-label="Distance between stop and target">
        {stop !== undefined ? (
          <span className={`stop-pill ${atBe ? 'safe' : ''}`} title="Stop-loss: price and money at risk">
            <span className="stop-pill-main">🛡️ <b className="num">{priceFmt(stop, inst.tickSize)}</b></span>
            <span className="stop-pill-risk num">{atBe ? (atRisk < -0.5 ? `🔒 ${money(-atRisk)}` : 'BE ✓') : `−${money(atRisk)}`}</span>
            <button className="stop-pill-x" onClick={removeStop} aria-label="Remove stop-loss">✕</button>
          </span>
        ) : (
          <button className="stop-pill none" onClick={restoreStop} aria-label="Add a stop-loss">
            <span className="stop-pill-main">no stop ⚠️</span><span className="stop-pill-add">＋🛡️</span>
          </button>
        )}
        <div className="pos-track">
          <div className="pos-track-fill" style={{ width: `${progress * 100}%` }} />
          <div className="pos-track-dot" style={{ left: `${progress * 100}%` }} />
        </div>
        {canBe ? (
          <button className="be-btn" onClick={toBreakeven} title="Move the stop to your entry price: this trade can no longer lose">🛡️→BE</button>
        ) : (
          <span className="pos-bar-end">🎯{target !== undefined && <b className="num"> {priceFmt(target, inst.tickSize)}</b>}</span>
        )}
      </div>
      {botPnl !== null && <BotChip pnl={botPnl} open={!!botSession?.state.position} />}
    </div>
  );
}

function BotChip({ pnl, open }: { pnl: number; open: boolean }) {
  return (
    <span className={`bot-chip ${open ? 'live' : ''}`} title="Your bot in this round">
      🤖 <span className="num">{signedMoney(pnl)}</span>
    </span>
  );
}
