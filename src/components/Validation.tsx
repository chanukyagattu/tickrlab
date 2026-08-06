import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_PARAMS, type BacktestResult } from '../engine/backtest';
import { DEFAULT_CONFIG } from '../engine/score';
import type { Candle } from '../engine/types';

interface Props {
  candles: Record<string, Candle[]>;
  result: BacktestResult | null;
  running: boolean;
  error: string | null;
  runCount: number;
  onRun: (params: typeof DEFAULT_PARAMS) => void;
}

function EquityCurve({ result }: { result: BacktestResult }) {
  const path = useMemo(() => {
    const points = result.equity;
    if (points.length < 2) return null;

    const values = points.flatMap((p) => [p.strategy, p.buyHold]);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    const toPath = (key: 'strategy' | 'buyHold') =>
      points
        .map((point, i) => {
          const x = (i / (points.length - 1)) * 460;
          const y = 140 - ((point[key] - min) / range) * 130;
          return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ');

    return { strategy: toPath('strategy'), buyHold: toPath('buyHold'), min, max };
  }, [result]);

  if (!path) return null;

  return (
    <svg viewBox="0 0 460 150" className="h-[150px] w-full">
      <line x1="0" y1="140" x2="460" y2="140" stroke="#2a3441" />
      <line x1="0" y1="75" x2="460" y2="75" stroke="#2a3441" strokeDasharray="3 4" />
      <path d={path.buyHold} fill="none" stroke="#5a6673" strokeWidth="1.6" strokeDasharray="4 4" />
      <path d={path.strategy} fill="none" stroke="#2dd4a7" strokeWidth="1.8" />
    </svg>
  );
}

/**
 * Validation tab.
 *
 * The equity curve plots the strategy against buy-and-hold with no scaling
 * trick to flatter it. If the strategy line sits below the benchmark, that is
 * what the chart shows — a project that measures its own output and reports an
 * unflattering result demonstrates something a green BUY badge cannot.
 */
export function Validation({ candles, result, running, error, runCount, onRun }: Props) {
  const [threshold, setThreshold] = useState(DEFAULT_PARAMS.threshold);
  const [holdBars, setHoldBars] = useState(DEFAULT_PARAMS.holdBars);
  const [costBps, setCostBps] = useState(DEFAULT_PARAMS.costBps);

  const run = () =>
    onRun({ threshold, holdBars, costBps, scoreConfig: DEFAULT_CONFIG });

  // Run once on mount so the tab is never empty on arrival.
  useEffect(() => {
    if (!result && !running && Object.keys(candles).length) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles]);

  const sweeps = Math.max(0, runCount - 1);

  return (
    <div className="space-y-3">
      <div className="panel p-4">
        <div className="lbl mb-2">Method</div>
        <p className="text-[12px] leading-relaxed text-ink-dim">
          A signal fires when |score| exceeds the threshold. The position is entered at
          the <strong className="text-ink">close of the signal bar</strong> — not its
          open, which would be lookahead — held for a fixed number of sessions, and
          charged costs on both legs. Every signal is counted; none are filtered after
          the fact. The benchmark is buy-and-hold over the identical window, so a
          strategy that is merely long during a rising market earns no credit for it.
        </p>
      </div>

      <div className="panel p-4">
        <div className="lbl mb-3">Parameters</div>
        <div className="grid gap-4 sm:grid-cols-3">
          {(
            [
              ['Threshold', threshold, setThreshold, 5, 80, 5, '|score| to trigger'],
              ['Hold bars', holdBars, setHoldBars, 1, 30, 1, 'sessions held'],
              ['Costs (bps)', costBps, setCostBps, 0, 100, 5, 'round trip'],
            ] as const
          ).map(([label, value, setter, min, max, step, hint]) => (
            <label key={label} className="block font-mono text-[10px] text-ink-faint">
              <span className="flex justify-between">
                <span>{label}</span>
                <span className="text-ink">{value}</span>
              </span>
              <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(e) => setter(Number(e.target.value))}
                className="mt-1 w-full accent-accent"
              />
              <span className="opacity-70">{hint}</span>
            </label>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={run}
            disabled={running}
            className="rounded border border-accent-d bg-accent/10 px-3 py-1.5 font-mono text-[11px] text-accent disabled:opacity-50"
          >
            {running ? 'running…' : 'Run backtest'}
          </button>

          {sweeps >= 5 && (
            <span className="font-mono text-[10px] text-warn">
              ⚠ {sweeps} parameter sweeps — this is overfitting. Parameters tuned against
              a fixed history describe the past, not the future.
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="panel border-bear/40 p-4 font-mono text-[11px] text-bear">{error}</div>
      )}

      {result && (
        <div className="grid gap-3 lg:grid-cols-[1fr_260px]">
          <div className="panel p-4">
            <div className="lbl mb-2 flex justify-between">
              <span>Equity curve · strategy vs buy &amp; hold</span>
              <span className="normal-case tracking-normal">
                <span className="text-bull">— strategy</span>{' '}
                <span className="text-ink-faint">┈ buy &amp; hold</span>
              </span>
            </div>
            <EquityCurve result={result} />
          </div>

          <div className="panel p-4">
            <div className="lbl mb-2">Results</div>
            <dl className="space-y-1 font-mono text-[11px] text-ink-dim">
              {[
                ['signals', String(result.trades)],
                ['symbols', String(result.symbolsTested)],
                ['hit rate', `${(result.hitRate * 100).toFixed(1)}%`],
                ['after costs', `${(result.hitRateAfterCosts * 100).toFixed(1)}%`],
                ['sharpe', result.sharpe.toFixed(2)],
                ['max drawdown', `${(result.maxDrawdown * 100).toFixed(1)}%`],
                ['strategy', `${(result.totalReturn * 100).toFixed(1)}%`],
                ['buy & hold', `${(result.buyHoldReturn * 100).toFixed(1)}%`],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between">
                  <dt className="text-ink-faint">{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
              <div className="flex justify-between border-t border-line pt-1">
                <dt className="text-ink-faint">vs buy &amp; hold</dt>
                <dd className={result.excessReturn >= 0 ? 'text-bull' : 'text-bear'}>
                  {result.excessReturn >= 0 ? '+' : ''}
                  {(result.excessReturn * 100).toFixed(1)}%
                </dd>
              </div>
              {result.elapsedMs != null && (
                <div className="flex justify-between text-ink-faint">
                  <dt>worker</dt>
                  <dd>{(result.elapsedMs / 1000).toFixed(2)}s</dd>
                </div>
              )}
            </dl>

            {result.trades === 0 && (
              <p className="mt-3 font-mono text-[10px] text-warn">
                No signals cleared this threshold. Measured |score| rarely exceeds ~35,
                so thresholds above that select approximately nothing.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
