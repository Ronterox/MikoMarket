import type { Time } from 'lightweight-charts';
import type { Candle, DataFrame, Functionalities, GraphicFunctionalities, Iter, Mark } from './types';
import { z } from 'zod';

const DataList = z.custom<Record<number, number>>().default({});

export const TechnicalAnalysis = z.object({
    sma: z.object({ 50: DataList, 200: DataList, 20: DataList, 3: DataList }).default({}),
    stddev: z.object({ 20: DataList }).default({}),
    max: z.object({ 10: DataList }).default({}),
    min: z.object({ 10: DataList }).default({}),
});

const Source = z.enum(['close', 'open', 'high', 'low']).default('close');

export const Sources = z.record(TechnicalAnalysis.keyof(), Source).parse({
    sma: 'close',
    stddev: 'close',
    max: 'high',
    min: 'low',
});

type CloseCond = (close: number, orderBuy: number, winPercent: number) => boolean;

const $ = <T = HTMLElement>(query: string) => document.querySelector(query) as T;
const html = (strings: TemplateStringsArray, ...values: any[]) => String.raw({ raw: strings }, ...values);
const { max, min, floor, abs } = Math;

const relu = (x: number) => max(0, x);

let seed = new Date().valueOf();
function random() {
    const x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
}

console.log("Seed", seed);

function gaussianRandom(mean = 0, stdev = 1) {
    const u = 1 - random(); // Converting [0,1) to (0,1]
    const v = random();
    const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    // Transform to the desired mean and standard deviation:
    return z * stdev + mean;
}

function stats(arr: number[]): [number, number, number] {
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    const max = arr.reduce((a, b) => Math.max(a, b), 0);
    const min = arr.reduce((a, b) => Math.min(a, b), 0);
    return [min, max, avg];
}

export function loadChart(
    { open, high, low, close }: z.infer<typeof DataFrame>,
    { arrow, zip, firstOf }: Functionalities,
    { markers, line, bars }: GraphicFunctionalities,
    ta: z.infer<typeof TechnicalAnalysis> & { ema: (src: number[], length: number, start: number) => number[] }
) {
    const df = (i: number) => ({ open: open[i], high: high[i], low: low[i], close: close[i] });
    const toLine = (series: number[]) => (i: number) => ({ value: series[i] });
    const winrate = (a: any[], b: any[]) => ((a.length / (a.length + b.length)) * 100).toFixed(2) + '%';

    const q = 10;
    const avg_top = close.map((c, i) => c - 0.5 * (ta.max[q][i] + ta.min[q][i]))
    const avg_bot = close.map((_, i) => ta.max[q][i] - ta.min[q][i])

    const smi_top = ta.ema(ta.ema(avg_top, 3, q), 3, q);
    const smi_bot = ta.ema(ta.ema(avg_bot, 3, q), 3, q);

    function calls_formula(pd_candles: number, smi_oversold: number, hanham_body: number) {
        return (i: number) => {
            const lastDay = getDayIdx(i, -1);
            let can_pdh = close[i] <= pdh[lastDay];

            if (!can_pdh) {
                can_pdh = close[max(0, min(i - pd_candles, i))] >= pdh[lastDay]; // Always True
            }

            const smi = smi_top[i] / (0.5 * smi_bot[i]);
            const is_oversold = smi <= smi_oversold; // Always True

            const li = max(i - 1, 0);
            const is_red = open[li] > close[li];

            const l_lower_tail = is_red ? close[li] - low[li] : open[li] - low[li];
            const l_body = abs(open[li] - close[li]);

            const l_hammer = l_lower_tail >= l_body * hanham_body; // Always True
            const engulfing = abs(close[i] - open[i]) > abs(high[li] - low[li]);

            const lower_bb = ta.sma[20][i] - 2 * ta.stddev[20][i];
            const c_red = open[i] > close[i];

            const is_call = can_pdh && !c_red && is_oversold && low[i] < lower_bb && l_hammer && engulfing;
            return is_call && arrow(`Call (${i})`, 'belowBar', '#0f0', 'arrowUp');
        };
    }

    function puts_formula(pd_candles: number, smi_overbought: number, hanham_body: number) {
        return (i: number) => {
            const lastDay = getDayIdx(i, -1);
            let can_pdl = close[i] >= pdl[lastDay];

            if (!can_pdl) {
                can_pdl = close[max(0, i - pd_candles)] <= pdl[lastDay];
            }

            const smi = smi_top[i] / (0.5 * smi_bot[i]);
            const is_overbought = smi >= smi_overbought;

            const li = max(i - 1, 0);
            const is_red = open[li] > close[li];

            const l_upper_tail = is_red ? high[li] - open[li] : high[li] - close[li];
            const l_body = abs(open[li] - close[li]);

            const l_hanger = l_upper_tail >= l_body * hanham_body;
            const engulfing = abs(close[i] - open[i]) > abs(high[li] - low[li]);

            const upper_bb = ta.sma[20][i] + 2 * ta.stddev[20][i];
            const c_red = open[i] > close[i];

            const is_put = can_pdl && c_red && is_overbought && high[i] > upper_bb && l_hanger && engulfing;
            return is_put && arrow(`Put (${i})`, 'aboveBar', '#f00', 'arrowDown');
        };
    }

    const candles = zip<Candle>(df);

    const size = 24 * 60;
    const dailyCandle: Candle[][] = [];
    for (let i = 0; i < candles.length; i += size) {
        dailyCandle.push(candles.slice(i, i + size));
    }

    const length = dailyCandle.length;
    const getDayIdx = (i: number, di: number = 0) => max(0, min(floor(i / size) % length, length - 1) + di);

    const pdh = dailyCandle.map(d => d.reduce((a, b) => max(a, b.high), 0));
    const pdl = dailyCandle.map(d => d.reduce((a, b) => min(a, b.low), Infinity));

    function ordersSimulation(
        orders: Iter,
        { budget, src, length_limit, leverage }: {
            budget: number, src: z.infer<typeof Source>,
            length_limit: number, leverage: number
        },
        winCond: CloseCond,
        lossCond: CloseCond,
        exitWinCond: CloseCond,
        winArrow: (time: Time, i: number, p: number) => Mark,
        lossArrow: (time: Time, i: number, p: number) => Mark,
    ): [number, number[], number[], Mark[]] {

        const wins: number[] = [];
        const losses: number[] = [];
        const orderMarks = [] as Mark[];
        const initialBudget = budget;

        firstOf(orders).forEach(data => {
            const idx = candles.findIndex(c => c.time === data.time);
            if (idx === -1) return;

            function checkWinLoss(time: Time, close: number, wcond: CloseCond, lcond: CloseCond): boolean {
                if (budget <= 0) return true;
                // TODO: Fix inconsistencies between close and high/low for calculating

                const orderBuy = candles[idx].close;
                const percentApprox = (abs(orderBuy - close) / orderBuy) * leverage / 0.5;
                const transaction_cost = budget * 0.2;

                // 150% == 0.32
                const percent = percentApprox / 0.3
                const commission = 0.02 * transaction_cost;

                if (wcond(close, orderBuy, percent)) {
                    const win = transaction_cost * percent - commission;

                    if (should_print) console.log('Budget:', floor(budget), ', Won:', floor(win));

                    budget += win;

                    orderMarks.push(winArrow(time, idx, percent));
                    wins.push(win);

                    return true;
                } else if (lcond(close, orderBuy, percent) || percent >= 1) {
                    const loss = transaction_cost * percent + commission;

                    if (should_print) console.log('Budget:', floor(budget), ', Loss:', floor(loss));

                    budget = max(0, budget - loss);

                    orderMarks.push(lossArrow(time, idx, percent));
                    losses.push(loss);

                    return true;
                }

                return false;
            }

            let i;
            // Skip 1, don't the next one for security
            for (i = idx + 1; i < min(idx + length_limit, candles.length - 1); i++) {
                if (checkWinLoss(candles[i].time, candles[i][src], winCond, lossCond)) return;
            }
            checkWinLoss(candles[i].time, candles[i][src], exitWinCond, () => true);
        });


        return [max(0, budget - initialBudget), wins, losses, orderMarks];
    }


    const applyWeights = (xs: number[], ws: number[]) => xs.map((x, i) => relu(ws[i] * x + ws[ws.length - 1]));

    function simulationStepCall(xs: number[], ws: number[]): [number, number[], number[], Mark[]] {
        const res = applyWeights(xs, ws);

        return ordersSimulation(calls_formula(res[0], res[1], res[2]),
            { budget, src: 'high', length_limit: res[5], leverage },
            (c, o, p) => c > o && p >= res[3],
            (c, o, p) => c < o && p >= res[4],
            (c, o, _) => c > o,
            (t, i, p) => arrow(`Call Win (${i}) ${(p * 100).toFixed(2)}%`, 'aboveBar', '#0f9', 'arrowDown', t),
            (t, i, p) => arrow(`Call Loss (${i}) -${(p * 100).toFixed(2)}%`, 'aboveBar', '#0f2', 'arrowDown', t)
        );
    }

    function simulationStepPut(xs: number[], ws: number[]): [number, number[], number[], Mark[]] {
        const res = applyWeights(xs, ws);

        return ordersSimulation(puts_formula(res[0], res[1], res[2]),
            { budget, src: 'low', length_limit: res[5], leverage },
            (c, o, p) => c < o && p >= res[3],
            (c, o, p) => c > o && p >= res[4],
            (c, o, _) => c < o,
            (t, i, p) => arrow(`Put Win (${i}) ${(p * 100).toFixed(2)}%}`, 'aboveBar', '#f09', 'arrowDown', t),
            (t, i, p) => arrow(`Put Loss (${i}) -${(p * 100).toFixed(2)}%`, 'aboveBar', '#f02', 'arrowDown', t)
        );
    }

    function training(
        data: Object,
        simulationStep: (xs: number[], ws: number[]) => [number, number[], number[], Mark[]],
        epochs: number,
        train: boolean
    ): [number[], number[]] {
        const checkpoint_name = Object.keys(data).join(',');
        const checkpoint = localStorage.getItem(checkpoint_name);

        let xs: number[] = Object.values(data).concat([1]); // Bias
        let ws: number[] = checkpoint ? JSON.parse(checkpoint) : Array.from({ length: xs.length }, () => gaussianRandom())

        for (let i = 1; i <= epochs && train; i++) {
            const [bestIncome, _bWs] = simulationStep(xs, ws);

            const cws = ws.map(w => w + gaussianRandom() * 1.0);
            const [income, _Ws] = simulationStep(xs, cws);

            if (income > bestIncome) {
                ws = cws;
                console.log(
                    ...Object.keys(data_call).map((d, i) => {
                        return { [d]: ws[i] * xs[i] + ws[ws.length - 1] };
                    })
                );
            }

            if (i % 10 == 0) {
                localStorage.setItem(checkpoint_name, JSON.stringify(ws));
                console.log(i, income, bestIncome);
            }
        }

        return [xs, ws];
    }

    function getTrainingResults(
        name: string,
        data: Object,
        train: boolean,
        simulationStep: (xs: number[], ws: number[]) => [number, number[], number[], Mark[]]): [string, number[], number[], Mark[]] {
        const [xs, ws] = training(data, simulationStep, 200, train);
        // const ws = Array.from({ length: xs.length }, () => 1).concat([0]);

        console.log(...Object.keys(data_call).map((d, i) => {
            return { [d]: ws[i] * xs[i] + ws[ws.length - 1] };
        }));

        const res = applyWeights(xs, ws);
        const [income, wins, loss, orderMarks] = simulationStep(xs, ws);

        const [_minWin, maxWin, avgWin] = stats(wins);
        const [_minLoss, maxLoss, avgLoss] = stats(loss);

        const statsHtml = html`
        <summary>${name}</summary>
        <span>
            Budget: ${budget}$,
            L: x${leverage},
            SLimit: ${(res[3] * 100).toFixed(2)}%,
            SLoss: ${(res[4] * 100).toFixed(2)}%
            Length: ${res[5]}
        </span>
        <span>Wins: ${wins.length}, Losses: ${loss.length}, Winrate: ${winrate(wins, loss)}</span>
        <br/>
        <span>Income: ${income.toFixed(2)}$, Total Winrate: ${winrate(wins, loss)}</span>
        <br/><br/>
        <span>Max Win: ${maxWin.toFixed(2)}$, Max Loss: -${maxLoss.toFixed(2)}$</span>
        <br/>
        <span>Avg Win: ${avgWin.toFixed(2)}$, Avg Loss: -${avgLoss.toFixed(2)}$</span>
        <br/><br/>
        <span>Total Trades: ${wins.length + loss.length}</span>
        `;

        return [statsHtml, xs, ws, orderMarks];
    }

    const leverage = 50;
    const budget = 5000;

    const data_call = {
        pd_candles: 60,
        smi_oversold: -0.6,
        hanham_body: 0.5,

        stop_limit: 0.5,
        stop_loss: 0.2,

        length: 20,
    };

    const data_put = {
        pd_candles: 60,
        smi_overbought: 0.6,
        hanham_body: 0.5,

        stop_limit: 0.5,
        stop_loss: 0.2,

        length: 20,
    };

    const should_print = true;

    const [callStats, xsCall, wsCall, calls] = getTrainingResults('Calls', data_call, false, simulationStepCall);
    const [putStats, xsPut, wsPut, puts] = getTrainingResults('Puts', data_put, false, simulationStepPut);

    $('#income').innerHTML = html`
        <details>${callStats}</details>
        <br/>
        <details>${putStats}</details>
    `;

    const resCall = applyWeights(xsCall, wsCall);
    const resPut = applyWeights(xsPut, wsPut);

    bars(df);
    line(toLine(ta.sma[20] as number[]), 'SMA 20', 2, '#0A5');
    markers(
        firstOf(calls_formula(resCall[0], resCall[1], resCall[2])),
        calls,
        firstOf(puts_formula(resPut[0], resPut[1], resPut[2])),
        puts
    );
}
