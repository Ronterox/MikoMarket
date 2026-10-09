import type { Instrument, Timeframe } from '@miko/engine';

/** UI catalogue of playable markets (emoji = flavour). Merged with /api/instruments when available. */
export const LOCAL_INSTRUMENTS: Instrument[] = [
  { symbol: 'SPY', name: 'S&P 500 ETF', kind: 'etf', pointValue: 1, tickSize: 0.01, emoji: '🇺🇸' },
  { symbol: '@MNQ', name: 'Micro Nasdaq 100', kind: 'future', pointValue: 2, tickSize: 0.25, emoji: '🚀' },
  { symbol: 'AAPL', name: 'Apple', kind: 'stock', pointValue: 1, tickSize: 0.01, emoji: '🍎' },
  { symbol: 'GLD', name: 'Gold ETF', kind: 'etf', pointValue: 1, tickSize: 0.01, emoji: '🥇' },
  { symbol: '@MES', name: 'Micro S&P 500', kind: 'future', pointValue: 5, tickSize: 0.25, emoji: '🗽' },
  { symbol: 'QQQ', name: 'Nasdaq 100 ETF', kind: 'etf', pointValue: 1, tickSize: 0.01, emoji: '💻' },
  { symbol: 'TSLA', name: 'Tesla', kind: 'stock', pointValue: 1, tickSize: 0.01, emoji: '⚡' },
  { symbol: 'NVDA', name: 'Nvidia', kind: 'stock', pointValue: 1, tickSize: 0.01, emoji: '🎮' },
  { symbol: 'MSFT', name: 'Microsoft', kind: 'stock', pointValue: 1, tickSize: 0.01, emoji: '🪟' },
  { symbol: '@MCL', name: 'Micro Crude Oil', kind: 'future', pointValue: 100, tickSize: 0.01, emoji: '🛢️' },
  { symbol: '@MGC', name: 'Micro Gold', kind: 'future', pointValue: 10, tickSize: 0.1, emoji: '👑' },
  { symbol: 'AMZN', name: 'Amazon', kind: 'stock', pointValue: 1, tickSize: 0.01, emoji: '📦' },
];

export const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '1d'];

/** Rough starting prices for demo data so the synthetic charts look plausible. */
export const DEMO_PRICE: Record<string, number> = {
  SPY: 520, '@MNQ': 18500, '@NQ': 18500, AAPL: 190, GLD: 215, '@MES': 5200, '@ES': 5200, QQQ: 440, TSLA: 210, NVDA: 120,
  MSFT: 420, '@MCL': 78, '@CL': 78, '@MGC': 2350, '@GC': 2350, AMZN: 180,
};

export function emojiFor(inst: Pick<Instrument, 'symbol' | 'emoji' | 'kind'>): string {
  if (inst.emoji) return inst.emoji;
  const local = LOCAL_INSTRUMENTS.find((i) => i.symbol === inst.symbol);
  if (local?.emoji) return local.emoji;
  return inst.kind === 'future' ? '📈' : inst.kind === 'crypto' ? '🪙' : inst.kind === 'fx' ? '💱' : '📊';
}

export function displaySymbol(symbol: string): string {
  return symbol.replace(/^@/, '');
}

/** Game setting: starting cash per round. Futures accounts start bigger so one micro contract fits a 1% risk. */
export function startingCash(inst: Pick<Instrument, 'kind'>): number {
  return inst.kind === 'future' ? 25_000 : 10_000;
}
