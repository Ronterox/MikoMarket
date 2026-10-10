import type { IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, SeriesAttachedParameter, Time } from 'lightweight-charts';
import type { DrawPoint, Drawing } from '../../state/draw.ts';

type Target = Parameters<IPrimitivePaneRenderer['draw']>[0];

export interface DrawScene {
  drawings: Drawing[];
  /** Trend line being placed: the first tap and where the pointer is now. */
  draft: { a: DrawPoint; b: DrawPoint } | null;
  selected: string | null;
  color: string;
}

/**
 * The player's lines, drawn on the price pane by lightweight-charts itself, so they pan and zoom
 * with the candles. `xOf` maps a bar time to a pane x (also for bars not revealed yet).
 */
export class DrawLayer implements ISeriesPrimitive<Time> {
  private series: ISeriesApi<'Candlestick'> | null = null;
  private requestUpdate: (() => void) | null = null;
  private scene: DrawScene = { drawings: [], draft: null, selected: null, color: '#fff' };
  private readonly view: IPrimitivePaneView;

  constructor(private readonly xOf: (t: number) => number | null) {
    const renderer: IPrimitivePaneRenderer = { draw: (target) => this.draw(target) };
    this.view = { zOrder: () => 'top', renderer: () => renderer };
  }

  attached(p: SeriesAttachedParameter<Time>) {
    this.series = p.series as ISeriesApi<'Candlestick'>;
    this.requestUpdate = p.requestUpdate;
  }

  detached() { this.series = null; this.requestUpdate = null; }

  paneViews() { return [this.view]; }

  set(scene: Partial<DrawScene>) {
    this.scene = { ...this.scene, ...scene };
    this.requestUpdate?.();
  }

  /** Pane coordinates of a drawing's ends (horizontal lines span the whole pane). */
  ends(d: Pick<Drawing, 'kind' | 'a' | 'b'>, width: number): [number, number, number, number] | null {
    const y1 = this.series?.priceToCoordinate(d.a.p);
    if (y1 == null) return null;
    if (d.kind === 'hline') return [0, y1, width, y1];
    const y2 = this.series?.priceToCoordinate(d.b.p);
    const x1 = this.xOf(d.a.t), x2 = this.xOf(d.b.t);
    if (y2 == null || x1 == null || x2 == null) return null;
    return [x1, y1, x2, y2];
  }

  private draw(target: Target) {
    const { drawings, draft, selected, color } = this.scene;
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr, mediaSize }) => {
      const line = (e: [number, number, number, number] | null, width: number, dash: number[] = []) => {
        if (!e) return;
        ctx.setLineDash(dash.map((v) => v * hr));
        ctx.lineWidth = width * hr;
        ctx.beginPath();
        ctx.moveTo(e[0] * hr, e[1] * vr);
        ctx.lineTo(e[2] * hr, e[3] * vr);
        ctx.stroke();
      };
      const dot = (x: number, y: number) => {
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(x * hr, y * vr, 4.5 * hr, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 2 * hr;
        ctx.stroke();
      };
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = color;
      for (const d of drawings) {
        const e = this.ends(d, mediaSize.width);
        const sel = d.id === selected;
        if (sel) {
          // soft glow under the selected line
          ctx.globalAlpha = 0.25;
          line(e, 7);
          ctx.globalAlpha = 1;
        }
        line(e, sel ? 2.5 : 2, d.kind === 'hline' ? [7, 5] : []);
        if (sel && e) {
          ctx.fillStyle = color;
          if (d.kind === 'trend') { dot(e[0], e[1]); dot(e[2], e[3]); }
        }
      }
      if (draft) {
        const e = this.ends({ kind: 'trend', ...draft }, mediaSize.width);
        ctx.globalAlpha = 0.8;
        line(e, 2, [4, 4]);
        ctx.globalAlpha = 1;
        if (e) { ctx.fillStyle = color; dot(e[0], e[1]); }
      }
      ctx.restore();
    });
  }
}

/** Distance (px) from p to the segment a→b. */
export function distToSegment(px: number, py: number, [x1, y1, x2, y2]: [number, number, number, number]): number {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const k = len2 > 0 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2)) : 0;
  return Math.hypot(px - (x1 + k * dx), py - (y1 + k * dy));
}
