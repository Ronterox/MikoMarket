import type { IndicatorMeta } from '@miko/engine';
import { token } from './theme.ts';

/** Colours the player can give an indicator line (CSS tokens `--pal-<key>`, themed). */
export const PALETTE = ['sky', 'pink', 'gold', 'mint', 'grape', 'coral', 'teal', 'ink'] as const;
export type PalKey = (typeof PALETTE)[number];

/** How one indicator is drawn: a colour per output line, and bars instead of a line where it makes sense. */
export interface IndStyle { colors?: Record<string, PalKey>; bars?: boolean }

/** Outputs that are not price levels (never drawn on the price pane). */
export const NON_PRICE = new Set(['percentB', 'bandwidth', 'slope', 'dir']);

/** The output that can be drawn as bars (a histogram around zero, or volume). */
export const BAR_KEY: Record<string, string> = {
  macd: 'hist', mom: 'value', roc: 'value', cci: 'value', cmf: 'value', zscore: 'value', aroon: 'osc', volsma: 'volume',
};
/** Indicators that start as bars because that is how traders know them. */
const BARS_BY_DEFAULT = new Set(['macd', 'volsma']);

/** Per chart slot: the main line keeps the slot colour (chips match), extra lines get contrasting ones. */
const SLOT_SETS: PalKey[][] = [
  ['sky', 'coral', 'mint', 'grape', 'ink'],
  ['pink', 'teal', 'gold', 'grape', 'ink'],
  ['gold', 'grape', 'teal', 'mint', 'coral'],
];

export const palVar = (k: PalKey) => `var(--pal-${k})`;
export const palColor = (k: PalKey) => token(`--pal-${k}`);
const isPal = (k: unknown): k is PalKey => typeof k === 'string' && (PALETTE as readonly string[]).includes(k);

/** Output lines an indicator shows on the chart, in order. */
export function visibleOutputs(meta: IndicatorMeta) {
  return meta.outputs.filter((o) => !meta.overlay || !NON_PRICE.has(o.key));
}

export function usesBars(id: string, style?: IndStyle): boolean {
  if (!BAR_KEY[id]) return false;
  return style?.bars ?? BARS_BY_DEFAULT.has(id);
}

/** Colour key of each visible output. Band edges (upper/lower) share one colour by default. */
export function lineColors(meta: IndicatorMeta, slot: number, style?: IndStyle): Record<string, PalKey> {
  const set = SLOT_SETS[((slot % 3) + 3) % 3]!;
  const out: Record<string, PalKey> = {};
  visibleOutputs(meta).forEach((o, k) => {
    const picked = style?.colors?.[o.key];
    if (isPal(picked)) out[o.key] = picked;
    else if (o.key === 'lower' && out.upper) out[o.key] = out.upper;
    else out[o.key] = set[Math.min(k, set.length - 1)]!;
  });
  return out;
}

/** The colour that represents the indicator (chips, its settings bubble): its first visible line. */
export function mainColor(meta: IndicatorMeta, slot: number, style?: IndStyle): PalKey {
  const first = visibleOutputs(meta)[0];
  return (first && lineColors(meta, slot, style)[first.key]) ?? SLOT_SETS[((slot % 3) + 3) % 3]![0]!;
}
