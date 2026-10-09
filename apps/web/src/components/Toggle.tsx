import { sound } from '../lib/sound.ts';

export function Toggle({ on, onChange, icon, label }: { on: boolean; onChange: (v: boolean) => void; icon: string; label: string }) {
  return (
    <button className={`toggle ${on ? 'on' : ''}`} role="switch" aria-checked={on} onClick={() => { sound.play('tick'); onChange(!on); }}>
      <span className="toggle-ico">{icon}</span>
      <span className="toggle-lbl">{label}</span>
      <span className="toggle-track"><span className="toggle-knob" /></span>
    </button>
  );
}
