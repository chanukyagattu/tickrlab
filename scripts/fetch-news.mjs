#!/usr/bin/env node
/**
 * Fetch market news and SEC filings, write news.json.
 *
 * Both sources are free and keyless, and neither sends CORS headers — a
 * browser cannot read either one directly. Fetching in CI sidesteps that
 * entirely, because there is no browser origin in Actions.
 *
 * SEC EDGAR is the differentiator here: 8-K and 10-Q filings are free,
 * unlimited, and absent from essentially every other portfolio dashboard. The
 * only requirement is a descriptive User-Agent with contact details, which is
 * SEC access policy rather than a rate limit — they return 403 without it.
 *
 * Usage: node scripts/fetch-news.mjs --out dist-data
 */

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const SEC_USER_AGENT =
  process.env.SEC_USER_AGENT ?? 'TickrLab/1.0 (chanukyasharma@gmail.com)';

const MAX_ITEMS = 120;
const MAX_CONCURRENCY = 3;
const REQUEST_TIMEOUT_MS = 15_000;

/** Symbols we pull per-company news for. The full universe would be noise. */
const HEADLINE_SYMBOLS = ['NVDA', 'AAPL', 'MSFT', 'AMZN', 'GOOGL', 'META', 'TSLA', 'JPM'];

function parseArgs(argv) {
  const out = { outDir: 'dist-data' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out' && argv[i + 1]) out.outDir = argv[++i];
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

async function get(url, headers) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, headers });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Minimal RSS/Atom extraction.
 *
 * A full XML parser is a dependency this does not need — the two feeds
 * involved are well-formed and the fields wanted are few. If that stops being
 * true the failure is a dropped item, not corrupt data, because every field is
 * validated below before it is emitted.
 */
export function parseFeed(xml) {
  const items = [];
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/g) ?? [];

  for (const block of blocks) {
    const pick = (tag) => {
      const cdata = block.match(new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>`, 'i'));
      if (cdata) return cdata[1].trim();
      const plain = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
      return plain ? plain[1].trim() : '';
    };

    const title = decode(pick('title'));
    let link = decode(pick('link'));
    if (!link) {
      const href = block.match(/<link[^>]*href=["']([^"']+)["']/i);
      link = href ? decode(href[1]) : '';
    }

    const dateText = pick('pubDate') || pick('updated') || pick('published');
    const parsed = Date.parse(dateText);
    const time = Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;

    if (!title || !link || time === null) continue;
    items.push({ title, link, time });
  }

  return items;
}

function decode(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, '')
    .trim();
}

/** Yahoo Finance per-symbol RSS. Keyless, but CORS-blocked in a browser. */
async function fetchYahooNews(symbol) {
  const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${symbol}&region=US&lang=en-US`;
  try {
    const xml = await get(url, { 'User-Agent': 'Mozilla/5.0 (compatible; TickrLab/1.0)' });
    return parseFeed(xml).map((item) => ({
      id: `yahoo:${symbol}:${item.link}`,
      headline: item.title,
      source: 'YAHOO',
      url: item.link,
      datetime: item.time,
      symbols: [symbol],
    }));
  } catch (error) {
    console.warn(`  ! yahoo ${symbol}: ${error.message}`);
    return [];
  }
}

/**
 * SEC EDGAR full-text filing feed, filtered to the forms that actually move
 * prices: 8-K (material events), 10-Q, 10-K.
 */
async function fetchSecFilings() {
  const url =
    'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&dateb=&owner=include&count=100&output=atom';
  try {
    const xml = await get(url, { 'User-Agent': SEC_USER_AGENT, Accept: 'application/atom+xml' });
    return parseFeed(xml).map((item) => {
      // EDGAR titles look like "8-K - COMPANY NAME (0000123456) (Filer)".
      const formMatch = item.title.match(/^([0-9A-Z/-]+)\s+-\s+/);
      return {
        id: `sec:${item.link}`,
        headline: item.title.replace(/\s*\(\d{10}\)\s*\(Filer\)\s*$/, '').trim(),
        source: 'SEC',
        url: item.link,
        datetime: item.time,
        symbols: [],
        formType: formMatch ? formMatch[1] : '8-K',
      };
    });
  } catch (error) {
    console.warn(`  ! sec edgar: ${error.message}`);
    return [];
  }
}

async function main() {
  const { outDir } = parseArgs(process.argv.slice(2));

  const universeRaw = await readFile(join(ROOT, 'src/data/universe.json'), 'utf8');
  const universe = JSON.parse(universeRaw).assets;
  const known = new Set(Object.keys(universe));

  console.log(`fetching news for ${HEADLINE_SYMBOLS.length} symbols + SEC filings`);

  const [perSymbol, filings] = await Promise.all([
    pool(HEADLINE_SYMBOLS.filter((s) => known.has(s)), MAX_CONCURRENCY, fetchYahooNews),
    fetchSecFilings(),
  ]);

  const all = [...perSymbol.flat(), ...filings];

  // Yahoo repeats the same story across symbol feeds; dedupe on URL.
  const seen = new Set();
  const deduped = [];
  for (const item of all) {
    const key = item.url;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  deduped.sort((a, b) => b.datetime - a.datetime);
  const items = deduped.slice(0, MAX_ITEMS);

  console.log(
    `\n${items.length} items ` +
      `(yahoo: ${items.filter((i) => i.source === 'YAHOO').length}, ` +
      `sec: ${items.filter((i) => i.source === 'SEC').length})`,
  );

  if (!items.length) {
    console.error('refusing to publish an empty news payload');
    process.exit(1);
  }

  const payload = { generatedAt: Math.floor(Date.now() / 1000), items };

  await mkdir(outDir, { recursive: true });
  const target = join(outDir, 'news.json');
  await writeFile(target, JSON.stringify(payload));
  console.log(`wrote ${target}`);
}

// Only run when invoked directly, so the parser can be imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
