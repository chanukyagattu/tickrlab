import type { ScoredAsset } from '../engine/types';

const HEADLINE = ['SPY', 'QQQ', 'IWM', 'GLD', 'USO', 'TLT', 'BTCUSDT', 'ETHUSDT'];

const SHORT: Record<string, string> = {
  SPY: 'S&P',
  QQQ: 'NDX',
  IWM: 'RUT',
  GLD: 'GOLD',
  USO: 'OIL',
  TLT: '20Y',
  BTCUSDT: 'BTC',
  ETHUSDT: 'ETH',
};

/**
 * Header tape. Built from the same derived assets as the grid rather than an
 * embedded third-party widget — an iframe would render faster and would mean
 * none of this was mine.
 */
export function TickerTape({ assets }: { assets: ScoredAsset[] }) {
  const bySymbol = new Map(assets.map((a) => [a.symbol, a]));

  return (
    <div className="flex items-center gap-5 overflow-x-auto whitespace-nowrap border-b border-line px-4 py-2 font-mono text-[11px] text-ink-dim">
      {HEADLINE.map((symbol) => {
        const asset = bySymbol.get(symbol);
        if (!asset) return null;
        const up = asset.changePct >= 0;
        return (
          <span key={symbol} className="shrink-0">
            {SHORT[symbol] ?? symbol}{' '}
            <span className={up ? 'text-bull' : 'text-bear'}>
              {up ? '▲' : '▼'} {Math.abs(asset.changePct).toFixed(2)}%
            </span>
            {asset.live && <span className="ml-1 text-bull">●</span>}
          </span>
        );
      })}
    </div>
  );
}
