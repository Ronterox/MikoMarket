import { useEffect, useMemo, useState } from 'react';
import { weekKey, type LeaderboardEntry } from '@miko/engine';
import { MikoAvatar } from '../../miko/MikoAvatar.tsx';
import { fetchJson, hash } from '../../lib/api.ts';
import { compactMoney, signedMoney } from '../../lib/format.ts';
import { sound } from '../../lib/sound.ts';
import { useApp } from '../../state/app.ts';

interface Board {
  week: string;
  dataWeek: string | null;
  entries: LeaderboardEntry[];
  generatedAt: number;
  note?: string;
  rivals?: { label: string; symbols: string[]; timeframe: string };
}
interface Weeks { current: string; weeks: string[] }

const DAY = 86_400_000;
const AVATARS = ['🦊', '🐱', '🐼', '🐰', '🐻', '🐨', '🐸', '🐧', '🦄', '🐯', '🐹', '🦉'];
const MEDALS = ['👑', '🥈', '🥉'];

const avatarOf = (e: LeaderboardEntry) => e.avatar ?? (e.kind === 'rival' ? '🤖' : AVATARS[hash(e.id) % AVATARS.length]!);
const pctFmt = (x: number) => `${Math.round(x * 100)}%`;

/** "Sep 21 – 27" for a Monday key. */
function weekLabel(week: string): string {
  const a = new Date(`${week}T12:00:00Z`), b = new Date(a.getTime() + 6 * DAY);
  const m = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  return a.getUTCMonth() === b.getUTCMonth() ? `${m(a)} ${a.getUTCDate()} – ${b.getUTCDate()}` : `${m(a)} ${a.getUTCDate()} – ${m(b)} ${b.getUTCDate()}`;
}

/** Epoch ms of next Monday 00:00 in New York (the week rolls over then). */
function weekEndMs(week: string): number {
  const end = new Date(`${week}T00:00:00Z`).getTime() + 7 * DAY;
  // NY offset at that moment: format the instant in NY and compare.
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(new Date(end)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
  return end + (end - asUtc);
}

function useCountdown(target: number | null): string {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (target === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [target]);
  if (target === null) return '';
  const ms = Math.max(0, target - now);
  const d = Math.floor(ms / DAY), h = Math.floor((ms % DAY) / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Weekly leaderboard: a podium, profitable traders first, honest rival-bot labels, and "you" pinned. */
export function LeaderboardScreen() {
  const profile = useApp((s) => s.profile);
  const setName = useApp((s) => s.setName);
  const setTab = useApp((s) => s.setTab);
  const [weeks, setWeeks] = useState<Weeks | null>(null);
  const [week, setWeek] = useState<string>(() => weekKey(Date.now()));
  const [board, setBoard] = useState<Board | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'offline'>('loading');
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    void fetchJson<Weeks>('/api/leaderboard/weeks', {}, 6000)
      .then((w) => { setWeeks(w); if (w.current) setWeek(w.current); })
      .catch(() => setWeeks(null));
  }, []);

  useEffect(() => {
    let alive = true;
    setState((s) => (s === 'ok' ? 'ok' : 'loading'));
    fetchJson<Board>(`/api/leaderboard?week=${week}`, {}, 15000)
      .then((b) => { if (alive) { setBoard(b); setState(Array.isArray(b.entries) ? 'ok' : 'offline'); } })
      .catch(() => { if (alive) setState('offline'); });
    return () => { alive = false; };
  }, [week]);

  const current = weeks?.current ?? weekKey(Date.now());
  const list = useMemo(() => {
    const all = new Set([current, ...(weeks?.weeks ?? [])]);
    return [...all].sort().reverse();
  }, [weeks, current]);
  const idx = list.indexOf(week);
  const older = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : undefined;
  const newer = idx > 0 ? list[idx - 1] : undefined;
  const left = useCountdown(week === current ? weekEndMs(week) : null);

  const entries = board?.entries ?? [];
  const winners = entries.filter((e) => e.profit > 0 && e.rank !== undefined);
  const learning = entries.filter((e) => !(e.profit > 0 && e.rank !== undefined));
  const me = entries.find((e) => e.kind === 'player' && e.id === profile.id);
  const podium = winners.slice(0, 3);
  const rest = winners.slice(3);

  const podiumKey = podium.map((e) => e.id).join(',');
  useEffect(() => {
    if (state !== 'ok' || !podiumKey) return;
    const places = podiumKey.split(',').length;
    const ids: number[] = [];
    for (let p = places; p >= 1; p--) ids.push(window.setTimeout(() => sound.play('podium', p), 200 + (places - p) * 380));
    ids.push(window.setTimeout(() => sound.play('crown'), 200 + places * 380 + 150));
    return () => ids.forEach((id) => window.clearTimeout(id));
  }, [week, podiumKey, state]);

  const go = (w?: string) => { if (!w) return; sound.play('select'); setWeek(w); };

  return (
    <div className="screen lb-screen">
      <div className="lb-scroll scroll">
        <header className="lb-head">
          <div className="lb-title">🏆 Weekly</div>
          <div className="lb-week" role="group" aria-label="Week">
            <button className="lb-arrow" onClick={() => go(older)} disabled={!older} aria-label="Previous week">‹</button>
            <span className="lb-week-lbl num">{weekLabel(week)}</span>
            <button className="lb-arrow" onClick={() => go(newer)} disabled={!newer} aria-label="Next week">›</button>
          </div>
          {left && <span className="lb-left num" title="Time left this week">⏳ {left}</span>}
        </header>

        <div className="lb-you-name">
          <span className="muted">You</span>
          {editing ? (
            <input className="tc-name-input lb-name-input" autoFocus defaultValue={profile.name} maxLength={18} aria-label="Display name"
              onBlur={(e) => { setName(e.target.value.trim()); setEditing(false); }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
          ) : (
            <button className="lb-name-btn" onClick={() => { sound.play('tap'); setEditing(true); }}>{profile.name} <span className="tc-edit">✎</span></button>
          )}
        </div>

        {state === 'offline' ? (
          <div className="lb-empty">
            <MikoAvatar mood="sleepy" size={120} />
            <b>The leaderboard is napping 😴</b>
            <span className="muted">No server right now. Your trades still count!</span>
            <button className="cta small" onClick={() => { sound.play('tap'); setTab('play'); }}>▶ Play a round</button>
          </div>
        ) : state === 'loading' && !board ? (
          <div className="lb-empty"><span className="loader-candles"><i /><i /><i /><i /></span></div>
        ) : (
          <>
            {podium.length > 0 ? (
              <div className="podium" key={week}>
                {[1, 0, 2].map((p) => {
                  const e = podium[p];
                  if (!e) {
                    return (
                      <div key={p} className={`pod pod-${p + 1} empty`}>
                        <span className="pod-crown">{MEDALS[p]}</span>
                        <span className="pod-ava">❔</span>
                        <span className="pod-name muted">Your spot?</span>
                        <div className="pod-block"><span className="num">{p + 1}</span></div>
                      </div>
                    );
                  }
                  return (
                    <div key={e.id} className={`pod pod-${p + 1} ${e.kind} ${e.id === profile.id ? 'me' : ''}`}>
                      <span className="pod-crown">{MEDALS[p]}</span>
                      <span className="pod-ava">{avatarOf(e)}</span>
                      <span className="pod-name">{e.id === profile.id ? profile.name : e.name}</span>
                      {e.kind === 'rival' && <span className="bot-tag">BOT</span>}
                      <span className="pod-profit num">▲ {compactMoney(e.profit)}</span>
                      <div className="pod-block"><span className="num">{p + 1}</span></div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="lb-empty small">
                <MikoAvatar mood="thinking" size={92} />
                <b>No profitable traders yet</b>
                <span className="muted">Be the first one on the podium ✨</span>
              </div>
            )}

            <div className="lb-legend">
              <span>🤖 <b>{board?.rivals?.label ?? "Miko's rival bots"}</b>: real backtests of starter strategies on {board?.dataWeek && board.dataWeek !== week ? `the week of ${weekLabel(board.dataWeek)}` : "this week's"} real data.</span>
            </div>

            {rest.length > 0 && <ol className="lb-list">{rest.map((e) => <Row key={e.id} e={e} me={e.id === profile.id} name={profile.name} />)}</ol>}

            {learning.length > 0 && (
              <>
                <div className="lb-divider"><span>Still learning 📘</span></div>
                <ol className="lb-list muted-list">{learning.map((e) => <Row key={e.id} e={e} me={e.id === profile.id} name={profile.name} />)}</ol>
              </>
            )}
            <div className="lb-spacer" />
          </>
        )}
      </div>

      {state !== 'offline' && (
        <div className="lb-pinned">
          {me ? <Row e={me} me name={profile.name} pinned /> : (
            <div className="lb-row me pinned">
              <span className="lb-rank num">—</span>
              <span className="lb-ava">{AVATARS[hash(profile.id) % AVATARS.length]}</span>
              <span className="lb-who"><b>{profile.name}</b><small>No rounds this week yet</small></span>
              <button className="lb-play" onClick={() => setTab('play')}>▶ Play</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ e, me, name, pinned }: { e: LeaderboardEntry; me: boolean; name: string; pinned?: boolean }) {
  const up = e.profit > 0;
  return (
    <li className={`lb-row ${e.kind} ${me ? 'me' : ''} ${pinned ? 'pinned' : ''}`}>
      <span className="lb-rank num">{e.rank ?? '—'}</span>
      <span className="lb-ava">{avatarOf(e)}</span>
      <span className="lb-who">
        <b>{me ? name : e.name}{me && <span className="you-tag">you</span>}{e.kind === 'rival' && <span className="bot-tag">BOT</span>}</b>
        <small>
          {e.trades > 0 ? <>🎯 {pctFmt(e.winRate)} · 💰 {compactMoney(e.winnings)} won</> : 'No trades'}
          {e.rank === undefined && e.trades > 0 && ' · needs 3 trades'}
          {e.strategy && ` · ${e.strategy}`}
        </small>
      </span>
      <span className={`lb-profit num ${up ? 'up' : e.profit < 0 ? 'down' : ''}`}>{up ? '▲ ' : e.profit < 0 ? '▼ ' : ''}{signedMoney(e.profit)}</span>
    </li>
  );
}
