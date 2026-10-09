import type { Session } from '@miko/engine';
import { arrow, signedMoney, num } from '../../lib/format.ts';
import { AnimatedNumber } from '../../components/AnimatedNumber.tsx';

/** Open-position card: big unrealised P&L, R multiple, progress between stop and target. */
export function PositionCard({ session, botSession }: { session: Session; botSession: Session | null }) {
  const pos = session.state.position;
  const working = session.state.workingOrders.filter((o) => o.actor === 'manual');
  const botPnl = botSession ? botSession.state.equity - botSession.initialCash : null;

  if (!pos) {
    return (
      <div className="pos-card idle" data-fx="pnl">
        <div className="pos-idle">
          {working.length > 0 ? <><span className="spinner" /> Order on the way…</> : <><span className="pos-idle-ico">🎯</span> Flat · pick a side</>}
        </div>
        {botPnl !== null && <BotChip pnl={botPnl} open={!!botSession?.state.position} />}
      </div>
    );
  }

  const last = session.cols.c[session.index]!;
  const r = pos.initialRisk && pos.initialRisk > 0 ? pos.unrealized / pos.initialRisk : NaN;
  const stop = pos.trailStop ?? pos.stopLoss;
  const target = pos.takeProfit;
  let progress = 0.5;
  if (stop !== undefined && target !== undefined && target !== stop) progress = Math.max(0, Math.min(1, (last - stop) / (target - stop)));
  const up = pos.unrealized >= 0;

  return (
    <div className={`pos-card ${up ? 'up' : 'down'}`} data-fx="pnl">
      <div className="pos-top">
        <span className={`side-tag ${pos.side}`}>{pos.side === 'long' ? '▲ LONG' : '▼ SHORT'} <b className="num">×{pos.qty}</b></span>
        <AnimatedNumber className="pos-pnl" value={pos.unrealized} duration={300} format={(v) => `${arrow(v)} ${signedMoney(v)}`} />
        <span className="r-chip num">{Number.isFinite(r) ? `${r >= 0 ? '+' : ''}${num(r, 1)}R` : '—'}</span>
      </div>
      <div className="pos-bar" aria-label="Distance between stop and target">
        <span className="pos-bar-end">🛡️</span>
        <div className="pos-track">
          <div className="pos-track-fill" style={{ width: `${progress * 100}%` }} />
          <div className="pos-track-dot" style={{ left: `${progress * 100}%` }} />
        </div>
        <span className="pos-bar-end">🎯</span>
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
