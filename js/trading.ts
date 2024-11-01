import { createChart, CrosshairMode, LineStyle, type BarData, type LineWidth, type SeriesMarker, type Time } from 'lightweight-charts';
import ta from './ta';

const $ = <T = HTMLElement>(query: string) => document.querySelector(query) as T;

$('#income').innerHTML = `Income: 985`;

const PORT = 8080;
const SYMBOL = 'AAPL';
const BASE_URL = `http://localhost:${PORT}/api?symbol=${SYMBOL}`;

type Optional<T> = T | undefined;

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
});

// 2% is 20% for us
const LOSS = 0.02;
const WIN = 0.02;

(async function() {
    const res = await fetch(BASE_URL);
    if (!res.ok) {
        console.error(res);
        return;
    }

    const data: Data = await res.json().catch(console.error);

    const df = data.results.map(result => ({
        time: new Date(result.t).toString(),
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

    const series = chart.addCandlestickSeries({ title: data.ticker });
    series.setData(df);
    series.applyOptions({
        wickUpColor: 'rgb(54, 116, 217)',
        upColor: 'rgb(54, 116, 217)',
        wickDownColor: 'rgb(225, 50, 85)',
        downColor: 'rgb(225, 50, 85)',
        borderVisible: false,
    });

    function call(cond: boolean, time: Time): Optional<SeriesMarker<Time>> {
        if (!cond) return;
        return { time, position: 'belowBar', color: '#0f0', shape: 'arrowUp', text: 'Call' };
    }

    function put(cond: boolean, time: Time): Optional<SeriesMarker<Time>> {
        if (!cond) return;
        return { time, position: 'aboveBar', color: '#f00', shape: 'arrowDown', text: 'Put' };
    }

    function setMarkers(markers: Optional<SeriesMarker<Time>>[]) {
        const checkCondition = (m: Optional<SeriesMarker<Time>>, i: number) => m && !markers[Math.max(0, i - 1)];
        series.setMarkers(markers.filter(checkCondition) as SeriesMarker<Time>[]);
    }

    const range = <T>(n: number, evaluate: (i: number) => T) => Array.from({ length: n }, (_, i) => evaluate(i));

    const calls = range(df.length, i => call(sma50[i] > sma200[i], time[i]));
    const puts = range(df.length, i => put(sma50[i] < sma200[i], time[i]));

    const buys = calls.filter((m, i) => m && !calls[Math.max(0, i - 1)]) as SeriesMarker<Time>[];
    const sells = puts.filter((m, i) => m && !puts[Math.max(0, i - 1)]) as SeriesMarker<Time>[];

    const { income, wins, losses } = df.reduce(({ income, curr: { method, price }, wins, losses }, d) => {
        if (method) {
            const gains = method === 'call' ? d.close - price : price - d.close;
            const limit_hit = gains >= price * WIN || gains <= price * LOSS;

            if (limit_hit) {
                method = '';
                income += gains * +limit_hit;
                wins += +(gains > 0);
                losses += +(gains <= 0);
            }

            return { income, curr: { method, price }, wins, losses };
        }

        const call = buys.find(m => m && m.time === d.time);
        const put = sells.find(m => m && m.time === d.time);

        let curr;
        if (call) {
            curr = { method: 'call', price: d.close };
        } else if (put) {
            curr = { method: 'put', price: d.close };
        } else {
            curr = { method: '', price: 0 };
        }

        return { income, curr, wins, losses };
    }, { income: 0, curr: { method: '', price: 0 }, wins: 0, losses: 0 });

    $('#income').innerHTML = `Income: ${income.toFixed(2)}, Wins: ${wins}, Losses: ${losses}`;

    // setMarkers([...calls, ...puts]);
    series.setMarkers([...buys]);

    chart.addLineSeries({ title: 'SMA 200', lineType: 2, color: '#0f0' }).setData(line200);
    chart.addLineSeries({ title: 'SMA 50', lineType: 2, color: '#f00' }).setData(line50);
}())


