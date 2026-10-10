import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { levelProgress } from '@miko/engine';
import { uiRank as rankFor } from '../lib/ranks.ts';
import { useApp, type ResultsData } from '../state/app.ts';
import { usePlay } from '../state/play.ts';
import { MikoAvatar } from '../miko/MikoAvatar.tsx';
import { LevelRing } from './LevelRing.tsx';
import { AnimatedNumber } from './AnimatedNumber.tsx';
import { arrow, signedMoney } from '../lib/format.ts';
import { sound } from '../lib/sound.ts';
import { fx } from '../lib/fx.ts';

export function Overlays() {
  const overlay = useApp((s) => s.overlay);
  if (!overlay) return null;
  const root = document.getElementById('overlay-root') ?? document.body;
  return createPortal(overlay.kind === 'levelUp' ? <LevelUp level={overlay.level} /> : <Results data={overlay.data} />, root);
}

function LevelUp({ level }: { level: number }) {
  const overlay = useApp((s) => s.overlay);
  const setOverlay = useApp((s) => s.setOverlay);
  const rank = rankFor(level);
  const prevRank = rankFor(level - 1);
  const newRank = rank.title !== prevRank.title;
  useEffect(() => {
    sound.play('levelUp');
    fx.flash('rgba(255, 246, 236, 0.85)');
    setTimeout(() => fx.confetti(160), 150);
  }, []);
  const next = () => {
    sound.play('tap');
    setOverlay(overlay?.kind === 'levelUp' ? overlay.then ?? null : null);
  };
  return (
    <div className="overlay levelup" onClick={next} role="dialog" aria-label={`Level ${level}`}>
      <div className="levelup-rays" />
      <div className="levelup-inner">
        <div className="levelup-kicker">LEVEL UP!</div>
        <div className="levelup-num num">{level}</div>
        <div className="rank-card" style={{ ['--rank-c' as string]: rank.color }}>
          <span className="rank-card-ico">{rank.icon}</span>
          <span className="rank-card-title">{rank.title}</span>
          {newRank && <span className="rank-card-new">NEW RANK</span>}
        </div>
        <MikoAvatar mood="cheer" size={120} />
        <button className="cta" onClick={(e) => { e.stopPropagation(); next(); }}>Yay! ✨</button>
      </div>
    </div>
  );
}

function Results({ data }: { data: ResultsData }) {
  const setOverlay = useApp((s) => s.setOverlay);
  const newRound = usePlay((s) => s.newRound);
  const [shown, setShown] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [shown]);
  const total = data.awards.reduce((a, w) => a + w.amount, 0);

  useEffect(() => {
    if (shown >= data.awards.length) {
      if (data.ratingDelta > 0) window.setTimeout(() => sound.play('star'), 250);
      if (data.achievements.length) { sound.play('achievement'); fx.confetti(90); }
      return;
    }
    const id = window.setTimeout(() => { sound.play('xp', shown); setShown((n) => n + 1); }, shown === 0 ? 450 : 170);
    return () => window.clearTimeout(id);
  }, [shown, data.awards.length, data.achievements.length]);

  useEffect(() => {
    if (data.netProfit <= 0) return;
    const id = window.setTimeout(() => { sound.play('win'); fx.burst(window.innerWidth / 2, window.innerHeight * 0.25, 'win', 40); }, 450);
    return () => window.clearTimeout(id);
  }, [data.netProfit]);

  const runningXp = data.awards.slice(0, shown).reduce((a, w) => a + w.amount, 0);
  const lp = levelProgress(data.xpBefore + runningXp);

  const again = () => { sound.play('whoosh'); setOverlay(null); newRound(); };

  return (
    <div className="overlay results" role="dialog" aria-label="Round results">
      <div className="results-card">
        <div className="results-head">
          <div className="results-title">{data.title}</div>
          <div className={`results-pnl ${data.netProfit > 0 ? 'up' : data.netProfit < 0 ? 'down' : ''}`}>
            <span>{arrow(data.netProfit)}</span> <span className="num">{signedMoney(data.netProfit)}</span>
          </div>
          <div className="results-sub">
            <span>🎯 <b className="num">{data.trades}</b> trades</span>
            <span>✅ <b className="num">{data.wins}</b> wins</span>
            <span className={`rating-delta ${data.ratingDelta >= 0 ? 'up' : 'down'}`}>⭐ <b className="num">{data.ratingDelta >= 0 ? '+' : ''}{Math.round(data.ratingDelta)}</b></span>
          </div>
          {data.bot && (
            <div className="results-bot" title="Your bot traded the same bars; its results count as yours">
              <span>🤖 {data.bot.icon} Your bot</span>
              <b className={`num ${data.bot.netProfit >= 0 ? 'up-text' : 'down-text'}`}>{arrow(data.bot.netProfit)} {signedMoney(data.bot.netProfit)}</b>
              <small>{data.bot.trades} trades · {data.bot.wins} wins</small>
            </div>
          )}
        </div>

        <div className="results-xp">
          <LevelRing level={lp.level} pct={lp.pct} size={64} />
          <div className="results-xp-total">
            <AnimatedNumber value={runningXp} format={(v) => `+${Math.round(v)}`} className="results-xp-num" />
            <span className="results-xp-lbl">XP</span>
          </div>
        </div>

        <ul className="award-list" ref={listRef}>
          {data.awards.slice(0, shown).map((a, i) => (
            <li key={i} className="award">
              <span className="award-ico">{a.icon}</span>
              <span className="award-reason">{a.reason}</span>
              <span className="award-amt num">+{a.amount}</span>
            </li>
          ))}
        </ul>

        {shown >= data.awards.length && data.achievements.length > 0 && (
          <div className="ach-unlocked">
            {data.achievements.map((a) => (
              <div key={a.id} className="ach-pop"><span className="ach-pop-ico">{a.icon}</span><span><b>{a.name}</b><small>{a.desc}</small></span></div>
            ))}
          </div>
        )}

        <div className="results-miko">
          <MikoAvatar mood={data.tip.mood} size={64} />
          <div className="results-miko-bubble">{data.tip.text}</div>
        </div>

        <div className="results-actions">
          <button className="cta" onClick={again}>🎮 Play again</button>
          <button className="ghost-btn" onClick={() => { sound.play('dismiss'); setOverlay(null); }}>✕</button>
        </div>
        {data.demo && <div className="results-demo">🧪 Demo data</div>}
        <span className="sr-only">Total {total} XP</span>
      </div>
    </div>
  );
}
