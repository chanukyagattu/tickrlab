/**
 * Composite momentum score.
 *
 * Four components, each normalised to [-1, 1], weighted, summed, clamped to
 * [-100, 100]. The total is never displayed on its own — the UI always renders
 * the decomposition beside it, so a reader can recompute the number by hand
 * from the raw inputs. That auditability is the entire design goal, and it is
 * the reason the copilot is never permitted to produce these figures.
 *
 * The weights below are a judgement call, not a fitted result. Nothing here was
 * optimised against historical returns, which is deliberate: parameters swept
 * against a fixed history produce a curve that looks good and predicts nothing.
 * See `backtest.ts` for what this configuration actually achieves.
 */

import type { Candle, MomentumScore, ScoreBand, ScoreComponent } from './types';
import { atr, ema, latest, macd, rsi, slope, sma } from './indicators';

export interface ScoreConfig {
  rsiPeriod: number;
  emaFast: number;
  emaSlow: number;
  atrPeriod: number;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
  volumeLookback: number;
  weights: Record<'RSI' | 'EMA_SPREAD' | 'MACD_SLOPE' | 'VOLUME', number>;
}

export const DEFAULT_CONFIG: ScoreConfig = {
  rsiPeriod: 14,
  emaFast: 20,
  emaSlow: 50,
  atrPeriod: 14,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  volumeLookback: 20,
  weights: { RSI: 0.4, EMA_SPREAD: 0.3, MACD_SLOPE: 0.2, VOLUME: 0.1 },
};

/** Enough bars for the slowest indicator (EMA 50) plus a usable tail. */
export const MIN_CANDLES = 60;

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

const round = (v: number, dp = 2): number => {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};

/**
 * RSI to [-1, 1].
 *
 * Note the sign: RSI 30 (oversold) maps to +1, RSI 70 (overbought) to -1. This
 * is the mean-reversion reading, and it is a choice rather than a fact — a
 * momentum reading would invert it. Stated here because a reader comparing this
 * against a trend-following score will otherwise think it is a bug.
 */
function normaliseRsi(value: number): number {
  return clamp((50 - value) / 20, -1, 1);
}

/** EMA spread in ATR units. ±2 ATR is treated as a full-strength trend. */
function normaliseSpread(fast: number, slow: number, atrValue: number): number {
  if (atrValue <= 0) return 0;
  return clamp((fast - slow) / atrValue / 2, -1, 1);
}

/** MACD histogram slope, scaled by ATR so it is comparable across assets. */
function normaliseMacdSlope(slopeValue: number, atrValue: number): number {
  if (atrValue <= 0) return 0;
  return clamp((slopeValue / atrValue) * 10, -1, 1);
}

/**
 * Volume relative to its own average, log-scaled and capped at 3x.
 *
 * Volume is unsigned — heavy volume confirms whatever direction the other
 * components found, so it is multiplied by the sign of their consensus rather
 * than contributing a direction of its own. A 3x volume day on a collapsing
 * price is not bullish.
 */
function normaliseVolume(ratio: number, directionSign: number): number {
  if (ratio <= 0) return 0;
  const magnitude = clamp(Math.log(clamp(ratio, 0.01, 3)) / Math.log(3), -1, 1);
  return magnitude * directionSign;
}

export function bandOf(total: number): ScoreBand {
  if (total <= -60) return 'STRONGLY BEARISH';
  if (total <= -20) return 'BEARISH';
  if (total < 20) return 'NEUTRAL';
  if (total < 60) return 'BULLISH';
  return 'STRONGLY BULLISH';
}

/**
 * Score a candle series. Returns null when there is not enough history —
 * never a fabricated neutral score, because a real 0 and "I don't know" are
 * different statements and the UI renders them differently.
 */
export function computeScore(
  candles: readonly Candle[],
  config: ScoreConfig = DEFAULT_CONFIG,
): MomentumScore | null {
  if (candles.length < MIN_CANDLES) return null;

  const close = candles.map((c) => c.close);
  const high = candles.map((c) => c.high);
  const low = candles.map((c) => c.low);
  const volume = candles.map((c) => c.volume);

  const rsiValue = latest(rsi(close, config.rsiPeriod));
  const fastValue = latest(ema(close, config.emaFast));
  const slowValue = latest(ema(close, config.emaSlow));
  const atrValue = latest(atr(high, low, close, config.atrPeriod));
  const hist = macd(close, config.macdFast, config.macdSlow, config.macdSignal).histogram;
  const histSlope = slope(hist, 3);
  // Average of the bars PRECEDING the current one. Including today in today's
  // own average dampens the very spike the component exists to detect: a 3x
  // volume day against 19 normal days reads as 2.7x rather than 3x.
  const volumeAvgSeries = sma(volume, config.volumeLookback);
  const avgVolume = volumeAvgSeries[volumeAvgSeries.length - 2] ?? null;
  const lastVolume = volume[volume.length - 1] ?? 0;

  if (
    rsiValue === null ||
    fastValue === null ||
    slowValue === null ||
    atrValue === null ||
    histSlope === null ||
    avgVolume === null ||
    avgVolume === 0
  ) {
    return null;
  }

  const rsiNorm = normaliseRsi(rsiValue);
  const spreadRaw = (fastValue - slowValue) / atrValue;
  const spreadNorm = normaliseSpread(fastValue, slowValue, atrValue);
  const macdNorm = normaliseMacdSlope(histSlope, atrValue);

  // Volume takes its sign from the directional components, weighted as they
  // are relative to each other.
  const directional =
    rsiNorm * config.weights.RSI +
    spreadNorm * config.weights.EMA_SPREAD +
    macdNorm * config.weights.MACD_SLOPE;
  const directionSign = directional === 0 ? 0 : Math.sign(directional);

  const volumeRatio = lastVolume / avgVolume;
  const volumeNorm = normaliseVolume(volumeRatio, directionSign);

  const build = (
    key: ScoreComponent['key'],
    raw: number,
    normalised: number,
    note: string,
  ): ScoreComponent => {
    const weight = config.weights[key];
    return {
      key,
      raw: round(raw),
      normalised: round(normalised, 4),
      weight,
      contribution: round(normalised * weight * 100, 1),
      note,
    };
  };

  const components: ScoreComponent[] = [
    build(
      'RSI',
      rsiValue,
      rsiNorm,
      rsiValue < 30
        ? 'oversold (below 30)'
        : rsiValue > 70
          ? 'overbought (above 70)'
          : 'within the conventional 30-70 range',
    ),
    build(
      'EMA_SPREAD',
      spreadRaw,
      spreadNorm,
      `EMA${config.emaFast} ${fastValue >= slowValue ? 'above' : 'below'} EMA${config.emaSlow}, in ATR units`,
    ),
    build(
      'MACD_SLOPE',
      histSlope,
      macdNorm,
      `histogram ${histSlope > 0 ? 'rising' : histSlope < 0 ? 'falling' : 'flat'} over 3 sessions`,
    ),
    build(
      'VOLUME',
      volumeRatio,
      volumeNorm,
      `${round(volumeRatio)}x the ${config.volumeLookback}-period average` +
        (directionSign === 0 ? ' (no directional consensus to confirm)' : ''),
    ),
  ];

  const total = clamp(
    components.reduce((sum, c) => sum + c.contribution, 0),
    -100,
    100,
  );

  const last = candles[candles.length - 1]!;

  return {
    total: round(total, 1),
    components,
    candlesUsed: candles.length,
    asOf: last.time,
  };
}
