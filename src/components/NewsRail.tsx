import { useMarketStore } from '../store/useMarketStore';

function ago(unixSeconds: number): string {
  const minutes = Math.floor((Date.now() / 1000 - unixSeconds) / 60);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * News and filings rail.
 *
 * SEC 8-K and 10-Q entries are the differentiator here — free, keyless, and
 * absent from essentially every other portfolio dashboard, because they
 * require fetching from somewhere a browser cannot reach.
 */
export function NewsRail() {
  const news = useMarketStore((s) => s.news);

  return (
    <aside className="panel h-full max-h-[calc(100vh-180px)] overflow-auto p-3">
      <div className="lbl mb-2">News &amp; Filings</div>

      {!news.length && (
        <p className="font-mono text-[10px] leading-relaxed text-ink-faint">
          No news payload published yet. Run{' '}
          <span className="text-accent">npm run fetch:news</span> — it needs no API key.
        </p>
      )}

      {news.slice(0, 40).map((item) => (
        <a
          key={item.id}
          href={item.url}
          target="_blank"
          rel="noreferrer"
          className="block border-b border-line/60 py-2 last:border-0 hover:bg-line/20"
        >
          <div className="font-mono text-[9px] tracking-wide text-ink-faint">
            {item.source === 'SEC' ? (
              <span className="text-warn">SEC {item.formType}</span>
            ) : (
              <span>YAHOO</span>
            )}
            {item.symbols.length > 0 && ` · ${item.symbols.join(' ')}`} · {ago(item.datetime)}
          </div>
          <div className="text-[11.5px] leading-snug text-ink-dim">{item.headline}</div>
        </a>
      ))}
    </aside>
  );
}
