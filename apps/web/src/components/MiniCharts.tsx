import { useId } from 'react';

/** Small hand-made SVG charts (no chart lib needed for these). */

function path(values: number[], w: number, h: number, pad = 4, min?: number, max?: number): string {
  if (values.length === 0) return '';
  const lo = min ?? Math.min(...values);
  const hi = max ?? Math.max(...values);
  const span = hi - lo || 1;
  const n = Math.max(1, values.length - 1);
  return values.map((v, i) => `${i === 0 ? 'M' : 'L'}${((i / n) * (w - pad * 2) + pad).toFixed(1)},${(h - pad - ((v - lo) / span) * (h - pad * 2)).toFixed(1)}`).join('');
}

export function Sparkline({ values, height = 60, animate = true }: { values: number[]; height?: number; animate?: boolean }) {
  const id = useId().replace(/:/g, '');
  const w = 320;
  const d = path(values, w, height);
  const up = (values[values.length - 1] ?? 0) >= (values[0] ?? 0);
  const color = up ? 'var(--up)' : 'var(--down)';
  return (
    <svg className="sparkline" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" width="100%" height={height}>
      <defs>
        <linearGradient id={`sg${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={up ? '#22d3a6' : '#ff6a3d'} stopOpacity="0.35" />
          <stop offset="1" stopColor={up ? '#22d3a6' : '#ff6a3d'} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d}L${w - 4},${height}L4,${height}Z`} fill={`url(#sg${id})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" pathLength={1} className={animate ? 'draw-line' : ''} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function Donut({ value, size = 80 }: { value: number; size?: number }) {
  const r = size / 2 - 7;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="donut" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line-strong)" strokeWidth="9" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--up)" strokeWidth="9" strokeLinecap="round"
          strokeDasharray={`${v * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} className="ring-anim" />
      </svg>
      <span className="donut-num num">{Math.round(v * 100)}%</span>
    </div>
  );
}

/** Equity curve that draws itself, with a baseline at the starting cash. */
export function EquityCurve({ values, base, height = 120 }: { values: number[]; base: number; height?: number }) {
  const id = useId().replace(/:/g, '');
  const w = 340;
  if (values.length < 2) return <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} />;
  const lo = Math.min(base, ...values), hi = Math.max(base, ...values);
  const d = path(values, w, height, 6, lo, hi);
  const span = hi - lo || 1;
  const by = height - 6 - ((base - lo) / span) * (height - 12);
  const up = values[values.length - 1]! >= base;
  return (
    <svg className="equity-curve" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" width="100%" height={height}>
      <defs>
        <linearGradient id={`eq${id}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ff5fa2" />
          <stop offset="0.55" stopColor="#9b5cff" />
          <stop offset="1" stopColor="#3ee0ff" />
        </linearGradient>
        <linearGradient id={`eqf${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#9b5cff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#9b5cff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1="0" x2={w} y1={by} y2={by} stroke="var(--line-strong)" strokeDasharray="4 4" />
      <path d={`${d}L${w - 6},${height}L6,${height}Z`} fill={`url(#eqf${id})`} className="fade-in" />
      <path d={d} fill="none" stroke={`url(#eq${id})`} strokeWidth="3" strokeLinejoin="round" pathLength={1} className="draw-line slow" vectorEffect="non-scaling-stroke" />
      <circle cx={w - 6} cy={height - 6 - ((values[values.length - 1]! - lo) / span) * (height - 12)} r="4.5" fill={up ? 'var(--up)' : 'var(--down)'} className="pop-in-late" />
    </svg>
  );
}

/** Live best/mean fitness lines per GA generation. */
export function FitnessChart({ best, mean, total, height = 110 }: { best: number[]; mean: number[]; total: number; height?: number }) {
  const w = 340;
  const all = [...best, ...mean].filter(Number.isFinite);
  const lo = all.length ? Math.min(...all) : 0, hi = all.length ? Math.max(...all) : 1;
  const span = hi - lo || 1;
  const pts = (arr: number[]) => arr.map((v, i) => `${i === 0 ? 'M' : 'L'}${(6 + (i / Math.max(1, total - 1)) * (w - 12)).toFixed(1)},${(height - 6 - ((Number.isFinite(v) ? v - lo : 0) / span) * (height - 12)).toFixed(1)}`).join('');
  const lastI = best.length - 1;
  return (
    <svg className="fitness-chart" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" width="100%" height={height}>
      {Array.from({ length: total }, (_, i) => (
        <rect key={i} x={6 + (i / Math.max(1, total - 1)) * (w - 12) - 1} y={height - 4} width="2" height="3" fill={i <= lastI ? 'var(--cyan)' : 'var(--line-strong)'} />
      ))}
      <path d={pts(mean)} fill="none" stroke="var(--muted)" strokeOpacity="0.6" strokeWidth="1.5" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
      <path d={pts(best)} fill="none" stroke="var(--pink)" strokeWidth="3" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {lastI >= 0 && Number.isFinite(best[lastI]!) && (
        <circle cx={6 + (lastI / Math.max(1, total - 1)) * (w - 12)} cy={height - 6 - ((best[lastI]! - lo) / span) * (height - 12)} r="5" fill="var(--pink)" className="pulse-dot" />
      )}
    </svg>
  );
}

/** Monte Carlo fan: sample curves (normalised per trade index) + median. */
export function FanChart({ curves, base, height = 140 }: { curves: number[][]; base: number; height?: number }) {
  const w = 340;
  const usable = curves.filter((c) => c.length > 1);
  if (usable.length === 0) return <div className="empty">Not enough trades for a fan</div>;
  const len = Math.max(...usable.map((c) => c.length));
  const all = usable.flat();
  const lo = Math.min(base, ...all), hi = Math.max(base, ...all);
  const span = hi - lo || 1;
  const xy = (i: number, v: number) => `${(6 + (i / Math.max(1, len - 1)) * (w - 12)).toFixed(1)},${(height - 6 - ((v - lo) / span) * (height - 12)).toFixed(1)}`;
  const median: number[] = [];
  for (let i = 0; i < len; i++) {
    const col = usable.map((c) => c[Math.min(i, c.length - 1)]!).sort((a, b) => a - b);
    median.push(col[Math.floor(col.length / 2)]!);
  }
  const by = height - 6 - ((base - lo) / span) * (height - 12);
  return (
    <svg className="fan-chart" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" width="100%" height={height}>
      <line x1="0" x2={w} y1={by} y2={by} stroke="var(--line-strong)" strokeDasharray="4 4" />
      {usable.map((c, k) => (
        <path key={k} d={c.map((v, i) => `${i === 0 ? 'M' : 'L'}${xy(i, v)}`).join('')} fill="none"
          stroke={c[c.length - 1]! >= base ? 'var(--cyan)' : 'var(--down)'} strokeOpacity="0.28" strokeWidth="1.2"
          vectorEffect="non-scaling-stroke" className="fan-line" style={{ animationDelay: `${k * 40}ms` }} />
      ))}
      <path d={median.map((v, i) => `${i === 0 ? 'M' : 'L'}${xy(i, v)}`).join('')} fill="none" stroke="var(--pink)" strokeWidth="3" vectorEffect="non-scaling-stroke" pathLength={1} className="draw-line slow" />
    </svg>
  );
}

/** Two horizontal bars: in-sample vs out-of-sample for one metric. */
export function CompareBars({ a, b, labelA = 'Train', labelB = 'Unseen', format }: { a: number; b: number; labelA?: string; labelB?: string; format: (v: number) => string }) {
  const m = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  const bar = (v: number, cls: string, label: string) => (
    <div className="cmp-row">
      <span className="cmp-lbl">{label}</span>
      <div className="cmp-track">
        <div className={`cmp-fill ${cls} ${v < 0 ? 'neg' : ''}`} style={{ width: `${(Math.abs(v) / m) * 100}%` }} />
      </div>
      <span className={`cmp-val num ${v >= 0 ? 'up-text' : 'down-text'}`}>{format(v)}</span>
    </div>
  );
  return <div className="cmp">{bar(a, 'is', labelA)}{bar(b, 'oos', labelB)}</div>;
}
