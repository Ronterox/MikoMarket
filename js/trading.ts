import { createChart, CrosshairMode, LineStyle, type CandlestickData, type LineData, type LineWidth, type SeriesMarker, type Time } from 'lightweight-charts';

const $ = <T = HTMLElement>(query: string) => document.querySelector(query) as T;

const PORT = 8080;
const SYMBOL = 'AAPL';
const BASE_URL = `http://localhost:${PORT}/api?symbol=${SYMBOL}`;

type DataFrame = {
    time: Time[];
    open: number[];
    high: number[];
    low: number[];
    close: number[];
}
    &
{
    sma50: number[];
    sma200: number[]
};

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

interface Functionalities {
    put(cond: boolean): SeriesMarker<Time> | undefined
    call(cond: boolean): SeriesMarker<Time> | undefined
    arrow(text: string, position: 'aboveBar' | 'belowBar', color: string, shape: 'arrowUp' | 'arrowDown'): SeriesMarker<Time>

    zip<T>(arr: (i: number) => T | any): T[]
    firstOf<T>(alert: (i: number) => T): SeriesMarker<Time>[]
}

const CALL_WIN = 0.05 + 1;
const CALL_LOSS = 1 - 0.05;

const PUT_WIN = 1 - 0.05;
const PUT_LOSS = 0.05 + 1;

function loadChart(
    { open, high, low, close, sma50, sma200 }: DataFrame,
    { call, arrow, put, zip, firstOf }: Functionalities
) {
    const df = (i: number) => ({ open: open[i], high: high[i], low: low[i], close: close[i] });

    const line200 = (i: number) => ({ value: sma200[i] });
    const line50 = (i: number) => ({ value: sma50[i] });

    const calls = (i: number) => call(sma50[i] > sma200[i]);
    const puts = (i: number) => put(sma50[i] < sma200[i]);

    const wins: Time[] = [];
    const losses: Time[] = [];
    let income = 0;

    firstOf(calls).filter(c => c.position).forEach(data => {
        const candles = zip<CandlestickData<Time>>(df);
        const idx = candles.findIndex(c => c.time === data.time);
        if (idx === -1) return;

        const candleClose = candles[idx].close;
        for (let i = idx + 1; i < candles.length; i++) {
            const { time, close } = candles[i];

            if (close >= candleClose * CALL_WIN) {
                income += close - candleClose;
                wins.push(time);
                return;
            }

            if (close <= candleClose * CALL_LOSS) {
                income += candleClose - close;
                losses.push(time);
                return;
            }
        }
    });

    $('#income').innerHTML = `Calls -> Wins: ${wins.length} (${wins}), Losses:${losses.length} (${losses})`;

    wins.length = losses.length = 0;

    firstOf(puts).filter(c => c.position).forEach(data => {
        const candles = zip<CandlestickData<Time>>(df);
        const idx = candles.findIndex(c => c.time === data.time);
        if (idx === -1) return;

        const candleClose = candles[idx].close;
        for (let i = idx + 1; i < candles.length; i++) {
            const { time, close } = candles[i];

            if (close <= candleClose * PUT_WIN) {
                income += candleClose - close;
                wins.push(time);
                return;
            }

            if (close >= candleClose * PUT_LOSS) {
                income += close - candleClose;
                losses.push(time);
                return;
            }
        }
    });

    $('#income').innerHTML += `<br/>Puts -> Wins: ${wins.length} (${wins}), Losses:${losses.length} (${losses})`;
    $('#income').innerHTML += `<br/>Income: ${income.toFixed(2)}$`;

    // TODO: bars
    const series = chart.addCandlestickSeries({ title: SYMBOL });
    series.applyOptions({
        wickUpColor: 'rgb(54, 116, 217)',
        upColor: 'rgb(54, 116, 217)',
        wickDownColor: 'rgb(225, 50, 85)',
        downColor: 'rgb(225, 50, 85)',
        borderVisible: false,
    });
    series.setData(zip(df) as CandlestickData<Time>[]);

    // TODO: alert
    series.setMarkers(firstOf(calls).concat(firstOf(puts)));

    // TODO: line
    chart.addLineSeries({ title: 'SMA 200', lineType: 2, color: '#0A5' }).setData(zip(line200) as LineData<Time>[]);
    chart.addLineSeries({ title: 'SMA 50', lineType: 2, color: '#f05' }).setData(zip(line50) as LineData<Time>[]);
}

(async function() {
    const res = await fetch(BASE_URL);
    if (!res.ok) {
        console.error(res);
        return;
    }

    const data: DataFrame = await res.json().catch(console.error);
    const zip = <T>(arr: (i: number) => T) => data.time.map((t, i) => ({ time: t, ...arr(i) }));

    function arrow(text: string, position: 'aboveBar' | 'belowBar', color: string, shape: 'arrowUp' | 'arrowDown') {
        return { text, position, color, shape } as SeriesMarker<Time>;
    }

    function call(cond: boolean): SeriesMarker<Time> | undefined {
        if (!cond) return;
        return arrow('Call', 'belowBar', '#0f0', 'arrowUp');
    }

    function put(cond: boolean): SeriesMarker<Time> | undefined {
        if (!cond) return;
        return arrow('Put', 'aboveBar', '#f00', 'arrowDown');
    }

    function firstOf<T>(alert: (i: number) => T): SeriesMarker<Time>[] {
        const alerts = zip(alert) as unknown as SeriesMarker<Time>[];
        const markers = [];

        const has = (c: any) => c.position;
        const notHas = (c: any) => !c.position;

        let idx = -1, i = 0;
        while ((idx = alerts.findIndex(i % 2 == 0 ? has : notHas)) !== -1) {
            i = markers.push(alerts[idx]);
            alerts.splice(0, idx + 1);
        }

        return markers;
    }

    return loadChart(data, { call, put, arrow, zip, firstOf });
}())


