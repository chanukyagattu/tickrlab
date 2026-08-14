import { describe, expect, it } from 'vitest';
import { parsePrices } from './tiingo.mjs';

/**
 * The network hop cannot be tested in CI without making the suite depend on a
 * third party being up. The parsing can, and that is where the bugs live.
 *
 * Stooq and Yahoo adapters were removed after measuring both: Stooq now serves
 * a JavaScript challenge page to every request regardless of User-Agent, and
 * Yahoo returns HTTP 429 from a cold IP. See DESIGN.md §4.
 */

const row = (overrides = {}) => ({
  date: '2026-01-02T00:00:00.000Z',
  open: 100,
  high: 102,
  low: 99,
  close: 101,
  volume: 1_000_000,
  adjOpen: 100,
  adjHigh: 102,
  adjLow: 99,
  adjClose: 101,
  adjVolume: 1_000_000,
  ...overrides,
});

describe('tiingo parsePrices', () => {
  it('parses a well-formed series', () => {
    const candles = parsePrices([row()], 'TEST');
    expect(candles).toHaveLength(1);
    expect(candles[0]).toEqual({
      time: Date.parse('2026-01-02T00:00:00.000Z') / 1000,
      open: 100,
      high: 102,
      low: 99,
      close: 101,
      volume: 1_000_000,
    });
  });

  it('prefers adjusted prices over raw', () => {
    // The correctness point of the whole adapter. Raw prices put a fake
    // discontinuity at every split: NVDA's 10-for-1 in June 2024 shows as a
    // ~90% single-session crash in unadjusted data, which drives RSI to 0 and
    // manufactures a maximum-conviction signal out of an accounting event.
    const split = row({ open: 1000, high: 1020, low: 990, close: 1010 });
    const candles = parsePrices([split], 'NVDA');
    expect(candles[0].close).toBe(101); // adjClose, not the 1010 raw close
    expect(candles[0].open).toBe(100);
  });

  it('adjusts volume too, not just price', () => {
    // Otherwise the volume-vs-average component sees a 10x spike on the same
    // day for the same non-reason.
    const split = row({ volume: 10_000_000, adjVolume: 1_000_000 });
    expect(parsePrices([split], 'NVDA')[0].volume).toBe(1_000_000);
  });

  it('falls back to raw fields when adjusted ones are absent', () => {
    const raw = {
      date: '2026-01-02T00:00:00.000Z',
      open: 50,
      high: 51,
      low: 49,
      close: 50.5,
      volume: 900,
    };
    const candles = parsePrices([raw], 'TEST');
    expect(candles[0].close).toBe(50.5);
    expect(candles[0].volume).toBe(900);
  });

  it('sorts ascending by time regardless of response order', () => {
    // The engine assumes ascending order and would silently compute garbage
    // indicators on a reversed series.
    const later = row({ date: '2026-01-05T00:00:00.000Z', adjClose: 105 });
    const earlier = row({ date: '2026-01-02T00:00:00.000Z', adjClose: 101 });
    const candles = parsePrices([later, earlier], 'TEST');
    expect(candles.map((c) => c.close)).toEqual([101, 105]);
  });

  it('throws with the API detail when the payload is an error object', () => {
    expect(() => parsePrices({ detail: 'Not found.' }, 'BADSYM')).toThrow(/Not found/);
  });

  it('throws on an empty array', () => {
    expect(() => parsePrices([], 'TEST')).toThrow(/empty series/i);
  });

  it('throws when the payload is not an array at all', () => {
    expect(() => parsePrices(null, 'TEST')).toThrow(/no series/i);
    expect(() => parsePrices('nope', 'TEST')).toThrow(/no series/i);
  });

  it('drops rows with zero or non-finite prices', () => {
    // A zero close divides by zero in every downstream return calculation.
    const bad = row({ date: '2026-01-03T00:00:00.000Z', adjClose: 0 });
    const candles = parsePrices([row(), bad], 'TEST');
    expect(candles).toHaveLength(1);
  });

  it('drops rows with an unparseable date', () => {
    const bad = row({ date: 'not-a-date' });
    expect(() => parsePrices([bad], 'TEST')).toThrow(/no usable rows/i);
  });

  it('coerces a negative or missing volume to zero', () => {
    const odd = row({ adjVolume: -5, volume: undefined });
    expect(parsePrices([odd], 'TEST')[0].volume).toBe(0);
  });
});
