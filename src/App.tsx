import { useEffect, useMemo, useState } from 'react';
import { AssetGrid } from './components/AssetGrid';
import { Copilot } from './components/Copilot';
import { DisclaimerBar, DisclaimerGate } from './components/Disclaimer';
import { NewsRail } from './components/NewsRail';
import { PriceChart } from './components/PriceChart';
import { ScorePanel } from './components/ScorePanel';
import { SectorTree } from './components/SectorTree';
import { TickerTape } from './components/TickerTape';
import { Validation } from './components/Validation';
import { useCryptoStream } from './hooks/useCryptoStream';
import { deriveAssets, useMarketStore } from './store/useMarketStore';
import { useBacktest } from './workers/useBacktest';

type Tab = 'dashboard' | 'validation';

function Freshness() {
  const pricesAt = useMarketStore((s) => s.pricesGeneratedAt);
  const newsAt = useMarketStore((s) => s.newsGeneratedAt);

  // Rendered from the payload rather than claiming "live". Labelling
  // end-of-day data as real-time would be the easiest lie in the project.
  const fmt = (t: number | null) =>
    t ? new Date(t * 1000).toISOString().slice(5, 16).replace('T', ' ') + 'Z' : '—';

  return (
    <span className="font-mono text-[10px] text-ink-faint">
      prices {fmt(pricesAt)} · news {fmt(newsAt)}
    </span>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>('dashboard');

  const candles = useMarketStore((s) => s.candles);
  const livePrices = useMarketStore((s) => s.livePrices);
  const loadState = useMarketStore((s) => s.loadState);
  const loadError = useMarketStore((s) => s.loadError);
  const selected = useMarketStore((s) => s.selected);
  const sectorFilter = useMarketStore((s) => s.sectorFilter);
  const loadStaticData = useMarketStore((s) => s.loadStaticData);
  const select = useMarketStore((s) => s.select);
  const setSectorFilter = useMarketStore((s) => s.setSectorFilter);

  useEffect(() => {
    void loadStaticData();
  }, [loadStaticData]);

  useCryptoStream(true);

  const assets = useMemo(() => deriveAssets(candles, livePrices), [candles, livePrices]);

  const visible = useMemo(
    () => (sectorFilter ? assets.filter((a) => a.meta.sector === sectorFilter) : assets),
    [assets, sectorFilter],
  );

  const active = useMemo(
    () => assets.find((a) => a.symbol === selected) ?? visible[0] ?? null,
    [assets, selected, visible],
  );

  const backtest = useBacktest();

  return (
    <div className="flex min-h-screen flex-col">
      <DisclaimerGate />

      <header className="border-b border-line">
        <TickerTape assets={assets} />
        <div className="flex flex-wrap items-center gap-4 px-4 py-2">
          <span className="font-mono text-sm font-bold tracking-wide">TICKRLAB</span>
          <nav className="flex gap-1">
            {(['dashboard', 'validation'] as const).map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setTab(name)}
                className={`rounded px-2.5 py-1 font-mono text-[11px] capitalize ${
                  tab === name ? 'bg-line text-ink' : 'text-ink-faint hover:text-ink-dim'
                }`}
              >
                {name}
              </button>
            ))}
          </nav>
          <div className="ml-auto">
            <Freshness />
          </div>
        </div>
      </header>

      <main className="flex-1 p-3">
        {loadState === 'loading' && (
          <div className="panel p-6 text-center font-mono text-xs text-ink-faint">
            Loading published data…
          </div>
        )}

        {loadState === 'error' && (
          <div className="panel border-warn/40 p-5 font-mono text-[11px] text-ink-dim">
            <div className="mb-2 text-warn">Could not load prices.json — {loadError}</div>
            <p className="max-w-2xl leading-relaxed">
              The dashboard reads a static payload published by the CI pipeline to the{' '}
              <code className="text-ink">data</code> branch. If that branch has not been
              written yet, run the fetch workflow:
              <br />
              <span className="text-accent">
                gh workflow run fetch-prices.yml
              </span>{' '}
              — or locally,{' '}
              <span className="text-accent">npm run fetch:prices</span>.
            </p>
            <p className="mt-2 text-ink-faint">
              Crypto rows stream independently over WebSocket and are unaffected.
            </p>
          </div>
        )}

        {loadState === 'ready' && tab === 'dashboard' && (
          <div className="grid gap-3 lg:grid-cols-[170px_1fr_260px]">
            <div className="hidden lg:block">
              <SectorTree assets={assets} active={sectorFilter} onSelect={setSectorFilter} />
            </div>

            <div className="grid min-w-0 gap-3">
              <div className="panel max-h-[340px] overflow-hidden">
                <AssetGrid assets={visible} selected={active?.symbol ?? null} onSelect={select} />
              </div>
              <ScorePanel
                asset={active}
                backtest={backtest.result}
                onShowValidation={() => setTab('validation')}
              />
              <div className="h-[280px]">
                <PriceChart
                  symbol={active?.symbol ?? ''}
                  candles={active ? (candles[active.symbol] ?? []) : []}
                />
              </div>
            </div>

            <div className="hidden lg:block">
              <NewsRail />
            </div>
          </div>
        )}

        {loadState === 'ready' && tab === 'validation' && (
          <Validation
            candles={candles}
            result={backtest.result}
            running={backtest.running}
            error={backtest.error}
            runCount={backtest.runCount}
            onRun={(params) => backtest.run(candles, params)}
          />
        )}
      </main>

      <Copilot asset={active} onFilter={(sector) => setSectorFilter(sector)} />
      <DisclaimerBar />
    </div>
  );
}
