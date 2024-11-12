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
    watermark: {
        visible: true,
        text: `${SYMBOL} Miko Market`,
        color: 'rgb(255, 255, 255, 0.2)',
    },
});


const series = chart.addCandlestickSeries({ title: SYMBOL });

type Position = 'aboveBar' | 'belowBar';
type Shape = 'arrowUp' | 'arrowDown';
type Color = string;

type Candle = CandlestickData<Time>;
type Mark = SeriesMarker<Time>;
type Iter<T = any> = (i: number) => T;

interface Functionalities {
    put(cond: boolean): Mark | undefined
    call(cond: boolean): Mark | undefined
    arrow(text: string, position: Position, color: Color, shape: Shape, time?: Time): Mark

    zip<T>(arr: Iter): T[]
    firstOf(alert: Iter): Mark[]
    sortedByTime<T extends { time: Time }>(arr: T[]): T[]
}

const CALL_WIN = 0.05 + 1;
const CALL_LOSS = 1 - 0.05;

const PUT_WIN = 1 - 0.05;
const PUT_LOSS = 0.05 + 1;

function loadChart(
    { open, high, low, close, sma50, sma200 }: DataFrame,
    { call, arrow, put, zip, firstOf, sortedByTime }: Functionalities
) {
    const df = (i: number) => ({ open: open[i], high: high[i], low: low[i], close: close[i] });

    const line200 = (i: number) => ({ value: sma200[i] });
    const line50 = (i: number) => ({ value: sma50[i] });

    const calls = (i: number) => call(sma50[i] > sma200[i]);
    const puts = (i: number) => put(sma50[i] < sma200[i]);

    const wins: Time[] = [];
    const losses: Time[] = [];

    const orderMarks = [] as Mark[];
    const candles = zip<Candle>(df);

    let income = 0;

    const markers = (...arr: Mark[][]) => {
        let allMarks = arr[0];
        for (let i = 1; i < arr.length; i++) {
            allMarks = allMarks.concat(arr[i]);
        }
        series.setMarkers(sortedByTime(allMarks));
    }
    const line = (data: Iter, title: string, lineType: number, color: Color) => chart.addLineSeries({ title, lineType, color }).setData(zip(data));
    const bars = (data: Iter) => series.setData(zip(data));

    function ordersClosure(
        orders: Iter,
        winCond: (c: number, p: number) => boolean,
        lossCond: (c: number, p: number) => boolean,
        winArrow: (time: Time) => Mark,
        lossArrow: (time: Time) => Mark
    ) {
        firstOf(orders).forEach(data => {
            const idx = candles.findIndex(c => c.time === data.time);
            if (idx === -1) return;

            const orderBuy = candles[idx].close;
            for (let i = idx + 1; i < candles.length; i++) {
                const { time, close } = candles[i];

                if (winCond(close, orderBuy)) {
                    income += Math.abs(orderBuy - close);
                    orderMarks.push(winArrow(time));
                    wins.push(time);
                    break;
                }

                if (lossCond(close, orderBuy)) {
                    income -= Math.abs(close - orderBuy);
                    orderMarks.push(lossArrow(time));
                    losses.push(time);
                    break;
                }
            }
        });
    }

    ordersClosure(calls,
        (c, p) => c >= p * CALL_WIN,
        (c, p) => c <= p * CALL_LOSS,
        t => arrow('Call Win', 'aboveBar', '#0f1', 'arrowDown', t),
        t => arrow('Call Loss', 'aboveBar', '#0f1', 'arrowDown', t)
    );

    $('#income').innerHTML = `Calls -> Wins: ${wins.length} (${wins}), Losses:${losses.length} (${losses})`;
    wins.length = losses.length = 0;

    ordersClosure(puts,
        (c, p) => c <= p * PUT_WIN,
        (c, p) => c >= p * PUT_LOSS,
        t => arrow('Put Win', 'aboveBar', '#f01', 'arrowUp', t),
        t => arrow('Put Loss', 'aboveBar', '#f01', 'arrowDown', t)
    );

    $('#income').innerHTML += `<br/>Puts -> Wins: ${wins.length} (${wins}), Losses: ${losses.length} (${losses})`;
    $('#income').innerHTML += `<br/>Income: ${income.toFixed(2)}$`;

    bars(df)

    line(line200, 'SMA 200', 2, '#0A5');
    line(line50, 'SMA 50', 2, '#f05');

    markers(firstOf(calls), firstOf(puts), orderMarks);
}

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

    function call(cond: boolean): SeriesMarker<Time> | undefined {
        if (!cond) return;
        return arrow('Call', 'belowBar', '#0f0', 'arrowUp');
    }

    function put(cond: boolean): SeriesMarker<Time> | undefined {
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

    return loadChart(data, { call, put, arrow, zip, firstOf, sortedByTime });
}())


