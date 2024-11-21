import type { Time } from 'lightweight-charts';
import type { Candle, DataFrame, Functionalities, GraphicFunctionalities, Iter, Mark } from './types';

const $ = <T = HTMLElement>(query: string) => document.querySelector(query) as T;

export class TechnicalAnalysis {
    sma = { 50: [0], 200: [0], 20: [0] }
    stdev = { 20: [0] }
}

export function loadChart(
    { open, high, low, close }: DataFrame,
    { arrow, zip, firstOf, sortedByTime }: Functionalities,
    { markers, line, bars }: GraphicFunctionalities,
    ta: TechnicalAnalysis
) {
    function call(cond: boolean, i: number): Mark | undefined {
        if (!cond) return;
        return arrow(`Call ${i}`, 'belowBar', '#0f0', 'arrowUp');
    }

    function put(cond: boolean, i: number): Mark | undefined {
        if (!cond) return;
        return arrow(`Put ${i}`, 'aboveBar', '#f00', 'arrowDown');
    }

    const df = (i: number) => ({ open: open[i], high: high[i], low: low[i], close: close[i] });

    const line200 = (i: number) => ({ value: ta.sma[200][i] });
    const line50 = (i: number) => ({ value: ta.sma[50][i] });

    const calls_sma = (i: number) => call(ta.sma[50][i] > ta.sma[200][i], i);
    const puts_sma = (i: number) => put(ta.sma[50][i] < ta.sma[200][i], i);

    const dist = (a: number, b: number) => Math.abs(a - b);

    const calls_ham_eng = (i: number) => {
        const percentage = 0.5;
        // TODO: should probably reverse so that you don't have to do Math.max(-1)
        // or modify access of close, high, open, low
        const li = Math.max(i - 1, 0);
        const is_red = open[li] > close[li];

        const l_lower_tail = is_red ? close[li] - low[li] : open[li] - low[li];
        const l_body = dist(open[i], close[i]);

        const l_hammer = l_lower_tail >= l_body * percentage;
        const engulfing = dist(close[i], open[i]) > dist(high[li], low[li]);

        return call(l_hammer && engulfing, i);
    };

    const puts_han_eng = (i: number) => {
        const percentage = 0.5;
        const li = Math.max(i - 1, 0);
        const is_red = open[li] > close[li];

        const l_upper_tail = is_red ? high[li] - open[li] : high[li] - close[li];
        const l_body = dist(open[i], close[i]);

        const l_hanger = l_upper_tail >= l_body * percentage;
        const engulfing = dist(close[i], open[i]) > dist(high[li], low[li]);

        return put(l_hanger && engulfing, i);
    };

    // const [calls, puts] = [calls_sma, puts_sma]
    const [calls, puts] = [calls_ham_eng, puts_han_eng];

    const wins: Time[] = [];
    const losses: Time[] = [];

    const orderMarks = [] as Mark[];
    const candles = zip<Candle>(df);

    let income = 0;

    function ordersClosure(
        orders: Iter,
        winCond: (close: number, orderBuy: number) => boolean,
        winArrow: (time: Time, i: number) => Mark,
        lossArrow: (time: Time, i: number) => Mark
    ) {
        firstOf(orders).forEach(data => {
            const idx = candles.findIndex(c => c.time === data.time);
            if (idx === -1) return;

            const orderBuy = candles[idx].close;
            const length = 5;

            let i;
            for (i = idx + 1; i < Math.min(idx + length, candles.length); i++) {
                const { time, close } = candles[i];

                if (winCond(close, orderBuy)) {
                    income += Math.abs(orderBuy - close);
                    orderMarks.push(winArrow(time, idx));
                    wins.push(time);
                    return;
                }

            }

            const { time, close } = candles[i];
            income -= Math.abs(close - orderBuy);
            orderMarks.push(lossArrow(time, idx));
            losses.push(time);
        });
    }

    ordersClosure(calls,
        (c, o) => c > o,
        (t, i) => arrow(`Call Win ${i}`, 'aboveBar', '#0f9', 'arrowDown', t),
        (t, i) => arrow(`Call Loss ${i}`, 'aboveBar', '#0f2', 'arrowDown', t)
    );

    $('#income').innerHTML = `Calls -> Wins: ${wins.length}, Losses: ${losses.length}`;

    wins.length = losses.length = 0;

    ordersClosure(puts,
        (c, o) => c < o,
        (t, i) => arrow(`Put Win ${i}`, 'aboveBar', '#f09', 'arrowDown', t),
        (t, i) => arrow(`Put Loss ${i}`, 'aboveBar', '#f02', 'arrowDown', t)
    );

    $('#income').innerHTML += `<br/>Puts -> Wins: ${wins.length}, Losses: ${losses.length}`;
    $('#income').innerHTML += `<br/>Income: ${income.toFixed(2)}$, Winrate: ${(wins.length / (wins.length + losses.length) * 100).toFixed(2)}%`;

    bars(df)

    line(line200, 'SMA 200', 2, '#0A5');
    line(line50, 'SMA 50', 2, '#f05');

    markers(firstOf(calls), firstOf(puts), orderMarks);
}

