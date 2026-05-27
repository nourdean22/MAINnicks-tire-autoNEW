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
        className="rounded-xl border bg-[var(--bg-raised)] p-4"
        style={{ borderColor: "rgba(255,255,255,0.06)" }}
      >
        <h2 className="font-serif text-lg tracking-tight text-[var(--text-primary)] mb-2">
          Alpha moments
        </h2>
        <p className="text-xs text-[var(--text-tertiary)]">
          No peaks pinned yet. From the ledger timeline, long-press an
          entry to mark it as a peak / shift / insight.
        </p>
      </section>
    );
  }

  return (
    <section
      className="rounded-xl border bg-[var(--bg-raised)] p-4"
      style={{ borderColor: "rgba(255,255,255,0.06)" }}
    >
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="font-serif text-lg tracking-tight text-[var(--text-primary)]">
          Alpha moments
        </h2>
        <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] tabular-nums">
          {moments.length}
        </span>
      </div>
      <ol className="space-y-3">
        {moments.map((m, i) => (
          <li
            key={`${m.ledgerId}:${i}`}
            className="border-l-2 pl-3"
            style={{ borderColor: "rgba(253,185,19,0.4)" }}
          >
            <div className="text-[10px] uppercase tracking-wider text-amber-300/80">
              {m.kind}
            </div>
            <p className="text-sm text-[var(--text-secondary)] mt-1 leading-snug break-words">
              {m.moment}
            </p>
            <p className="text-[10px] text-[var(--text-tertiary)] mt-1 font-mono tabular-nums">
              {m.createdAt.slice(0, 10)}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
