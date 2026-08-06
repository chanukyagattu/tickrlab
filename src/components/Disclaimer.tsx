import { useEffect, useState } from 'react';

const STORAGE_KEY = 'tickrlab.disclaimer.v1';

/**
 * Blocking first-visit gate.
 *
 * Not dismissible by clicking the backdrop, and it links straight to the
 * measured hit rate rather than burying it. Volunteering the weakness is the
 * credibility move: anyone evaluating this will check whether the signals
 * work, and finding the answer already published changes how the rest reads.
 */
export function DisclaimerGate() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setOpen(true);
    } catch {
      // Private browsing can throw on localStorage. Showing the gate every
      // visit is the safe failure, so default to showing it.
      setOpen(true);
    }
  }, []);

  if (!open) return null;

  const accept = () => {
    try {
      localStorage.setItem(STORAGE_KEY, String(Date.now()));
    } catch {
      /* non-fatal */
    }
    setOpen(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="disclaimer-title"
    >
      <div className="panel max-w-lg p-6">
        <div className="lbl mb-3">Before you continue</div>
        <h2 id="disclaimer-title" className="mb-3 text-lg font-semibold">
          TickrLab is not financial advice.
        </h2>

        <div className="space-y-3 text-sm text-ink-dim">
          <p>
            This is a technical demonstration. Data may be delayed, incomplete, or
            incorrect. Scores are mechanical calculations with{' '}
            <strong className="text-ink">no demonstrated predictive value</strong> — the
            measured hit rate is published on the Validation tab, and it is close to a
            coin flip after costs.
          </p>
          <p>Nothing here is an offer to buy or sell any security.</p>
          <p>Do your own research and consult a licensed financial advisor.</p>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={accept}
            className="rounded border border-accent-d bg-accent/10 px-4 py-2 font-mono text-xs text-accent hover:bg-accent/20"
          >
            I understand — continue
          </button>
          <a
            href="https://github.com/chanukyagattu/tickrlab/blob/main/DESIGN.md"
            target="_blank"
            rel="noreferrer"
            className="rounded border border-line-hi px-4 py-2 font-mono text-xs text-ink-faint hover:text-ink-dim"
          >
            Read the design doc
          </a>
        </div>
      </div>
    </div>
  );
}

export function DisclaimerBar() {
  return (
    <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2 font-mono text-[10px] text-ink-faint">
      <span>
        <span className="text-warn">⚠</span> Not financial advice · mechanical indicators
        only · data may be delayed or wrong
      </span>
      <a
        href="https://github.com/chanukyagattu/tickrlab"
        target="_blank"
        rel="noreferrer"
        className="hover:text-ink-dim"
      >
        github.com/chanukyagattu/tickrlab
      </a>
    </footer>
  );
}
