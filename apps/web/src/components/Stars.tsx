import { useMemo } from 'react';

/** Subtle twinkling night sky behind everything (pure CSS animation). */
export function Stars({ count = 70 }: { count?: number }) {
  const stars = useMemo(() => Array.from({ length: count }, (_, i) => ({
    left: Math.random() * 100,
    top: Math.random() * 100,
    size: Math.random() < 0.15 ? 3 : Math.random() < 0.5 ? 2 : 1,
    delay: Math.random() * 6,
    dur: 3 + Math.random() * 5,
    key: i,
  })), [count]);
  return (
    <div className="stars" aria-hidden="true">
      {stars.map((s) => (
        <span key={s.key} className="star" style={{ left: `${s.left}%`, top: `${s.top}%`, width: s.size, height: s.size, animationDelay: `${s.delay}s`, animationDuration: `${s.dur}s` }} />
      ))}
      <span className="shooting" />
    </div>
  );
}
