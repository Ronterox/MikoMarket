import { rankFor } from '@miko/engine';

/**
 * UI colour for each engine rank. Some engine rank colours are cool, cold tones
 * tones that clash with the sakura palette, so the web skin maps them by title.
 */
const RANK_COLORS: Record<string, string> = {
  'Rookie': '#6fdcb0',
  'Paper Trader': '#d9b98c',
  'Chart Reader': '#3fb8f5',
  'Swing Kid': '#7fd0fa',
  'Risk Tamer': '#2fd38a',
  'Trend Rider': '#4aa8e0',
  'Quant Apprentice': '#ff9a76',
  'Market Ninja': '#e85a8c',
  'Diamond Mind': '#93d6fa',
  'Legend of the Tape': '#ff6fa5',
};

export function uiRank(level: number): { title: string; icon: string; color: string } {
  const r = rankFor(level);
  return { ...r, color: RANK_COLORS[r.title] ?? '#ff9a76' };
}
