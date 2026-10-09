import { useEffect, useRef } from 'react';
import {
  AreaSeries, ColorType, createChart, createSeriesMarkers,
  type SeriesMarker, type Time, type UTCTimestamp,
} from 'lightweight-charts';
import type { BacktestResult, BarSeries } from '@miko/engine';
import { useApp } from '../../state/app.ts';
import { alpha, token } from '../../lib/theme.ts';

const ts = (t: number) => (t / 1000) as UTCTimestamp;

/** Price (area) over the tested range with every trade's entry/exit marker. */
export function BacktestChart({ series, result }: { series: BarSeries; result: BacktestResult }) {
  const el = useRef<HTMLDivElement>(null);
  const theme = useApp((s) => s.theme);

  useEffect(() => {
    const root = el.current;
    if (!root) return;
    const chart = createChart(root, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: token('--chart-text'), fontFamily: 'Nunito, sans-serif', fontSize: 10 },
      grid: { vertLines: { visible: false }, horzLines: { color: token('--chart-grid') } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, barSpacing: 3 },
      crosshair: { vertLine: { labelVisible: false } },
    });
    const area = chart.addSeries(AreaSeries, {
      lineColor: token('--brand'), topColor: alpha(token('--brand'), 0.3), bottomColor: alpha(token('--brand-2'), 0), lineWidth: 2,
      priceLineVisible: false, lastValueVisible: false,
    });
    const bars = series.bars.slice(result.startIndex, result.endIndex + 1);
    area.setData(bars.map((b) => ({ time: ts(b.t), value: b.c })));
    const up = token('--up'), down = token('--down'), info = token('--info');
    const markers: SeriesMarker<Time>[] = [];
    for (const t of result.trades) {
      const long = t.side === 'long';
      markers.push({ time: ts(t.entryT), position: long ? 'belowBar' : 'aboveBar', shape: long ? 'arrowUp' : 'arrowDown', color: long ? up : down, size: 0.8 });
      markers.push({ time: ts(t.exitT), position: 'inBar', shape: 'circle', color: t.pnl >= 0 ? up : info, size: 0.5 });
    }
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    createSeriesMarkers(area, markers);
    const n = bars.length;
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 260), to: n + 2 });
    return () => chart.remove();
  }, [series, result, theme]);

  return <div ref={el} className="bt-chart" />;
}
