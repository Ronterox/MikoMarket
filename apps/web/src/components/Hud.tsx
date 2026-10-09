import { levelProgress, rankFor, sumXp } from '@miko/engine';
import { AnimatedNumber } from './AnimatedNumber.tsx';
import { LevelRing } from './LevelRing.tsx';
import { arrow, money, signedMoney } from '../lib/format.ts';
import { useApp } from '../state/app.ts';
import { usePlay } from '../state/play.ts';

/** Top HUD: equity counter, today's P&L pill, level ring with XP bar, streak flame. */
export function Hud() {
  const profile = useApp((s) => s.profile);
  usePlay((s) => s.version);
  const session = usePlay((s) => s.session);
  const liveAwards = usePlay((s) => s.liveAwards);
  const combo = usePlay((s) => s.combo);
  const equity = session?.state.equity ?? 10_000;
  const pnl = equity - (session?.initialCash ?? 10_000);
  const pending = sumXp(liveAwards);
  const lp = levelProgress(profile.xp);
  const rank = rankFor(lp.level);

  return (
    <header className="hud">
      <div className="hud-money">
        <div className="hud-label">💰 Equity</div>
        <AnimatedNumber className="hud-equity" value={equity} format={(v) => money(v)} />
      </div>
      <div className={`pnl-pill ${pnl > 0 ? 'up' : pnl < 0 ? 'down' : ''}`} data-fx="pnl-pill">
        <span className="pnl-arrow">{arrow(pnl)}</span>
        <AnimatedNumber value={pnl} format={(v) => signedMoney(v)} />
      </div>
      <div className="hud-right">
        {combo >= 2 && <div key={combo} className="combo-badge">x{combo}</div>}
        <div className="streak" title="Daily streak">🔥<span className="num">{profile.streakDays}</span></div>
        <div className="hud-level">
          <LevelRing level={lp.level} pct={lp.pct} pending={pending / lp.needed} size={44} />
          <div className="hud-xp">
            <span className="hud-rank">{rank.icon} {rank.title}</span>
            <span className="xpbar"><span className="xpbar-fill" style={{ width: `${lp.pct * 100}%` }} /><span className="xpbar-pending" style={{ left: `${lp.pct * 100}%`, width: `${Math.min(1 - lp.pct, pending / lp.needed) * 100}%` }} /></span>
            <span className="hud-xpnum num">{lp.into}{pending > 0 && <b> +{pending}</b>}/{lp.needed}</span>
          </div>
        </div>
      </div>
    </header>
  );
}
