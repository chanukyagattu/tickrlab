import { useEffect, useRef } from 'react';
// lightweight-charts v4 API: `chart.addCandlestickSeries(...)`.
// v5 replaced these with `chart.addSeries(CandlestickSeries, ...)`. Pinned to
// v4 in package.json, so the v4 calls below are correct — upgrading the
// dependency means rewriting this file, not just bumping the version.
import { createChart, type IChartApi } from 'lightweight-charts';
import { ema } from '../engine/indicators';
import type { Candle } from '../engine/types';

/**
 * Canvas chart via lightweight-charts.
 *
 * The EMAs plotted here are computed by the SAME `ema()` the score uses, from
 * the same candle array — one source of truth, so the chart cannot visually
 * disagree with the number rendered beside it. Recomputing them with charting
 * library built-ins would be easier and would eventually drift.
 */
interface Props {
  symbol: string;
  candles: Candle[];
  emaFast?: number;
  emaSlow?: number;
}

export function PriceChart({ symbol, candles, emaFast = 20, emaSlow = 50 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !candles.length) return;

    const chart = createChart(container, {
      layout: {
        background: { color: 'transparent' },
        textColor: '#8b98a5',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 10,
      },
      grid: {
        vertLines: { color: 'rgba(42,52,65,0.4)' },
        horzLines: { color: 'rgba(42,52,65,0.4)' },
      },
      rightPriceScale: { borderColor: '#2a3441' },
      timeScale: { borderColor: '#2a3441', timeVisible: false },
      crosshair: { mode: 0 },
      autoSize: true,
    });

    const priceSeries = chart.addCandlestickSeries({
      upColor: '#2dd4a7',
      downColor: '#f0616d',
      borderUpColor: '#2dd4a7',
      borderDownColor: '#f0616d',
      wickUpColor: '#2dd4a7',
      wickDownColor: '#f0616d',
    });

    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    });

    const fastSeries = chart.addLineSeries({
      color: '#2dd4a7',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const slowSeries = chart.addLineSeries({
      color: '#5a6673',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const bars = candles.map((candle) => ({
      time: candle.time as never,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }));
    priceSeries.setData(bars);

    volumeSeries.setData(
      candles.map((candle) => ({
        time: candle.time as never,
        value: candle.volume,
        color: candle.close >= candle.open ? 'rgba(45,212,167,0.3)' : 'rgba(240,97,109,0.3)',
      })),
    );

    const closes = candles.map((candle) => candle.close);
    const toLine = (series: (number | null)[]) =>
      candles
        .map((candle, i) => ({ time: candle.time as never, value: series[i] }))
        .filter((point): point is { time: never; value: number } => point.value != null);

    fastSeries.setData(toLine(ema(closes, emaFast)));
    slowSeries.setData(toLine(ema(closes, emaSlow)));

    chart.timeScale().fitContent();
    chartRef.current = chart;

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [candles, emaFast, emaSlow]);

  if (!candles.length) {
    return (
      <div className="panel flex h-full min-h-[220px] items-center justify-center font-mono text-xs text-ink-faint">
        No candle history for {symbol}.
      </div>
    );
  }

  return (
    <div className="panel flex h-full min-h-[240px] flex-col p-3">
      <div className="lbl mb-2 flex items-center justify-between">
        <span>{symbol} · daily candles + volume</span>
        <span className="normal-case tracking-normal">
          <span className="text-bull">— EMA{emaFast}</span>{' '}
          <span className="text-ink-faint">— EMA{emaSlow}</span>
        </span>
      </div>
      <div ref={containerRef} className="min-h-0 flex-1" />
    </div>
  );
}
