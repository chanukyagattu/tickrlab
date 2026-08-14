/**
 * Tiingo price provider — PRIMARY.
 *
 * Chosen after Stooq and Yahoo both became unusable for programmatic access
 * (Stooq now serves a JavaScript challenge page to every request regardless of
 * User-Agent; Yahoo returns HTTP 429 from a cold IP). Measured, not assumed —
 * see scripts/diagnose.mjs.
 *
 * URL:      https://api.tiingo.com/tiingo/daily/{ticker}/prices?startDate=...
 * Auth:     Authorization: Token <token>   (header, not query string)
 * Response: JSON array, oldest first, one object per session.
 *
 * FREE TIER: 50 requests/hour, 1000/day, 500 unique symbols/month. The hourly
 * cap is the binding one and is why fetch-prices.mjs refreshes a subset per
 * run rather than the whole universe.
 */

const BASE = 'https://api.tiingo.com/tiingo/daily';

/**
 * ADJUSTED PRICES, deliberately.
 *
 * Tiingo returns both raw and split/dividend-adjusted fields. Using raw prices
 * over a multi-year window puts fake discontinuities in the series at every
 * corporate action — NVDA's 10-for-1 split in June 2024 appears as a ~90%
 * single-session crash in unadjusted data, which would drive RSI to 0, invert
 * the EMA spread, and generate a maximum-conviction signal out of an
 * accounting event.
 *
 * Volume is adjusted too, or the volume-vs-average component sees a 10x spike
 * on the same day for the same non-reason.
 */
export function parsePrices(payload, ticker) {
  if (!Array.isArray(payload)) {
    const detail = payload?.detail ?? payload?.message ?? 'not an array';
    throw new Error(`tiingo returned no series for ${ticker}: ${detail}`);
  }
  if (payload.length === 0) {
    throw new Error(`tiingo returned an empty series for ${ticker}`);
  }

  const candles = [];
  for (const row of payload) {
    const time = Math.floor(Date.parse(row.date) / 1000);

    const open = row.adjOpen ?? row.open;
    const high = row.adjHigh ?? row.high;
    const low = row.adjLow ?? row.low;
    const close = row.adjClose ?? row.close;
    const volume = row.adjVolume ?? row.volume ?? 0;

    if (!Number.isFinite(time)) continue;
    if (![open, high, low, close].every((v) => Number.isFinite(v) && v > 0)) continue;

    candles.push({
      time,
      open,
      high,
      low,
      close,
      volume: Number.isFinite(volume) && volume >= 0 ? volume : 0,
    });
  }

  if (!candles.length) throw new Error(`tiingo produced no usable rows for ${ticker}`);

  candles.sort((a, b) => a.time - b.time);
  return candles;
}

export async function fetchCandles(ticker, { signal, token, startDate } = {}) {
  if (!token) throw new Error('TIINGO_TOKEN is not set');

  const start = startDate ?? isoDaysAgo(760); // ~2 years plus indicator warm-up
  const url = `${BASE}/${encodeURIComponent(ticker)}/prices?startDate=${start}`;

  const response = await fetch(url, {
    signal,
    headers: {
      // Header auth keeps the token out of URLs, which otherwise end up in
      // CI logs, proxy logs, and error messages.
      Authorization: `Token ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (response.status === 429) {
    throw new Error(`tiingo rate limit hit for ${ticker} (50/hour on the free tier)`);
  }
  if (response.status === 404) {
    throw new Error(`tiingo has no ticker ${ticker}`);
  }
  if (!response.ok) {
    throw new Error(`tiingo HTTP ${response.status} for ${ticker}`);
  }

  return parsePrices(await response.json(), ticker);
}

function isoDaysAgo(days) {
  const date = new Date(Date.now() - days * 86400_000);
  return date.toISOString().slice(0, 10);
}

export const name = 'tiingo';
