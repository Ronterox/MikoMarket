/**
 * Reads colour tokens from CSS (styles/tokens.css) so canvas / chart code follows the
 * active theme. Fallbacks are the dark "lofi night" values.
 */
const FALLBACK: Record<string, string> = {
  '--brand': '#ff6fa5', '--brand-2': '#ff9a76', '--info': '#3fb8f5', '--gold': '#ffc857',
  '--up': '#2fd38a', '--down': '#ff8551', '--text': '#fff6ec', '--muted': '#cdbba8', '--star': '#fff1de',
  '--chart-grid': 'rgba(255,228,200,0.055)', '--chart-text': '#b5a291', '--chart-cross': '#ff9a76',
  '--wick-up': 'rgba(47,211,138,0.7)', '--wick-down': 'rgba(255,133,81,0.7)',
  '--ind-1': '#3fb8f5', '--ind-1b': '#93d6fa', '--ind-2': '#ff8fb8', '--ind-2b': '#ffc4da',
  '--ind-level': 'rgba(205,187,168,0.4)', '--bot': '#8fc9e8', '--surface-2': '#342c27', '--bg': '#171412',
};

export function token(name: string): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (v) return v;
  } catch { /* no DOM */ }
  return FALLBACK[name] ?? '#ffffff';
}

/** Indicator slot colours: [main line, secondary lines]. */
export function slotColors(slot: number): [string, string] {
  return slot % 2 === 0 ? [token('--ind-1'), token('--ind-1b')] : [token('--ind-2'), token('--ind-2b')];
}

/** CSS-variable form for DOM styling (chips etc.). */
export const SLOT_VARS = ['var(--ind-1)', 'var(--ind-2)'] as const;

/** Same colour with a new alpha (accepts #rgb, #rrggbb, rgb(), rgba()). Chart libs want plain rgba. */
export function alpha(color: string, a: number): string {
  const c = color.trim();
  let r = 255, g = 255, b = 255;
  if (c.startsWith('#')) {
    const h = c.length === 4 ? c.slice(1).split('').map((x) => x + x).join('') : c.slice(1, 7);
    r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16);
  } else {
    const m = c.match(/[\d.]+/g);
    if (m && m.length >= 3) { r = Number(m[0]); g = Number(m[1]); b = Number(m[2]); }
  }
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
