"use client";

/**
 * NicksRelationshipsBrief · Wave AB Phase 2 · 2026-05-28.
 *
 * Mirror of NicksMorningBrief (Wave AA) but scoped to relationships.
 * A single 1-paragraph synthesis from Nick across the operator's
 * PersonProfile + recent RelationshipLedger movement + KEPT_WORD
 * markers + cross-reference of mention-days against operator mastery
 * score · cached daily in BrainMemory(category=relationships_morning_brief).
 *
 *   "Manny 11d silent · his birthday in 6 weeks · he helped you 3×
 *    last month, you've returned 1. Mo's promise from Mar 18 still
 *    open. Tyler hit 90d silent (Greene Law 16)."
 *
 * Self-hides when zero active people.
 */

import { useEffect, useMemo, useState } from "react";
import { Brain } from "lucide-react";
import { rawFetch } from "@/lib/utils/api-fetch";

interface NicksRelationshipsBriefProps {
  /** Count of active people · the gate condition for the fetch. Passed
   *  in so the parent owns the data and this component stays dumb. */
  activePeopleCount: number;
}

export function NicksRelationshipsBrief({
  activePeopleCount,
}: NicksRelationshipsBriefProps) {
  const [brief, setBrief] = useState<string | null>(null);

  const shouldFetch = useMemo(() => activePeopleCount > 0, [activePeopleCount]);

  useEffect(() => {
    if (!shouldFetch) return;
    let cancelled = false;
    void (async () => {
      try {
        const data = await rawFetch<{ brief: string }>("/api/ai/relationships-morning-brief", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
        });
        if (!cancelled) setBrief(data.brief?.trim() || null);
      } catch {
        // PRE-EXISTING, fixed in passing because it is the same defect as
        // nicks-morning-brief and this file is already in the diff. The effect
        // re-runs on `shouldFetch`, so a failed refetch left the previous
        // brief on screen — a stale summary shown as current. Clearing is what
        // "the section self-hides" always claimed to do but did not.
        if (!cancelled) setBrief(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shouldFetch]);

  if (!brief) return null;

  return (
    <section
      aria-label="nick's relationships brief"
      className="rounded-surface border border-edge-subtle bg-content px-4 py-3"
    >
      <div className="flex items-start gap-2">
        <Brain
          size={12}
          className="text-fg-tertiary mt-0.5 shrink-0"
          strokeWidth={1.75}
        />
        <div className="flex-1 min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
            nick · today&apos;s relationships
          </p>
          <p className="mt-1 text-[12px] text-[var(--text-primary)] leading-snug whitespace-pre-line">
            {brief}
          </p>
        </div>
      </div>
    </section>
  );
}
