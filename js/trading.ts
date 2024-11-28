import type { Time } from 'lightweight-charts';
import type { Candle, DataFrame, Functionalities, GraphicFunctionalities, Iter, Mark } from './types';
import { z } from 'zod';

const $ = <T = HTMLElement>(query: string) => document.querySelector(query) as T;
const { max, min, floor, abs } = Math;

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

export function loadChart(
    { open, high, low, close }: z.infer<typeof DataFrame>,
    { arrow, zip, firstOf }: Functionalities,
    { markers, line, bars }: GraphicFunctionalities,
    ta: z.infer<typeof TechnicalAnalysis>
) {
    function toCall(cond: boolean, i: number): Mark | undefined {
        if (!cond) return;
        return arrow(`Call (${i})`, 'belowBar', '#0f0', 'arrowUp');
    }

    function toPut(cond: boolean, i: number): Mark | undefined {
        if (!cond) return;
        return arrow(`Put (${i})`, 'aboveBar', '#f00', 'arrowDown');
    }

    const df = (i: number) => ({ open: open[i], high: high[i], low: low[i], close: close[i] });
    const toLine = (series: number[]) => (i: number) => ({ value: series[i] });

    const winrate = (a: any[], b: any[]) => ((a.length / (a.length + b.length)) * 100).toFixed(2) + '%';

    const ta_ema = (src: number[], length: number, start: number): number[] => {
        const ema = Array.from({ length: start }, (_, i) => ta.sma[length][i] ?? 0);
        const multiplier = 2 / (length + 1);

        for (let i = start; i < src.length; i++) {
            ema.push(src[i] * multiplier + ema[max(0, i - 1)] * (1 - multiplier));
        }

        return ema;
    };

    const q = 10;
    const avg_top = close.map((c, i) => c - 0.5 * (ta.max[q][i] + ta.min[q][i]))
    const avg_bot = close.map((_, i) => ta.max[q][i] - ta.min[q][i])

    const smi_top = ta_ema(ta_ema(avg_top, 3, q), 3, q);
    const smi_bot = ta_ema(ta_ema(avg_bot, 3, q), 3, q);

    const calls_bb_ham_engulfing = (i: number) => {
        const lastDay = getDayIdx(i, -1);
        let can_pdh = close[i] <= pdh[lastDay];

        if (!can_pdh) {
            can_pdh = close[max(0, i - 60)] >= pdh[lastDay];
        }
        // const can_pdh = true;

        const smi = smi_top[i] / (0.5 * smi_bot[i]);
        const oversold = -0.6;
        const is_oversold = smi <= oversold;
        // const is_oversold = true;

        const percentage = 0.5;
        const li = max(i - 1, 0);
        const is_red = open[li] > close[li];

        const l_lower_tail = is_red ? close[li] - low[li] : open[li] - low[li];
        const l_body = abs(open[li] - close[li]);

        const l_hammer = l_lower_tail >= l_body * percentage;
        const engulfing = abs(close[i] - open[i]) > abs(high[li] - low[li]);

        const lower_bb = ta.sma[20][i] - 2 * ta.stddev[20][i];
        const c_red = open[i] > close[i];

        return toCall(can_pdh && !c_red && is_oversold && low[i] < lower_bb && l_hammer && engulfing, i);
    };

    const puts_bb_han_engulfing = (i: number) => {
        const lastDay = getDayIdx(i, -1);
        let can_pdl = close[i] >= pdl[lastDay];

        if (!can_pdl) {
            // can_pdl = close[max(0, i - 60)] <= pdl[lastDay];
        }
        // const can_pdl = true;

        const smi = smi_top[i] / (0.5 * smi_bot[i]);
        const overbought = 0.6
        const is_overbought = smi >= overbought
        // const is_overbought = true;

        const percentage = 0.5;
        const li = max(i - 1, 0);
        const is_red = open[li] > close[li];

        const l_upper_tail = is_red ? high[li] - open[li] : high[li] - close[li];
        const l_body = abs(open[li] - close[li]);

        const l_hanger = l_upper_tail >= l_body * percentage;
        const engulfing = abs(close[i] - open[i]) > abs(high[li] - low[li]);

        const upper_bb = ta.sma[20][i] + 2 * ta.stddev[20][i];
        const c_red = open[i] > close[i];

        return toPut(can_pdl && c_red && is_overbought && high[i] > upper_bb && l_hanger && engulfing, i);
    };

    const wins: Time[] = [];
    const losses: Time[] = [];

    const orderMarks = [] as Mark[];
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

    const [calls, puts] = [calls_bb_ham_engulfing, puts_bb_han_engulfing];

    // 0.5 == xN / 10

    const transaction_cost = 1000;
    const commission = 0.02 * transaction_cost;
    const leverage = 50;

    const stop_limit = 0.2;
    const stop_loss = 0.2;
    const length_limit = 20;

    $('#income').innerHTML = `
    <h2>TC: ${transaction_cost}$,
        C: ${commission}$,
        L: x${leverage},
        SLimit: ${stop_limit * 100}%,
        SLoss: ${stop_loss * 100}%
        Length: ${length_limit}
    </h2>`;

    let maxWin = 0;
    let maxLoss = 0;
    let minWin = Infinity;
    let minLoss = Infinity;
    let income = 0;

    function ordersClosure(
        orders: Iter,
        src: z.infer<typeof Source>,
        winCond: CloseCond,
        lossCond: CloseCond,
        exitWinCond: CloseCond,
        winArrow: (time: Time, i: number, p: number) => Mark,
        lossArrow: (time: Time, i: number, p: number) => Mark
    ) {
        firstOf(orders).forEach(data => {
            const idx = candles.findIndex(c => c.time === data.time);
            if (idx === -1) return;

            function checkWinLoss(time: Time, close: number, wcond: CloseCond, lcond: CloseCond): boolean {
                const orderBuy = candles[idx].close;
                const percentApprox = (abs(orderBuy - close) / orderBuy) * leverage / 0.5;

                // 150% == 0.32
                const percent = percentApprox / 0.3

                if (wcond(close, orderBuy, percent)) {
                    const win = transaction_cost * percent - commission;
                    income += win;

                    maxWin = max(maxWin, win);
                    minWin = min(minWin, win);

                    orderMarks.push(winArrow(time, idx, percent));
                    wins.push(time);

                    return true;
                } else if (lcond(close, orderBuy, percent)) {
                    const loss = transaction_cost * percent + commission;
                    income -= loss;

                    minLoss = min(minLoss, loss);
                    maxLoss = max(maxLoss, loss);

                    orderMarks.push(lossArrow(time, idx, percent));
                    losses.push(time);

                    return true;
                }

                return false;
            }

            let i;
            for (i = idx + 1; i < min(idx + length_limit, candles.length); i++) {
                if (checkWinLoss(candles[i].time, candles[i][src], winCond, lossCond)) return;
            }
            checkWinLoss(candles[i].time, candles[i][src], exitWinCond, () => true);
        });
    }

    ordersClosure(calls,
        'high',
        (c, o, p) => c > o && p >= stop_limit,
        (c, o, p) => c < o && p >= stop_loss,
        (c, o, _) => c > o,
        (t, i, p) => arrow(`Call Win (${i}) ${(p * 100).toFixed(2)}%`, 'aboveBar', '#0f9', 'arrowDown', t),
        (t, i, p) => arrow(`Call Loss (${i}) -${(p * 100).toFixed(2)}%`, 'aboveBar', '#0f2', 'arrowDown', t)
    );

    const w_calls = Array.from(wins);
    const l_calls = Array.from(losses);

    $('#income').innerHTML += `
    <span>Calls -> Wins: ${wins.length}, Losses: ${losses.length}, Winrate: ${winrate(w_calls, l_calls)}</span>
    `;

    wins.length = losses.length = 0;

    ordersClosure(puts,
        'low',
        (c, o, p) => c < o && p >= stop_limit,
        (c, o, p) => c > o && p >= stop_loss,
        (c, o, _) => c < o,
        (t, i, p) => arrow(`Put Win (${i}) ${(p * 100).toFixed(2)}%}`, 'aboveBar', '#f09', 'arrowDown', t),
        (t, i, p) => arrow(`Put Loss (${i}) -${(p * 100).toFixed(2)}%`, 'aboveBar', '#f02', 'arrowDown', t)
    );

    const w_puts = Array.from(wins);
    const l_puts = Array.from(losses);

    const t_wins = w_calls.concat(w_puts);
    const t_losses = l_calls.concat(l_puts);

    $('#income').innerHTML += `
    <br/>
    <span>Puts -> Wins: ${wins.length}, Losses: ${losses.length}, Winrate: ${winrate(w_puts, l_puts)}</span>
    <br/>
    <span>Total Income: ${income.toFixed(2)}$, Total Winrate: ${winrate(t_wins, t_losses)}</span>
    <br/><br/>
    <span>Max Win: ${maxWin.toFixed(2)}$, Min Win: ${minWin.toFixed(2)}$</span>
    <br/>
    <span>Max Loss: -${maxLoss.toFixed(2)}$, Min Loss: -${minLoss.toFixed(2)}$</span>
    <br/><br/>
    <span>Total Trades: ${t_wins.length + t_losses.length}</span>
    `;

    bars(df)
    line(toLine(ta.sma[20] as number[]), 'SMA 20', 2, '#0A5');
    markers(firstOf(calls), firstOf(puts), orderMarks);

    // const smi = smi_top.map((t, i) => t / (0.5 * smi_bot[i]))
    // line(toLine(smi), 'SMI 10', 2, '#0A0');

}

