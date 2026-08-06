import { describe, expect, it } from 'vitest';
import { parseCsv, toStooqSymbol } from './stooq.mjs';
import { parseChart } from './yahoo.mjs';

/**
 * The network hop cannot be tested in CI without making the suite depend on a
 * third party being up. The parsing can, and that is where the bugs live —
 * every failure mode below is one of these providers answering with HTTP 200
 * and something other than the data you asked for.
 */

describe('toStooqSymbol', () => {
  it('lowercases and appends the US suffix', () => {
    expect(toStooqSymbol('NVDA')).toBe('nvda.us');
    expect(toStooqSymbol('SPY')).toBe('spy.us');
  });

  it('converts dotted class tickers to the hyphenated form', () => {
    expect(toStooqSymbol('BRK.B')).toBe('brk-b.us');
  });
});

describe('stooq parseCsv', () => {
  const good = [
    'Date,Open,High,Low,Close,Volume',
    '2026-01-02,100.0,102.0,99.5,101.5,1000000',
    '2026-01-03,101.5,103.0,101.0,102.75,1200000',
  ].join('\n');

  it('parses a well-formed response', () => {
    const candles = parseCsv(good, 'TEST');
    expect(candles).toHaveLength(2);
    expect(candles[0]).toEqual({
      time: Date.parse('2026-01-02T00:00:00Z') / 1000,
      open: 100,
      high: 102,
      low: 99.5,
      close: 101.5,
      volume: 1000000,
    });
  });

  it('throws on the "No data" body that Stooq returns with HTTP 200', () => {
    // The single most important case: a 200 with no data would otherwise
    // publish an empty dashboard over a good snapshot.
    expect(() => parseCsv('No data', 'BADSYM')).toThrow(/no data/i);
  });

  it('throws on an empty body', () => {
    expect(() => parseCsv('   ', 'TEST')).toThrow(/no data/i);
  });

  it('throws when the response is not the expected CSV at all', () => {
    expect(() => parseCsv('<!DOCTYPE html><html>rate limited</html>', 'TEST')).toThrow(
      /unexpected header/i,
    );
  });

  it('drops holiday rows with zero prices rather than passing them through', () => {
    const withHoliday = [
      'Date,Open,High,Low,Close,Volume',
      '2026-01-02,100,102,99,101,1000',
      '2026-01-03,0,0,0,0,0',
      '2026-01-04,101,103,100,102,1100',
    ].join('\n');
    // A zero close divides by zero in every downstream return calculation.
    const candles = parseCsv(withHoliday, 'TEST');
    expect(candles).toHaveLength(2);
    expect(candles.every((c) => c.close > 0)).toBe(true);
  });

  it('drops malformed short rows', () => {
    const ragged = [
      'Date,Open,High,Low,Close,Volume',
      '2026-01-02,100,102,99,101,1000',
      '2026-01-03,broken',
    ].join('\n');
    expect(parseCsv(ragged, 'TEST')).toHaveLength(1);
  });

  it('coerces a negative or missing volume to zero rather than propagating it', () => {
    const oddVolume = [
      'Date,Open,High,Low,Close,Volume',
      '2026-01-02,100,102,99,101,',
    ].join('\n');
    expect(parseCsv(oddVolume, 'TEST')[0].volume).toBe(0);
  });

  it('throws when every row was unusable', () => {
    const allBad = ['Date,Open,High,Low,Close,Volume', '2026-01-02,0,0,0,0,0'].join('\n');
    expect(() => parseCsv(allBad, 'TEST')).toThrow(/no usable rows/i);
  });
});

describe('yahoo parseChart', () => {
  const chart = (overrides = {}) => ({
    chart: {
      result: [
        {
          timestamp: [1767312000, 1767398400, 1767484800],
          indicators: {
            quote: [
              {
                open: [100, 101, 102],
                high: [102, 103, 104],
                low: [99, 100, 101],
                close: [101, 102, 103],
                volume: [1000, 1100, 1200],
                ...overrides,
              },
            ],
          },
        },
      ],
      error: null,
    },
  });

  it('parses parallel arrays into candles', () => {
    const candles = parseChart(chart(), 'TEST');
    expect(candles).toHaveLength(3);
    expect(candles[1]).toEqual({
      time: 1767398400,
      open: 101,
      high: 103,
      low: 100,
      close: 102,
      volume: 1100,
    });
  });

  it('drops halted sessions rather than interpolating them', () => {
    // Interpolating a null would invent price action that never happened.
    const candles = parseChart(chart({ close: [101, null, 103] }), 'TEST');
    expect(candles).toHaveLength(2);
    expect(candles.map((c) => c.close)).toEqual([101, 103]);
  });

  it('drops a row when any one of the four prices is null', () => {
    expect(parseChart(chart({ low: [99, null, 101] }), 'TEST')).toHaveLength(2);
  });

  it('surfaces the API error description when there is no result block', () => {
    const errored = { chart: { result: null, error: { description: 'No data found, symbol may be delisted' } } };
    expect(() => parseChart(errored, 'BADSYM')).toThrow(/symbol may be delisted/);
  });

  it('throws on an empty payload', () => {
    expect(() => parseChart({}, 'TEST')).toThrow(/no data/i);
  });

  it('throws when every row was unusable', () => {
    const allNull = chart({ close: [null, null, null] });
    expect(() => parseChart(allNull, 'TEST')).toThrow(/no usable rows/i);
  });

  it('defaults a missing volume to zero', () => {
    const candles = parseChart(chart({ volume: [1000, null, 1200] }), 'TEST');
    expect(candles[1].volume).toBe(0);
  });
});
