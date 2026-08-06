import { useMemo } from 'react';
import type { ScoredAsset } from '../engine/types';

/**
 * Score bar with a centre tick.
 *
 * Deliberately not a BUY/SELL badge. The tick marks zero so the reader sees
 * magnitude and direction — a measurement — rather than a verdict.
 */
function ScoreBar({ total }: { total: number }) {
  const magnitude = Math.min(Math.abs(total), 100) / 100;
  const width = magnitude * 50;
  const positive = total >= 0;

  return (
    <span className="inline-flex items-center gap-2">
      <span className="relative h-[5px] w-[64px] rounded bg-line">
        <span className="absolute -top-[2px] left-1/2 h-[9px] w-px bg-ink-faint" />
        <span
          className={`absolute top-0 h-[5px] rounded ${positive ? 'bg-bull' : 'bg-bear'}`}
          style={{
            left: positive ? '50%' : `${50 - width}%`,
            width: `${width}%`,
          }}
        />
      </span>
      <span
        className={`w-9 text-right font-mono text-[11px] ${
          total >= 20 ? 'text-bull' : total <= -20 ? 'text-bear' : 'text-ink-dim'
        }`}
      >
        {total > 0 ? '+' : ''}
        {total.toFixed(0)}
      </span>
    </span>
  );
}

interface Props {
  assets: ScoredAsset[];
  selected: string | null;
  onSelect: (symbol: string) => void;
}

export function AssetGrid({ assets, selected, onSelect }: Props) {
  const sorted = useMemo(
    () =>
      [...assets].sort((a, b) => {
        // Unscored assets sink rather than being treated as neutral.
        const aScore = a.score?.total ?? Number.NEGATIVE_INFINITY;
        const bScore = b.score?.total ?? Number.NEGATIVE_INFINITY;
        return bScore - aScore;
      }),
    [assets],
  );

  if (!sorted.length) {
    return (
      <div className="p-6 text-center font-mono text-xs text-ink-faint">
        No assets match this filter.
      </div>
    );
  }

  return (
    <div className="overflow-auto">
      <table className="w-full border-collapse font-mono text-[11px]">
        <thead className="sticky top-0 bg-panel">
          <tr className="border-b border-line text-left text-[9.5px] uppercase tracking-wider text-ink-faint">
            <th className="px-2 py-2 font-normal">Ticker</th>
            <th className="px-2 py-2 font-normal">Name</th>
            <th className="hidden px-2 py-2 font-normal md:table-cell">Industry</th>
            <th className="px-2 py-2 text-right font-normal">Price</th>
            <th className="px-2 py-2 text-right font-normal">Chg</th>
            <th className="px-2 py-2 font-normal">Momentum</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((asset) => {
            const isSelected = asset.symbol === selected;
            return (
              <tr
                key={asset.symbol}
                onClick={() => onSelect(asset.symbol)}
                className={`cursor-pointer border-b border-line/50 hover:bg-line/30 ${
                  isSelected ? 'bg-line/40' : ''
                }`}
              >
                <td className="px-2 py-1.5 font-semibold text-ink">
                  {asset.symbol.replace('USDT', '')}
                  {asset.live && (
                    <span className="ml-1 text-bull" title="live WebSocket">
                      ●
                    </span>
                  )}
                </td>
                <td className="max-w-[180px] truncate px-2 py-1.5 text-ink-dim">
                  {asset.meta.name}
                  {asset.meta.proxyFor && (
                    <span
                      className="ml-1 text-warn"
                      title={`Proxy for ${asset.meta.proxyFor}. ${asset.meta.proxyCaveat ?? ''}`}
                    >
                      †
                    </span>
                  )}
                </td>
                <td className="hidden px-2 py-1.5 md:table-cell">
                  <span className="rounded border border-line-hi px-1.5 py-px text-[9px] text-ink-faint">
                    {asset.meta.industry}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right text-ink-dim">
                  {asset.price.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: asset.price < 10 ? 4 : 2,
                  })}
                </td>
                <td
                  className={`px-2 py-1.5 text-right ${
                    asset.changePct >= 0 ? 'text-bull' : 'text-bear'
                  }`}
                >
                  {asset.changePct >= 0 ? '+' : ''}
                  {asset.changePct.toFixed(2)}%
                </td>
                <td className="px-2 py-1.5">
                  {asset.score ? (
                    <ScoreBar total={asset.score.total} />
                  ) : (
                    <span className="text-[10px] text-ink-faint" title="Fewer than 60 bars available">
                      insufficient history
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
