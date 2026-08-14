#!/usr/bin/env node
/**
 * Provider diagnostic.
 *
 * Written because two rounds were spent guessing why the fetchers failed. This
 * measures instead: it tries each endpoint under several User-Agent and URL
 * variants and prints exactly what came back, so the fix is chosen from
 * evidence rather than from a plausible story about bot protection.
 *
 * Usage: node scripts/diagnose.mjs
 */

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const BOT_UA = 'TickrLab/1.0 (+https://github.com/chanukyagattu/tickrlab)';

function describe(body) {
  const head = body.slice(0, 120).replace(/\s+/g, ' ');
  if (/^\s*</.test(body)) return `HTML  «${head}»`;
  if (/^date,/i.test(body.trim())) return `CSV   «${head}»`;
  if (/^\s*[[{]/.test(body)) return `JSON  «${head}»`;
  return `?     «${head}»`;
}

async function probe(label, url, headers) {
  const started = Date.now();
  try {
    const response = await fetch(url, { headers, redirect: 'follow' });
    const body = await response.text();
    const ms = Date.now() - started;
    const verdict =
      response.ok && /^date,/i.test(body.trim())
        ? '✅ USABLE CSV'
        : response.ok && /^\s*[[{]/.test(body)
          ? '✅ USABLE JSON'
          : response.ok && /<(rss|feed)\b/i.test(body)
            ? '✅ USABLE FEED'
            : '❌';

    console.log(`\n${label}`);
    console.log(`   ${url}`);
    console.log(`   HTTP ${response.status}  ${ms}ms  ${verdict}`);
    console.log(`   ${describe(body)}`);
    console.log(`   bytes: ${body.length}`);
    return verdict.startsWith('✅');
  } catch (error) {
    console.log(`\n${label}`);
    console.log(`   ${url}`);
    console.log(`   ❌ threw: ${error.message}`);
    return false;
  }
}

console.log('TickrLab provider diagnostic');
console.log('='.repeat(62));

console.log('\n\n── STOOQ ─────────────────────────────────────────────');
await probe('stooq · bot UA (what the code sends today)', 'https://stooq.com/q/d/l/?s=nvda.us&i=d', {
  'User-Agent': BOT_UA,
});
await probe('stooq · browser UA', 'https://stooq.com/q/d/l/?s=nvda.us&i=d', {
  'User-Agent': BROWSER_UA,
  Accept: 'text/csv,text/plain,*/*',
});
await probe('stooq · no UA header at all', 'https://stooq.com/q/d/l/?s=nvda.us&i=d', {});
await probe('stooq · alternate host (stooq.pl)', 'https://stooq.pl/q/d/l/?s=nvda.us&i=d', {
  'User-Agent': BROWSER_UA,
});

console.log('\n\n── YAHOO ─────────────────────────────────────────────');
await probe(
  'yahoo chart · browser UA',
  'https://query1.finance.yahoo.com/v8/finance/chart/NVDA?range=2y&interval=1d',
  { 'User-Agent': BROWSER_UA, Accept: 'application/json' },
);
await probe(
  'yahoo chart · query2 host',
  'https://query2.finance.yahoo.com/v8/finance/chart/NVDA?range=2y&interval=1d',
  { 'User-Agent': BROWSER_UA, Accept: 'application/json' },
);

console.log('\n\n── NEWS ──────────────────────────────────────────────');
await probe(
  'yahoo RSS headline feed',
  'https://feeds.finance.yahoo.com/rss/2.0/headline?s=NVDA&region=US&lang=en-US',
  { 'User-Agent': BROWSER_UA },
);
await probe(
  'sec edgar atom',
  'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&dateb=&owner=include&count=20&output=atom',
  { 'User-Agent': 'TickrLab/1.0 (chanukyasharma@gmail.com)', Accept: 'application/atom+xml' },
);

console.log('\n\n' + '='.repeat(62));
console.log('Paste this whole output back. Any line marked ✅ is a working');
console.log('source; the fix is to adopt whichever variant works, not to add');
console.log('retries to one that is being deliberately refused.');
