"use client";

/**
 * NextMoveCard · Wave 24 (v10.0.529.80) · #4
 *
 * Top-of-NOW affordance · reads /api/tasks/next-move and surfaces:
 *   · weakest mastery domain + score
 *   · 1-line rationale ("X drifted recently · time for a deliberate push")
 *   · up to 3 candidate tasks (from inbox match, pattern thread, or
 *     create-daily fallback)
 *
 * Operator's morning glance: "where do I aim today?" answered.
 *
 * Auto-hides when there's no mastery data yet (fresh OS).
 */

import { useEffect } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { TipChip } from "@/components/ui/tip-chip";
import { onDataChanged } from "@/lib/events/data-change";
import { Target } from "lucide-react";

const TIP =
  "the system finds your weakest mastery axis and suggests 3 moves: tasks already in your inbox that lift it, threads from recent patterns, or a daily-loop to create. updates as you check things off.";

export function NextMoveCard() {
  // Polls every 120s for the weakest-axis read · matches the legacy
  // setInterval cadence. onDataChanged refetches after a task/goal
  // mutation so the card reflects check-offs without waiting a cycle.
  const { data, isError, refetch } = trpc.task.nextMove.useQuery(undefined, {
    refetchInterval: 120_000,
  });

  useEffect(() => {
    const off = onDataChanged(["tasks", "goals"], () => {
      setTimeout(() => void refetch(), 500);
    });
    return off;
  }, [refetch]);

  if (isError || !data || !data.weakestDomain || data.suggestions.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="next move suggestions"
      className="rounded-lg border border-[var(--gold)]/30 bg-[var(--gold)]/[0.04] p-3 space-y-2"
    >
      <header className="flex items-center gap-2">
        <Target size={13} className="text-[var(--gold)]" strokeWidth={1.75} />
        <h3 className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--gold)]">
          next move
        </h3>
        {typeof data.weakestScore === "number" && (
          <span className="text-[10px] font-mono tabular-nums text-[var(--text-tertiary)]">
            · {data.weakestDomain} {data.weakestScore}/100
          </span>
        )}
        <TipChip tip={TIP} title="next move" size="xs" />
      </header>
      {data.rationale && (
        <p className="text-[11px] text-[var(--text-secondary)] leading-snug">
          {data.rationale}
        </p>
      )}
      <ul className="space-y-1" aria-label="suggested moves">
        {data.suggestions.map((s, i) => {
          const body = (
            <>
              <span className="flex-1 text-[11px] text-[var(--text-primary)] leading-snug">
                {s.title}
              </span>
              <span className="text-[9px] font-mono uppercase tracking-[0.12em] text-[var(--text-tertiary)] shrink-0 ml-2">
                {s.reason}
              </span>
            </>
          );
          return (
            <li key={i}>
              {s.taskId ? (
                <Link
                  href={`/missions?focus=${encodeURIComponent(s.taskId)}`}
                  className="flex items-center justify-between gap-2 rounded-md border border-[var(--border-default)] bg-[var(--bg-raised)]/[0.04] px-2.5 py-1.5 hover:border-[var(--gold)]/40 hover:bg-[var(--gold)]/[0.06] transition-colors focus-visible:outline-none focus-visible:border-[var(--gold)]/60"
                  aria-label={`open task ${s.title}`}
                >
                  {body}
                </Link>
              ) : (
                <div className="flex items-center justify-between gap-2 rounded-md border border-[var(--border-default)] bg-[var(--bg-raised)]/[0.04] px-2.5 py-1.5">
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
