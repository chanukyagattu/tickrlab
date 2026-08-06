import { useEffect, useRef } from 'react';
import { UNIVERSE, useMarketStore } from '../store/useMarketStore';

/**
 * Binance miniTicker stream. Keyless, and the only genuinely real-time data in
 * TickrLab — everything else is explicitly end-of-day.
 *
 * Two things this hook exists to get right:
 *
 * 1. THROTTLING. Raw streams push far faster than any display needs. Setting
 *    React state per message causes a re-render storm delivering information
 *    no human can read. Ticks are accumulated into a ref and flushed once per
 *    animation frame, so render rate is bounded by the display, not the wire.
 *
 * 2. RECONNECTION. Binance drops idle connections and the socket also dies on
 *    sleep/wake. Reconnect uses exponential backoff with jitter — a fixed
 *    interval turns a brief outage into a self-inflicted hammering.
 *
 * Note: Binance.com geo-blocks some regions. A failure here degrades to
 * "crypto rows show no live dot", not a broken page, which is why the crypto
 * rows are additive rather than load-bearing.
 */

const STREAM_HOST = 'wss://stream.binance.com:9443/stream';
const MAX_BACKOFF_MS = 30_000;

interface MiniTicker {
  s: string; // symbol
  c: string; // close
  o: string; // open (24h)
}

export function useCryptoStream(enabled = true) {
  const applyTicks = useMarketStore((s) => s.applyTicks);
  const pending = useRef<Record<string, { price: number; changePct: number }>>({});
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const streams = Object.values(UNIVERSE)
      .filter((meta) => meta.type === 'CRYPTO' && meta.stream)
      .map((meta) => `${meta.stream}@miniTicker`);

    if (!streams.length) return;

    let socket: WebSocket | null = null;
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const flush = () => {
      frame.current = null;
      const batch = pending.current;
      pending.current = {};
      if (Object.keys(batch).length) applyTicks(batch);
    };

    const schedule = () => {
      if (frame.current === null) frame.current = requestAnimationFrame(flush);
    };

    const connect = () => {
      if (closed) return;

      socket = new WebSocket(`${STREAM_HOST}?streams=${streams.join('/')}`);

      socket.onopen = () => {
        attempt = 0;
      };

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data as string) as { data?: MiniTicker };
          const tick = payload.data;
          if (!tick?.s) return;

          const price = Number.parseFloat(tick.c);
          const open = Number.parseFloat(tick.o);
          if (!Number.isFinite(price) || !Number.isFinite(open) || open === 0) return;

          pending.current[tick.s] = {
            price,
            changePct: ((price - open) / open) * 100,
          };
          schedule();
        } catch {
          // A malformed frame is not worth tearing the connection down for.
        }
      };

      socket.onclose = () => {
        if (closed) return;
        // Exponential backoff with jitter: 1s, 2s, 4s ... capped at 30s.
        const base = Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
        const delay = base * (0.5 + Math.random() * 0.5);
        attempt++;
        reconnectTimer = setTimeout(connect, delay);
      };

      socket.onerror = () => socket?.close();
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      socket?.close();
    };
  }, [enabled, applyTicks]);
}
