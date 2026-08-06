/**
 * Stooq price provider — free daily OHLCV, no API key, no documented quota.
 *
 * URL shape:  https://stooq.com/q/d/l/?s=nvda.us&i=d
 * Response:   CSV, `Date,Open,High,Low,Close,Volume`, oldest row first.
 *
 * Stooq is the primary source because it requires no key and imposes no
 * per-request quota, which is what makes the whole pipeline runnable by anyone
 * who clones this repo. It is not an official API and carries no SLA — hence
 * the Yahoo fallback in `yahoo.mjs`.
 */

const BASE = 'https://stooq.com/q/d/l/';

/** US equities and ETFs are lowercase ticker + `.us` on Stooq. */
export function toStooqSymbol(ticker) {
  return `${ticker.toLowerCase().replace(/\./g, '-')}.us`;
}

/**
 * Stooq answers a bad symbol with HTTP 200 and the body "No data", not a 404.
 * Treating any 200 as success is the failure that would publish an empty
 * dashboard over good data, so the body is checked, not just the status.
 */
export function parseCsv(text, ticker) {
  const trimmed = text.trim();

  if (!trimmed || /^no data/i.test(trimmed)) {
    throw new Error(`stooq returned no data for ${ticker}`);
  }

  const lines = trimmed.split('\n');
  const header = lines[0]?.toLowerCase() ?? '';
  if (!header.startsWith('date,')) {
    throw new Error(`stooq returned an unexpected header for ${ticker}: ${header.slice(0, 60)}`);
  }

  const candles = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length < 6) continue;

    const [date, open, high, low, close, volume] = parts;
    const time = Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000);
    const bar = {
      time,
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume),
    };

    // Stooq occasionally emits rows with empty or zero prices on holidays.
    // A zero close would divide by zero downstream in every return calculation.
    if (!Number.isFinite(time)) continue;
    if (![bar.open, bar.high, bar.low, bar.close].every((v) => Number.isFinite(v) && v > 0)) {
      continue;
    }
    if (!Number.isFinite(bar.volume) || bar.volume < 0) bar.volume = 0;

    candles.push(bar);
  }

  if (!candles.length) throw new Error(`stooq produced no usable rows for ${ticker}`);
  return candles;
}

export async function fetchCandles(ticker, { signal } = {}) {
  const url = `${BASE}?s=${encodeURIComponent(toStooqSymbol(ticker))}&i=d`;

  const response = await fetch(url, {
    signal,
    headers: { 'User-Agent': 'TickrLab/1.0 (+https://github.com/chanukyagattu/tickrlab)' },
  });

  if (!response.ok) {
    throw new Error(`stooq HTTP ${response.status} for ${ticker}`);
  }

  return parseCsv(await response.text(), ticker);
}

export const name = 'stooq';
