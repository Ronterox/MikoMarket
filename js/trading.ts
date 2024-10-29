import { ColorType, createChart, type BarData, type Time } from 'lightweight-charts';

const PORT = 8080;
const SYMBOL = 'AAPL';
const BASE_URL = `http://localhost:${PORT}/api?symbol=${SYMBOL}`;

interface Result {
    v: number;
    vw: number;
    o: number;
    c: number;
    h: number;
    l: number;
    t: number;
    n: number;
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

    chart.addCandlestickSeries({
        title: data.ticker,
    }).setData(df);
}())


