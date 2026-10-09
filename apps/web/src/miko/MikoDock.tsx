import { useEffect, useRef, useState } from 'react';
import { MikoAvatar } from './MikoAvatar.tsx';
import { coach, useApp } from '../state/app.ts';
import { sound } from '../lib/sound.ts';

const CHAR_MS = 22;

/** Miko in her corner: speech bubble with typewriter text, auto-dismiss, tap for the next tip. */
export function MikoDock() {
  const tip = useApp((s) => s.tip);
  const queue = useApp((s) => s.tipQueue.length);
  const mood = useApp((s) => s.mikoMood);
  const collapsed = useApp((s) => s.mikoCollapsed);
  const enabled = useApp((s) => s.profile.settings.assistant);
  const nextTip = useApp((s) => s.nextTip);
  const toggle = useApp((s) => s.toggleMiko);
  const setMood = useApp((s) => s.setMood);
  const say = useApp((s) => s.say);
  const [typed, setTyped] = useState(0);
  const [bounce, setBounce] = useState(0);
  const idleTimer = useRef(0);

  // Typewriter
  useEffect(() => {
    setTyped(0);
    if (!tip) return;
    setBounce((b) => b + 1);
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setTyped(i);
      if (i >= tip.text.length) window.clearInterval(id);
    }, CHAR_MS);
    return () => window.clearInterval(id);
  }, [tip]);

  // Auto-dismiss
  useEffect(() => {
    if (!tip) return;
    const ms = tip.text.length * CHAR_MS + 3800 + Math.min(2500, tip.text.length * 25);
    const id = window.setTimeout(() => nextTip(), ms);
    return () => window.clearTimeout(id);
  }, [tip, nextTip]);

  // Doze off when nothing happens for a while (and wake on the next tip).
  useEffect(() => {
    window.clearTimeout(idleTimer.current);
    if (tip) return;
    idleTimer.current = window.setTimeout(() => setMood('sleepy'), 60_000);
    const back = window.setTimeout(() => { if (useApp.getState().mikoMood !== 'sleepy') setMood('happy'); }, 1200);
    return () => { window.clearTimeout(idleTimer.current); window.clearTimeout(back); };
  }, [tip, setMood]);

  if (!enabled) return null;

  const done = tip ? typed >= tip.text.length : true;
  const onBubble = () => {
    sound.play('tick');
    if (!done && tip) setTyped(tip.text.length);
    else nextTip();
  };
  const onAvatar = () => {
    if (collapsed) { toggle(); return; }
    sound.play('tick');
    if (!tip) say(coach.idle());
    else onBubble();
  };

  return (
    <div className={`miko-dock ${collapsed ? 'collapsed' : ''}`}>
      {tip && !collapsed && (
        <div key={tip.id} className={`miko-bubble mood-${tip.mood}`} role="status" aria-live="polite" onClick={onBubble}>
          <span className="miko-bubble-text">{tip.text.slice(0, typed)}<span className="miko-caret" aria-hidden>{done ? '' : '▍'}</span></span>
          {done && <span className="miko-bubble-next">{queue > 0 ? `▶ ${queue}` : '✓'}</span>}
        </div>
      )}
      <button key={bounce} className="miko-avatar-btn" onClick={onAvatar} aria-label={collapsed ? 'Open Miko' : 'Ask Miko for a tip'}>
        <MikoAvatar mood={collapsed ? 'happy' : mood} size={collapsed ? 40 : 78} talking={!!tip && !done} />
        {collapsed && tip && <span className="miko-dot" />}
      </button>
      {!collapsed && (
        <button className="miko-min" onClick={toggle} aria-label="Hide Miko">–</button>
      )}
    </div>
  );
}
