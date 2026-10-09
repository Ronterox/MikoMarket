import { useEffect, useMemo, useRef } from 'react';
import {
  CandlestickSeries, ColorType, createChart, createSeriesMarkers, CrosshairMode, LineSeries, LineStyle,
  type IChartApi, type IPriceLine, type ISeriesApi, type ISeriesMarkersPluginApi, type LineData, type SeriesMarker,
  type Time, type UTCTimestamp, type WhitespaceData,
} from 'lightweight-charts';
import { computeIndicator, listIndicators, type Bar, type IndicatorMeta, type Session, type Trade } from '@miko/engine';
import { priceFmt, signedMoney } from '../../lib/format.ts';
import { useApp } from '../../state/app.ts';
import { slotColors, token } from '../../lib/theme.ts';

const HISTORY = 160;
/** Outputs that are not price levels (never drawn on the price pane). */
const NON_PRICE = new Set(['percentB', 'bandwidth', 'slope', 'dir']);

const ts = (t: number) => (t / 1000) as UTCTimestamp;

const cssVar = (name: string) => token(name);

function toCandle(b: Bar) { return { time: ts(b.t), open: b.o, high: b.h, low: b.l, close: b.c }; }

interface IndLayer { id: string; meta: IndicatorMeta; data: Record<string, Float64Array>; series: { key: string; s: ISeriesApi<'Line'> }[] }

export interface PlayChartProps {
  session: Session;
  botSession: Session | null;
  version: number;
  round: number;
  speedMs: number;
  indicators: string[];
  mystery: boolean;
  onBracket: (kind: 'stop' | 'target', price: number) => void;
}

const nyFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false });
const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });

export function PlayChart({ session, botSession, version, round, speedMs, indicators, mystery, onBracket }: PlayChartProps) {
  const theme = useApp((s) => s.theme);
  const wrap = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const lastIdx = useRef(-1);
  const fromIdx = useRef(0);
  const forming = useRef(false);
  const layers = useRef<IndLayer[]>([]);
  const lines = useRef<{ entry?: IPriceLine; stop?: IPriceLine; target?: IPriceLine }>({});
  const stopHandle = useRef<HTMLButtonElement>(null);
  const targetHandle = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ kind: 'stop' | 'target'; price: number } | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const onBracketRef = useRef(onBracket);
  onBracketRef.current = onBracket;

  const metas = useMemo(() => new Map(listIndicators().map((m) => [m.id, m])), []);

  // ── create chart once ──
  useEffect(() => {
    const el = wrap.current!;
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: cssVar('--chart-text'), fontFamily: 'Nunito, sans-serif', fontSize: 11, attributionLogo: true },
      grid: { vertLines: { color: cssVar('--chart-grid') }, horzLines: { color: cssVar('--chart-grid') } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.08 } },
      timeScale: { borderVisible: false, rightOffset: 8, barSpacing: 8, minBarSpacing: 2, fixLeftEdge: false },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { labelVisible: false }, horzLine: { labelBackgroundColor: cssVar('--chart-cross') } },
      handleScale: { axisPressedMouseMove: { time: true, price: false } },
    });
    const candle = chart.addSeries(CandlestickSeries, {
      upColor: cssVar('--up'), downColor: cssVar('--down'),
      wickUpColor: cssVar('--wick-up'), wickDownColor: cssVar('--wick-down'), borderVisible: false,
      priceLineColor: cssVar('--brand-2'), priceLineStyle: LineStyle.Dotted,
    });
    chartRef.current = chart;
    candleRef.current = candle;
    markersRef.current = createSeriesMarkers(candle, []);
    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      markersRef.current = null;
      layers.current = [];
      lines.current = {};
    };
  }, []);

  // ── theme colours ──
  useEffect(() => {
    const chart = chartRef.current, candle = candleRef.current;
    if (!chart || !candle) return;
    const grid = cssVar('--chart-grid');
    chart.applyOptions({
      layout: { textColor: cssVar('--chart-text') },
      grid: { vertLines: { color: grid }, horzLines: { color: grid } },
      crosshair: { horzLine: { labelBackgroundColor: cssVar('--chart-cross') } },
    });
    candle.applyOptions({
      upColor: cssVar('--up'), downColor: cssVar('--down'), wickUpColor: cssVar('--wick-up'), wickDownColor: cssVar('--wick-down'),
      priceLineColor: cssVar('--brand-2'),
    });
  }, [theme]);

  // ── mystery mode hides dates ──
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const intraday = session.timeframe !== '1d' && session.timeframe !== '1w';
    chart.applyOptions({
      timeScale: {
        visible: true,
        tickMarkFormatter: (time: Time, tickType: number) => {
          if (mystery) return '';
          const d = new Date((time as number) * 1000);
          return intraday && tickType >= 3 ? nyFmt.format(d) : dayFmt.format(d);
        },
      },
      localization: { timeFormatter: (time: Time) => (mystery ? '' : new Date((time as number) * 1000).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: intraday ? '2-digit' : undefined, minute: intraday ? '2-digit' : undefined })) },
    });
  }, [mystery, session]);

  const fullReset = () => {
    const s = sessionRef.current, candle = candleRef.current, chart = chartRef.current;
    if (!candle || !chart) return;
    const bars = s.series.bars;
    fromIdx.current = Math.max(0, s.startIndex - HISTORY);
    candle.setData(bars.slice(fromIdx.current, s.index + 1).map(toCandle));
    lastIdx.current = s.index;
    forming.current = false;
    for (const layer of layers.current) fillLayer(layer);
  };

  const lineData = (arr: Float64Array, from: number, to: number, bars: Bar[]): (LineData | WhitespaceData)[] => {
    const out: (LineData | WhitespaceData)[] = [];
    for (let i = from; i <= to; i++) {
      const v = arr[i]!;
      out.push(Number.isFinite(v) ? { time: ts(bars[i]!.t), value: v } : { time: ts(bars[i]!.t) });
    }
    return out;
  };

  const fillLayer = (layer: IndLayer) => {
    const s = sessionRef.current;
    for (const { key, s: ser } of layer.series) ser.setData(lineData(layer.data[key]!, fromIdx.current, s.index, s.series.bars));
  };

  // ── new round: full data reset + view ──
  useEffect(() => {
    const chart = chartRef.current;
    fullReset();
    if (chart) {
      const n = session.index - fromIdx.current;
      chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 70), to: n + 8 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round, session]);

  // ── indicator layers ──
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const layer of layers.current) for (const { s } of layer.series) chart.removeSeries(s);
    layers.current = [];
    let pane = 1;
    indicators.forEach((id, slot) => {
      const meta = metas.get(id);
      if (!meta) return;
      let data: Record<string, Float64Array>;
      try { data = computeIndicator(session.cols, id); } catch { return; }
      const paneIndex = meta.overlay ? 0 : pane++;
      const keys = meta.outputs.map((o) => o.key).filter((k) => data[k] && (!meta.overlay || !NON_PRICE.has(k)));
      const [c1, c2] = slotColors(slot);
      const series = keys.map((key, k) => {
        const s = chart.addSeries(LineSeries, {
          color: k === 0 ? c1 : c2,
          lineWidth: k === 0 ? 2 : 1,
          lineStyle: meta.overlay && keys.length === 3 && k === 1 ? LineStyle.Dashed : LineStyle.Solid,
          priceLineVisible: false, lastValueVisible: k === 0, crosshairMarkerVisible: false,
          pointMarkersVisible: id === 'psar',
          lineVisible: id !== 'psar',
        }, paneIndex);
        if (k === 0 && !meta.overlay) for (const lv of meta.levels ?? []) s.createPriceLine({ price: lv, color: cssVar('--ind-level'), lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false, title: '' });
        return { key, s };
      });
      const layer = { id, meta, data, series };
      layers.current.push(layer);
      fillLayer(layer);
    });
    const panes = chart.panes();
    // Stretch factors survive hidden tabs / resizes (fixed pixel heights do not).
    panes[0]?.setStretchFactor(panes.length > 1 ? 3.2 : 1);
    for (let p = 1; p < panes.length; p++) panes[p]!.setStretchFactor(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicators, session, metas, theme]);

  // ── incremental updates per step ──
  useEffect(() => {
    const candle = candleRef.current;
    if (!candle) return;
    const s = session;
    const bars = s.series.bars;
    if (s.index < lastIdx.current || forming.current && s.index === lastIdx.current) {
      fullReset();
    } else {
      for (let i = lastIdx.current + 1; i <= s.index; i++) {
        candle.update(toCandle(bars[i]!));
        for (const layer of layers.current) {
          // Live mode appends bars: recompute (causal) indicators when the series grew.
          if ((layer.data[layer.series[0]?.key ?? '']?.length ?? 0) <= i) {
            try { layer.data = computeIndicator(s.cols, layer.id); } catch { /* keep old */ }
          }
          for (const { key, s: ser } of layer.series) {
            const v = layer.data[key]?.[i] ?? NaN;
            ser.update(Number.isFinite(v) ? { time: ts(bars[i]!.t), value: v } : { time: ts(bars[i]!.t) });
          }
        }
      }
      lastIdx.current = s.index;
      forming.current = false;
    }

    // markers
    const markers: SeriesMarker<Time>[] = [];
    const up = cssVar('--up'), down = cssVar('--down'), botC = cssVar('--bot'), lesson = cssVar('--info');
    const addTrade = (t: Trade, bot: boolean) => {
      const long = t.side === 'long';
      markers.push({ time: ts(t.entryT), position: long ? 'belowBar' : 'aboveBar', shape: long ? 'arrowUp' : 'arrowDown', color: bot ? botC : long ? up : down, text: bot ? '🤖' : long ? 'BUY' : 'SELL', size: bot ? 1 : 1.4 });
      markers.push({ time: ts(t.exitT), position: long ? 'aboveBar' : 'belowBar', shape: 'circle', color: bot ? botC : t.pnl >= 0 ? up : lesson, text: bot ? '' : signedMoney(t.pnl), size: bot ? 0.6 : 1 });
    };
    for (const t of s.trades) addTrade(t, false);
    if (botSession) for (const t of botSession.trades) addTrade(t, true);
    const pos = s.state.position;
    if (pos) markers.push({ time: ts(pos.openedAt), position: pos.side === 'long' ? 'belowBar' : 'aboveBar', shape: pos.side === 'long' ? 'arrowUp' : 'arrowDown', color: pos.side === 'long' ? up : down, text: pos.side === 'long' ? 'BUY' : 'SELL', size: 1.4 });
    const bpos = botSession?.state.position;
    if (bpos) markers.push({ time: ts(bpos.openedAt), position: bpos.side === 'long' ? 'belowBar' : 'aboveBar', shape: bpos.side === 'long' ? 'arrowUp' : 'arrowDown', color: botC, text: '🤖', size: 1 });
    const minT = bars[fromIdx.current]!.t;
    markersRef.current?.setMarkers(markers.filter((m) => (m.time as number) * 1000 >= minT).sort((a, b) => (a.time as number) - (b.time as number)));

    // bracket lines
    const L = lines.current;
    const sync = (key: 'entry' | 'stop' | 'target', price: number | undefined, color: string, title: string, style: LineStyle) => {
      if (price === undefined || !Number.isFinite(price)) {
        if (L[key]) { candle.removePriceLine(L[key]!); delete L[key]; }
        return;
      }
      if (drag.current && key === drag.current.kind) return;
      if (!L[key]) L[key] = candle.createPriceLine({ price, color, lineWidth: key === 'entry' ? 1 : 2, lineStyle: style, axisLabelVisible: true, title });
      else L[key]!.applyOptions({ price, title, color });
    };
    sync('entry', pos?.avgPrice, cssVar('--chart-text'), '', LineStyle.Dotted);
    sync('stop', pos?.trailStop ?? pos?.stopLoss, down, '', LineStyle.Dashed);
    sync('target', pos?.takeProfit, up, '', LineStyle.Dashed);
  }, [version, session, botSession, theme]);

  // ── forming candle animation (visual only: the engine never sees it) ──
  useEffect(() => {
    const candle = candleRef.current;
    if (!candle) return;
    const s = session;
    if (speedMs < 500 || s.done) {
      if (forming.current) fullReset();
      return;
    }
    const next = s.series.bars[s.index + 1];
    if (!next) return;
    const dur = speedMs * 0.9;
    const bull = next.c >= next.o;
    const p1 = bull ? next.l : next.h, p2 = bull ? next.h : next.l;
    const start = performance.now();
    let raf = 0;
    let hi = next.o, lo = next.o;
    const frame = (now: number) => {
      const k = Math.min(1, (now - start) / dur);
      let price: number;
      if (k < 0.3) price = next.o + (p1 - next.o) * (k / 0.3);
      else if (k < 0.75) price = p1 + (p2 - p1) * ((k - 0.3) / 0.45);
      else price = p2 + (next.c - p2) * ((k - 0.75) / 0.25);
      // a little noise makes it feel alive
      price += Math.sin(now / 37) * (next.h - next.l) * 0.04 * (1 - k);
      price = Math.min(next.h, Math.max(next.l, price));
      hi = Math.max(hi, price); lo = Math.min(lo, price);
      candle.update({ time: ts(next.t), open: next.o, high: hi, low: lo, close: price });
      forming.current = true;
      if (k < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, speedMs, session]);

  // ── drag handles follow their lines ──
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const candle = candleRef.current;
      const s = sessionRef.current;
      const pos = s.state.position;
      const place = (el: HTMLButtonElement | null, kind: 'stop' | 'target', price: number | undefined) => {
        if (!el) return;
        const p = drag.current?.kind === kind ? drag.current.price : price;
        const y = p !== undefined && candle ? candle.priceToCoordinate(p) : null;
        const h = wrap.current?.clientHeight ?? 0;
        if (y === null || y < 4 || y > h - 4) { el.style.opacity = '0'; el.style.pointerEvents = 'none'; return; }
        el.style.opacity = '1';
        el.style.pointerEvents = 'auto';
        el.style.transform = `translateY(${y - 14}px)`;
        const label = el.querySelector('.drag-price');
        if (label && p !== undefined) label.textContent = priceFmt(p, s.series.instrument.tickSize);
      };
      place(stopHandle.current, 'stop', pos ? pos.trailStop ?? pos.stopLoss : undefined);
      place(targetHandle.current, 'target', pos?.takeProfit);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const startDrag = (kind: 'stop' | 'target') => (e: React.PointerEvent<HTMLButtonElement>) => {
    const pos = sessionRef.current.state.position;
    if (!pos) return;
    const price = kind === 'stop' ? pos.trailStop ?? pos.stopLoss : pos.takeProfit;
    if (price === undefined) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { kind, price };
    chartRef.current?.applyOptions({ handleScroll: false, handleScale: false });
  };

  const moveDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current, candle = candleRef.current, el = wrap.current;
    if (!d || !candle || !el) return;
    const s = sessionRef.current;
    const pos = s.state.position;
    if (!pos) return;
    const y = e.clientY - el.getBoundingClientRect().top;
    const raw = candle.coordinateToPrice(y);
    if (raw === null) return;
    const tick = s.series.instrument.tickSize;
    const last = s.cols.c[s.index]!;
    let p = Math.round(raw / tick) * tick;
    // Keep the line on the sensible side of the last price so it doesn't trigger instantly.
    const long = pos.side === 'long';
    const isBelow = (d.kind === 'stop') === long;
    p = isBelow ? Math.min(p, last - tick) : Math.max(p, last + tick);
    d.price = p;
    lines.current[d.kind]?.applyOptions({ price: p });
  };

  const endDrag = () => {
    const d = drag.current;
    drag.current = null;
    chartRef.current?.applyOptions({ handleScroll: true, handleScale: true });
    if (d) onBracketRef.current(d.kind, d.price);
  };

  return (
    <div className="play-chart" data-fx="chart">
      <div ref={wrap} className="play-chart-canvas" />
      <button ref={stopHandle} className="drag-handle stop" onPointerDown={startDrag('stop')} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} aria-label="Drag stop-loss">
        <span>🛡️</span><span className="drag-price num" /><span className="drag-grip">⇕</span>
      </button>
      <button ref={targetHandle} className="drag-handle target" onPointerDown={startDrag('target')} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} aria-label="Drag take-profit">
        <span>🎯</span><span className="drag-price num" /><span className="drag-grip">⇕</span>
      </button>
    </div>
  );
}
