/**
 * Core domain types. Everything downstream of a Candle is derived, so this is
 * the only shape the engine trusts as input.
 */

export type AssetType = 'STOCK' | 'ETF' | 'BOND_ETF' | 'COMMODITY_ETF' | 'CRYPTO';

export interface Candle {
  /** Unix seconds, UTC, at the open of the bar. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface AssetMeta {
  name: string;
  type: AssetType;
  sector: string;
  industry: string;
  exchange: string;
  description: string;
  /** Present on assets standing in for something they are not (bond/commodity ETFs). */
  proxyFor?: string;
  proxyCaveat?: string;
  /** Binance stream symbol, crypto only. */
  stream?: string;
}

export type ComponentKey = 'RSI' | 'EMA_SPREAD' | 'MACD_SLOPE' | 'VOLUME';

export interface ScoreComponent {
  key: ComponentKey;
  /** The underlying measurement, in its own units. Displayed verbatim in the UI. */
  raw: number;
  /** Normalised to [-1, 1] before weighting. */
  normalised: number;
  weight: number;
  /** normalised * weight * 100, so contributions sum to the total. */
  contribution: number;
  /** Short human-readable statement of what `raw` means. */
  note: string;
}

export interface MomentumScore {
  /** [-100, 100]. Sum of component contributions, clamped. */
  total: number;
  components: ScoreComponent[];
  /** How many candles fed the calculation. */
  candlesUsed: number;
  /** Unix seconds of the last candle scored. */
  asOf: number;
}

/**
 * Deliberately descriptive, never imperative. "BULLISH" states what the
 * indicators measured; "BUY" would state what the reader should do, which is a
 * claim this project cannot support. See DESIGN.md §7.
 */
export type ScoreBand =
  | 'STRONGLY BEARISH'
  | 'BEARISH'
  | 'NEUTRAL'
  | 'BULLISH'
  | 'STRONGLY BULLISH';

export interface ScoredAsset {
  symbol: string;
  meta: AssetMeta;
  price: number;
  changePct: number;
  score: MomentumScore | null;
  band: ScoreBand;
  /** True only for assets on a live WebSocket. Everything else is end-of-day. */
  live: boolean;
  lastUpdated: number;
}

export interface NewsItem {
  id: string;
  headline: string;
  source: 'YAHOO' | 'SEC';
  url: string;
  datetime: number;
  symbols: string[];
  /** SEC form type where applicable — 8-K, 10-Q, 10-K. */
  formType?: string;
}

export interface PricePayload {
  generatedAt: number;
  provider: string;
  assets: Record<string, { candles: Candle[] }>;
}

export interface NewsPayload {
  generatedAt: number;
  items: NewsItem[];
}
