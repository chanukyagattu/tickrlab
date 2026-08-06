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

Early. The pipeline and the docs came first, deliberately — the scoring engine is
the substance and it's being built against a real data feed rather than mocks.

| | |
|---|---|
| Design doc | ✅ |
| Wireframes | ✅ |
| CI data pipeline + keepalive | ✅ workflows in, scripts in progress |
| Scoring engine + tests | 🔨 |
| Backtester (Web Worker) | 🔨 |
| Dashboard UI | ⬜ |
| Copilot + Worker | ⬜ |

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

npm test              # engine unit + property tests
npm run backtest      # CLI harness over committed bars
```

## Repository

```
.github/workflows/    deploy · fetch-prices · fetch-news · keepalive
scripts/              CI fetchers (Yahoo RSS + SEC EDGAR are keyless)
worker/               Cloudflare Worker — key custody + rate limit
src/engine/           indicators, scoring, backtest — pure, no I/O
src/data/             curated universe, committed, never fetched
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
