import { createChart, CrosshairMode, LineStyle, type LineWidth, type Time } from 'lightweight-charts';
import { loadChart } from './trading';
import type { Color, DataFrame, Iter, Mark, Position, Shape } from './types';

const PORT = 8080;
const SYMBOL = 'AAPL';
const BASE_URL = `http://localhost:${PORT}/api?symbol=${SYMBOL}`;

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
    const res = await fetch(BASE_URL);
    if (!res.ok) {
        console.error(res);
        return;
    }

    const data: DataFrame = await res.json().catch(console.error);
    const zip = <T>(arr: Iter<T>) => data.time.map((t, i) => ({ time: t, ...arr(i) }));

    function arrow(text: string, position: Position, color: Color, shape: Shape, time?: Time): Mark {
        return time ? { time, text, position, color, shape } : { text, position, color, shape } as Mark;
    }

    function call(cond: boolean): Mark | undefined {
        if (!cond) return;
        return arrow('Call', 'belowBar', '#0f0', 'arrowUp');
    }

    function put(cond: boolean): Mark | undefined {
        if (!cond) return;
        return arrow('Put', 'aboveBar', '#f00', 'arrowDown');
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

    return loadChart(data, { call, put, arrow, zip, firstOf, sortedByTime }, { line, bars, markers });
}())

