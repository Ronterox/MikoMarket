import { createChart, type BarData, type Time } from 'lightweight-charts';
import ta from './ta';

const PORT = 8080;
const SYMBOL = 'AAPL';
const BASE_URL = `http://localhost:${PORT}/api?symbol=${SYMBOL}`;

interface Result {
    v: number;  // volume
    vw: number; // volume-weighted
    o: number;  // open
    c: number;  // close
    h: number;  // high
    l: number;  // low
    t: number;  // time
    n: number;  // number of trades
}

interface Data {
    ticker: string;
    queryCount: number;
    resultsCount: number;
    adjusted: boolean;
    results: Result[];
    status: string;
    request_id: string;
    count: number;
}

const chart = createChart('chart', {
    width: 700, height: 500,
    autoSize: true,
    grid: {
        horzLines: { color: '#222' },
        vertLines: { color: '#222' }
    },
    layout: {
        background: { color: '#001' },
        textColor: '#ccc'
    }
});

(async function() {
    const res = await fetch(BASE_URL);
    if (!res.ok) {
        console.error(res);
        return;
    }

    const data: Data = await res.json().catch(console.error);

    const df = data.results.map(result => ({
        time: result.t,
        open: result.o,
        high: result.h,
        low: result.l,
        close: result.c
    })) as BarData<Time>[];

    const close = df.map(d => d.close);
    const time = df.map(d => d.time);

    const sma200 = ta.SMA(close, 200);
    const sma50 = ta.SMA(close, 50);

    const line200 = time.map((t, i) => ({ time: t, value: sma200[i] }));
    const line50 = time.map((t, i) => ({ time: t, value: sma50[i] }));

    chart.addCandlestickSeries({ title: data.ticker }).setData(df);
    chart.addLineSeries({ title: 'SMA 200', lineType: 1, color: '#0f0' }).setData(line200);
    chart.addLineSeries({ title: 'SMA 50', lineType: 2, color: '#f00' }).setData(line50);
}())


