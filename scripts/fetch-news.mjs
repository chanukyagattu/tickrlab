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
import { fileURLToPath, pathToFileURL } from 'node:url';

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

/**
 * Yahoo Finance per-symbol RSS. BEST EFFORT ONLY — do not rely on this.
 *
 * Measured 2026-08: returns HTTP 429 with a 19-byte "Too Many Requests" body
 * on every request, including the first from a cold IP. That is a block, not a
 * throttle, so there is nothing to back off from and retrying is pointless.
 *
 * Kept because it costs one request and may work from other addresses, but the
 * pipeline's health does not depend on it: an empty return here is normal.
 */
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
 * SEC EDGAR filings, across the form types that actually move prices.
 *
 * PRIMARY SOURCE. Measured 2026-08: EDGAR returns clean Atom in ~390ms with a
 * descriptive User-Agent, while Yahoo's RSS endpoint returns a flat HTTP 429.
 * SEC is also the more defensible source — it is the issuer's own filing, not
 * an aggregator's summary of it.
 */
async function fetchSecFilings() {
  const forms = ['8-K', '10-Q', '10-K'];
  const results = await pool(forms, 1, (form) => fetchSecForm(form));
  return results.flat();
}

async function fetchSecForm(formType) {
  const url =
    `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=${encodeURIComponent(formType)}` +
    '&dateb=&owner=include&count=60&output=atom';
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
        formType: formMatch ? formMatch[1] : formType,
      };
    });
  } catch (error) {
    console.warn(`  ! sec edgar ${formType}: ${error.message}`);
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

  const secCount = items.filter((i) => i.source === 'SEC').length;
  const yahooCount = items.filter((i) => i.source === 'YAHOO').length;
  console.log(`\n${items.length} items (sec: ${secCount}, yahoo: ${yahooCount})`);

  // SEC is the primary source; Yahoo is best effort. Failing the job only when
  // SEC is also empty means a Yahoo block — the normal case — does not turn
  // the pipeline red for something that was never load-bearing.
  if (!secCount) {
    console.error(
      'refusing to publish: SEC EDGAR returned nothing. Check the User-Agent ' +
        '(SEC requires contact details and returns 403 without them), or whether ' +
        'this IP range is blocked.',
    );
    process.exit(1);
  }

  const payload = { generatedAt: Math.floor(Date.now() / 1000), items };

  await mkdir(outDir, { recursive: true });
  const target = join(outDir, 'news.json');
  await writeFile(target, JSON.stringify(payload));
  console.log(`wrote ${target}`);
}

// Only run when invoked directly, so the parser can be imported by tests.
//
// `pathToFileURL` is required, not cosmetic. The naive comparison
//     import.meta.url === `file://${process.argv[1]}`
// fails on any path containing a space or a non-ASCII character, because
// import.meta.url is percent-encoded and argv[1] is not. On a checkout under
// "Documents - Chanukya’s MacBook Pro" the two never match, so main() silently
// never ran and the script exited 0 having done nothing — which is a far worse
// failure than a crash, because CI reports it as success.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
