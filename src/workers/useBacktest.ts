import { useCallback, useEffect, useRef, useState } from 'react';
import type { BacktestParams, BacktestResult } from '../engine/backtest';
import type { Candle } from '../engine/types';
import type { BacktestRequest, BacktestResponse } from './backtest.worker';

/**
 * Owns one backtest worker for the lifetime of the component.
 *
 * Responses carry the `requestId` they were asked with, and anything that
 * isn't the newest request is dropped. Without that, dragging a parameter
 * slider produces a race where an older, slower run lands after a newer one
 * and the UI settles on stale numbers — a bug that looks like flakiness rather
 * than a race, and is correspondingly annoying to find.
 */
export function useBacktest() {
  const workerRef = useRef<Worker | null>(null);
  const latestRequest = useRef(0);

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runCount, setRunCount] = useState(0);

  useEffect(() => {
    const worker = new Worker(new URL('./backtest.worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (event: MessageEvent<BacktestResponse>) => {
      const response = event.data;
      if (response.requestId !== latestRequest.current) return; // superseded

      setRunning(false);
      if (response.ok) {
        setResult(response.result);
        setError(null);
      } else {
        setError(response.error);
      }
    };

    worker.onerror = (event) => {
      setRunning(false);
      setError(event.message || 'backtest worker failed');
    };

    workerRef.current = worker;
    return () => worker.terminate();
  }, []);

  const run = useCallback((data: Record<string, Candle[]>, params: BacktestParams) => {
    const worker = workerRef.current;
    if (!worker) return;

    const requestId = latestRequest.current + 1;
    latestRequest.current = requestId;

    setRunning(true);
    setError(null);
    setRunCount((n) => n + 1);

    const request: BacktestRequest = { requestId, data, params };
    worker.postMessage(request);
  }, []);

  return { run, running, result, error, runCount };
}
