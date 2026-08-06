/**
 * Technical indicators. Pure functions over number arrays: no I/O, no clock,
 * no randomness, no mutation of inputs.
 *
 * Written by hand rather than pulled from `technicalindicators`. It is ~120
 * lines, removes a thinly-maintained dependency, and makes the unit tests
 * meaningful — testing against hand-computed fixtures verifies the maths,
 * whereas testing against another library only verifies that two
 * implementations share a bug.
 *
 * Every function returns an array ALIGNED TO THE INPUT: positions where the
 * indicator is not yet defined hold `null` rather than being dropped. Trimming
 * the warm-up period is the classic source of off-by-one errors in this kind
 * of code, because it silently shifts every subsequent index.
 */

export type Series = readonly number[];
export type Aligned = (number | null)[];

const nulls = (n: number): Aligned => new Array(n).fill(null);

/** Simple moving average. */
export function sma(values: Series, period: number): Aligned {
  if (period <= 0) throw new RangeError('period must be positive');
  if (values.length < period) return nulls(values.length);

  const out = nulls(values.length);
  let sum = 0;

  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/**
 * Exponential moving average, seeded with the SMA of the first `period` values.
 *
 * Seeding matters: seeding with values[0] instead converges to the same place
 * but differs materially for the first ~3 periods, which is exactly the region
 * a short backtest samples most heavily.
 */
export function ema(values: Series, period: number): Aligned {
  if (period <= 0) throw new RangeError('period must be positive');
  if (values.length < period) return nulls(values.length);

  const out = nulls(values.length);
  const k = 2 / (period + 1);

  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i]!;
  let prev = seed / period;
  out[period - 1] = prev;

  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/**
 * Wilder's RSI. Note this is Wilder smoothing (1/period), not a simple average
 * of gains and losses — the two diverge quickly and Wilder's is what every
 * charting package plots.
 */
export function rsi(values: Series, period = 14): Aligned {
  if (period <= 0) throw new RangeError('period must be positive');
  if (values.length <= period) return nulls(values.length);

  const out = nulls(values.length);
  let gain = 0;
  let loss = 0;

  for (let i = 1; i <= period; i++) {
    const d = values[i]! - values[i - 1]!;
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  out[period] = rsiFrom(gain, loss);

  for (let i = period + 1; i < values.length; i++) {
    const d = values[i]! - values[i - 1]!;
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    gain = (gain * (period - 1) + g) / period;
    loss = (loss * (period - 1) + l) / period;
    out[i] = rsiFrom(gain, loss);
  }
  return out;
}

/**
 * RSI from smoothed average gain and loss.
 *
 * The 0/0 case is the one worth being careful about. A naive `loss === 0 ? 100`
 * guard reports a *flat* series as maximally overbought, because zero losses
 * and zero gains take the same branch as zero losses and large gains. A series
 * that has not moved is neither overbought nor oversold, so it returns the
 * midpoint. This was a live bug caught by the flat-series test.
 */
function rsiFrom(gain: number, loss: number): number {
  if (loss === 0) return gain === 0 ? 50 : 100;
  if (gain === 0) return 0;
  return 100 - 100 / (1 + gain / loss);
}

export interface MacdResult {
  macd: Aligned;
  signal: Aligned;
  histogram: Aligned;
}

/** MACD. Defaults are the conventional 12/26/9. */
export function macd(values: Series, fast = 12, slow = 26, signalPeriod = 9): MacdResult {
  if (fast >= slow) throw new RangeError('fast period must be shorter than slow');

  const fastEma = ema(values, fast);
  const slowEma = ema(values, slow);

  const macdLine: Aligned = values.map((_, i) => {
    const f = fastEma[i];
    const s = slowEma[i];
    return f === null || f === undefined || s === null || s === undefined ? null : f - s;
  });

  // The signal line is an EMA of the MACD line, which only exists after the
  // slow EMA warms up. Compute it over the defined tail, then map back to
  // input positions so all three series stay index-aligned.
  const firstDefined = macdLine.findIndex((v) => v !== null);
  const signal: Aligned = nulls(values.length);

  if (firstDefined !== -1) {
    const tail = macdLine.slice(firstDefined) as number[];
    const sig = ema(tail, signalPeriod);
    for (let i = 0; i < sig.length; i++) signal[firstDefined + i] = sig[i] ?? null;
  }

  const histogram: Aligned = values.map((_, i) => {
    const m = macdLine[i];
    const s = signal[i];
    return m === null || m === undefined || s === null || s === undefined ? null : m - s;
  });

  return { macd: macdLine, signal, histogram };
}

/**
 * Average True Range, Wilder-smoothed.
 *
 * Used to normalise the EMA spread. A $2 gap between EMAs means something
 * entirely different on a $30 ETF than on a $700 stock; dividing by ATR makes
 * the component comparable across the universe, which is what makes
 * cross-asset ranking legitimate rather than a proxy for share price.
 */
export function atr(
  high: Series,
  low: Series,
  close: Series,
  period = 14,
): Aligned {
  const n = close.length;
  if (high.length !== n || low.length !== n) {
    throw new RangeError('high, low and close must be the same length');
  }
  if (n <= period) return nulls(n);

  const tr: number[] = new Array(n).fill(0);
  tr[0] = high[0]! - low[0]!;
  for (let i = 1; i < n; i++) {
    const h = high[i]!;
    const l = low[i]!;
    const pc = close[i - 1]!;
    tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }

  const out = nulls(n);
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i]!;
  let prev = sum / period;
  out[period] = prev;

  for (let i = period + 1; i < n; i++) {
    prev = (prev * (period - 1) + tr[i]!) / period;
    out[i] = prev;
  }
  return out;
}

/** Last non-null value of an aligned series, or null if there is none. */
export function latest(series: Aligned): number | null {
  for (let i = series.length - 1; i >= 0; i--) {
    const v = series[i];
    if (v !== null && v !== undefined) return v;
  }
  return null;
}

/**
 * Least-squares slope of the final `window` defined values, per step.
 * Used for MACD histogram direction: the sign of the histogram says where
 * momentum is, the slope says where it is going.
 */
export function slope(series: Aligned, window = 3): number | null {
  const vals: number[] = [];
  for (let i = series.length - 1; i >= 0 && vals.length < window; i--) {
    const v = series[i];
    if (v !== null && v !== undefined) vals.unshift(v);
  }
  if (vals.length < 2) return null;

  const n = vals.length;
  const meanX = (n - 1) / 2;
  const meanY = vals.reduce((a, b) => a + b, 0) / n;

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (vals[i]! - meanY);
    den += (i - meanX) ** 2;
  }
  return den === 0 ? null : num / den;
}
