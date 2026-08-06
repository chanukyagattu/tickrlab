import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, runBacktest } from './backtest';
import { MIN_CANDLES } from './score';
import type { Candle } from './types';

/**
 * Backtesters fail silently and flatteringly. These tests target the specific
 * ways this one could lie: lookahead, uncharged costs, and a benchmark that
 * isn't measured over the same window.
 */

function series(closes: number[]): Candle[] {
  return closes.map((close, i) => ({
    time: 1600000000 + i * 86400,
    open: close,
    high: close * 1.01,
    low: close * 0.99,
    close,
    volume: 1_000_000,
  }));
}

function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

function randomWalk(n: number, seed: number, drift = 0): Candle[] {
  const rand = lcg(seed);
  let price = 100;
  return series(
    Array.from({ length: n }, () => {
      price = Math.max(1, price * (1 + drift + (rand() - 0.5) * 0.04));
      return price;
    }),
  );
}

describe('runBacktest — no lookahead', () => {
  it('never exits before it enters', () => {
    const r = runBacktest({ TEST: randomWalk(400, 11) });
    for (const t of r.tradeList) {
      expect(t.exitTime).toBeGreaterThan(t.entryTime);
    }
  });

  it('holds for exactly holdBars sessions', () => {
    const r = runBacktest(
      { TEST: randomWalk(400, 12) },
      { ...DEFAULT_PARAMS, holdBars: 5 },
    );
    for (const t of r.tradeList) {
      expect(t.exitTime - t.entryTime).toBe(5 * 86400);
    }
  });

  it('never opens a trade whose exit bar does not exist', () => {
    const n = MIN_CANDLES + 10;
    const r = runBacktest(
      { TEST: randomWalk(n, 13) },
      { ...DEFAULT_PARAMS, holdBars: 5 },
    );
    const lastTime = 1600000000 + (n - 1) * 86400;
    for (const t of r.tradeList) {
      expect(t.exitTime).toBeLessThanOrEqual(lastTime);
    }
  });

  it('skips symbols with too little history instead of extrapolating', () => {
    const r = runBacktest({ SHORT: randomWalk(MIN_CANDLES - 5, 14) });
    expect(r.symbolsTested).toBe(0);
    expect(r.trades).toBe(0);
  });
});

describe('runBacktest — costs are real', () => {
  it('charges every trade, so net return is always below gross', () => {
    const r = runBacktest(
      { TEST: randomWalk(500, 21) },
      { ...DEFAULT_PARAMS, costBps: 10 },
    );
    for (const t of r.tradeList) {
      const gross = ((t.exitPrice - t.entryPrice) / t.entryPrice) * t.direction;
      expect(t.returnPct).toBeCloseTo(gross - 0.001, 10);
    }
  });

  it('post-cost hit rate never exceeds pre-cost hit rate', () => {
    for (const seed of [31, 32, 33, 34]) {
      const r = runBacktest({ TEST: randomWalk(500, seed) });
      expect(r.hitRateAfterCosts).toBeLessThanOrEqual(r.hitRate);
    }
  });

  it('raising costs strictly reduces total return', () => {
    const cheap = runBacktest({ TEST: randomWalk(500, 41) }, { ...DEFAULT_PARAMS, costBps: 0 });
    const dear = runBacktest({ TEST: randomWalk(500, 41) }, { ...DEFAULT_PARAMS, costBps: 100 });
    expect(cheap.trades).toBeGreaterThan(0); // guard: a no-trade run passes vacuously
    expect(dear.totalReturn).toBeLessThan(cheap.totalReturn);
    expect(dear.trades).toBe(cheap.trades); // same signals, different economics
  });
});

describe('runBacktest — honest benchmark', () => {
  it('reports buy-and-hold gains on a steadily rising series', () => {
    const rising = series(Array.from({ length: 400 }, (_, i) => 100 * 1.002 ** i));
    expect(runBacktest({ TEST: rising }).buyHoldReturn).toBeGreaterThan(0);
  });

  it('reports buy-and-hold losses on a steadily falling series', () => {
    const falling = series(Array.from({ length: 400 }, (_, i) => 300 * 0.998 ** i));
    expect(runBacktest({ TEST: falling }).buyHoldReturn).toBeLessThan(0);
  });

  it('excessReturn is exactly totalReturn minus buyHoldReturn', () => {
    const r = runBacktest({ A: randomWalk(400, 51), B: randomWalk(400, 52) });
    expect(r.excessReturn).toBeCloseTo(r.totalReturn - r.buyHoldReturn, 10);
  });
});

describe('runBacktest — statistics', () => {
  it('max drawdown is never positive', () => {
    for (const seed of [61, 62, 63]) {
      expect(runBacktest({ TEST: randomWalk(500, seed) }).maxDrawdown).toBeLessThanOrEqual(0);
    }
  });

  it('hit rates stay within [0, 1]', () => {
    for (const seed of [71, 72, 73, 74, 75]) {
      const r = runBacktest({ TEST: randomWalk(400, seed) });
      expect(r.hitRate).toBeGreaterThanOrEqual(0);
      expect(r.hitRate).toBeLessThanOrEqual(1);
      expect(r.hitRateAfterCosts).toBeGreaterThanOrEqual(0);
      expect(r.hitRateAfterCosts).toBeLessThanOrEqual(1);
    }
  });

  it('wins never exceed trades', () => {
    const r = runBacktest({ TEST: randomWalk(500, 81) });
    expect(r.wins).toBeLessThanOrEqual(r.trades);
  });

  it('decimates the equity curve for charting', () => {
    const r = runBacktest({ TEST: randomWalk(3000, 91) });
    expect(r.equity.length).toBeLessThanOrEqual(401);
  });

  it('is deterministic for identical input', () => {
    const data = { TEST: randomWalk(400, 101) };
    const a = runBacktest(data);
    const b = runBacktest(data);
    expect(a.trades).toBe(b.trades);
    expect(a.totalReturn).toBeCloseTo(b.totalReturn, 12);
  });
});

describe('runBacktest — threshold', () => {
  it('a higher threshold produces no more trades than a lower one', () => {
    const data = { TEST: randomWalk(600, 111) };
    const loose = runBacktest(data, { ...DEFAULT_PARAMS, threshold: 20 });
    const tight = runBacktest(data, { ...DEFAULT_PARAMS, threshold: 80 });
    expect(tight.trades).toBeLessThanOrEqual(loose.trades);
  });

  it('an unreachable threshold produces no trades at all', () => {
    const r = runBacktest({ TEST: randomWalk(400, 121) }, { ...DEFAULT_PARAMS, threshold: 101 });
    expect(r.trades).toBe(0);
    expect(r.hitRate).toBe(0);
  });

  it('every recorded trade cleared the threshold', () => {
    const r = runBacktest({ TEST: randomWalk(600, 131) }, { ...DEFAULT_PARAMS, threshold: 50 });
    for (const t of r.tradeList) {
      expect(Math.abs(t.scoreAtEntry)).toBeGreaterThanOrEqual(50);
    }
  });
});

describe('runBacktest — the honest result', () => {
  it('does not beat a coin flip on random walks, which is the expected outcome', () => {
    // If this ever passed convincingly on pure noise, the backtester would be
    // broken, not the strategy brilliant. Guarding the claim in the README.
    const data: Record<string, Candle[]> = {};
    for (let i = 0; i < 12; i++) data[`SYM${i}`] = randomWalk(600, 200 + i);

    const r = runBacktest(data);
    expect(r.trades).toBeGreaterThan(30);
    expect(r.hitRateAfterCosts).toBeGreaterThan(0.35);
    expect(r.hitRateAfterCosts).toBeLessThan(0.65);
  });

  it('the default threshold actually selects trades', () => {
    // Regression guard for a silent failure that shipped in the first draft:
    // threshold 50 selected ~0% of bars, so every backtest returned zero
    // trades and a 0% hit rate, which reads as a result rather than a bug.
    const data: Record<string, Candle[]> = {};
    for (let i = 0; i < 6; i++) data[`SYM${i}`] = randomWalk(500, 400 + i);

    const r = runBacktest(data);
    expect(r.symbolsTested).toBe(6);
    expect(r.trades).toBeGreaterThan(20);
  });

  it('a threshold of 50 selects almost nothing — documenting the measured limit', () => {
    const data: Record<string, Candle[]> = {};
    for (let i = 0; i < 6; i++) data[`SYM${i}`] = randomWalk(500, 500 + i);

    const loose = runBacktest(data, { ...DEFAULT_PARAMS, threshold: 25 });
    const unreachable = runBacktest(data, { ...DEFAULT_PARAMS, threshold: 50 });

    expect(loose.trades).toBeGreaterThan(20);
    expect(unreachable.trades).toBeLessThan(loose.trades / 10);
  });
});
