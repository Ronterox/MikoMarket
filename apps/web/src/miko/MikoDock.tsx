import { useEffect, useRef, useState } from 'react';
import { MikoAvatar } from './MikoAvatar.tsx';
import { coach, useApp } from '../state/app.ts';
import { sound } from '../lib/sound.ts';
import { exclamationFor, voice, type Exclamation } from '../lib/voice.ts';
import type { Tip } from '@miko/engine';
import { beginMikoDrag, justDragged } from './drag.ts';

const CHAR_MS = 22;
/** Typing progress per tip: moving Miko remounts her, and she resumes instead of retyping. */
const typedChars = new WeakMap<Tip, number>();
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;
/** What she says when tapped, and when tapped too much. */
const TAP_LINES: readonly Exclamation[] = ['hai', 'nya', 'ehehe', 'ufufu'];
const POKES_TO_POUT = 5;

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
  const mikoFx = useApp((s) => s.mikoFx);
  const [typed, setTyped] = useState(0);
  const [bounce, setBounce] = useState(0);
  const [react, setReact] = useState<{ kind: 'surprise' | 'sparkle'; n: number } | null>(null);
  const idleTimer = useRef(0);
  const pokes = useRef<number[]>([]);
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;

  // One-shot reactions: 😳 jump with a "!" pop, or a happy sparkle.
  useEffect(() => {
    if (!mikoFx) return;
    setReact(mikoFx);
    sound.play(mikoFx.kind === 'surprise' ? 'whoosh' : 'pop');
    if (!collapsedRef.current) voice.exclaim(mikoFx.kind === 'surprise' ? 'ehh' : pick(['kyaa', 'sugoi', 'ufufu'] as const));
    const id = window.setTimeout(() => setReact(null), 1500);
    return () => window.clearTimeout(id);
  }, [mikoFx]);

  // Typewriter
  useEffect(() => {
    let i = tip ? typedChars.get(tip) ?? 0 : 0;
    setTyped(i);
    if (!tip || i >= tip.text.length) return;
    if (i === 0) {
      setBounce((b) => b + 1);
      // She talks as she types: sometimes an interjection first, then babble shaped by her mood.
      if (!collapsedRef.current) {
        const ex = exclamationFor(tip.mood, Math.random());
        if (ex) voice.exclaim(ex);
        voice.babble(tip.text, tip.mood);
      }
    }
    const id = window.setInterval(() => {
      i += 1;
      typedChars.set(tip, i);
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
    idleTimer.current = window.setTimeout(() => { setMood('sleepy'); if (!collapsedRef.current && !document.hidden) voice.exclaim('fuwaa'); }, 60_000);
    const back = window.setTimeout(() => { if (useApp.getState().mikoMood !== 'sleepy') setMood('happy'); }, 1200);
    return () => { window.clearTimeout(idleTimer.current); window.clearTimeout(back); };
  }, [tip, setMood]);

  if (!enabled) return null;

  const done = tip ? typed >= tip.text.length : true;
  const onBubble = () => {
    sound.play('tap');
    if (!done && tip) { typedChars.set(tip, tip.text.length); setTyped(tip.text.length); }
    else nextTip();
  };
  const onAvatar = () => {
    if (justDragged()) return;
    if (collapsed) { toggle(); return; }
    sound.play('tap');
    // Poke her a lot and she pouts (once, then the count starts over).
    const now = performance.now();
    pokes.current = [...pokes.current.filter((t) => now - t < 3000), now];
    if (pokes.current.length >= POKES_TO_POUT) {
      pokes.current = [];
      voice.exclaim('mou');
      useApp.getState().mikoReact('surprise');
      useApp.getState().sayText(pick(['Mou~! That tickles! 😤', 'Hey! I am not a button! 😤💕', 'Mou! Eyes on the chart, Trader! 😤']), 'worried', 70);
      return;
    }
    if (!tip) { if (Math.random() < 0.7) voice.exclaim(pick(TAP_LINES)); say(coach.idle()); }
    else onBubble();
  };

  return (
    <div className={`miko-dock ${collapsed ? 'collapsed' : ''} ${react ? `react-${react.kind}` : ''}`}>
      {tip && !collapsed && (
        <div key={tip.id} className={`miko-bubble mood-${tip.mood}`} role="status" aria-live="polite" onClick={onBubble}>
          <span className="miko-bubble-text">{tip.text.slice(0, typed)}<span className="miko-caret" aria-hidden>{done ? '' : '▍'}</span></span>
          {done && <span className="miko-bubble-next">{queue > 0 ? `▶ ${queue}` : '✓'}</span>}
        </div>
      )}
      <button key={`${bounce}-${react?.n ?? 0}`} className="miko-avatar-btn" onClick={onAvatar} onPointerDown={beginMikoDrag} aria-label={collapsed ? 'Open Miko (drag to move her)' : 'Ask Miko for a tip (drag to move her)'}>
        <MikoAvatar mood={collapsed ? 'happy' : react?.kind === 'surprise' ? 'worried' : react?.kind === 'sparkle' ? 'excited' : mood} size={collapsed ? 40 : 78} talking={!!tip && !done} />
        {collapsed && tip && <span className="miko-dot" />}
        {!collapsed && react?.kind === 'surprise' && <span key={react.n} className="miko-react surprise" aria-hidden><b>!</b><i>😳</i></span>}
        {!collapsed && react?.kind === 'sparkle' && (
          <span key={react.n} className="miko-react sparkle" aria-hidden><i>✨</i><i>⭐</i><i>✨</i><i>💖</i><i>✨</i></span>
        )}
      </button>
      {!collapsed && (
        <button className="miko-min" onClick={toggle} aria-label="Hide Miko">–</button>
      )}
    </div>
  );
}
