import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, MIN_CANDLES, bandOf, computeScore } from './score';
import type { Candle } from './types';

/** Deterministic pseudo-random so failures are reproducible. */
function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

function candles(
  closes: number[],
  opts: { volume?: number[]; spread?: number } = {},
): Candle[] {
  const spread = opts.spread ?? 1;
  return closes.map((close, i) => ({
    time: 1700000000 + i * 86400,
    open: close,
    high: close + spread,
    low: close - spread,
    close,
    volume: opts.volume?.[i] ?? 1_000_000,
  }));
}

const rising = (n: number, step = 1) =>
  candles(Array.from({ length: n }, (_, i) => 100 + i * step));

const falling = (n: number, step = 1) =>
  candles(Array.from({ length: n }, (_, i) => 300 - i * step));

const flat = (n: number) => candles(new Array(n).fill(100));

describe('computeScore — contract', () => {
  it('returns null below the minimum candle count rather than a fake neutral', () => {
    expect(computeScore(rising(MIN_CANDLES - 1))).toBeNull();
  });

  it('produces a score at exactly the minimum', () => {
    expect(computeScore(rising(MIN_CANDLES))).not.toBeNull();
  });

  it('reports the candle count and timestamp it actually used', () => {
    const input = rising(120);
    const score = computeScore(input)!;
    expect(score.candlesUsed).toBe(120);
    expect(score.asOf).toBe(input[119]!.time);
  });

  it('emits exactly the four documented components', () => {
    const score = computeScore(rising(120))!;
    expect(score.components.map((c) => c.key)).toEqual([
      'RSI',
      'EMA_SPREAD',
      'MACD_SLOPE',
      'VOLUME',
    ]);
  });

  it('does not mutate its input', () => {
    const input = rising(120);
    const snapshot = JSON.stringify(input);
    computeScore(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('is deterministic across repeated calls', () => {
    const input = rising(120);
    expect(computeScore(input)).toEqual(computeScore(input));
  });
});

describe('computeScore — bounds', () => {
  it('keeps the total within [-100, 100] across varied inputs', () => {
    const rand = lcg(99);
    for (let trial = 0; trial < 200; trial++) {
      const drift = (rand() - 0.5) * 4;
      let price = 50 + rand() * 500;
      const closes = Array.from({ length: 120 }, () => {
        price = Math.max(1, price + drift + (rand() - 0.5) * 6);
        return price;
      });
      const vols = Array.from({ length: 120 }, () => 500_000 + rand() * 5_000_000);
      const score = computeScore(candles(closes, { volume: vols }));
      if (score) {
        expect(score.total).toBeGreaterThanOrEqual(-100);
        expect(score.total).toBeLessThanOrEqual(100);
      }
    }
  });

  it('keeps every component normalised within [-1, 1]', () => {
    const rand = lcg(4242);
    for (let trial = 0; trial < 100; trial++) {
      let price = 10 + rand() * 900;
      const closes = Array.from({ length: 150 }, () => {
        price = Math.max(1, price * (1 + (rand() - 0.5) * 0.15));
        return price;
      });
      const score = computeScore(candles(closes));
      if (score) {
        for (const c of score.components) {
          expect(c.normalised).toBeGreaterThanOrEqual(-1);
          expect(c.normalised).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('total equals the sum of contributions when not clamped', () => {
    const score = computeScore(flat(120))!;
    const sum = score.components.reduce((a, c) => a + c.contribution, 0);
    expect(score.total).toBeCloseTo(Math.round(sum * 10) / 10, 5);
  });
});

describe('computeScore — directional behaviour', () => {
  it('reads a sustained uptrend as a positive EMA spread', () => {
    const spread = computeScore(rising(150))!.components.find(
      (c) => c.key === 'EMA_SPREAD',
    )!;
    expect(spread.contribution).toBeGreaterThan(0);
  });

  it('reads a sustained downtrend as a negative EMA spread', () => {
    const spread = computeScore(falling(150))!.components.find(
      (c) => c.key === 'EMA_SPREAD',
    )!;
    expect(spread.contribution).toBeLessThan(0);
  });

  it('treats an overbought RSI as a negative contribution (mean-reversion reading)', () => {
    const rsiComp = computeScore(rising(150))!.components.find((c) => c.key === 'RSI')!;
    expect(rsiComp.raw).toBeGreaterThan(70);
    expect(rsiComp.contribution).toBeLessThan(0);
  });

  it('treats an oversold RSI as a positive contribution', () => {
    const rsiComp = computeScore(falling(150))!.components.find((c) => c.key === 'RSI')!;
    expect(rsiComp.raw).toBeLessThan(30);
    expect(rsiComp.contribution).toBeGreaterThan(0);
  });

  it('scores a flat series near neutral', () => {
    // Regression guard for the RSI 0/0 bug: an unmoved asset must not read as
    // strongly bearish just because it had no gains to divide by.
    expect(Math.abs(computeScore(flat(150))!.total)).toBeLessThan(5);
  });

  it('gives volume no directional weight when the series is flat', () => {
    const vol = computeScore(flat(150))!.components.find((c) => c.key === 'VOLUME')!;
    expect(Math.abs(vol.contribution)).toBeLessThanOrEqual(0.1);
  });

  it('volume confirms rather than leads — it takes the sign of the consensus', () => {
    const n = 150;
    const closes = Array.from({ length: n }, (_, i) => 300 - i);
    const volume = new Array(n).fill(1_000_000);
    volume[n - 1] = 3_000_000; // heavy volume on a collapsing price

    const score = computeScore(candles(closes, { volume }))!;
    const vol = score.components.find((c) => c.key === 'VOLUME')!;
    const directional = score.components
      .filter((c) => c.key !== 'VOLUME')
      .reduce((a, c) => a + c.contribution, 0);

    expect(vol.raw).toBeCloseTo(3, 1);
    // A 3x volume day is not bullish on its own; it amplifies the consensus.
    expect(Math.sign(vol.contribution)).toBe(Math.sign(directional));
  });
});

describe('computeScore — scale invariance', () => {
  it('scores a $30 and a $700 asset with the same shape near-identically', () => {
    const shape = Array.from({ length: 150 }, (_, i) => 1 + Math.sin(i / 9) * 0.1 + i * 0.004);
    const cheap = computeScore(candles(shape.map((v) => v * 30), { spread: 0.3 }))!;
    const dear = computeScore(candles(shape.map((v) => v * 700), { spread: 7 }))!;

    // ATR normalisation is what makes cross-asset ranking meaningful rather
    // than a proxy for share price.
    expect(Math.abs(cheap.total - dear.total)).toBeLessThan(5);
  });
});

describe('bandOf', () => {
  it('maps totals to descriptive, never imperative, bands', () => {
    expect(bandOf(-100)).toBe('STRONGLY BEARISH');
    expect(bandOf(-60)).toBe('STRONGLY BEARISH');
    expect(bandOf(-30)).toBe('BEARISH');
    expect(bandOf(0)).toBe('NEUTRAL');
    expect(bandOf(19.9)).toBe('NEUTRAL');
    expect(bandOf(30)).toBe('BULLISH');
    expect(bandOf(60)).toBe('STRONGLY BULLISH');
    expect(bandOf(100)).toBe('STRONGLY BULLISH');
  });

  it('never emits an actionable word', () => {
    const forbidden = /\b(BUY|SELL|CALL|PUT|HOLD|TARGET)\b/;
    for (let t = -100; t <= 100; t += 1) {
      expect(bandOf(t)).not.toMatch(forbidden);
    }
  });
});

describe('config', () => {
  it('weights sum to 1 so contributions are interpretable as percentages', () => {
    const sum = Object.values(DEFAULT_CONFIG.weights).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });
});
