/**
 * Yahoo Finance price provider — fallback only.
 *
 * URL shape:
 *   https://query1.finance.yahoo.com/v8/finance/chart/NVDA?range=2y&interval=1d
 *
 * This endpoint is undocumented and unsupported. It is used here strictly as a
 * fallback for symbols Stooq fails on, and the pipeline records which provider
 * served each asset so a silent shift from primary to fallback is visible
 * rather than invisible.
 *
 * The response nests OHLCV as parallel arrays with nulls on non-trading days,
 * which have to be dropped index-wise across all six arrays at once.
 */

const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

export async function fetchCandles(ticker, { signal, range = '2y' } = {}) {
  const url = `${BASE}/${encodeURIComponent(ticker)}?range=${range}&interval=1d`;

  const response = await fetch(url, {
    signal,
    headers: {
      // Yahoo returns 403 to clients that do not look like browsers.
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      Accept: 'application/json',
    },
  });

  if (!response.ok) throw new Error(`yahoo HTTP ${response.status} for ${ticker}`);

  return parseChart(await response.json(), ticker);
}

/** Pure: JSON payload in, candles out. Split from the fetch so it is testable. */
export function parseChart(payload, ticker) {
  const result = payload?.chart?.result?.[0];
  if (!result) {
    const message = payload?.chart?.error?.description ?? 'no result block';
    throw new Error(`yahoo returned no data for ${ticker}: ${message}`);
  }

  const timestamps = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0] ?? {};
  const { open = [], high = [], low = [], close = [], volume = [] } = quote;

  const candles = [];
  for (let i = 0; i < timestamps.length; i++) {
    const bar = {
      time: timestamps[i],
      open: open[i],
      high: high[i],
      low: low[i],
      close: close[i],
      volume: volume[i] ?? 0,
    };

    // Nulls appear on halted or non-trading sessions. Interpolating them would
    // invent price action that never happened, so the row is dropped instead.
    if (!Number.isFinite(bar.time)) continue;
    if (![bar.open, bar.high, bar.low, bar.close].every((v) => Number.isFinite(v) && v > 0)) {
      continue;
    }
    if (!Number.isFinite(bar.volume) || bar.volume < 0) bar.volume = 0;

    candles.push(bar);
  }

  if (!candles.length) throw new Error(`yahoo produced no usable rows for ${ticker}`);
  return candles;
}

export const name = 'yahoo';
