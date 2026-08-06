/**
 * Backtester.
 *
 * The point of this file is not to find a profitable strategy. It is to
 * measure whether the score in `score.ts` predicts anything, and to publish
 * that measurement in the UI next to the score itself.
 *
 * The expected answer is "barely". Retail technical indicators on daily bars
 * have been arbitraged out for decades. Reporting that honestly is the whole
 * argument of this project: a signal you cannot falsify is not an engineering
 * artifact.
 *
 * METHODOLOGICAL NOTES, because a backtest that quietly cheats is worse than
 * no backtest at all:
 *
 *  - No lookahead. The score at bar i is computed from candles [0..i] only,
 *    and the trade is entered at the CLOSE of bar i. Entering at bar i's open
 *    using bar i's close-derived signal is the most common way this class of
 *    code lies about itself.
 *  - Costs are charged on both legs, in basis points of notional.
 *  - Every signal is measured, not just the winners. There is no filtering of
 *    trades after the fact.
 *  - The comparison is buy-and-hold over the identical window, so a strategy
 *    that is merely long during a bull market gets no credit for it.
 */

import type { Candle } from './types';
import { DEFAULT_CONFIG, MIN_CANDLES, type ScoreConfig, computeScore } from './score';

export interface BacktestParams {
  /** |score| above this triggers a position. */
  threshold: number;
  /** Bars held before exit. */
  holdBars: number;
  /** Round-trip cost in basis points of notional. */
  costBps: number;
  scoreConfig: ScoreConfig;
}

/**
 * Threshold is 25, not the 50 you might expect from a [-100, 100] range.
 *
 * Measured score distribution across 5,100 scored bars of synthetic series:
 *
 *                    p5     p25    p50    p75    p95    >=35    >=50
 *   random walk    -23.0   -9.7    0.1    9.5   23.3    0.6%    0.0%
 *   mild uptrend   -19.6   -9.1   -1.1    8.4   24.0    0.7%    0.0%
 *   strong trend   -22.1  -14.0   -8.1   -2.1    7.7    0.1%    0.0%
 *
 * The composite is heavily damped because two of its components are
 * structurally opposed: RSI is read as mean-reversion (negative in uptrends)
 * while EMA spread is trend-following (positive in uptrends). They cancel
 * except on genuine confluence — oversold WITHIN an uptrend, or overbought
 * within a downtrend — which is the behaviour the design intends but which
 * keeps |total| far below its theoretical bound in practice.
 *
 * A threshold of 50 therefore selects approximately nothing: the first version
 * of this file paired it with `threshold: 50` and the backtest ran zero trades
 * across every symbol, silently reporting a 0% hit rate as though that were a
 * finding. 25 sits near the 90th percentile and fires on roughly 8-15% of bars.
 *
 * Note also the third row: the score reads mildly NEGATIVE during a strong
 * uptrend, because the mean-reversion term outweighs the trend term at these
 * weights. That is a property of the configuration, not a bug, and it is
 * exactly the sort of thing the validation tab exists to expose.
 */
export const DEFAULT_PARAMS: BacktestParams = {
  threshold: 25,
  holdBars: 5,
  costBps: 10,
  scoreConfig: DEFAULT_CONFIG,
};

export interface Trade {
  symbol: string;
  entryTime: number;
  exitTime: number;
  direction: 1 | -1;
  entryPrice: number;
  exitPrice: number;
  /** Net of costs, as a fraction. */
  returnPct: number;
  scoreAtEntry: number;
  win: boolean;
}

export interface EquityPoint {
  time: number;
  strategy: number;
  buyHold: number;
}

export interface BacktestResult {
  trades: number;
  wins: number;
  /** Directional accuracy before costs. */
  hitRate: number;
  /** Directional accuracy after costs — the number that matters. */
  hitRateAfterCosts: number;
  meanReturn: number;
  totalReturn: number;
  buyHoldReturn: number;
  /** totalReturn - buyHoldReturn. Negative means the strategy destroyed value. */
  excessReturn: number;
  sharpe: number;
  maxDrawdown: number;
  equity: EquityPoint[];
  tradeList: Trade[];
  symbolsTested: number;
  /** Wall-clock ms, filled in by the caller. */
  elapsedMs?: number;
}

/** Sample the equity curve down to at most `max` points for charting. */
function decimate(points: EquityPoint[], max = 400): EquityPoint[] {
  if (points.length <= max) return points;
  const step = points.length / max;
  const out: EquityPoint[] = [];
  for (let i = 0; i < max; i++) out.push(points[Math.floor(i * step)]!);
  const last = points[points.length - 1];
  if (last && out[out.length - 1] !== last) out.push(last);
  return out;
}

function maxDrawdownOf(series: number[]): number {
  let peak = -Infinity;
  let worst = 0;
  for (const v of series) {
    if (v > peak) peak = v;
    if (peak > 0) {
      const dd = (v - peak) / peak;
      if (dd < worst) worst = dd;
    }
  }
  return worst;
}

/**
 * Run the strategy across a set of symbols.
 *
 * Cost is O(symbols x bars x indicatorWindow) because the score is recomputed
 * at each bar from scratch. That is deliberately the naive implementation: it
 * is obviously correct, and being obviously correct matters more here than
 * being fast. It is also the reason this belongs in a Worker — 50 symbols over
 * six years is seconds, not microseconds.
 */
export function runBacktest(
  data: Record<string, readonly Candle[]>,
  params: BacktestParams = DEFAULT_PARAMS,
): BacktestResult {
  const { threshold, holdBars, costBps, scoreConfig } = params;
  const costPerTrade = costBps / 10_000;

  const tradeList: Trade[] = [];
  const equityByTime = new Map<number, { strategy: number; buyHold: number }>();
  let symbolsTested = 0;

  for (const [symbol, candles] of Object.entries(data)) {
    if (candles.length < MIN_CANDLES + holdBars + 1) continue;
    symbolsTested++;

    // Bar i is scored from [0..i]; exit is at i + holdBars, so stop early
    // enough that the exit bar exists. No lookahead, no partial trades.
    for (let i = MIN_CANDLES; i + holdBars < candles.length; i++) {
      const window = candles.slice(0, i + 1);
      const score = computeScore(window, scoreConfig);
      if (!score || Math.abs(score.total) < threshold) continue;

      const direction: 1 | -1 = score.total > 0 ? 1 : -1;
      const entry = candles[i]!;
      const exit = candles[i + holdBars]!;
      if (entry.close <= 0) continue;

      const gross = ((exit.close - entry.close) / entry.close) * direction;
      const net = gross - costPerTrade;

      tradeList.push({
        symbol,
        entryTime: entry.time,
        exitTime: exit.time,
        direction,
        entryPrice: entry.close,
        exitPrice: exit.close,
        returnPct: net,
        scoreAtEntry: score.total,
        win: net > 0,
      });
    }

    // Buy-and-hold benchmark over the identical window.
    const first = candles[MIN_CANDLES];
    if (first && first.close > 0) {
      for (let i = MIN_CANDLES; i < candles.length; i++) {
        const bar = candles[i]!;
        const bh = bar.close / first.close - 1;
        const acc = equityByTime.get(bar.time) ?? { strategy: 0, buyHold: 0 };
        acc.buyHold += bh;
        equityByTime.set(bar.time, acc);
      }
    }
  }

  tradeList.sort((a, b) => a.entryTime - b.entryTime);

  // Equal-weight compounding across trades in chronological order.
  let cumulative = 0;
  const strategyByTime = new Map<number, number>();
  for (const t of tradeList) {
    cumulative += t.returnPct;
    strategyByTime.set(t.exitTime, cumulative);
  }

  const times = [...equityByTime.keys()].sort((a, b) => a - b);
  const equity: EquityPoint[] = [];
  let lastStrategy = 0;
  let symbolCount = Math.max(symbolsTested, 1);

  for (const time of times) {
    const s = strategyByTime.get(time);
    if (s !== undefined) lastStrategy = s;
    const bh = equityByTime.get(time)!.buyHold / symbolCount;
    equity.push({ time, strategy: lastStrategy, buyHold: bh });
  }

  const wins = tradeList.filter((t) => t.win).length;
  const grossWins = tradeList.filter((t) => t.returnPct + costPerTrade > 0).length;
  const n = tradeList.length;

  const returns = tradeList.map((t) => t.returnPct);
  const meanReturn = n ? returns.reduce((a, b) => a + b, 0) / n : 0;
  const variance = n > 1
    ? returns.reduce((a, r) => a + (r - meanReturn) ** 2, 0) / (n - 1)
    : 0;
  const sd = Math.sqrt(variance);

  // Annualised from the holding period. Reported for comparability, but a
  // Sharpe computed over overlapping fixed-hold windows is a rough figure —
  // the trades are not independent.
  const periodsPerYear = 252 / Math.max(holdBars, 1);
  const sharpe = sd > 0 ? (meanReturn / sd) * Math.sqrt(periodsPerYear) : 0;

  const totalReturn = cumulative;
  const buyHoldReturn = equity.length ? equity[equity.length - 1]!.buyHold : 0;

  return {
    trades: n,
    wins,
    hitRate: n ? grossWins / n : 0,
    hitRateAfterCosts: n ? wins / n : 0,
    meanReturn,
    totalReturn,
    buyHoldReturn,
    excessReturn: totalReturn - buyHoldReturn,
    sharpe,
    maxDrawdown: maxDrawdownOf(equity.map((e) => e.strategy)),
    equity: decimate(equity),
    tradeList: tradeList.slice(0, 500),
    symbolsTested,
  };
}
