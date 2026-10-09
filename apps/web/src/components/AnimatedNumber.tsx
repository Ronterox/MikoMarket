import { useEffect, useRef, useState } from 'react';

/** Counts smoothly toward `value` (easeOutCubic). Pulses up/down on change. */
export function AnimatedNumber({ value, format, duration = 650, className = '' }: { value: number; format: (v: number) => string; duration?: number; className?: string }) {
  const [shown, setShown] = useState(value);
  const [pulse, setPulse] = useState<'' | 'up' | 'down'>('');
  const from = useRef(value);
  const raf = useRef(0);

  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    const b = value;
    if (a === b) return;
    setPulse(b > a ? 'up' : 'down');
    const t = window.setTimeout(() => setPulse(''), 450);
    cancelAnimationFrame(raf.current);
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / duration);
      const e = 1 - Math.pow(1 - k, 3);
      const v = a + (b - a) * e;
      from.current = v;
      setShown(v);
      if (k < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf.current); window.clearTimeout(t); };
  }, [value, duration]);

  return <span className={`num ${pulse ? `pulse-${pulse}` : ''} ${className}`}>{format(shown)}</span>;
}
