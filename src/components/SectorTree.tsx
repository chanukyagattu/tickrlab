import { useMemo } from 'react';
import type { ScoredAsset } from '../engine/types';

interface Props {
  assets: ScoredAsset[];
  active: string | null;
  onSelect: (sector: string | null) => void;
}

/**
 * Two-level sector/industry navigation.
 *
 * Sector alone is useless — "Technology" spans semis, SaaS, and hardware,
 * which trade nothing alike. The second level is what makes filtering worth
 * doing, and it is what enables industry-relative comparison rather than
 * absolute ranking across unrelated assets.
 */
export function SectorTree({ assets, active, onSelect }: Props) {
  const tree = useMemo(() => {
    const bySector = new Map<string, Map<string, number>>();
    for (const asset of assets) {
      const { sector, industry } = asset.meta;
      if (!bySector.has(sector)) bySector.set(sector, new Map());
      const industries = bySector.get(sector)!;
      industries.set(industry, (industries.get(industry) ?? 0) + 1);
    }
    return [...bySector.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [assets]);

  return (
    <nav className="panel h-full overflow-auto p-3">
      <div className="lbl mb-2">Sector / Industry</div>

      <button
        type="button"
        onClick={() => onSelect(null)}
        className={`mb-1 block w-full text-left font-mono text-[11px] ${
          active === null ? 'text-accent' : 'text-ink-dim hover:text-ink'
        }`}
      >
        All assets <span className="text-ink-faint">{assets.length}</span>
      </button>

      {tree.map(([sector, industries]) => {
        const total = [...industries.values()].reduce((a, b) => a + b, 0);
        const isActive = active === sector;
        return (
          <div key={sector} className="mt-1.5">
            <button
              type="button"
              onClick={() => onSelect(isActive ? null : sector)}
              className={`block w-full text-left font-mono text-[11px] ${
                isActive ? 'text-accent' : 'text-ink-dim hover:text-ink'
              }`}
            >
              {isActive ? '▾' : '▸'} {sector} <span className="text-ink-faint">{total}</span>
            </button>

            {isActive &&
              [...industries.entries()]
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([industry, count]) => (
                  <div
                    key={industry}
                    className="pl-4 font-mono text-[10.5px] text-ink-faint"
                  >
                    {industry} <span className="opacity-60">{count}</span>
                  </div>
                ))}
          </div>
        );
      })}
    </nav>
  );
}
