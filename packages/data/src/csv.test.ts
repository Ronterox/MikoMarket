import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inferSymbolFromPath, loadCsv, parseCsv, toMikoCsv } from './csv.ts';

const IB = `,date,open,high,low,close,volume,average,barCount
0,2026-02-10 09:30:00-05:00,694.48,696.09,694.46,695.2,-1.0,-1.0,-1
1,2026-02-10 09:45:00-05:00,695.2,695.7,695.2,695.52,1200.0,-1.0,-1
2,2026-02-10 10:00:00-05:00,695.52,695.54,695.27,695.33,-1.0,-1.0,-1
`;

const SQX = `Date,Time,Open,High,Low,Close,Volume
2015.01.01,18:01,8048,8053.25,8048,8053.25,207
2015.01.01,18:02,8053,8053,8052,8053,53
2015.01.01,18:03,8053,8054,8051.5,8052,40
`;

const SQX_SUMMER = `Date,Time,Open,High,Low,Close,Volume
2026.07.06,09:31,100,101,99,100.5,10
2026.07.06,09:32,100.5,102,100,101,20
`;

const TS = `"Date","Time","Open","High","Low","Close","Up","Down"
10/07/2026,16:55,31390,31402,31388,31400.25,100,90
10/07/2026,17:00,31400.25,31416.5,31396,31403.75,260,247
`;

const TS_NOHEADER = `10/07/2026,16:55,31390,31402,31388,31400.25,100,90\r
10/07/2026,17:00,31400.25,31416.5,31396,31403.75,260,247\r
`;

describe('CSV formats', () => {
  test('IB style: tz-aware open stamps, -1 volume becomes 0', () => {
    const r = parseCsv(IB);
    expect(r.format).toBe('ib');
    expect(r.timeframe).toBe('15m');
    expect(r.bars).toHaveLength(3);
    expect(r.bars[0]).toEqual({ t: Date.UTC(2026, 1, 10, 14, 30), o: 694.48, h: 696.09, l: 694.46, c: 695.2, v: 0 });
    expect(r.bars[1]!.v).toBe(1200);
    expect(r.bars[2]!.t - r.bars[1]!.t).toBe(15 * 60_000);
  });

  test('SQX: New York close stamps become UTC open times (winter)', () => {
    const r = parseCsv(SQX);
    expect(r.format).toBe('sqx');
    expect(r.timeframe).toBe('1m');
    // 18:01 EST close => 18:00 EST open => 23:00 UTC
    expect(r.bars[0]!.t).toBe(Date.UTC(2015, 0, 1, 23, 0));
    expect(r.bars[0]!.v).toBe(207);
    expect(r.bars[2]!.c).toBe(8052);
  });

  test('SQX: daylight saving time is honoured', () => {
    const r = parseCsv(SQX_SUMMER);
    // 09:31 EDT close => 09:30 EDT open => 13:30 UTC
    expect(r.bars[0]!.t).toBe(Date.UTC(2026, 6, 6, 13, 30));
  });

  test('TradeStation export: Up + Down volume, close stamps', () => {
    const r = parseCsv(TS);
    expect(r.format).toBe('tradestation');
    expect(r.timeframe).toBe('5m');
    expect(r.bars[1]).toEqual({ t: Date.UTC(2026, 9, 7, 20, 55), o: 31400.25, h: 31416.5, l: 31396, c: 31403.75, v: 507 });
  });

  test('TradeStation export without header and with CRLF', () => {
    const r = parseCsv(TS_NOHEADER);
    expect(r.format).toBe('tradestation');
    expect(r.bars).toHaveLength(2);
    expect(r.bars[1]!.v).toBe(507);
  });

  test('stamp option keeps open-stamped exports as-is', () => {
    const r = parseCsv(TS, { stamp: 'open' });
    expect(r.bars[1]!.t).toBe(Date.UTC(2026, 9, 7, 21, 0));
  });

  test('our own format round-trips', () => {
    const bars = parseCsv(IB).bars;
    const back = parseCsv(toMikoCsv(bars), { timeframe: '15m' });
    expect(back.format).toBe('miko');
    expect(back.bars).toEqual(bars);
  });

  test('since/until filter and dedupe', () => {
    const dup = IB + '3,2026-02-10 10:00:00-05:00,1,2,0.5,1.5,5,-1,-1\n';
    const r = parseCsv(dup, { since: Date.UTC(2026, 1, 10, 14, 45) });
    expect(r.bars).toHaveLength(2);
    expect(r.bars[1]!.c).toBe(1.5); // later duplicate wins
  });

  test('rejects things that are not bars', () => {
    expect(() => parseCsv('Trade number,Type,Date and time\n1,Exit long,2026-03-02 07:15\n')).toThrow();
  });

  test('loadCsv streams a file and infers the symbol', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'miko-csv-'));
    const file = join(dir, 'NQ_M1.csv');
    writeFileSync(file, SQX);
    const s = await loadCsv(file);
    expect(s.instrument.symbol).toBe('@NQ');
    expect(s.instrument.pointValue).toBe(20);
    expect(s.timeframe).toBe('1m');
    expect(s.bars).toHaveLength(3);
  });

  test('symbol inference from file names', () => {
    expect(inferSymbolFromPath('/x/20260713_105D_15mins_SPY.csv')).toBe('SPY');
    expect(inferSymbolFromPath('/x/NQ_M1.csv')).toBe('@NQ');
    expect(inferSymbolFromPath('/x/ES_M5.txt')).toBe('@ES');
    expect(inferSymbolFromPath('/x/AAPL_5m.csv')).toBe('AAPL');
  });
});
