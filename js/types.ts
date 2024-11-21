import type { CandlestickData, SeriesMarker, Time } from "lightweight-charts";

export type DataFrame = {
    time: Time[];
    open: number[];
    high: number[];
    low: number[];
    close: number[];
}

export type Position = 'aboveBar' | 'belowBar';
export type Shape = 'arrowUp' | 'arrowDown';
export type Color = string;

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
