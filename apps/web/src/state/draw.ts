import { create } from 'zustand';
import { lsGet, lsSet } from '../lib/storage.ts';
import { sound } from '../lib/sound.ts';

/** A chart point in data space: bar time (ms) and price, so it survives zoom, scroll and timeframe changes. */
export interface DrawPoint { t: number; p: number }
export type DrawTool = 'trend' | 'hline';
export interface Drawing { id: string; kind: DrawTool; a: DrawPoint; b: DrawPoint }

/** Lines kept per symbol (a support level on SPY 5m is still one on SPY 1h). */
const MAX_PER_SYMBOL = 40;
const KEY = 'miko.drawings';

interface DrawState {
  tool: DrawTool | null;
  /** First point of a trend line while waiting for the second tap. */
  anchor: DrawPoint | null;
  selected: string | null;
  bySymbol: Record<string, Drawing[]>;
  setTool(tool: DrawTool | null): void;
  setAnchor(p: DrawPoint | null): void;
  add(symbol: string, d: Omit<Drawing, 'id'>): void;
  remove(symbol: string, id: string): void;
  clear(symbol: string): void;
  select(id: string | null): void;
}

let seq = 0;

export const useDraw = create<DrawState>((set, get) => {
  const save = (bySymbol: Record<string, Drawing[]>) => { lsSet(KEY, bySymbol); set({ bySymbol }); };
  return {
    tool: null,
    anchor: null,
    selected: null,
    bySymbol: lsGet<Record<string, Drawing[]>>(KEY) ?? {},

    setTool: (tool) => {
      const same = get().tool === tool;
      sound.play(tool && !same ? 'toggleOn' : 'toggleOff');
      set({ tool: same ? null : tool, anchor: null, selected: null });
    },
    setAnchor: (anchor) => set({ anchor }),
    add: (symbol, d) => {
      const list = [...(get().bySymbol[symbol] ?? []), { ...d, id: `d${Date.now().toString(36)}${(seq++).toString(36)}` }].slice(-MAX_PER_SYMBOL);
      sound.play('pop');
      save({ ...get().bySymbol, [symbol]: list });
      set({ tool: null, anchor: null });
    },
    remove: (symbol, id) => {
      sound.play('cardRemove');
      save({ ...get().bySymbol, [symbol]: (get().bySymbol[symbol] ?? []).filter((d) => d.id !== id) });
      set({ selected: null });
    },
    clear: (symbol) => {
      sound.play('dismiss');
      const { [symbol]: _gone, ...rest } = get().bySymbol;
      save(rest);
      set({ selected: null, anchor: null });
    },
    select: (selected) => { if (selected !== get().selected) { if (selected) sound.play('tap'); set({ selected }); } },
  };
});
