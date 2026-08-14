#!/usr/bin/env node
/**
 * Fetch daily OHLCV for the equity and ETF universe and write prices.json.
 *
 * INCREMENTAL BY DESIGN. Tiingo's free tier allows 50 requests/hour and the
 * universe is 55 symbols, so a naive full run hits the cap every time and
 * publishes a partial payload. Instead each run:
 *
 *   1. loads the previously published payload (if any),
 *   2. picks the symbols that are missing or stalest,
 *   3. fetches at most MAX_PER_RUN of them,
 *   4. merges the result over the existing data and republishes.
 *
 * Coverage therefore converges over the first two runs and stays fresh after
 * that, without ever tripping the rate limit. It also means a partial failure
 * degrades to "some symbols are a day older" rather than "the dashboard lost
 * half its assets".
 *
 * Usage: node scripts/fetch-prices.mjs --out dist-data [--existing <file>]
 */

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import * as tiingo from './providers/tiingo.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const MIN_CANDLES = 60;        // matches MIN_CANDLES in src/engine/score.ts
const MIN_ASSETS = 30;         // floor below which the payload is not worth publishing
const MAX_PER_RUN = 40;        // headroom under Tiingo's 50/hour free tier
const CONCURRENCY = 2;
const REQUEST_TIMEOUT_MS = 20_000;

function parseArgs(argv) {
  const out = { outDir: 'dist-data', existing: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out' && argv[i + 1]) out.outDir = argv[++i];
    if (argv[i] === '--existing' && argv[i + 1]) out.existing = argv[++i];
  }
  return out;
}

async function pool(items, limit, worker) {
  const results = [];
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
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

/** Newest candle timestamp in a series, or 0 when there is none. */
function freshness(entry) {
  const candles = entry?.candles;
  if (!Array.isArray(candles) || !candles.length) return 0;
  return candles[candles.length - 1]?.time ?? 0;
}

async function loadExisting(path) {
  if (!path) return { assets: {} };
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    // First run, or the data branch does not exist yet. Not an error.
    console.log('no existing payload found — bootstrapping');
    return { assets: {} };
  }
}

async function main() {
  const { outDir, existing: existingPath } = parseArgs(process.argv.slice(2));

  const token = process.env.TIINGO_TOKEN;
  if (!token) {
    console.error(
      'TIINGO_TOKEN is not set.\n' +
        '  local: export TIINGO_TOKEN=... (free key from tiingo.com)\n' +
        '  CI:    add TIINGO_TOKEN to repository secrets',
    );
    process.exit(1);
  }

  const universeRaw = await readFile(join(ROOT, 'src/data/universe.json'), 'utf8');
  const universe = JSON.parse(universeRaw).assets;

  // Crypto streams live over WebSocket in the browser. Fetching it here would
  // create a second, staler source of truth for the same asset.
  const tickers = Object.entries(universe)
    .filter(([, meta]) => meta.type !== 'CRYPTO')
    .map(([ticker]) => ticker);

  const existing = await loadExisting(existingPath);
  const existingAssets = existing.assets ?? {};

  // Stalest first, so missing symbols (freshness 0) are always picked up
  // before symbols that merely need a refresh.
  const queue = [...tickers].sort(
    (a, b) => freshness(existingAssets[a]) - freshness(existingAssets[b]),
  );
  const batch = queue.slice(0, MAX_PER_RUN);

  console.log(
    `universe ${tickers.length} · already held ${Object.keys(existingAssets).length} · ` +
      `refreshing ${batch.length} this run (Tiingo free tier is 50/hour)`,
  );

  const started = Date.now();
  let rateLimited = false;

  const results = await pool(batch, CONCURRENCY, async (ticker) => {
    if (rateLimited) return { ticker, ok: false, error: 'skipped after rate limit' };
    try {
      const candles = await withTimeout((signal) =>
        tiingo.fetchCandles(ticker, { signal, token }),
      );
      if (candles.length < MIN_CANDLES) {
        throw new Error(`only ${candles.length} candles, need ${MIN_CANDLES}`);
      }
      console.log(`  · ${ticker.padEnd(6)} ${String(candles.length).padStart(4)} bars`);
      return { ticker, ok: true, candles };
    } catch (error) {
      // Once the hourly cap is hit every remaining request will fail too.
      // Stop hammering and keep whatever was already retrieved.
      if (/rate limit/i.test(error.message)) rateLimited = true;
      console.warn(`  ! ${ticker.padEnd(6)} ${error.message}`);
      return { ticker, ok: false, error: error.message };
    }
  });

  const merged = { ...existingAssets };
  let refreshed = 0;
  for (const result of results) {
    if (result?.ok) {
      merged[result.ticker] = { candles: result.candles };
      refreshed++;
    }
  }

  const total = Object.keys(merged).length;
  console.log(
    `\nrefreshed ${refreshed}/${batch.length} in ${((Date.now() - started) / 1000).toFixed(1)}s · ` +
      `${total}/${tickers.length} symbols held`,
  );
  if (rateLimited) {
    console.log('hit the hourly cap — remaining symbols will be picked up next run');
  }

  // Never publish a payload thinner than what is already live. A partial fetch
  // overwriting a good snapshot is worse than a failed job: the job failure is
  // loud, the thin dashboard is silent.
  const held = Object.keys(existingAssets).length;
  if (total < held) {
    console.error(`refusing to publish: ${total} assets is fewer than the ${held} already live`);
    process.exit(1);
  }
  if (total < MIN_ASSETS) {
    console.error(`refusing to publish: ${total} assets is below the ${MIN_ASSETS} floor`);
    process.exit(1);
  }

  const payload = {
    generatedAt: Math.floor(Date.now() / 1000),
    provider: 'tiingo',
    assets: merged,
  };

  await mkdir(outDir, { recursive: true });
  const target = join(outDir, 'prices.json');
  const body = JSON.stringify(payload);
  await writeFile(target, body);
  console.log(`wrote ${target} (${(body.length / 1024 / 1024).toFixed(2)} MB)`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
