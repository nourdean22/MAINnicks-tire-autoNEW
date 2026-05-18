"use client";

/**
 * MasteryErrorView · shared error UI for the 4 mastery surfaces.
 *
 * Phase D follow-up · 2026-05-18 · extracted from the duplicated
 * ErrorView implementations that were inline in goals/page.tsx
 * (lines 456-474) and scoreboard/page.tsx (lines 244-268). Both
 * implementations were byte-for-byte identical except for the
 * `label` prop (page name shown above the error).
 *
 * Cross-surface coherence audit (feature-dev:code-reviewer
 * agent, 2026-05-18) flagged the duplication as pattern-dup #3.
 *
 * The full-page takeover pattern (vs the inline banner pattern
 * /journal uses) IS the deliberate choice for goals + scoreboard ·
 * those pages have no useful chrome to preserve when the snapshot
 * fails (no per-section data, no partial render). /journal keeps
 * its inline banner because the metacognition card + entry feed
 * can still render around a thread-fetch failure.
 */

import { cn } from "@/lib/utils";

interface MasteryErrorViewProps {
  /** Page name shown as the small supertitle (e.g. "Goals" or "Scoreboard"). */
  label: string;
  /** The error message to display in red below the supertitle. */
  error: string;
  /** Called when the operator clicks "retry". */
  onRetry: () => void;
  /** Override the default min-height / centering behavior. */
  className?: string;
}

export function MasteryErrorView({
  label,
  error,
  onRetry,
  className,
}: MasteryErrorViewProps) {
  return (
    <main
      className={cn(
        "min-h-[100dvh] bg-[#0A0A0A] text-white flex items-center justify-center px-6",
        className,
      )}
    >
      <div className="max-w-md text-center">
        <p className="text-xs uppercase tracking-[0.18em] text-white/40 mb-3">
          {label}
        </p>
        <p className="text-sm text-red-300">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-6 inline-flex items-center min-h-[44px] px-4 py-2 rounded border border-white/15 text-sm hover:bg-white/[0.04]"
        >
          retry
        </button>
      </div>
    </main>
  );
}
