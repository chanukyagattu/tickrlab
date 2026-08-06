import { describe, expect, it } from 'vitest';
import { atr, ema, latest, macd, rsi, slope, sma } from './indicators';

/**
 * Fixtures are computed by hand or from first principles, NOT from another
 * indicator library. Testing against a second implementation only proves the
 * two agree, which is worthless if they share a misreading of the definition.
 */

describe('sma', () => {
  it('averages the trailing window', () => {
    // mean(1..5) = 3, mean(2..6) = 4
    expect(sma([1, 2, 3, 4, 5, 6], 5)).toEqual([null, null, null, null, 3, 4]);
  });

  it('is null throughout when the series is shorter than the period', () => {
    expect(sma([1, 2], 5)).toEqual([null, null]);
  });

  it('stays aligned to the input length', () => {
    const input = Array.from({ length: 30 }, (_, i) => i);
    expect(sma(input, 7)).toHaveLength(30);
  });

  it('rejects a non-positive period', () => {
    expect(() => sma([1, 2, 3], 0)).toThrow(RangeError);
  });
});

describe('ema', () => {
  it('seeds with the SMA of the first period', () => {
    // SMA(1,2,3) = 2 at index 2.
    const out = ema([1, 2, 3, 4, 5], 3);
    expect(out[2]).toBeCloseTo(2, 10);
  });

  it('applies k = 2/(period+1) thereafter', () => {
    // k = 0.5 for period 3. next = 4*0.5 + 2*0.5 = 3, then 5*0.5 + 3*0.5 = 4.
    const out = ema([1, 2, 3, 4, 5], 3);
    expect(out[3]).toBeCloseTo(3, 10);
    expect(out[4]).toBeCloseTo(4, 10);
  });

  it('returns the constant for a constant series', () => {
    const out = ema(new Array(50).fill(42), 10);
    expect(latest(out)).toBeCloseTo(42, 10);
  });
});

describe('rsi', () => {
  it('is 100 when every change is a gain', () => {
    const rising = Array.from({ length: 40 }, (_, i) => 100 + i);
    expect(latest(rsi(rising, 14))).toBe(100);
  });

  it('approaches 0 when every change is a loss', () => {
    const falling = Array.from({ length: 40 }, (_, i) => 200 - i);
    expect(latest(rsi(falling, 14))!).toBeCloseTo(0, 6);
  });

  it('returns the midpoint for a flat series rather than treating it as overbought', () => {
    // Regression: a naive `loss === 0 ? 100` guard sends zero-movement down
    // the same branch as all-gains, reporting an unmoved series as maximally
    // overbought. This scored a flat asset at -40 before it was fixed.
    expect(latest(rsi(new Array(60).fill(100), 14))).toBe(50);
  });

  it('oscillates about 50 when gains and losses are symmetric', () => {
    // Alternating +1/-1 gives equal average gain and loss, but Wilder weights
    // the most recent change most heavily, so consecutive readings straddle 50
    // rather than sitting on it. They do not average to exactly 50 either —
    // the smoothing is asymmetric — so the honest assertion is the straddle
    // plus a tight band, not a precise midpoint.
    const zigzag = Array.from({ length: 60 }, (_, i) => 100 + (i % 2));
    const out = rsi(zigzag, 14);
    const last = out[out.length - 1]!;
    const penultimate = out[out.length - 2]!;

    expect(Math.min(last, penultimate)).toBeLessThan(50);
    expect(Math.max(last, penultimate)).toBeGreaterThan(50);
    expect(last).toBeGreaterThan(45);
    expect(last).toBeLessThan(55);
  });

  it('returns 0 when every change is a loss and there are no gains at all', () => {
    const monotonic = Array.from({ length: 40 }, (_, i) => 200 - i);
    expect(latest(rsi(monotonic, 14))!).toBeCloseTo(0, 6);
  });

  it('stays within [0, 100] on noisy input', () => {
    let seed = 7;
    const noisy = Array.from({ length: 200 }, () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return 100 + (seed % 1000) / 100;
    });
    for (const v of rsi(noisy, 14)) {
      if (v !== null) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });

  it('first defined value lands exactly at index = period', () => {
    const out = rsi(Array.from({ length: 40 }, (_, i) => 100 + i), 14);
    expect(out[13]).toBeNull();
    expect(out[14]).not.toBeNull();
  });
});

describe('macd', () => {
  it('keeps all three series aligned to the input', () => {
    const input = Array.from({ length: 100 }, (_, i) => 100 + Math.sin(i / 5) * 10);
    const { macd: line, signal, histogram } = macd(input);
    expect(line).toHaveLength(100);
    expect(signal).toHaveLength(100);
    expect(histogram).toHaveLength(100);
  });

  it('collapses to zero on a constant series', () => {
    const { macd: line, histogram } = macd(new Array(120).fill(50));
    expect(latest(line)!).toBeCloseTo(0, 8);
    expect(latest(histogram)!).toBeCloseTo(0, 8);
  });

  it('is positive when the fast EMA leads a rising series', () => {
    const rising = Array.from({ length: 120 }, (_, i) => 100 + i);
    expect(latest(macd(rising).macd)!).toBeGreaterThan(0);
  });

  it('histogram equals macd minus signal wherever both are defined', () => {
    const input = Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i / 7) * 5);
    const { macd: line, signal, histogram } = macd(input);
    for (let i = 0; i < input.length; i++) {
      if (line[i] !== null && signal[i] !== null) {
        expect(histogram[i]!).toBeCloseTo(line[i]! - signal[i]!, 10);
      }
    }
  });

  it('rejects fast >= slow', () => {
    expect(() => macd([1, 2, 3], 26, 12)).toThrow(RangeError);
  });
});

describe('atr', () => {
  it('equals the constant range for a series with fixed high-low spread', () => {
    const n = 60;
    const high = new Array(n).fill(102);
    const low = new Array(n).fill(98);
    const close = new Array(n).fill(100);
    // True range is max(4, |102-100|, |98-100|) = 4 throughout.
    expect(latest(atr(high, low, close, 14))!).toBeCloseTo(4, 8);
  });

  it('is never negative', () => {
    let seed = 3;
    const close = Array.from({ length: 120 }, () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return 100 + (seed % 500) / 50;
    });
    const high = close.map((c) => c + 2);
    const low = close.map((c) => c - 2);
    for (const v of atr(high, low, close, 14)) {
      if (v !== null) expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it('rejects mismatched series lengths', () => {
    expect(() => atr([1, 2], [1], [1, 2], 14)).toThrow(RangeError);
  });
});

describe('slope', () => {
  it('recovers the gradient of a straight line', () => {
    expect(slope([1, 2, 3, 4, 5], 3)!).toBeCloseTo(1, 10);
    expect(slope([10, 8, 6, 4], 3)!).toBeCloseTo(-2, 10);
  });

  it('is zero on a flat series', () => {
    expect(slope([5, 5, 5, 5], 3)!).toBeCloseTo(0, 10);
  });

  it('skips nulls when collecting the window', () => {
    expect(slope([null, null, 1, 2, 3], 3)!).toBeCloseTo(1, 10);
  });

  it('returns null with fewer than two defined values', () => {
    expect(slope([null, null, 1], 3)).toBeNull();
  });
});

describe('latest', () => {
  it('finds the last defined value', () => {
    expect(latest([1, 2, null])).toBe(2);
  });

  it('returns null when nothing is defined', () => {
    expect(latest([null, null])).toBeNull();
  });
});
