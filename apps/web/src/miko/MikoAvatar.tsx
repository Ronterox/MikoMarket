import { useId } from 'react';
import type { Mood } from '@miko/engine';

/**
 * Miko — original chibi trading assistant, drawn as inline SVG.
 * Big eyes, pink→violet twin-tails, and a hair clip made of two tiny
 * candlesticks (one up-candle, one down-candle). Each Mood swaps eyes,
 * mouth, arms and a small prop. Idle bob / blink / tail sway are CSS.
 */

type EyeKind = 'open' | 'star' | 'happy' | 'sleep' | 'up' | 'wink';
type MouthKind = 'smile' | 'open' | 'o' | 'wavy' | 'cat' | 'flat' | 'grin';
type Arms = 'down' | 'up' | 'chin' | 'point' | 'hip' | 'fists';

const MOODS: Record<Mood, { eyes: EyeKind; mouth: MouthKind; arms: Arms; brows: 'none' | 'worried' | 'up' | 'focused'; blush: number }> = {
  happy: { eyes: 'open', mouth: 'smile', arms: 'down', brows: 'none', blush: 0.55 },
  excited: { eyes: 'star', mouth: 'open', arms: 'fists', brows: 'up', blush: 0.8 },
  thinking: { eyes: 'up', mouth: 'flat', arms: 'chin', brows: 'focused', blush: 0.35 },
  worried: { eyes: 'open', mouth: 'wavy', arms: 'fists', brows: 'worried', blush: 0.4 },
  proud: { eyes: 'happy', mouth: 'cat', arms: 'hip', brows: 'up', blush: 0.75 },
  teaching: { eyes: 'wink', mouth: 'grin', arms: 'point', brows: 'none', blush: 0.5 },
  cheer: { eyes: 'happy', mouth: 'open', arms: 'up', brows: 'up', blush: 0.85 },
  sleepy: { eyes: 'sleep', mouth: 'o', arms: 'down', brows: 'none', blush: 0.3 },
};

const INK = '#2a1840';

function Eye({ kind, cx, cy, irisId, flip }: { kind: EyeKind; cx: number; cy: number; irisId: string; flip?: boolean }) {
  if (kind === 'happy') {
    return <path d={`M${cx - 7},${cy + 2} Q${cx},${cy - 7} ${cx + 7},${cy + 2}`} stroke={INK} strokeWidth="2.8" fill="none" strokeLinecap="round" />;
  }
  if (kind === 'sleep' || (kind === 'wink' && flip)) {
    return <path d={`M${cx - 7},${cy} Q${cx},${cy + 5} ${cx + 7},${cy}`} stroke={INK} strokeWidth="2.6" fill="none" strokeLinecap="round" />;
  }
  const dx = kind === 'up' ? -1.6 : 0;
  const dy = kind === 'up' ? -2.4 : 0.6;
  return (
    <g className="miko-eye" style={{ transformOrigin: `${cx}px ${cy}px` }}>
      <ellipse cx={cx} cy={cy} rx="7.4" ry="8.8" fill="#fff" />
      <ellipse cx={cx + dx} cy={cy + dy} rx="6" ry="7.6" fill={`url(#${irisId})`} />
      <ellipse cx={cx + dx} cy={cy + dy + 0.6} rx="2.7" ry="3.6" fill="#1b0f3a" />
      {kind === 'star' ? (
        <>
          <path d={star(cx + dx - 1.6, cy + dy - 2.4, 3.2)} fill="#fff" />
          <path d={star(cx + dx + 2.4, cy + dy + 2.8, 1.5)} fill="#fff" />
        </>
      ) : (
        <>
          <circle cx={cx + dx - 2.2} cy={cy + dy - 3} r="2.3" fill="#fff" />
          <circle cx={cx + dx + 2.2} cy={cy + dy + 2.8} r="1.1" fill="#fff" opacity="0.9" />
        </>
      )}
      {/* upper lash with a little flick */}
      <path
        d={!flip
          ? `M${cx + 8.4},${cy - 4} Q${cx},${cy - 11.5} ${cx - 8},${cy - 5.4} L${cx - 9.6},${cy - 7.6}`
          : `M${cx - 8.4},${cy - 4} Q${cx},${cy - 11.5} ${cx + 8},${cy - 5.4} L${cx + 9.6},${cy - 7.6}`}
        stroke={INK} strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round"
      />
    </g>
  );
}

function star(x: number, y: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    pts.push(`${(x + Math.cos(a) * rr).toFixed(2)},${(y + Math.sin(a) * rr).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

function Mouth({ kind }: { kind: MouthKind }) {
  const x = 60, y = 79;
  switch (kind) {
    case 'smile':
      return <path d={`M${x - 5},${y} Q${x},${y + 5} ${x + 5},${y}`} stroke={INK} strokeWidth="2" fill="none" strokeLinecap="round" />;
    case 'grin':
      return <path d={`M${x - 5},${y - 1} Q${x},${y + 6} ${x + 5},${y - 1} Z`} fill="#d23a6a" stroke={INK} strokeWidth="1.4" strokeLinejoin="round" />;
    case 'open':
      return (
        <g>
          <path d={`M${x - 6.5},${y - 2} Q${x},${y + 10} ${x + 6.5},${y - 2} Z`} fill="#c22e5e" stroke={INK} strokeWidth="1.5" strokeLinejoin="round" />
          <path d={`M${x - 3.5},${y + 3.4} Q${x},${y + 1} ${x + 3.5},${y + 3.4} Q${x},${y + 6.5} ${x - 3.5},${y + 3.4}`} fill="#ff8fb1" />
        </g>
      );
    case 'o':
      return <ellipse cx={x} cy={y + 1} rx="2.4" ry="3" fill="#c22e5e" stroke={INK} strokeWidth="1.3" />;
    case 'wavy':
      return <path d={`M${x - 6},${y + 1} q1.5,-3 3,0 t3,0 t3,0 t3,0`} stroke={INK} strokeWidth="1.8" fill="none" strokeLinecap="round" />;
    case 'cat':
      return <path d={`M${x - 6},${y - 1} q3,4 6,0 q3,4 6,0`} stroke={INK} strokeWidth="1.9" fill="none" strokeLinecap="round" strokeLinejoin="round" />;
    case 'flat':
      return <path d={`M${x - 2},${y + 1} L${x + 5},${y}`} stroke={INK} strokeWidth="2" strokeLinecap="round" />;
  }
}

function ArmsLayer({ arms, skin, sleeve }: { arms: Arms; skin: string; sleeve: string }) {
  const arm = (d: string, hx: number, hy: number, key: string) => (
    <g key={key}>
      <path d={d} stroke={sleeve} strokeWidth="8" fill="none" strokeLinecap="round" />
      <circle cx={hx} cy={hy} r="4.6" fill={skin} stroke={INK} strokeWidth="1.2" />
    </g>
  );
  switch (arms) {
    case 'down':
      return <>{arm('M45,99 Q40,108 39,117', 39, 119, 'l')}{arm('M75,99 Q80,108 81,117', 81, 119, 'r')}</>;
    case 'up':
      return (
        <>
          {arm('M45,99 Q34,90 27,78', 26, 75, 'l')}
          {arm('M75,99 Q86,90 93,78', 94, 75, 'r')}
          <path className="miko-pom" d={star(24, 70, 8)} fill="#ffd23f" stroke="#ff9f1c" strokeWidth="1" />
          <path className="miko-pom" d={star(96, 70, 8)} fill="#ffd23f" stroke="#ff9f1c" strokeWidth="1" />
        </>
      );
    case 'fists':
      return <>{arm('M45,99 Q38,100 40,92', 41, 90, 'l')}{arm('M75,99 Q82,100 80,92', 79, 90, 'r')}</>;
    case 'chin':
      return <>{arm('M45,99 Q40,108 39,117', 39, 119, 'l')}{arm('M75,99 Q80,96 70,90', 68, 89, 'r')}</>;
    case 'hip':
      return <>{arm('M45,99 Q34,106 42,113', 43, 114, 'l')}{arm('M75,99 Q86,106 78,113', 77, 114, 'r')}</>;
    case 'point':
      return (
        <>
          {arm('M45,99 Q40,108 39,117', 39, 119, 'l')}
          <line x1="96" y1="90" x2="112" y2="66" stroke="#8a5a2b" strokeWidth="2.4" strokeLinecap="round" />
          <path d={star(112.5, 64, 4.5)} fill="#ffd23f" stroke="#ff9f1c" strokeWidth="0.8" />
          {arm('M75,99 Q86,96 94,91', 95, 90, 'r')}
        </>
      );
  }
}

export function MikoAvatar({ mood = 'happy', size = 96, talking = false, className = '' }: { mood?: Mood; size?: number; talking?: boolean; className?: string }) {
  const uid = useId().replace(/:/g, '');
  const m = MOODS[mood] ?? MOODS.happy;
  const hair = `hair${uid}`, iris = `iris${uid}`, dress = `dress${uid}`, shine = `shine${uid}`;
  const skin = '#ffe6d8';
  const sleeve = '#2d2a7a';

  return (
    <svg
      className={`miko-svg mood-${mood} ${talking ? 'is-talking' : ''} ${className}`}
      viewBox="0 0 120 132" width={size} height={size * 1.1} role="img" aria-label={`Miko looks ${mood}`}
    >
      <defs>
        <linearGradient id={hair} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="#ff9fd0" />
          <stop offset="0.55" stopColor="#ff5fa2" />
          <stop offset="1" stopColor="#9b5cff" />
        </linearGradient>
        <linearGradient id={iris} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5b2bd6" />
          <stop offset="0.6" stopColor="#8f5cff" />
          <stop offset="1" stopColor="#3ee0ff" />
        </linearGradient>
        <linearGradient id={dress} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3b35a0" />
          <stop offset="1" stopColor="#241f6b" />
        </linearGradient>
        <linearGradient id={shine} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>

      <g className="miko-bob">
        {/* twin-tails (behind) */}
        <g className="miko-tail miko-tail-l" style={{ transformOrigin: '30px 36px' }}>
          <path d="M32,32 C10,34 2,62 8,88 C11,102 18,112 14,124 C26,114 28,98 26,84 C24,66 30,52 38,44 Z" fill={`url(#${hair})`} stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M20,52 C14,66 14,80 18,94" stroke="#fff" strokeOpacity="0.35" strokeWidth="2" fill="none" strokeLinecap="round" />
        </g>
        <g className="miko-tail miko-tail-r" style={{ transformOrigin: '90px 36px' }}>
          <path d="M88,32 C110,34 118,62 112,88 C109,102 102,112 106,124 C94,114 92,98 94,84 C96,66 90,52 82,44 Z" fill={`url(#${hair})`} stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M100,52 C106,66 106,80 102,94" stroke="#fff" strokeOpacity="0.35" strokeWidth="2" fill="none" strokeLinecap="round" />
        </g>
        {/* hair ties */}
        <circle cx="31" cy="35" r="4.2" fill="#3ee0ff" stroke={INK} strokeWidth="1.3" />
        <circle cx="89" cy="35" r="4.2" fill="#3ee0ff" stroke={INK} strokeWidth="1.3" />

        {/* back hair */}
        <path d="M24,56 C22,26 40,12 60,12 C80,12 98,26 96,56 C96,72 92,84 88,90 L32,90 C28,84 24,72 24,56 Z" fill={`url(#${hair})`} stroke={INK} strokeWidth="1.6" />

        {/* body */}
        <path d="M44,92 C40,100 37,116 35,132 L85,132 C83,116 80,100 76,92 Z" fill={`url(#${dress})`} stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
        {/* sailor collar + ribbon */}
        <path d="M46,92 L60,104 L74,92 L80,100 L60,112 L40,100 Z" fill="#e9f8ff" stroke={INK} strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M47,96 L60,107 L73,96" stroke="#3ee0ff" strokeWidth="1.6" fill="none" />
        <path d="M60,106 L52,112 L54,103 Z M60,106 L68,112 L66,103 Z" fill="#ff5fa2" stroke={INK} strokeWidth="1.1" strokeLinejoin="round" />
        <circle cx="60" cy="106" r="2.4" fill="#ff5fa2" stroke={INK} strokeWidth="1.1" />
        {/* chest badge: tiny up-arrow */}
        <path d="M60,120 l-4,5 h2.6 v4 h2.8 v-4 h2.6 z" fill="#22d3a6" opacity="0.9" />

        {/* neck + face */}
        <rect x="55" y="84" width="10" height="9" rx="3" fill="#f5cdbb" />
        <ellipse cx="60" cy="58" rx="33" ry="30" fill={skin} stroke={INK} strokeWidth="1.6" />

        {/* blush */}
        <ellipse cx="41" cy="72" rx="5.5" ry="3" fill="#ff7aa8" opacity={m.blush} />
        <ellipse cx="79" cy="72" rx="5.5" ry="3" fill="#ff7aa8" opacity={m.blush} />
        {m.blush > 0.7 && (
          <g stroke="#ff4f8f" strokeWidth="1" strokeLinecap="round" opacity="0.8">
            <path d="M38,71 l2,-2 M41,71 l2,-2 M44,71 l2,-2" />
            <path d="M76,71 l2,-2 M79,71 l2,-2 M82,71 l2,-2" />
          </g>
        )}

        {/* eyes */}
        <g className={m.eyes === 'happy' || m.eyes === 'sleep' ? '' : 'miko-blink'}>
          <Eye kind={m.eyes} cx={46} cy={64} irisId={iris} />
          <Eye kind={m.eyes} cx={74} cy={64} irisId={iris} flip />
        </g>

        {/* brows */}
        {m.brows === 'worried' && <path d="M39,50 L50,47 M81,50 L70,47" stroke={INK} strokeWidth="2" strokeLinecap="round" />}
        {m.brows === 'up' && <path d="M39,48 Q45,44 51,47 M81,48 Q75,44 69,47" stroke={INK} strokeWidth="1.8" fill="none" strokeLinecap="round" />}
        {m.brows === 'focused' && <path d="M39,48 L51,49 M69,47 Q75,44 81,47" stroke={INK} strokeWidth="1.8" fill="none" strokeLinecap="round" />}

        <g className="miko-mouth" style={{ transformOrigin: '60px 80px' }}><Mouth kind={m.mouth} /></g>

        {/* bangs */}
        <path
          d="M27,56 C24,30 40,17 60,17 C80,17 96,30 93,56 C90,50 88,46 86,42 C85,49 83,53 80,55 C79,47 76,41 72,37 C71,44 68,49 64,51 C64,44 62,39 60,36 C57,42 53,47 48,50 C49,44 48,40 46,37 C43,43 40,48 36,50 C36,46 36,43 35,41 C31,45 29,50 27,56 Z"
          fill={`url(#${hair})`} stroke={INK} strokeWidth="1.6" strokeLinejoin="round"
        />
        <path d="M40,26 Q50,20 62,21" stroke={`url(#${shine})`} strokeWidth="3" fill="none" strokeLinecap="round" />
        {/* ahoge */}
        <path d="M58,18 C54,6 66,2 70,9 C66,6 61,9 62,17" fill={`url(#${hair})`} stroke={INK} strokeWidth="1.4" strokeLinejoin="round" />

        {/* candlestick hair clip */}
        <g className="miko-clip" transform="translate(84 22) rotate(18)">
          <path d="M-7,6 Q-10,0 -6,-2 L0,3 L6,-2 Q10,0 7,6 L0,4 Z" fill="#fff4fa" stroke={INK} strokeWidth="1" strokeLinejoin="round" />
          <line x1="-3" y1="-10" x2="-3" y2="2" stroke={INK} strokeWidth="1" />
          <rect x="-5.2" y="-7" width="4.4" height="7" rx="1" fill="#22d3a6" stroke={INK} strokeWidth="0.9" />
          <line x1="3.4" y1="-6" x2="3.4" y2="5" stroke={INK} strokeWidth="1" />
          <rect x="1.2" y="-4" width="4.4" height="6" rx="1" fill="#ff6a3d" stroke={INK} strokeWidth="0.9" />
        </g>

        {/* glasses for teaching */}
        {mood === 'teaching' && (
          <g fill="none" stroke={INK} strokeWidth="1.6">
            <circle cx="46" cy="64" r="10" fill="#cfefff" fillOpacity="0.18" />
            <circle cx="74" cy="64" r="10" fill="#cfefff" fillOpacity="0.18" />
            <path d="M56,63 Q60,60 64,63" />
          </g>
        )}

        <ArmsLayer arms={m.arms} skin={skin} sleeve={sleeve} />
      </g>

      {/* mood props (outside the bob so they float on their own) */}
      {mood === 'worried' && <path className="miko-sweat" d="M92,44 C88,50 88,55 92,55 C96,55 96,50 92,44 Z" fill="#8fd8ff" stroke="#3a8fd0" strokeWidth="1" />}
      {(mood === 'excited' || mood === 'proud' || mood === 'cheer') && (
        <g className="miko-sparkles">
          <path d={star(14, 20, 6)} fill="#ffd23f" />
          <path d={star(106, 14, 4.5)} fill="#3ee0ff" />
          <path d={star(108, 46, 3.5)} fill="#ff5fa2" />
        </g>
      )}
      {mood === 'thinking' && (
        <g className="miko-think" fill="#fff" stroke={INK} strokeWidth="1.2">
          <circle cx="98" cy="26" r="2.4" />
          <circle cx="104" cy="17" r="3.4" />
          <text x="104" y="12" textAnchor="middle" fontSize="13" fontWeight="900" fill="#9b5cff" stroke="none" fontFamily="Baloo 2, sans-serif">?</text>
        </g>
      )}
      {mood === 'sleepy' && (
        <g className="miko-zzz" fill="#a59fd0" fontFamily="Baloo 2, sans-serif" fontWeight="800">
          <text x="94" y="30" fontSize="10">z</text>
          <text x="101" y="20" fontSize="13">z</text>
          <text x="109" y="9" fontSize="16">Z</text>
        </g>
      )}
    </svg>
  );
}
