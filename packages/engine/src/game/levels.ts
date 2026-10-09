/**
 * Levels and ranks.
 *
 * XP CURVE: the total XP needed to REACH level L is
 *
 *     xpForLevel(L) = round(100 * (L - 1)^1.5)       (level 1 = 0 XP)
 *
 * A disciplined trade (with a stop and sane risk) earns about 30-45 XP, so level 2
 * (100 XP) takes about 3 trades. Each step costs a little more than the one before:
 * L3 = 283, L5 = 800, L10 = 2,700, L20 = 8,282, L50 = 34,300. Early levels come quickly,
 * and later ones reward weeks of consistent play rather than a single lucky afternoon.
 */

export const XP_BASE = 100;
export const XP_EXPONENT = 1.5;
export const MAX_LEVEL = 999;

export function xpForLevel(level: number): number {
  const l = Math.max(1, Math.floor(level));
  return Math.round(XP_BASE * Math.pow(l - 1, XP_EXPONENT));
}

export function levelForXp(xp: number): number {
  const x = Math.max(0, Number.isFinite(xp) ? xp : 0);
  let level = Math.floor(1 + Math.pow(x / XP_BASE, 1 / XP_EXPONENT));
  // Correct for float error and rounding inside xpForLevel.
  while (level > 1 && xpForLevel(level) > x) level--;
  while (level < MAX_LEVEL && xpForLevel(level + 1) <= x) level++;
  return Math.min(Math.max(level, 1), MAX_LEVEL);
}

export interface LevelProgress {
  level: number;
  into: number;     // XP earned inside the current level
  needed: number;   // XP span of the current level (from this level to the next)
  pct: number;      // 0..1
}

export function levelProgress(xp: number): LevelProgress {
  const level = levelForXp(xp);
  const start = xpForLevel(level);
  const next = xpForLevel(level + 1);
  const needed = Math.max(1, next - start);
  const into = Math.max(0, Math.min(needed, Math.floor(xp) - start));
  return { level, into, needed, pct: into / needed };
}

export interface Rank {
  title: string;
  icon: string;
  color: string;
  minLevel: number;
}

/** Ten ranks. Names describe growing skill and never mock the player. */
export const RANKS: readonly Rank[] = [
  { minLevel: 1, title: 'Rookie', icon: '🌱', color: '#8bc34a' },
  { minLevel: 3, title: 'Paper Trader', icon: '📄', color: '#90a4ae' },
  { minLevel: 5, title: 'Chart Reader', icon: '👀', color: '#4fc3f7' },
  { minLevel: 8, title: 'Swing Kid', icon: '🎐', color: '#4dd0e1' },
  { minLevel: 11, title: 'Risk Tamer', icon: '🛡️', color: '#26a69a' },
  { minLevel: 15, title: 'Trend Rider', icon: '🏄', color: '#42a5f5' },
  { minLevel: 20, title: 'Quant Apprentice', icon: '🧪', color: '#7e57c2' },
  { minLevel: 27, title: 'Market Ninja', icon: '🥷', color: '#5c6bc0' },
  { minLevel: 35, title: 'Diamond Mind', icon: '💎', color: '#00bcd4' },
  { minLevel: 45, title: 'Legend of the Tape', icon: '👑', color: '#ffb300' },
];

export function rankFor(level: number): { title: string; icon: string; color: string } {
  let r = RANKS[0]!;
  for (const rank of RANKS) if (level >= rank.minLevel) r = rank;
  return { title: r.title, icon: r.icon, color: r.color };
}
