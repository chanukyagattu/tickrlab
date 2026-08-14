# TickrLab

**Signals computed, never asserted.**

A market dashboard with no server anywhere in it, and no number in the UI that
can't be recomputed by hand from what's on screen.

[📐 Wireframes](https://chanukyagattu.github.io/tickrlab/wireframes/) ·
[📖 Design doc](DESIGN.md) ·
[🧭 Portfolio](https://chanukyagattu.github.io/portfolio/)

> ### ⚠️ Not financial advice
> TickrLab is a technical demonstration. Data may be delayed, incomplete, or
> incorrect. Scores are mechanical calculations with **no demonstrated predictive
> value** — the measured hit rate is published in the UI, and it is worse than
> buy-and-hold. Nothing here is an offer to buy or sell any security.

---

## What it does

Equities, bond and commodity ETFs, and crypto each carry a momentum score. The
score is never rendered as a verdict — it decomposes into the four inputs that
produced it, prints their raw values, and sits next to the measured historical
hit rate of that exact configuration.

That hit rate is ~51% after costs. It ships in the UI rather than the footnotes.
A signal you can't falsify isn't an engineering artifact.

## The two ideas worth reading about

**GitHub Actions as the backend.** Static hosting has no server to hide an API
key in or absorb a rate limit, and most financial feeds send no CORS headers. So
the fetch moves to CI: scheduled jobs run under repo secrets and force-push a
single-commit orphan `data` branch. Every visitor reads a static file — ten
thousand concurrent users cost the same upstream call budget as zero.

**The model narrates, it never computes.** Scores are calculated client-side and
passed to the copilot as context. It explains numbers it did not produce, so it
structurally cannot hallucinate a price or an RSI. A local intent classifier
refuses advice queries before any inference is billed.

Both are covered properly in [DESIGN.md](DESIGN.md).

## Status

| | |
|---|---|
| Design doc + wireframes | ✅ |
| CI data pipeline + keepalive | ✅ keyless — no API account required |
| Scoring engine + tests | ✅ 145 tests |
| Backtester (Web Worker) | ✅ |
| Dashboard UI | ✅ |
| Crypto WebSocket | ✅ |
| Copilot — classifier + context | ✅ tested, incl. jailbreak cases |
| Copilot — live inference | ⬜ needs a Cloudflare Worker deploy |

**Prices need a free [Tiingo](https://tiingo.com) key** (`TIINGO_TOKEN`, in repo
secrets for CI or your shell locally). **News needs nothing** — SEC EDGAR is
keyless and works out of the box.

It was built keyless first, on Stooq and Yahoo. Both turned out to be unusable:
Stooq now serves a JavaScript challenge to every request regardless of
User-Agent, and Yahoo returns 429 from a cold IP. `npm run diagnose` is the
script written to establish that, after two rounds of guessing at it.

Switching to a keyed provider made the architecture more coherent, not less —
the whole "Actions as backend" argument is about key custody, and with keyless
sources that argument was decorative.

### Three things that were caught by measuring, not assuming

Worth recording, because both were silent failures that looked like results:

**RSI returned 100 for a flat series.** A naive `loss === 0 ? 100` guard sends
zero-movement down the same branch as all-gains, so an unmoved asset read as
maximally overbought and scored −40. Caught by a hand-computed fixture, not by
comparing against another library — which would have agreed if it shared the
same misreading.

**The default signal threshold selected nothing.** Measured across 5,100 scored
bars, `|score|` exceeds 50 approximately 0.0% of the time, because RSI is read
as mean-reversion while EMA spread is trend-following and the two partly cancel.
The backtest ran zero trades and reported a 0% hit rate as though that were a
finding. Threshold is now 25, sitting near the 90th percentile of the real
distribution.

**A script exited 0 having done nothing.** The `main()` guard compared
``import.meta.url`` against `` `file://${process.argv[1]}` ``, which never
matches on a path containing a space or a non-ASCII character, because one side
is percent-encoded and the other is not. On a checkout under
`Documents - Chanukya's MacBook Pro` the news fetcher silently did nothing and
returned success — worse than crashing, since CI reports it green. Fixed with
`pathToFileURL`.

## Stack

React 19 · TypeScript · Vite · Zustand · lightweight-charts · Web Workers ·
GitHub Actions · Cloudflare Workers AI

Indicators are hand-written rather than pulled from `technicalindicators` — about
120 lines, one fewer thinly-maintained dependency, and unit tests that verify the
maths instead of verifying that two implementations share a bug.

## Data

| Path | Assets | Transport | Freshness |
|---|---|---|---|
| Live | Crypto majors | WebSocket, keyless | Real-time |
| Batch | Equities, ETFs | Static JSON from CI | End of day |
| Batch | News, SEC filings | Static JSON from CI | ~30–45 min |

Bonds and physical commodities are represented by ETF proxies (TLT, HYG, GLD,
USO…), which trade on ordinary US equity feeds. That's a real modelling
compromise — tracking error and equity hours are distortions the underlying
doesn't have — and the UI labels them as proxies.

The UI renders `generatedAt` from the payload rather than claiming "live".

## Local development

```bash
npm install
npm run dev

npm test              # 145 tests: indicators, scoring, backtest, parsers, intent
npm run typecheck
npm run build

npm run fetch:prices  # keyless — writes dist-data/prices.json
npm run fetch:news    # keyless — Yahoo RSS + SEC EDGAR
```

To develop against locally fetched data instead of the published `data` branch,
set `VITE_DATA_BASE=/dist-data` before `npm run dev`.

## Repository

```
.github/workflows/    deploy · fetch-prices · fetch-news · keepalive
scripts/
  providers/          stooq (primary) · yahoo (fallback), both keyless
  fetch-prices.mjs    validation gates before publish
  fetch-news.mjs      Yahoo RSS + SEC EDGAR
src/engine/           indicators · score · backtest — pure, no I/O, no clock
src/workers/          backtest off the main thread
src/copilot/          intent classifier — refuses advice before inference
src/data/             curated universe, committed, never fetched
src/components/       dashboard, score decomposition, validation
public/wireframes/    served at /tickrlab/wireframes/
```

## License

[Apache License 2.0](LICENSE) — see [NOTICE](NOTICE) for attribution and the
warranty/liability position.

Apache rather than MIT deliberately: §3 grants an explicit patent license and
§7–8 spell out the warranty and liability disclaimers in terms, which matters
more than usual for software that computes and displays financial indicators.

---

*Built by [Chanukya Gattu](https://chanukyagattu.github.io/portfolio/). Sibling to
[StreamForge](https://chanukyagattu.github.io/stream-forge/).*
