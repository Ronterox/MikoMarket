import { useEffect } from 'react';
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
import { coach, todayLocal, useApp } from './state/app.ts';
import { usePlay } from './state/play.ts';
import { sound } from './lib/sound.ts';

export function App() {
  const tab = useApp((s) => s.tab);
  const reduced = useApp((s) => s.profile.settings.reducedMotion);
  const stage = useApp((s) => s.mikoStage);

  useEffect(() => {
    void useApp.getState().loadProfile().then(() => {
      const { profile, say } = useApp.getState();
      setTimeout(() => say(coach.greet(profile, todayLocal())), 700);
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
        {/* On Play, Miko stands on her stage at the chart's bottom-left (never over the buttons or the price axis). */}
        {tab === 'play' && stage ? createPortal(<MikoDock />, stage) : <div className={`miko-anchor tab-${tab}`}><MikoDock /></div>}
        <TabBar />
      </div>
      <FxLayer />
      <Overlays />
    </div>
  );
}
