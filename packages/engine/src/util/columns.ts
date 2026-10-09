import type { Bar, Columns, Source } from '../types.ts';

export function toColumns(bars: readonly Bar[]): Columns {
  const n = bars.length;
  const cols: Columns = {
    t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n),
    l: new Float64Array(n), c: new Float64Array(n), v: new Float64Array(n),
  };
  for (let i = 0; i < n; i++) {
    const b = bars[i]!;
    cols.t[i] = b.t; cols.o[i] = b.o; cols.h[i] = b.h; cols.l[i] = b.l; cols.c[i] = b.c; cols.v[i] = b.v;
  }
  return cols;
}

export function sourceOf(cols: Columns, source: Source): Float64Array {
  switch (source) {
    case 'open': return cols.o;
    case 'high': return cols.h;
    case 'low': return cols.l;
    case 'close': return cols.c;
    case 'volume': return cols.v;
    case 'hl2': return cols.h.map((h, i) => (h + cols.l[i]!) / 2);
    case 'hlc3': return cols.h.map((h, i) => (h + cols.l[i]! + cols.c[i]!) / 3);
    case 'ohlc4': return cols.h.map((h, i) => (cols.o[i]! + h + cols.l[i]! + cols.c[i]!) / 4);
  }
}
