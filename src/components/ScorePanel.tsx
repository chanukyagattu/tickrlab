import type { BacktestResult } from '../engine/backtest';
import type { ScoredAsset } from '../engine/types';

const LABELS: Record<string, string> = {
  RSI: 'RSI(14)',
  EMA_SPREAD: 'EMA SPREAD',
  MACD_SLOPE: 'MACD SLOPE',
  VOLUME: 'VOL vs 20D',
};

function ComponentBar({ contribution }: { contribution: number }) {
  const width = Math.min(Math.abs(contribution), 50);
  const positive = contribution >= 0;
  return (
    <span className="relative block h-[7px] flex-1 rounded bg-line">
      <span className="absolute -top-[2px] left-1/2 h-[11px] w-px bg-ink-faint" />
      <span
        className={`absolute top-0 h-[7px] rounded ${positive ? 'bg-bull' : 'bg-bear'}`}
        style={{ left: positive ? '50%' : `${50 - width}%`, width: `${width}%` }}
      />
    </span>
  );
}

interface Props {
  asset: ScoredAsset | null;
  backtest: BacktestResult | null;
  onShowValidation: () => void;
}

/**
 * The decomposition panel — the centrepiece.
 *
 * A single number is a black box and invites trust it has not earned. Printing
 * the four contributions and their raw inputs turns it into something a reader
 * can disagree with, which is the correct relationship to have with a
 * mechanical indicator. It is also why the copilot is never asked to produce
 * these figures: they are already on screen, computed.
 */
export function ScorePanel({ asset, backtest, onShowValidation }: Props) {
  if (!asset) {
    return (
      <div className="panel p-4 text-center font-mono text-xs text-ink-faint">
        Select an asset.
      </div>
    );
  }

  const { score, meta } = asset;

  if (!score) {
    return (
      <div className="panel p-4">
        <div className="lbl mb-2">{asset.symbol} · Technical Momentum Score</div>
        <p className="font-mono text-xs text-ink-faint">
          Fewer than 60 daily bars available, so no score is computed. An unscored
          asset is not a neutral one — the UI reports the absence rather than
          inventing a zero.
        </p>
      </div>
    );
  }

  const tone =
    score.total >= 20 ? 'text-bull' : score.total <= -20 ? 'text-bear' : 'text-ink-dim';

  return (
    <div className="panel p-4">
      <div className="lbl mb-3">
        {asset.symbol} · Technical Momentum Score
        {asset.live && <span className="ml-2 text-bull">● live</span>}
      </div>

      <div className="flex flex-wrap items-center gap-6">
        <div className="min-w-[110px] text-center">
          <div className={`font-mono text-[42px] font-bold leading-none ${tone}`}>
            {score.total > 0 ? '+' : ''}
            {score.total.toFixed(0)}
          </div>
          <div className="mt-1 font-mono text-[10px] tracking-widest text-ink-dim">
            {asset.band}
          </div>
          <div className="mt-2 font-mono text-[9px] text-ink-faint">−100 ·· 0 ·· +100</div>
        </div>

        <div className="grid flex-1 gap-2">
          {score.components.map((component) => (
            <div
              key={component.key}
              className="grid grid-cols-[84px_1fr_44px] items-center gap-3 font-mono text-[10px] text-ink-faint"
              title={`${component.note} · weight ${component.weight}`}
            >
              <span>{LABELS[component.key] ?? component.key}</span>
              <ComponentBar contribution={component.contribution} />
              <span
                className={`text-right ${
                  component.contribution >= 0 ? 'text-bull' : 'text-bear'
                }`}
              >
                {component.contribution > 0 ? '+' : ''}
                {component.contribution.toFixed(0)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-3 border-t border-line pt-3 md:grid-cols-2">
        <div>
          <div className="lbl mb-2">Inputs</div>
          <dl className="font-mono text-[10.5px] leading-relaxed text-ink-dim">
            {score.components.map((component) => (
              <div key={component.key} className="flex justify-between gap-3">
                <dt className="text-ink-faint">{LABELS[component.key] ?? component.key}</dt>
                <dd>
                  {component.raw.toFixed(2)}
                  <span className="ml-2 text-ink-faint">{component.note}</span>
                </dd>
              </div>
            ))}
            <div className="mt-1 flex justify-between gap-3 text-ink-faint">
              <dt>candles</dt>
              <dd>
                {score.candlesUsed} · to {new Date(score.asOf * 1000).toISOString().slice(0, 10)}
              </dd>
            </div>
          </dl>
        </div>

        <div>
          <div className="lbl mb-2">Honesty panel</div>
          {backtest && backtest.trades > 0 ? (
            <div className="text-[11.5px] text-ink-dim">
              <p>
                This configuration fired{' '}
                <strong className="text-ink">{backtest.trades}</strong> signals across{' '}
                {backtest.symbolsTested} assets.
              </p>
              <dl className="my-2 font-mono text-[10.5px] leading-relaxed">
                <div className="flex justify-between">
                  <dt>directional hit rate</dt>
                  <dd className="text-warn">{(backtest.hitRate * 100).toFixed(1)}%</dd>
                </div>
                <div className="flex justify-between">
                  <dt>after costs</dt>
                  <dd className="text-warn">
                    {(backtest.hitRateAfterCosts * 100).toFixed(1)}%
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>vs buy-and-hold</dt>
                  <dd className={backtest.excessReturn >= 0 ? 'text-bull' : 'text-bear'}>
                    {backtest.excessReturn >= 0 ? '+' : ''}
                    {(backtest.excessReturn * 100).toFixed(1)}%
                  </dd>
                </div>
              </dl>
              <p className="text-[11px]">
                {backtest.hitRateAfterCosts < 0.55
                  ? 'Close to a coin flip. '
                  : 'Measured on this universe only. '}
                <button
                  type="button"
                  onClick={onShowValidation}
                  className="text-accent underline underline-offset-2"
                >
                  See the full backtest →
                </button>
              </p>
            </div>
          ) : (
            <p className="text-[11.5px] text-ink-faint">
              Run the backtest on the Validation tab to measure how this configuration
              has actually performed.{' '}
              <button
                type="button"
                onClick={onShowValidation}
                className="text-accent underline underline-offset-2"
              >
                Open Validation →
              </button>
            </p>
          )}
        </div>
      </div>

      {meta.proxyFor && (
        <p className="mt-3 border-t border-line pt-2 font-mono text-[9.5px] text-warn">
          † Proxy for {meta.proxyFor}. {meta.proxyCaveat}
        </p>
      )}
    </div>
  );
}
