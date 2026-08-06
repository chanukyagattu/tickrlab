/// <reference lib="webworker" />

/**
 * Backtest worker.
 *
 * This is the one place in TickrLab where a Worker earns its keep. Scoring a
 * single asset is microseconds and belongs on the main thread; a parameter
 * sweep across 50 symbols and six years of daily bars is seconds and would
 * visibly freeze the UI.
 *
 * The worker owns no state beyond the request it is servicing, so cancelling
 * is just ignoring a stale response — see `requestId`.
 */

import { runBacktest, type BacktestParams, type BacktestResult } from '../engine/backtest';
import type { Candle } from '../engine/types';

export interface BacktestRequest {
  requestId: number;
  data: Record<string, Candle[]>;
  params: BacktestParams;
}

export type BacktestResponse =
  | { requestId: number; ok: true; result: BacktestResult }
  | { requestId: number; ok: false; error: string };

self.onmessage = (event: MessageEvent<BacktestRequest>) => {
  const { requestId, data, params } = event.data;

  try {
    const started = performance.now();
    const result = runBacktest(data, params);
    result.elapsedMs = Math.round(performance.now() - started);

    const response: BacktestResponse = { requestId, ok: true, result };
    self.postMessage(response);
  } catch (error) {
    const response: BacktestResponse = {
      requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};
