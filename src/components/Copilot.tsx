import { useState } from 'react';
import { classify } from '../copilot/intent';
import type { ScoredAsset } from '../engine/types';

const DISCLAIMER = '⚠ Not financial advice · appended by the UI, not the model';

/**
 * Copilot — inference deliberately deferred.
 *
 * The two pieces that matter architecturally are already live and tested: the
 * local intent classifier (which refuses advice before any inference is
 * billed) and the context builder below. What is stubbed is only the network
 * call to a Cloudflare Worker, which needs an account to deploy.
 *
 * The invariant this component exists to enforce: the model never computes a
 * number. Scores are calculated client-side and passed in as context, so it
 * narrates figures it did not produce and structurally cannot hallucinate a
 * price or an RSI.
 */
interface Message {
  role: 'user' | 'assistant';
  text: string;
  meta?: string;
}

/**
 * Build the context payload. Only computed values — never raw candles, and
 * never a request for the model to calculate anything.
 */
export function buildContext(asset: ScoredAsset | null) {
  if (!asset?.score) return null;
  return {
    symbol: asset.symbol,
    name: asset.meta.name,
    sector: asset.meta.sector,
    industry: asset.meta.industry,
    price: asset.price,
    changePct: asset.changePct,
    band: asset.band,
    total: asset.score.total,
    components: asset.score.components.map((c) => ({
      key: c.key,
      raw: c.raw,
      contribution: c.contribution,
      note: c.note,
    })),
  };
}

/** Deterministic narration from context — no model, no network, no invention. */
function narrate(asset: ScoredAsset): string {
  const context = buildContext(asset);
  if (!context) return 'No score is available for this asset yet.';

  const ranked = [...context.components].sort(
    (a, b) => Math.abs(b.contribution) - Math.abs(a.contribution),
  );
  const lead = ranked[0]!;

  const parts = ranked.map(
    (c) => `${c.key.replace('_', ' ').toLowerCase()} ${c.raw.toFixed(2)} (${c.contribution > 0 ? '+' : ''}${c.contribution.toFixed(0)})`,
  );

  return (
    `${context.symbol} scores ${context.total > 0 ? '+' : ''}${context.total.toFixed(0)} — ${context.band.toLowerCase()}. ` +
    `The largest contribution is ${lead.key.replace('_', ' ').toLowerCase()}, ${lead.note}. ` +
    `Full decomposition: ${parts.join(', ')}. ` +
    `These are mechanical calculations, not a forecast.`
  );
}

interface Props {
  asset: ScoredAsset | null;
  onFilter: (sector: string) => void;
}

export function Copilot({ asset, onFilter }: Props) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      text: 'I can explain what any indicator on screen measures and how it was calculated. I do not give buy or sell recommendations.',
      meta: DISCLAIMER,
    },
  ]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const query = input.trim();
    if (!query) return;

    const classification = classify(query);
    const next: Message[] = [...messages, { role: 'user', text: query }];

    if (classification.intent === 'ADVICE') {
      // Refused locally. Zero tokens, and no model that could be persuaded.
      next.push({
        role: 'assistant',
        text: classification.refusal!,
        meta: '↳ blocked by intent classifier · 0 tokens spent',
      });
    } else if (classification.intent === 'FILTER' && classification.filter?.sector) {
      onFilter(classification.filter.sector);
      next.push({
        role: 'assistant',
        text: `Filtered to ${classification.filter.sector}.`,
        meta: '↳ tool call · UI applied the filter',
      });
    } else if (classification.intent === 'EXPLAIN' && asset) {
      next.push({
        role: 'assistant',
        text: narrate(asset),
        meta: `${DISCLAIMER} · deterministic narration, inference not yet deployed`,
      });
    } else {
      next.push({
        role: 'assistant',
        text:
          'Live inference is not deployed yet — the Cloudflare Worker that holds the API key is still to come. ' +
          'The classifier and context builder are live, so refusals and filters already work, and "why is X bullish?" is answered directly from the computed score.',
        meta: '↳ inference deferred · see DESIGN.md §8',
      });
    }

    setMessages(next);
    setInput('');
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-12 right-4 z-40 rounded-full border border-accent-d bg-panel px-4 py-2 font-mono text-[11px] text-accent shadow-lg hover:bg-accent/10"
      >
        💬 Ask TickrLab
      </button>
    );
  }

  return (
    <div className="panel fixed bottom-12 right-4 z-40 flex h-[440px] w-[min(380px,calc(100vw-2rem))] flex-col shadow-2xl">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="lbl">Ask TickrLab</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="font-mono text-xs text-ink-faint hover:text-ink"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 space-y-2 overflow-auto p-3">
        {messages.map((message, i) => (
          <div
            key={i}
            className={`max-w-[88%] rounded-lg px-3 py-2 text-[12px] ${
              message.role === 'user'
                ? 'ml-auto bg-line text-ink'
                : 'border border-accent/20 bg-accent/5 text-ink-dim'
            }`}
          >
            {message.text}
            {message.meta && (
              <div className="mt-1.5 border-t border-line pt-1 font-mono text-[9px] text-ink-faint">
                {message.meta}
              </div>
            )}
          </div>
        ))}
      </div>

      <form onSubmit={submit} className="border-t border-line p-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={asset ? `Why is ${asset.symbol} ${asset.band.toLowerCase()}?` : 'Ask about anything on screen…'}
          className="w-full rounded border border-line-hi bg-bg px-2 py-1.5 font-mono text-[11px] text-ink placeholder:text-ink-faint focus:border-accent-d focus:outline-none"
        />
      </form>
    </div>
  );
}
