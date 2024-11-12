import type { Time } from 'lightweight-charts';
import type { Candle, DataFrame, Functionalities, GraphicFunctionalities, Iter, Mark } from './types';

const $ = <T = HTMLElement>(query: string) => document.querySelector(query) as T;

const CALL_WIN = 0.05 + 1;
const CALL_LOSS = 1 - 0.05;

const PUT_WIN = 1 - 0.05;
const PUT_LOSS = 0.05 + 1;

export function loadChart(
    { open, high, low, close, sma50, sma200 }: DataFrame,
    { call, arrow, put, zip, firstOf, sortedByTime }: Functionalities,
    { markers, line, bars } : GraphicFunctionalities
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

