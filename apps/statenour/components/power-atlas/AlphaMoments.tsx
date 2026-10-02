"use client";

/**
 * <AlphaMoments> · 2026-05-27 · Power Atlas Phase 2
 *
 * Renders the operator-pinned alpha moments for a person (peaks · shifts
 * · insights) sourced from BrainMemory(category="alpha_moment"). Empty
 * state shows the pin-from-timeline hint. Per-row amber left-border to
 * signal the "this is the high-value memory" archive.
 *
 * Operator pins moments via the markAlphaMoment mutation (called from
 * a future long-press handler on LedgerTimeline rows · v1 is read-only
 * + Cmd+K driven · scope-tight per plan).
 *
 * No emojis. Serif heading. Monospace dates. Compatible with Power
 * Atlas aesthetic.
 */

import { trpc } from "@/lib/trpc/client";

interface AlphaMomentsProps {
  personId: string;
}

export default function AlphaMoments({ personId }: AlphaMomentsProps) {
  const { data: moments = [] } = trpc.task.listAlphaMoments.useQuery({
    personId,
  });

  if (moments.length === 0) {
    return (
      <section
        className="rounded-surface border border-edge-subtle bg-content p-4"
      >
        <h2 className="text-[17px] font-semibold text-fg mb-2">
          Alpha moments
        </h2>
        <p className="text-xs text-fg-tertiary">
          No peaks pinned yet. From the ledger timeline, long-press an
          entry to mark it as a peak / shift / insight.
        </p>
      </section>
    );
  }

  return (
    <section
      className="rounded-surface border border-edge-subtle bg-content p-4"
    >
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="text-[17px] font-semibold text-fg">
          Alpha moments
        </h2>
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary tabular-nums">
          {moments.length}
        </span>
      </div>
      <ol className="space-y-3">
        {moments.map((m, i) => (
          <li
            key={`${m.ledgerId}:${i}`}
            className="border-l-2 border-edge-strong pl-3"
          >
            <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-amber-300/80">
              {m.kind}
            </div>
            <p className="text-sm text-fg-secondary mt-1 leading-snug break-words">
              {m.moment}
            </p>
            <p className="font-mono text-[11px] text-fg-tertiary mt-1 tabular-nums">
              {m.createdAt.slice(0, 10)}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
