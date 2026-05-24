"use client";

/**
 * components/chat/lens-badge-row.tsx · 2026-05-23 · UI #1.
 *
 * Lens-fire transparency · shows which strategic lenses Nick used to
 * reason about THIS specific assistant reply. Pre-fix the data
 * existed (record-lens-fire writes SystemMetric rows) but was only
 * visible aggregated on /system/lens-stats · operator had NO way to
 * see "for THIS reply, Nick used Pareto + Inversion."
 *
 * How it works:
 *   · For each assistant message, fire `chat.lensesForMessage` query
 *     against the previous user message
 *   · Re-runs `pickFrameworks(userContent)` server-side · DETERMINISTIC
 *     (same input → same lenses · matches what fired at request time)
 *   · Renders matched lens names as small chips below the reply
 *   · Click a chip → expands inline detail with the lens's oneLiner
 *
 * Why inline-expand vs popover · we don't have a Popover primitive
 * in components/ui/ yet and adding base-ui-react Popover for this
 * one component is overkill. Inline-expand is native HTML +
 * click-toggle + zero new dependencies. Same UX value.
 *
 * Performance:
 *   · React-query cached per messageId · the input (user message text)
 *     is immutable so we cache forever
 *   · Server-side detector is ~44 regex tests · trivial
 *   · Returns null when no lenses · zero DOM
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface Lens {
  id: string;
  name: string;
  oneLiner: string;
  score: number;
}

export function LensBadgeRow({ messageId }: { messageId: string }) {
  const { data, isLoading } = trpc.chat.lensesForMessage.useQuery(
    { messageId },
    {
      staleTime: Infinity,
      gcTime: 60 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    },
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (isLoading || !data || data.lenses.length === 0) return null;

  const expanded = expandedId
    ? data.lenses.find((l) => l.id === expandedId)
    : null;

  return (
    <div className="pt-1.5">
      <div className="flex flex-wrap items-center gap-1 text-[10px]">
        <Sparkles
          size={10}
          className="text-[var(--text-tertiary)] shrink-0"
          aria-hidden
        />
        <span className="text-[var(--text-tertiary)] font-mono uppercase tracking-wider mr-0.5">
          lens
        </span>
        {data.lenses.map((lens) => {
          const isActive = expandedId === lens.id;
          const shortName = lens.name.replace(/\s*\([^)]*\)\s*$/, "");
          return (
            <button
              key={lens.id}
              type="button"
              onClick={() => setExpandedId(isActive ? null : lens.id)}
              title={lens.oneLiner}
              className={cn(
                "rounded-full border px-2 py-0.5 transition-colors duration-150",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--gold)]/60",
                isActive
                  ? "border-[var(--gold)]/40 bg-[var(--gold)]/[0.08] text-[var(--gold)]"
                  : "border-[var(--border-default)] bg-[var(--bg-base)]/60 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-hover)] hover:bg-[var(--bg-raised)]/40",
              )}
              aria-expanded={isActive}
              aria-controls={isActive ? `lens-detail-${lens.id}` : undefined}
            >
              {shortName.toLowerCase()}
            </button>
          );
        })}
      </div>
      {expanded ? (
        <LensDetail key={expanded.id} lens={expanded} />
      ) : null}
    </div>
  );
}

function LensDetail({ lens }: { lens: Lens }) {
  return (
    <div
      id={`lens-detail-${lens.id}`}
      className="mt-2 rounded-lg border border-[var(--gold)]/20 bg-[var(--gold)]/[0.03] px-3 py-2 text-xs animate-in fade-in slide-in-from-top-1 duration-150"
    >
      <div className="font-semibold uppercase tracking-wider text-[10px] text-[var(--gold)]">
        {lens.name}
      </div>
      <p className="mt-1 text-[var(--text-secondary)] leading-relaxed">
        {lens.oneLiner}
      </p>
      <p className="mt-1.5 text-[10px] text-[var(--text-tertiary)] font-mono">
        score · {lens.score.toFixed(2)}
      </p>
    </div>
  );
}
