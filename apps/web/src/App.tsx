import { useEffect, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Stars } from './components/Stars.tsx';
import { TabBar } from './components/TabBar.tsx';
import { FxLayer } from './components/FxLayer.tsx';
import { Overlays } from './components/Overlays.tsx';
import { MikoDock } from './miko/MikoDock.tsx';
import { PlayScreen } from './screens/play/PlayScreen.tsx';
import { LabScreen } from './screens/lab/LabScreen.tsx';
import { MeScreen } from './screens/me/MeScreen.tsx';
import { LeaderboardScreen } from './screens/leaders/LeaderboardScreen.tsx';
import { coach, todayLocal, useApp, type Tab } from './state/app.ts';
import { usePlay } from './state/play.ts';
import { sound } from './lib/sound.ts';
import { lsGet, lsSet } from './lib/storage.ts';

export function App() {
  const tab = useApp((s) => s.tab);
  const reduced = useApp((s) => s.profile.settings.reducedMotion);
  const stage = useApp((s) => s.mikoStage);

  useEffect(() => {
    void useApp.getState().loadProfile().then(() => {
      const { profile, say } = useApp.getState();
      setTimeout(() => say(coach.greet(profile, todayLocal())), 700);
      // Once ever: tell the player Miko can be moved (queued behind the greeting).
      if (!lsGet('miko.dragHint')) {
        lsSet('miko.dragHint', true);
        setTimeout(() => useApp.getState().sayText('Psst! 💕 If I am ever in your way, drag me anywhere you like.', 'happy', 30), 900);
      }
    });
    const unlock = () => sound.unlock();
    window.addEventListener('pointerdown', unlock, { passive: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  // Leaving Play pauses the replay so nothing happens behind your back.
  useEffect(() => { if (tab !== 'play') usePlay.getState().setSpeed(0); }, [tab]);

  // Desktop shortcuts: B / S / C / space / →
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useApp.getState().tab !== 'play' || useApp.getState().overlay) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      const p = usePlay.getState();
      if (e.key === 'b' || e.key === 'B') p.trade('buy', document.querySelector('.bigbtn.buy'));
      else if (e.key === 's' || e.key === 'S') p.trade('sell', document.querySelector('.bigbtn.sell'));
      else if (e.key === 'c' || e.key === 'C') p.close(document.querySelector('.bigbtn.close'));
      else if (e.key === ' ') { e.preventDefault(); p.setSpeed(p.speed === 0 ? p.lastSpeed : 0); }
      else if (e.key === 'ArrowRight') p.step();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={`app-bg ${reduced ? 'calm' : ''}`}>
      <Stars />
      <div className="phone">
        <main className="screens">
          <div className={`screen-slot ${tab === 'play' ? 'active' : ''}`}><PlayScreen /></div>
          <div className={`screen-slot ${tab === 'lab' ? 'active' : ''}`}><LabScreen /></div>
          <div className={`screen-slot ${tab === 'leaders' ? 'active' : ''}`}>{tab === 'leaders' && <LeaderboardScreen />}</div>
          <div className={`screen-slot ${tab === 'me' ? 'active' : ''}`}>{tab === 'me' && <MeScreen />}</div>
        </main>
        <MikoHost tab={tab} stage={stage} />
        <TabBar />
      </div>
      <FxLayer />
      <Overlays />
    </div>
  );
}

/**
 * Where Miko stands. While dragged, or once the player has dropped her somewhere on this tab,
 * she floats in a full-screen layer; otherwise she uses her default spot (on Play: the chart's
 * bottom-left, clear of the buttons and the price axis).
 */
function MikoHost({ tab, stage }: { tab: Tab; stage: HTMLElement | null }) {
  const spot = useApp((s) => s.mikoSpots[tab]);
  const drag = useApp((s) => s.mikoDrag);
  if (drag || spot) {
    const fx = drag ? drag.x / window.innerWidth : spot!.x;
    const fy = drag ? drag.y / window.innerHeight : spot!.y;
    const style = { '--mx': drag ? `${drag.x}px` : `${fx * 100}%`, '--my': drag ? `${drag.y}px` : `${fy * 100}%` } as CSSProperties;
    // The bubble opens towards the roomier side: right of her in the left half, below her near the top.
    return (
      <div className={`miko-free-layer ${drag ? 'dragging' : ''}`}>
        <div className={`miko-free ${fx < 0.5 ? 'side-l' : 'side-r'} ${fy < 0.4 ? 'below' : ''}`} style={style}><MikoDock /></div>
      </div>
    );
  }
  return tab === 'play' && stage ? createPortal(<MikoDock />, stage) : <div className={`miko-anchor tab-${tab}`}><MikoDock /></div>;
}
