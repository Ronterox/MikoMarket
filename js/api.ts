import { DataFrame, type Color, type Iter, type Mark, type Position, type Shape } from './types';
import { createChart, CrosshairMode, LineStyle, type LineWidth, type Time } from 'lightweight-charts';
import { loadChart, Sources, TechnicalAnalysis } from './trading';

const PORT = 8080;
const SYMBOL = 'SPY';
const BASE_URL = `http://localhost:${PORT}/api`;

const chart = createChart('chart', {
    autoSize: true,
    grid: {
        horzLines: { color: '#222' },
        vertLines: { color: '#222' }
    },
    layout: {
        background: { color: '#001' },
        textColor: '#ccc'
    },
    localization: {
        priceFormatter: (price: number) => `${price.toFixed(2)}$`,
        timeFormatter: (time: Time) => new Date(time as number).toUTCString(),
    },
    crosshair: {
        mode: CrosshairMode.Normal,

        vertLine: {
            width: 8 as LineWidth,
            color: '#C3BCDB44',
            style: LineStyle.Solid,
            labelBackgroundColor: '#9B7DFF',
        },

        horzLine: {
            color: '#9B7DFF',
            labelBackgroundColor: '#9B7DFF',
        },
    },
    watermark: {
        visible: true,
        text: `${SYMBOL} Miko Market`,
        color: 'rgb(255, 255, 255, 0.2)',
    },
});

const series = chart.addCandlestickSeries({ title: SYMBOL });

(async function() {
    const ta_req = TechnicalAnalysis.promise().parse(
        fetch(BASE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbol: SYMBOL, ta: TechnicalAnalysis.parse({}), src: Sources }),
        }).then(res => res.json())
    );

    const data_req = DataFrame.promise().parse(
        fetch(BASE_URL + `?symbol=${SYMBOL}`).then(res => res.json())
    );

    const [data, ta] = await Promise.all([data_req, ta_req]);
    const zip = <T>(arr: Iter<T>) => data.time.map((t, i) => ({ time: t, ...arr(i) }));

    ta.ema = (src: number[], length: number, start: number): number[] => {
        const ema = Array.from({ length: start }, (_, i) => ta.sma[length][i] ?? 0);
        const multiplier = 2 / (length + 1);

        for (let i = start; i < src.length; i++) {
            ema.push(src[i] * multiplier + ema[Math.max(0, i - 1)] * (1 - multiplier));
        }

        return ema;
    };

    function arrow(text: string, position: Position, color: Color, shape: Shape, time?: Time): Mark {
        return time ? { time, text, position, color, shape } : { text, position, color, shape } as Mark;
    }

    function firstOf(alert: Iter): Mark[] {
        const alerts = zip<Mark>(alert);
        const markers = [];

        const has = (c: any) => c.position;
        const notHas = (c: any) => !c.position;

        let idx = -1, i = 0;
        while ((idx = alerts.findIndex(i % 2 == 0 ? has : notHas)) !== -1) {
            if (i % 2 == 0) markers.push(alerts[idx]);
            alerts.splice(0, idx + 1);
            i++;
        }

        return markers;
    }

    function sortedByTime<T extends { time: Time }>(arr: T[]): T[] {
        return arr.sort((a, b) => new Date(a.time as string).valueOf() - new Date(b.time as string).valueOf())
    }

    const markers = (...arr: Mark[][]) => {
        let allMarks = arr[0];
        for (let i = 1; i < arr.length; i++) {
            allMarks = allMarks.concat(arr[i]);
        }
        series.setMarkers(sortedByTime(allMarks));
    }
    const line = (data: Iter, title: string, lineType: number, color: Color) => chart.addLineSeries({ title, lineType, color }).setData(zip(data));
    const bars = (data: Iter) => series.setData(zip(data));

    return loadChart(data,
        { arrow, zip, firstOf, sortedByTime },
        { line, bars, markers },
        { ...ta }
    );
}())

