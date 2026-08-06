# TickrLab — Design

A market dashboard that computes its own signals in the browser, publishes its own
data from CI, and displays how often those signals have been wrong.

> **Not financial advice.** TickrLab is a technical demonstration. Data may be delayed,
> incomplete, or incorrect. Scores are mechanical calculations with no demonstrated
> predictive value — the measured hit rate is published in the UI. Nothing here is an
> offer to buy or sell any security.

---

## 1. What this is, and what it deliberately isn't

**It is** an instrument: it measures four properties of a price series, combines them
into one number, shows every input that produced that number, and reports how that
number has performed historically.

**It is not** a trading tool, a recommendation engine, or a real-time quote terminal.
It never emits "BUY", "SELL", "CALL", or "PUT". Those words imply a claim the system
cannot support, and the backtest in §7 is the evidence that it can't.

The naming carries this: *Lab*, not *Desk* or *Trader*. The positioning is structural
rather than a line in the footer.

---

## 2. The constraint that produced the design

GitHub Pages serves static files. There is no server-side runtime, which means:

- **No key custody.** Anything in the bundle is public. A `VITE_*` env var is not a
  secret, it is a published string. Free tiers get drained by scrapers within days.
- **No rate-limit absorption.** Every visitor calling a provider directly multiplies
  your quota by your traffic. Free tiers run in the single digits of calls per minute.
- **No CORS relief.** Most financial feeds — Yahoo RSS included — send no
  `Access-Control-Allow-Origin`, so the browser cannot read them at all.

The naive answer is a proxy, which is a server, which defeats the exercise. The answer
here is to move the fetch to **build time and CI time** instead of request time.

That single inversion resolves all three constraints at once, and it is the load-bearing
idea in the project.

---

## 3. Architecture

```
                        ┌──────────────────────────────┐
                        │   GitHub Actions (cron)      │
   provider ───────────▶│   key in repo secrets        │
   Yahoo RSS ──────────▶│   no browser, so no CORS     │
   SEC EDGAR ──────────▶│   validates before publish   │
                        └──────────────┬───────────────┘
                                       │ force-push, 1 commit
                                       ▼
                        ┌──────────────────────────────┐
                        │  orphan `data` branch        │
                        │  prices.json · news.json     │
                        └──────────────┬───────────────┘
                                       │ raw.githubusercontent (CORS *)
                                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    GitHub Pages — static bundle                      │
│                                                                      │
│   universe.json ──▶ ┌────────────────┐                               │
│   prices.json ────▶ │ scoring engine │──▶ grid · gauge · chart       │
│   WS (crypto) ────▶ │  pure, tested  │                               │
│                     └────────┬───────┘                               │
│                              │ scores + inputs as context            │
│                              ▼                                       │
│                     ┌────────────────┐                               │
│                     │ intent filter  │─ advice? ─▶ refuse, 0 tokens  │
│                     └────────┬───────┘                               │
│                              ▼                                       │
│                     Cloudflare Worker ──▶ Workers AI (narration only)│
│                                                                      │
│   Web Worker ──▶ backtester over committed daily bars                │
└──────────────────────────────────────────────────────────────────────┘
```

Two data paths, chosen by how fast the asset actually moves:

| Path | Assets | Transport | Freshness |
|---|---|---|---|
| Live | Crypto majors | Binance/Coinbase WebSocket, keyless | True real-time |
| Batch | Equities, ETFs, bond & commodity proxies | Static JSON from CI | End of day |
| Batch | News, SEC filings | Static JSON from CI | ~30–45 min |

The UI renders `generatedAt` from the payload rather than claiming "live". Labelling
end-of-day data as real-time would be the easiest lie in the project and the one most
likely to be caught.

---

## 4. Data pipeline

### Why an orphan branch

A 30-minute cron that commits normally produces ~17,000 commits a year and a repository
that is painful to clone. Each publish therefore does `git init` in the output directory
and force-pushes, so the `data` branch is permanently one commit deep. History is
worthless here — the data is a snapshot, not a ledger.

The frontend reads it from `raw.githubusercontent.com`, which serves
`Access-Control-Allow-Origin: *` with roughly a 5-minute CDN cache. That cache is
shorter than the publish cadence, so it costs nothing.

### Validation gates

The dangerous failure is not an error, it is a **200 with an empty body** — that would
publish a blank dashboard over good data. Both workflows assert before pushing:
minimum asset count, minimum candles per asset, non-empty news array. Failing the job
leaves the previous good snapshot in place.

### Keepalive

GitHub disables scheduled workflows after **60 days of repository inactivity**. For a
portfolio project this is the worst available failure mode: the site keeps loading, the
data silently goes stale, and it breaks precisely during the quiet period when a
recruiter is most likely to open it.

`keepalive.yml` runs weekly, pushes a heartbeat commit to reset the clock, and
additionally calls `PUT /actions/workflows/{id}/enable` to self-heal if the clock already
expired. Belt-and-braces, but the failure is silent and the job costs seconds.

### Cadence honesty

Actions cron is best-effort. A `*/30` schedule realistically lands every 30–45 minutes
and is occasionally skipped under platform load. Schedules use odd minutes rather than
`:00`, which is the most contended slot. The UI never promises a refresh interval it
does not control.

---

## 5. Asset universe

`universe.json` is hand-curated and committed. It never changes at runtime, so it needs
no provider, no quota, and cannot go stale.

```jsonc
{
  "NVDA": {
    "name": "NVIDIA Corporation",
    "type": "STOCK",
    "sector": "Technology",
    "industry": "Semiconductors",
    "exchange": "NASDAQ",
    "description": "Designs GPUs and accelerated computing platforms for gaming, data centers, and AI workloads."
  }
}
```

**Two-level taxonomy.** Sector alone is useless — "Technology" spans semis, SaaS, and
hardware, which trade nothing alike. Sector plus industry unlocks the sector heatmap and,
more usefully, **industry-relative ranking**: NVDA's momentum against other semis is a
more meaningful statement than its absolute score.

**ETF proxies.** Bonds and physical commodities are effectively unavailable on free
tiers. They are represented by ETFs that trade on ordinary US equity feeds:

| Exposure | Proxies |
|---|---|
| Rates / duration | TLT, IEF, SHY, TIP |
| Credit | HYG, AGG |
| Metals | GLD, SLV, COPX |
| Energy | USO, UNG |
| Broad market | SPY, QQQ, IWM, DIA |
| Sectors | XLK, XLE, XLF, XLV |

This is a real modelling compromise, not a free win — an ETF carries tracking error,
expense drag, and equity-market-hours constraints its underlying does not. The UI labels
these as proxies. Pretending TLT *is* the 10-year would be the kind of shortcut that
reads as not understanding the instrument.

Universe size is ~50 symbols: roughly 30 equities, 16 ETFs, and 8–12 crypto.

---

## 6. Scoring engine

Pure functions over `Candle[]`. No I/O, no clock, no randomness — which is what makes
them testable and what makes the number in the UI reproducible by hand.

```ts
export interface ScoreComponent {
  key: 'RSI' | 'EMA_SPREAD' | 'MACD_SLOPE' | 'VOLUME';
  raw: number;         // the underlying measurement
  contribution: number; // clamped, weighted, −100..+100
}

export interface MomentumScore {
  total: number;              // −100..+100
  components: ScoreComponent[];
  candlesUsed: number;
  asOf: number;
}
```

Four components, each normalised to `−1..+1`, weighted, summed, clamped:

| Component | Measures | Weight | Normalisation |
|---|---|---|---|
| RSI(14) | Position in recent up/down distribution | 0.40 | Linear from 30/70 bounds |
| EMA(20/50) spread | Trend direction and strength | 0.30 | Divided by ATR(14) |
| MACD histogram slope | Momentum acceleration | 0.20 | Sign and 3-day slope |
| Volume vs 20-day | Conviction behind the move | 0.10 | Log ratio, capped at 3× |

**Why the spread is ATR-normalised.** A $2 gap between EMAs means something entirely
different on a $30 ETF than on a $700 stock. Dividing by ATR makes the component
comparable across the universe, which is what makes cross-asset ranking legitimate
rather than a proxy for share price.

**Why the total decomposes in the UI.** An opaque score is a black box and invites
exactly the trust it hasn't earned. Printing the four contributions turns it into
something the reader can disagree with — the correct relationship to have with a
mechanical indicator.

`technicalindicators` from npm would cover most of this. These are implemented directly
instead: it is about 120 lines, removes a thinly-maintained dependency, and makes the
unit tests meaningful rather than a test of someone else's library.

---

## 7. Validation

The backtester runs in a **Web Worker** over the committed daily bars. This is the
legitimate case for a worker — RSI over 50 candles is microseconds and belongs on the
main thread; a parameter sweep across 50 symbols × 6 years is seconds and does not.

Method:

- Signal fires when `|score| > 50`.
- Hold a fixed window (default 5 trading days).
- Score the direction of the subsequent return.
- Apply 10bps round-trip costs.
- Compare against buy-and-hold on the same symbol over the same window.

Reported: signal count, hit rate, hit rate after costs, Sharpe, max drawdown, and delta
vs buy-and-hold.

**The result is that the strategy underperforms buy-and-hold**, at roughly 51% directional
accuracy after costs. This is the expected outcome — retail technical indicators on daily
bars have been arbitraged out for decades — and it ships prominently in the UI rather
than being quietly omitted.

Two reasons that is the right call. It is honest. And a project that measures its own
output and reports an unflattering result demonstrates something a project with a green
BUY badge cannot: that the author knows the difference between a system that runs and a
system that works.

The parameter sliders re-run the backtest live, and after five sweeps the UI raises an
**overfitting warning** — because that is exactly what sweeping parameters against a
fixed history is.

---

## 8. Copilot

### The invariant

**The model never computes a number.** Scores are calculated client-side and passed in
as context; the model's only job is to turn structured values into prose. It cannot
hallucinate a price, an RSI, or a hit rate, because it is not being asked to produce one.

This is the correct architecture for LLM features generally — deterministic compute,
model as presentation layer — and it is the part of this project most worth discussing
in an interview.

### Request path

```
query
  └─▶ intent classifier (local regex, zero cost)
        ├─ advice intent   → canned refusal, no inference
        ├─ filter intent   → structured tool call, UI applies it
        └─ explain intent  → build context, continue
              └─▶ Cloudflare Worker (key custody, per-IP rate limit)
                    └─▶ Workers AI (Llama)
                          └─▶ render + append disclaimer in UI layer
```

The classifier is both the safety layer and the cost control: refusals are free, and
they are the highest-volume category of question this app will receive.

### Scope

**Answers:** what's on screen and why ("why is NVDA bullish?" → reads the four
components from context), indicator mechanics, general market vocabulary, how brokerage
accounts work generically.

**Refuses:** should-I-buy, price predictions, specific broker or product
recommendations, anything about the user's own money or portfolio.

### Hosting

Cloudflare Workers AI — the Worker already exists for key custody, and Workers AI has a
free daily allocation with no separate provider account. Per-IP rate limiting lives in
the Worker; a public LLM endpoint without it will be drained. The Worker interface is
provider-agnostic, so swapping to Gemini or Groq is a one-file change.

### Prompt injection

Treated as a tested surface, not an assumption. The suite covers instruction-override
attempts, attempts to elicit advice through roleplay, and attempts to suppress the
disclaimer. The disclaimer is appended by the **UI**, not requested in the system prompt,
so no prompt-level attack can remove it.

---

## 9. Disclaimer as architecture

Three placements, all structural:

1. **Blocking modal on first visit**, `localStorage`-gated, not dismissible by clicking
   away, linking directly to the backtest results.
2. **Persistent footer bar**, always in the viewport.
3. **Appended to every copilot response** by the render layer.

Plus the substantive version: the measured hit rate is displayed next to the score
itself. A disclaimer that says "not advice" while the UI shows a confident green BUY is
a contradiction the reader will resolve in favour of the UI. Showing 51% resolves it
honestly.

---

## 10. Performance

- WebSocket ticks batch into Zustand on a `requestAnimationFrame` boundary. Raw crypto
  streams push far faster than any display needs; unthrottled they cause a re-render
  storm for information no human can read.
- The asset grid virtualises past ~100 rows.
- Backtests run off-thread; the UI displays the worker's runtime as a first-class metric
  rather than claiming performance in prose.
- Charts are canvas (`lightweight-charts`), not SVG or DOM.

---

## 11. Testing

| Layer | Approach |
|---|---|
| Indicators | Fixtures computed by hand and in a spreadsheet, asserted to 4dp |
| Scoring | Property tests — monotonic in each input, output always within bounds |
| Backtester | Known synthetic series with analytically-known outcomes |
| Pipeline | Workflow validation gates run as tests against recorded payloads |
| Copilot | Injection and advice-elicitation suite; refusal paths asserted |

Indicator correctness is the foundation everything else claims to rest on. Testing it
against hand-computed values rather than against another library is the difference
between verifying the maths and verifying that two implementations share a bug.

---

## 12. Tradeoffs

**Static JSON instead of live polling.** Costs freshness — equities are end-of-day.
Buys key safety, unlimited read scalability, and zero CORS handling. For a project whose
point is the scoring engine rather than latency, that is the right side of the trade.

**ETF proxies instead of real bond and commodity data.** Costs fidelity — tracking error
and equity trading hours are real distortions. Buys coverage that is otherwise
unavailable at zero budget. Labelled as proxies in the UI.

**Cloudflare Worker for the copilot.** Costs architectural purity — this is no longer
strictly serverless. Key custody in a browser bundle is not solvable any other way, and
claiming otherwise would be worse than the dependency.

**Hand-written indicators over `technicalindicators`.** Costs ~120 lines. Buys a
dependency removed and unit tests that verify something.

**Four components, not twelve.** More indicators would be easy to add and would mostly
add correlated noise while making the decomposition unreadable. The panel stays legible
at four.

### With a budget

Paid market data would remove the ETF proxies and make intraday equities viable. A real
database would allow per-user watchlists. Neither changes the scoring engine or the
validation approach, which is the actual substance.

---

## 13. Non-goals

- Order execution, brokerage integration, or portfolio tracking.
- Options data, Greeks, or anything implying an options recommendation.
- User accounts or any storage of personal financial information.
- Any claim of predictive accuracy. §7 is the measured claim, and it is a modest one.

---

## Repository

```
tickrlab/
├── .github/workflows/
│   ├── deploy.yml          # Vite build → Pages
│   ├── fetch-prices.yml    # weekday cron → data branch
│   ├── fetch-news.yml      # 30-min cron → data branch
│   └── keepalive.yml       # weekly; defeats 60-day cron auto-disable
├── scripts/
│   ├── fetch-prices.mjs
│   └── fetch-news.mjs      # Yahoo RSS + SEC EDGAR, keyless
├── worker/                 # Cloudflare Worker: key custody + rate limit
├── src/
│   ├── data/universe.json  # curated, committed, never fetched
│   ├── engine/             # indicators, scoring, backtest — pure
│   ├── workers/backtest.worker.ts
│   ├── copilot/            # intent classifier, context builder
│   └── components/
└── DESIGN.md
```

---

*Built by [Chanukya Gattu](https://chanukyagattu.github.io/portfolio/). Sibling to
[StreamForge](https://chanukyagattu.github.io/stream-forge/).*