import type { CandlestickData, SeriesMarker, Time } from "lightweight-charts";
import { z } from 'zod';

const NumArray = z.custom<number[]>();

export const DataFrame = z.object({
    time: z.custom<Time[]>(),
    open: NumArray,
    high: NumArray,
    low: NumArray,
    close: NumArray,
});

const Position = z.enum(['aboveBar', 'belowBar']);
const Shape = z.enum(['arrowUp', 'arrowDown']);
const Color = z.string();

export type Position = z.infer<typeof Position>;
export type Shape = z.infer<typeof Shape>;
export type Color = z.infer<typeof Color>;

export type Candle = CandlestickData<Time>;
export type Mark = SeriesMarker<Time>;
export type Iter<T = any> = (i: number) => T;

export interface Functionalities {
    arrow(text: string, position: Position, color: Color, shape: Shape, time?: Time): Mark

    zip<T>(arr: Iter): T[]
    firstOf(alert: Iter): Mark[]

    sortedByTime<T extends { time: Time }>(arr: T[]): T[]
}

export interface GraphicFunctionalities {
    bars(data: Iter): void
    line(data: Iter, title: string, lineType: number, color: Color): void
    markers(...arr: Mark[][]): void
}
