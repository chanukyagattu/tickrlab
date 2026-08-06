import { create } from 'zustand';
import universeData from '../data/universe.json';
import { bandOf, computeScore } from '../engine/score';
import type {
  AssetMeta,
  Candle,
  NewsItem,
  NewsPayload,
  PricePayload,
  ScoredAsset,
} from '../engine/types';

export const UNIVERSE = universeData.assets as unknown as Record<string, AssetMeta>;

/**
 * Data is read from the `data` branch via raw.githubusercontent, which serves
 * `Access-Control-Allow-Origin: *` with roughly a five-minute CDN cache — well
 * inside the publish cadence, so it costs nothing.
 *
 * Overridable so `npm run dev` can point at a local dist-data/ without a
 * network round trip.
 */
const DATA_BASE =
  import.meta.env.VITE_DATA_BASE ??
  'https://raw.githubusercontent.com/chanukyagattu/tickrlab/data';

export type LoadState = 'idle' | 'loading' | 'ready' | 'error';

interface MarketState {
  candles: Record<string, Candle[]>;
  livePrices: Record<string, { price: number; changePct: number; at: number }>;
  news: NewsItem[];

  pricesGeneratedAt: number | null;
  newsGeneratedAt: number | null;
  loadState: LoadState;
  loadError: string | null;

  selected: string | null;
  sectorFilter: string | null;

  loadStaticData: () => Promise<void>;
  applyTicks: (ticks: Record<string, { price: number; changePct: number }>) => void;
  select: (symbol: string | null) => void;
  setSectorFilter: (sector: string | null) => void;
}

export const useMarketStore = create<MarketState>((set, get) => ({
  candles: {},
  livePrices: {},
  news: [],
  pricesGeneratedAt: null,
  newsGeneratedAt: null,
  loadState: 'idle',
  loadError: null,
  selected: 'NVDA',
  sectorFilter: null,

  async loadStaticData() {
    if (get().loadState === 'loading') return;
    set({ loadState: 'loading', loadError: null });

    // News failing must not take prices down with it — they are independent
    // payloads published by independent jobs.
    const [pricesResult, newsResult] = await Promise.allSettled([
      fetch(`${DATA_BASE}/prices.json`).then((r) => {
        if (!r.ok) throw new Error(`prices.json HTTP ${r.status}`);
        return r.json() as Promise<PricePayload>;
      }),
      fetch(`${DATA_BASE}/news.json`).then((r) => {
        if (!r.ok) throw new Error(`news.json HTTP ${r.status}`);
        return r.json() as Promise<NewsPayload>;
      }),
    ]);

    if (newsResult.status === 'fulfilled') {
      set({ news: newsResult.value.items, newsGeneratedAt: newsResult.value.generatedAt });
    }

    if (pricesResult.status === 'fulfilled') {
      const candles: Record<string, Candle[]> = {};
      for (const [symbol, entry] of Object.entries(pricesResult.value.assets)) {
        candles[symbol] = entry.candles;
      }
      set({
        candles,
        pricesGeneratedAt: pricesResult.value.generatedAt,
        loadState: 'ready',
      });
    } else {
      set({
        loadState: 'error',
        loadError:
          pricesResult.reason instanceof Error
            ? pricesResult.reason.message
            : String(pricesResult.reason),
      });
    }
  },

  applyTicks(ticks) {
    const at = Date.now();
    set((state) => {
      const next = { ...state.livePrices };
      for (const [symbol, tick] of Object.entries(ticks)) {
        next[symbol] = { ...tick, at };
      }
      return { livePrices: next };
    });
  },

  select: (symbol) => set({ selected: symbol }),
  setSectorFilter: (sector) => set({ sectorFilter: sector }),
}));

/**
 * Derive the scored asset list.
 *
 * Scores are recomputed from candles rather than stored, so there is exactly
 * one source of truth and the chart can never disagree with the number beside
 * it. Called from a `useMemo` keyed on the candle map — cheap for ~55 assets,
 * and worth the simplicity of having no cache to invalidate.
 */
export function deriveAssets(
  candles: Record<string, Candle[]>,
  livePrices: MarketState['livePrices'],
): ScoredAsset[] {
  const out: ScoredAsset[] = [];

  for (const [symbol, meta] of Object.entries(UNIVERSE)) {
    const bars = candles[symbol];
    const live = livePrices[symbol];

    let price = 0;
    let changePct = 0;

    if (live) {
      price = live.price;
      changePct = live.changePct;
    } else if (bars && bars.length >= 2) {
      const last = bars[bars.length - 1]!;
      const prev = bars[bars.length - 2]!;
      price = last.close;
      changePct = prev.close > 0 ? ((last.close - prev.close) / prev.close) * 100 : 0;
    } else {
      continue; // no data at all — omit rather than render a zero row
    }

    const score = bars && bars.length ? computeScore(bars) : null;

    out.push({
      symbol,
      meta,
      price,
      changePct,
      score,
      band: score ? bandOf(score.total) : 'NEUTRAL',
      live: Boolean(live),
      lastUpdated: live?.at ?? (bars?.[bars.length - 1]?.time ?? 0) * 1000,
    });
  }

  return out;
}
