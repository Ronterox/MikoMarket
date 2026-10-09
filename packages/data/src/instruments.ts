import type { Instrument } from '@miko/engine';

/** The instruments the game knows about, in TradeStation spelling. */
export const INSTRUMENTS: Instrument[] = [
  { symbol: 'SPY', name: 'SPDR S&P 500 ETF', kind: 'etf', pointValue: 1, tickSize: 0.01, emoji: '🇺🇸' },
  { symbol: 'QQQ', name: 'Invesco QQQ (Nasdaq 100)', kind: 'etf', pointValue: 1, tickSize: 0.01, emoji: '💻' },
  { symbol: 'IWM', name: 'iShares Russell 2000 ETF', kind: 'etf', pointValue: 1, tickSize: 0.01, emoji: '🐿️' },
  { symbol: 'GLD', name: 'SPDR Gold Shares', kind: 'etf', pointValue: 1, tickSize: 0.01, emoji: '🥇' },
  { symbol: 'AAPL', name: 'Apple', kind: 'stock', pointValue: 1, tickSize: 0.01, emoji: '🍎' },
  { symbol: 'NVDA', name: 'NVIDIA', kind: 'stock', pointValue: 1, tickSize: 0.01, emoji: '🟩' },
  { symbol: 'TSLA', name: 'Tesla', kind: 'stock', pointValue: 1, tickSize: 0.01, emoji: '🚗' },
  { symbol: 'MSFT', name: 'Microsoft', kind: 'stock', pointValue: 1, tickSize: 0.01, emoji: '🪟' },
  { symbol: 'AMZN', name: 'Amazon', kind: 'stock', pointValue: 1, tickSize: 0.01, emoji: '📦' },
  { symbol: 'META', name: 'Meta Platforms', kind: 'stock', pointValue: 1, tickSize: 0.01, emoji: '👓' },
  { symbol: 'AMD', name: 'AMD', kind: 'stock', pointValue: 1, tickSize: 0.01, emoji: '🔺' },
  { symbol: '@ES', name: 'S&P 500 E-mini', kind: 'future', pointValue: 50, tickSize: 0.25, emoji: '📈' },
  { symbol: '@NQ', name: 'Nasdaq 100 E-mini', kind: 'future', pointValue: 20, tickSize: 0.25, emoji: '🚀' },
  { symbol: '@MES', name: 'Micro S&P 500 E-mini', kind: 'future', pointValue: 5, tickSize: 0.25, emoji: '🐣' },
  { symbol: '@MNQ', name: 'Micro Nasdaq 100 E-mini', kind: 'future', pointValue: 2, tickSize: 0.25, emoji: '🐥' },
  { symbol: '@CL', name: 'Crude Oil (WTI)', kind: 'future', pointValue: 1000, tickSize: 0.01, emoji: '🛢️' },
  { symbol: '@GC', name: 'Gold', kind: 'future', pointValue: 100, tickSize: 0.1, emoji: '🪙' },
];

const BY_SYMBOL = new Map(INSTRUMENTS.map((i) => [i.symbol, i]));
const MONTH_CODES = 'FGHJKMNQUVXZ';

/**
 * The instrument for a symbol. Understands continuous futures (@NQ), dated
 * contracts (MNQZ26, NQH10), bare roots (NQ) and TradingView-style ES1!.
 * Unknown symbols are treated as ordinary US stocks (point value 1, tick 0.01).
 */
export function instrumentFor(symbol: string): Instrument {
  const s = symbol.trim().toUpperCase();
  const exact = BY_SYMBOL.get(s);
  if (exact) return exact;

  const root = s.replace(/^@/, '').replace(/\d+!$/, '');
  const continuous = BY_SYMBOL.get(`@${root}`);
  if (continuous) return continuous;

  const dated = /^([A-Z]{1,3})([A-Z])(\d{2})$/.exec(root);
  if (dated && MONTH_CODES.includes(dated[2]!)) {
    const base = BY_SYMBOL.get(`@${dated[1]}`);
    if (base) return { ...base, symbol: s, name: `${base.name} ${dated[2]}${dated[3]}` };
  }

  return { symbol: s, name: s, kind: 'stock', pointValue: 1, tickSize: 0.01 };
}
