/**
    * Simple Moving Average
    * @param {number[]} prices
    * close, open, high, low
    * @param {number} period
    * 200, 50, 100
    * @return {number[]}
    */
function SMA(prices: number[], period: number): number[] {
    console.assert(period > 0 && period <= prices.length, 'Invalid period');

    const results = [];
    for (let i = 0; i < prices.length; i++) {
        const slice = prices.slice(Math.max(0, i - period + 1), i + 1);
        const avg = slice.reduce((acc, curr) => acc + curr, 0) / slice.length;
        results.push(avg);
    }

    return results;
}


export default { SMA };
