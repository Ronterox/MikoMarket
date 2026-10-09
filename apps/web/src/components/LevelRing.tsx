/** Circular XP ring with the level number inside. pct 0..1; `pending` shows uncommitted XP as a lighter arc. */
export function LevelRing({ level, pct, pending = 0, size = 46, color }: { level: number; pct: number; pending?: number; size?: number; color?: string }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const main = Math.max(0, Math.min(1, pct));
  const extra = Math.max(0, Math.min(1 - main, pending));
  return (
    <div className="level-ring" style={{ width: size, height: size }} aria-label={`Level ${level}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id="lvl-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ff5fa2" />
            <stop offset="0.55" stopColor="#9b5cff" />
            <stop offset="1" stopColor="#3ee0ff" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line-strong)" strokeWidth="5" />
        {extra > 0 && (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--gold)" strokeOpacity="0.8" strokeWidth="5" strokeLinecap="round"
            strokeDasharray={`${(main + extra) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} className="ring-anim" />
        )}
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color ?? 'url(#lvl-grad)'} strokeWidth="5" strokeLinecap="round"
          strokeDasharray={`${main * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} className="ring-anim" />
      </svg>
      <span className="level-ring-num num">{level}</span>
    </div>
  );
}
