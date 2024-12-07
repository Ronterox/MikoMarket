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

    const calls_formula = (pd_candles: number, smi_oversold: number, hanham_body: number) => (i: number) => {
        const lastDay = getDayIdx(i, -1);
        let can_pdh = close[i] <= pdh[lastDay];

        if (!can_pdh) {
            can_pdh = close[max(0, i - pd_candles)] >= pdh[lastDay];
        }

        const smi = smi_top[i] / (0.5 * smi_bot[i]);
        const is_oversold = smi <= smi_oversold;

        const li = max(i - 1, 0);
        const is_red = open[li] > close[li];

        const l_lower_tail = is_red ? close[li] - low[li] : open[li] - low[li];
        const l_body = abs(open[li] - close[li]);

        const l_hammer = l_lower_tail >= l_body * hanham_body;
        const engulfing = abs(close[i] - open[i]) > abs(high[li] - low[li]);

        const lower_bb = ta.sma[20][i] - 2 * ta.stddev[20][i];
        const c_red = open[i] > close[i];

        const is_call = can_pdh && !c_red && is_oversold && low[i] < lower_bb && l_hammer && engulfing;
        return is_call && arrow(`Call (${i})`, 'belowBar', '#0f0', 'arrowUp');
    };

    // const puts_formula = (pd_candles: number, smi_overbought: number, hanham_body: number) => (i: number) => {
    //     const lastDay = getDayIdx(i, -1);
    //     let can_pdl = close[i] >= pdl[lastDay];
    //
    //     if (!can_pdl) {
    //         can_pdl = close[max(0, i - pd_candles)] <= pdl[lastDay];
    //     }
    //
    //     const smi = smi_top[i] / (0.5 * smi_bot[i]);
    //     const is_overbought = smi >= smi_overbought
    //
    //     const li = max(i - 1, 0);
    //     const is_red = open[li] > close[li];
    //
    //     const l_upper_tail = is_red ? high[li] - open[li] : high[li] - close[li];
    //     const l_body = abs(open[li] - close[li]);
    //
    //     const l_hanger = l_upper_tail >= l_body * hanham_body;
    //     const engulfing = abs(close[i] - open[i]) > abs(high[li] - low[li]);
    //
    //     const upper_bb = ta.sma[20][i] + 2 * ta.stddev[20][i];
    //     const c_red = open[i] > close[i];
    //
    //     const is_put = can_pdl && c_red && is_overbought && high[i] > upper_bb && l_hanger && engulfing;
    //     return is_put && arrow(`Put (${i})`, 'aboveBar', '#f00', 'arrowDown');
    // };

    const candles = zip<Candle>(df);

    const size = 24 * 60;
    const dailyCandle: Candle[][] = [];
    for (let i = 0; i < candles.length; i += size) {
        dailyCandle.push(candles.slice(i, i + size));
    }

    const length = dailyCandle.length;
    const getDayIdx = (i: number, di: number = 0) => max(0, min(floor(i / size) % length, length - 1) + di);

    const pdh = dailyCandle.map(d => d.reduce((a, b) => max(a, b.high), 0));
    // const pdl = dailyCandle.map(d => d.reduce((a, b) => min(a, b.low), Infinity));

    function ordersSimulation(
        orders: Iter,
        { budget, max_cost, src, length_limit, leverage }: {
            budget: number, max_cost: number, src: z.infer<typeof Source>,
            length_limit: number, leverage: number
        },
        winCond: CloseCond,
        lossCond: CloseCond,
        exitWinCond: CloseCond,
        winArrow: (time: Time, i: number, p: number) => Mark,
        lossArrow: (time: Time, i: number, p: number) => Mark
    ): [number, number[], number[], Mark[]] {

        const wins: number[] = [];
        const losses: number[] = [];
        const orderMarks = [] as Mark[];

        firstOf(orders).forEach(data => {
            const idx = candles.findIndex(c => c.time === data.time);
            if (idx === -1) return;

            function checkWinLoss(time: Time, close: number, wcond: CloseCond, lcond: CloseCond): boolean {
                if (budget <= 0) return true;

                const orderBuy = candles[idx].close;
                const percentApprox = (abs(orderBuy - close) / orderBuy) * leverage / 0.5;
                const transaction_cost = min(budget, max_cost);

                // 150% == 0.32
                const percent = percentApprox / 0.3
                const commission = 0.02 * transaction_cost;

                if (wcond(close, orderBuy, percent)) {
                    const win = transaction_cost * percent - commission;
                    budget += win;

                    orderMarks.push(winArrow(time, idx, percent));
                    wins.push(win);

                    return true;
                } else if (lcond(close, orderBuy, percent)) {
                    const loss = min(transaction_cost * percent + commission, transaction_cost);
                    budget -= loss;

                    orderMarks.push(lossArrow(time, idx, percent));
                    losses.push(loss);

                    return true;
                }

                return false;
            }

            let i;
            // Skip 1, don't the next one for security
            for (i = idx + 2; i < min(idx + length_limit, candles.length - 1); i++) {
                if (checkWinLoss(candles[i].time, candles[i][src], winCond, lossCond)) return;
            }
            checkWinLoss(candles[i].time, candles[i][src], exitWinCond, () => true);
        });

        return [budget, wins, losses, orderMarks];
    }


    const applyWeights = (xs: number[], ws: number[]) => xs.map((x, i) => relu(ws[i] * x + ws[ws.length - 1]));

    function simulationStep(xs: number[], ws: number[]): [number, number[], number[], Mark[]] {
        const res = applyWeights(xs, ws);

        return ordersSimulation(calls_formula(res[0], res[1], res[2]),
            { budget, max_cost, src: 'high', length_limit: res[5], leverage },
            (c, o, p) => c > o && p >= res[3],
            (c, o, p) => c < o && p >= res[4],
            (c, o, _) => c > o,
            (t, i, p) => arrow(`Call Win (${i}) ${(p * 100).toFixed(2)}%`, 'aboveBar', '#0f9', 'arrowDown', t),
            (t, i, p) => arrow(`Call Loss (${i}) -${(p * 100).toFixed(2)}%`, 'aboveBar', '#0f2', 'arrowDown', t)
        );
    }

    const data = {
        pd_candles: 60,
        // smi_overbought: 0.6
        smi_oversold: -0.6,
        hanham_body: 0.5,

        stop_limit: 0.5,
        stop_loss: 0.2,

        length: 20,
    };

    const checkpoint_name = Object.keys(data).join(',');
    const checkpoint = localStorage.getItem(checkpoint_name);

    const leverage = 50;
    const budget = 1000;
    const max_cost = 1000;
    const train = false;

    let xs = Object.values(data).concat([1]); // Bias
    let ws: number[] = checkpoint ? JSON.parse(checkpoint) : Array.from({ length: xs.length }).map(() => gaussianRandom());

    for (let i = 0; i < 500 && train; i++) {
        const [bestIncome] = simulationStep(xs, ws);

        const cws = ws.map(w => w + gaussianRandom() * 1.0);
        const [income] = simulationStep(xs, cws);

        if (income > bestIncome) {
            ws = cws;
            console.log(
                ...Object.keys(data).map((d, i) => {
                    return { [d]: ws[i] * xs[i] + ws[ws.length - 1] };
                })
            );
        }

        if (i % 10 == 0) {
            localStorage.setItem(checkpoint_name, JSON.stringify(ws));
            console.log(i, income, bestIncome);
        }
    }

    const res = applyWeights(xs, ws);
    const [income, c_wins, c_loss, orderMarks] = simulationStep(xs, ws);

    const stats = (arr: number[]): [number, number, number] => {
        const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
        const max = arr.reduce((a, b) => Math.max(a, b), 0);
        const min = arr.reduce((a, b) => Math.min(a, b), 0);
        return [min, max, avg];
    }

    const [minWin, maxWin, avgWin] = stats(c_wins);
    const [minLoss, maxLoss, avgLoss] = stats(c_loss);

    $('#income').innerHTML = `
    <h2>Budget: ${budget}$,
        L: x${leverage},
        SLimit: ${(res[3] * 100).toFixed(2)}%,
        SLoss: ${(res[4] * 100).toFixed(2)}%
        Length: ${res[5]}
    </h2>
    <span>Calls -> Wins: ${c_wins.length}, Losses: ${c_loss.length}, Winrate: ${winrate(c_wins, c_loss)}</span>
    <br/>
    <span>Total Income: ${income.toFixed(2)}$, Total Winrate: ${winrate(c_wins, c_loss)}</span>
    <br/><br/>
    <span>Max Win: ${maxWin.toFixed(2)}$, Max Loss: -${maxLoss.toFixed(2)}$</span>
    <br/>
    <span>Min Win: ${minWin.toFixed(2)}$, Min Loss: -${minLoss.toFixed(2)}$</span>
    <br/>
    <span>Avg Win: ${avgWin.toFixed(2)}$, Avg Loss: -${avgLoss.toFixed(2)}$</span>
    <br/><br/>
    <span>Total Trades: ${c_wins.length + c_loss.length}</span>
    `;

    // ordersClosure(puts_formula(pd_candles, smi_overbought, hanham_body),
    //     transaction_cost,
    //     'low',
    //     (c, o, p) => c < o && p >= stop_limit,
    //     (c, o, p) => c > o && p >= stop_loss,
    //     (c, o, _) => c < o,
    //     (t, i, p) => arrow(`Put Win (${i}) ${(p * 100).toFixed(2)}%}`, 'aboveBar', '#f09', 'arrowDown', t),
    //     (t, i, p) => arrow(`Put Loss (${i}) -${(p * 100).toFixed(2)}%`, 'aboveBar', '#f02', 'arrowDown', t)
    // );


    // $('#income').innerHTML += `
    // <br/>
    // <span>Puts -> Wins: ${wins.length}, Losses: ${losses.length}, Winrate: ${winrate(w_puts, l_puts)}</span>
    // `;

    bars(df);
    line(toLine(ta.sma[20] as number[]), 'SMA 20', 2, '#0A5');
    markers(firstOf(calls_formula(res[0], res[1], res[2])), orderMarks);
}
