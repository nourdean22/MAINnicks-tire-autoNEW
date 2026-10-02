"use client";

/**
 * MemoryOfDayCard — the brain's curated daily pick.
 *
 * Lived inside components/settings/system-data-cards.tsx under Settings >
 * Diagnostics until the full-circle wave 2 recomposition (2026-10-02): it is
 * brain CONTENT, not machine health, so it mounts on /brain's self-model
 * zone now. The read is `brain.memoryOfTheDay`, which upserts the day's
 * pick-marker row on first call (lib/services/memory-of-the-day.ts) — a
 * read that writes, documented there. Silent on a measured empty day;
 * UnmeasuredLine on a failed read.
 */

import { GlassCard } from "@/components/ui/glass-card";
import { UnmeasuredLine } from "@/components/ui/unmeasured-line";
import { Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc/client";

export function MemoryOfDayCard() {
  const motdQuery = trpc.brain.memoryOfTheDay.useQuery();
  const data = motdQuery.data ?? null;

  if (motdQuery.isError) return <UnmeasuredLine label="Memory of the day" />;
  if (motdQuery.isPending || !data?.memory) return null;
  const m = data.memory;
  const ageStr =
    m.ageDays === 0 ? "today" : m.ageDays === 1 ? "yesterday" : `${m.ageDays}d ago`;

  return (
    <GlassCard>
      <div className="flex items-center gap-2 mb-2">
        <Sparkles size={14} className="text-fg-tertiary" />
        <p className="section-label">Memory of the day</p>
        <span className="ml-auto text-[11px] font-mono text-fg-tertiary">
          {data.dayKey}
        </span>
      </div>
      <div className="text-[11px] text-[var(--text-secondary)] leading-relaxed mb-2">
        {m.content.slice(0, 360)}
        {m.content.length > 360 ? "…" : ""}
      </div>
      <div className="flex items-center gap-3 text-[11px] font-mono text-fg-tertiary">
        <span className="uppercase tracking-[0.12em] text-fg-secondary">
          {m.category.replace(/_/g, " ")}
        </span>
        <span>·</span>
        <span>conf {m.confidence.toFixed(2)}</span>
        <span>·</span>
        <span>{ageStr}</span>
      </div>
    </GlassCard>
  );
}
