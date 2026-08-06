#!/usr/bin/env node
/**
 * Fetch daily OHLCV for the equity and ETF universe and write prices.json.
 *
 * Runs in GitHub Actions, never in a browser. That placement is the whole
 * architecture: there is no browser origin in CI, so CORS does not apply, and
 * visitors read a static file rather than hitting a provider — ten thousand
 * concurrent users cost the same upstream call budget as zero.
 *
 * Both providers are keyless, so this script runs for anyone who clones the
 * repo with no signup and no secret.
 *
 * Usage: node scripts/fetch-prices.mjs --out dist-data
 */

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as stooq from './providers/stooq.mjs';
import * as yahoo from './providers/yahoo.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const MIN_CANDLES = 60;      // matches MIN_CANDLES in src/engine/score.ts
const MIN_ASSETS = 40;       // below this the payload is not worth publishing
const MAX_CONCURRENCY = 4;   // polite to a free, unmetered endpoint
const REQUEST_TIMEOUT_MS = 20_000;

function parseArgs(argv) {
  const out = { outDir: 'dist-data' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out' && argv[i + 1]) out.outDir = argv[++i];
  }
  return out;
}

/** Run tasks with bounded concurrency, collecting results rather than failing fast. */
async function pool(items, limit, worker) {
  const results = [];
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}

async function withTimeout(fn) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Try the primary provider, fall back to the secondary.
 *
 * Which provider served a symbol is recorded per asset. A silent drift from
 * primary to fallback across the whole universe would otherwise be invisible,
 * and it is exactly the kind of degradation worth noticing early.
 */
async function fetchWithFallback(ticker) {
  const errors = [];

  for (const provider of [stooq, yahoo]) {
    try {
      const candles = await withTimeout((signal) => provider.fetchCandles(ticker, { signal }));

      if (candles.length < MIN_CANDLES) {
        throw new Error(`only ${candles.length} candles, need ${MIN_CANDLES}`);
      }

      // Providers do not guarantee ordering; the engine assumes ascending time.
      candles.sort((a, b) => a.time - b.time);

      // Duplicate timestamps have been observed around splits. Keep the last.
      const deduped = [];
      for (const candle of candles) {
        const previous = deduped[deduped.length - 1];
        if (previous && previous.time === candle.time) deduped[deduped.length - 1] = candle;
        else deduped.push(candle);
      }

      return { ok: true, provider: provider.name, candles: deduped };
    } catch (error) {
      errors.push(`${provider.name}: ${error.message}`);
    }
  }

  return { ok: false, errors };
}

async function main() {
  const { outDir } = parseArgs(process.argv.slice(2));

  const universeRaw = await readFile(join(ROOT, 'src/data/universe.json'), 'utf8');
  const universe = JSON.parse(universeRaw).assets;

  // Crypto is served live over WebSocket in the browser, so it is not fetched
  // here. Including it would produce a second, staler source of truth for the
  // same asset.
  const tickers = Object.entries(universe)
    .filter(([, meta]) => meta.type !== 'CRYPTO')
    .map(([ticker]) => ticker);

  console.log(`fetching ${tickers.length} symbols (stooq primary, yahoo fallback)`);

  const started = Date.now();
  const results = await pool(tickers, MAX_CONCURRENCY, async (ticker) => {
    const outcome = await fetchWithFallback(ticker);
    if (outcome.ok) {
      const flag = outcome.provider === 'stooq' ? ' ' : '~';
      console.log(`  ${flag} ${ticker.padEnd(6)} ${String(outcome.candles.length).padStart(5)} bars  [${outcome.provider}]`);
    } else {
      console.warn(`  ! ${ticker.padEnd(6)} FAILED — ${outcome.errors.join(' | ')}`);
    }
    return { ticker, ...outcome };
  });

  const assets = {};
  const providerCounts = {};
  const failures = [];

  for (const result of results) {
    if (result.ok) {
      assets[result.ticker] = { candles: result.candles };
      providerCounts[result.provider] = (providerCounts[result.provider] ?? 0) + 1;
    } else {
      failures.push(result.ticker);
    }
  }

  const count = Object.keys(assets).length;
  console.log(
    `\n${count}/${tickers.length} symbols in ${((Date.now() - started) / 1000).toFixed(1)}s ` +
      `(${Object.entries(providerCounts).map(([k, v]) => `${k}:${v}`).join(', ')})`,
  );
  if (failures.length) console.warn(`failed: ${failures.join(', ')}`);

  // Refuse to publish a thin payload. A partial fetch that overwrites a good
  // snapshot is worse than a failed job, because the job failure is loud and
  // the thin dashboard is silent.
  if (count < MIN_ASSETS) {
    console.error(`\nrefusing to publish: ${count} assets is below the ${MIN_ASSETS} minimum`);
    process.exit(1);
  }

  const payload = {
    generatedAt: Math.floor(Date.now() / 1000),
    provider: Object.keys(providerCounts).join('+') || 'none',
    assets,
  };

  await mkdir(outDir, { recursive: true });
  const target = join(outDir, 'prices.json');
  await writeFile(target, JSON.stringify(payload));

  const bytes = JSON.stringify(payload).length;
  console.log(`wrote ${target} (${(bytes / 1024 / 1024).toFixed(2)} MB)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
