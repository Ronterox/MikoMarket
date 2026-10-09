import { useMemo, useState } from 'react';
import { ACHIEVEMENTS, levelProgress, rankFor, ratingTier } from '@miko/engine';
import { useApp } from '../../state/app.ts';
import { LevelRing } from '../../components/LevelRing.tsx';
import { Toggle } from '../../components/Toggle.tsx';
import { Sparkline, Donut } from '../../components/MiniCharts.tsx';
import { ago, compactMoney, signedMoney, arrow } from '../../lib/format.ts';
import { displaySymbol } from '../../lib/instruments.ts';
import { sound } from '../../lib/sound.ts';

const AVATARS = ['🦊', '🐱', '🐼', '🐸', '🦄', '🐧', '🐯', '🐙'];

export function MeScreen() {
  const profile = useApp((s) => s.profile);
  const setSettings = useApp((s) => s.setSettings);
  const setName = useApp((s) => s.setName);
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const [editing, setEditing] = useState(false);
  const [avatarIdx, setAvatarIdx] = useState(() => Math.abs(hashStr(profile.id)) % AVATARS.length);

  const lp = levelProgress(profile.xp);
  const rank = rankFor(lp.level);
  const tier = ratingTier(profile.rating);
  const st = profile.stats;
  const winRate = st.wins + st.losses > 0 ? st.wins / (st.wins + st.losses) : 0;
  const stopPct = st.trades > 0 ? st.tradesWithStop / st.trades : 0;

  // Profit factor across saved session summaries (display aggregate only).
  const pf = useMemo(() => {
    let gw = 0, gl = 0;
    for (const h of profile.history) { const m = h.metrics; if (m.avgWin && m.wins) gw += m.avgWin * m.wins; if (m.avgLoss && m.losses) gl += Math.abs(m.avgLoss * m.losses); }
    return gl > 0 ? gw / gl : gw > 0 ? Infinity : 0;
  }, [profile.history]);

  const curve = useMemo(() => {
    const chrono = [...profile.history].reverse();
    let acc = 0;
    return [0, ...chrono.map((h) => (acc += h.metrics.netProfit ?? 0))];
  }, [profile.history]);

  const unlocked = Object.keys(profile.achievements).length;

  return (
    <div className="screen me-screen scroll">
      <section className="trader-card" style={{ ['--rank-c' as string]: rank.color }}>
        <div className="tc-shine" />
        <button className="tc-avatar" onClick={() => { sound.play('tick'); setAvatarIdx((i) => (i + 1) % AVATARS.length); }} aria-label="Change avatar">
          <span>{AVATARS[avatarIdx]}</span>
        </button>
        <div className="tc-main">
          {editing ? (
            <input className="tc-name-input" autoFocus defaultValue={profile.name} maxLength={18}
              onBlur={(e) => { setName(e.target.value.trim()); setEditing(false); }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
          ) : (
            <button className="tc-name" onClick={() => setEditing(true)}>{profile.name} <span className="tc-edit">✎</span></button>
          )}
          <div className="tc-rank">{rank.icon} {rank.title}</div>
          <div className="tc-tier"><span>{tier.icon} {tier.name}</span><b className="num">{Math.round(profile.rating)}</b></div>
        </div>
        <div className="tc-level">
          <LevelRing level={lp.level} pct={lp.pct} size={70} />
          <span className="tc-xp num">{lp.into}/{lp.needed}</span>
        </div>
      </section>

      <section className="stats-grid">
        <div className="stat big">
          <Donut value={winRate} size={74} />
          <div className="stat-cap">🎯 Win rate</div>
        </div>
        <div className="stat"><span className="stat-ico">⚖️</span><b className="num">{pf === Infinity ? '∞' : pf.toFixed(2)}</b><span className="stat-cap">Profit factor</span></div>
        <div className="stat"><span className="stat-ico">🏆</span><b className={`num ${st.bestTrade >= 0 ? 'up-text' : 'down-text'}`}>{st.trades ? compactMoney(st.bestTrade) : '—'}</b><span className="stat-cap">Best trade</span></div>
        <div className="stat"><span className="stat-ico">🛡️</span><b className="num">{Math.round(stopPct * 100)}%</b><span className="stat-cap">With stop</span></div>
        <div className="stat"><span className="stat-ico">🎮</span><b className="num">{st.sessions}</b><span className="stat-cap">Sessions · {st.trades} trades</span></div>
      </section>

      <section className="panel">
        <div className="panel-head"><span>📈 Equity journey</span><b className={`num ${st.netProfit >= 0 ? 'up-text' : 'down-text'}`}>{arrow(st.netProfit)} {signedMoney(st.netProfit)}</b></div>
        {curve.length > 1 ? <Sparkline values={curve} height={70} /> : <div className="empty">Play a round to start your journey ✨</div>}
      </section>

      <section className="panel">
        <div className="panel-head"><span>🕹️ Sessions</span><span className="muted">{profile.history.length}</span></div>
        {profile.history.length === 0 && <div className="empty">No rounds yet</div>}
        <ul className="history">
          {profile.history.slice(0, 8).map((h) => (
            <li key={h.id} className="history-row">
              <span className="h-mode">{h.mode === 'bot' ? (h.metrics.trades ? '🤖' : '🧪') : h.mode === 'live' ? '📡' : '🎮'}</span>
              <span className="h-sym">{h.mode === 'bot' && !h.metrics.trades ? 'Bot Lab' : displaySymbol(h.symbol)} <small>{h.timeframe}</small></span>
              {h.mode === 'bot' && !h.metrics.trades
                ? <span className="h-pnl muted">✨</span>
                : <span className={`h-pnl num ${h.metrics.netProfit >= 0 ? 'up-text' : 'down-text'}`}>{arrow(h.metrics.netProfit)} {compactMoney(h.metrics.netProfit)}</span>}
              <span className="h-xp num">+{h.xpEarned} XP</span>
              <span className="h-ago">{ago(h.t)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <div className="panel-head"><span>🏅 Achievements</span><span className="muted num">{unlocked}/{ACHIEVEMENTS.length}</span></div>
        <div className="ach-grid">
          {ACHIEVEMENTS.map((a) => {
            const got = profile.achievements[a.id] !== undefined;
            const hidden = a.secret && !got;
            return (
              <div key={a.id} className={`ach ${got ? 'got' : 'locked'}`} title={hidden ? 'Secret' : a.desc}>
                <span className="ach-ico">{hidden ? '❔' : a.icon}</span>
                <span className="ach-name">{hidden ? '???' : a.name}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel settings">
        <div className="panel-head"><span>⚙️ Settings</span></div>
        <div className="toggle-grid">
          <Toggle icon="🔊" label="Sound" on={profile.settings.sound} onChange={(v) => setSettings({ sound: v })} />
          <Toggle icon="🎵" label="Music" on={profile.settings.music} onChange={(v) => setSettings({ music: v })} />
          <Toggle icon="🌸" label="Miko" on={profile.settings.assistant} onChange={(v) => setSettings({ assistant: v })} />
          <Toggle icon="🐢" label="Calm motion" on={profile.settings.reducedMotion} onChange={(v) => setSettings({ reducedMotion: v })} />
          <Toggle icon={theme === 'dark' ? '🌙' : '☀️'} label="Night mode" on={theme === 'dark'} onChange={(v) => setTheme(v ? 'dark' : 'light')} />
        </div>
      </section>

      <div className="me-footer">
        <span>🌸 Every trade with a stop makes you stronger 💪</span>
      </div>
    </div>
  );
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
