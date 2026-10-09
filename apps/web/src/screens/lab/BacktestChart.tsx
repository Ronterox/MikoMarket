import { useEffect, useRef } from 'react';
import {
  AreaSeries, ColorType, createChart, createSeriesMarkers,
  type SeriesMarker, type Time, type UTCTimestamp,
} from 'lightweight-charts';
import type { BacktestResult, BarSeries } from '@miko/engine';
import { useApp } from '../../state/app.ts';

const ts = (t: number) => (t / 1000) as UTCTimestamp;

/** Price (area) over the tested range with every trade's entry/exit marker. */
export function BacktestChart({ series, result }: { series: BarSeries; result: BacktestResult }) {
  const el = useRef<HTMLDivElement>(null);
  const theme = useApp((s) => s.theme);

  useEffect(() => {
    const root = el.current;
    if (!root) return;
    const css = getComputedStyle(document.documentElement);
    const v = (n: string, f: string) => css.getPropertyValue(n).trim() || f;
    const chart = createChart(root, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: v('--chart-text', '#9d97d0'), fontFamily: 'Nunito, sans-serif', fontSize: 10 },
      grid: { vertLines: { visible: false }, horzLines: { color: v('--chart-grid', 'rgba(176,164,255,0.07)') } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, barSpacing: 3 },
      crosshair: { vertLine: { labelVisible: false } },
    });
    const area = chart.addSeries(AreaSeries, {
      lineColor: '#9b5cff', topColor: 'rgba(155,92,255,0.35)', bottomColor: 'rgba(155,92,255,0)', lineWidth: 2,
      priceLineVisible: false, lastValueVisible: false,
    });
    const bars = series.bars.slice(result.startIndex, result.endIndex + 1);
    area.setData(bars.map((b) => ({ time: ts(b.t), value: b.c })));
    const up = v('--up', '#22d3a6'), down = v('--down', '#ff6a3d');
    const markers: SeriesMarker<Time>[] = [];
    for (const t of result.trades) {
      const long = t.side === 'long';
      markers.push({ time: ts(t.entryT), position: long ? 'belowBar' : 'aboveBar', shape: long ? 'arrowUp' : 'arrowDown', color: long ? up : down, size: 0.8 });
      markers.push({ time: ts(t.exitT), position: 'inBar', shape: 'circle', color: t.pnl >= 0 ? '#ffd23f' : '#7fb2ff', size: 0.5 });
    }
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    createSeriesMarkers(area, markers);
    const n = bars.length;
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 260), to: n + 2 });
    return () => chart.remove();
  }, [series, result, theme]);

  return <div ref={el} className="bt-chart" />;
}
