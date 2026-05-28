"use client";

/**
 * NicksGoalsBrief · Wave AI · 2026-05-28.
 *
 * The Sam-layer header for /goals. Pre-this-fix /goals opened directly
 * onto the polyhedron + axis badges + GoalBoard — operator-grade museum.
 * Sam-Altman frame: "what's the ONE thing that, if it worked, would
 * matter 10x more than everything else?" — the operator needs Nick to
 * say it OUT LOUD before they have to scan a board.
 *
 * Mirrors NicksRelationshipsBrief (Wave AB) + NicksHomeBrief (Wave AC)
 * voice + tone · 2-3 sentence brief read from /api/ai/goals-brief which
 * caches daily in BrainMemory(GOALS_BRIEF). Self-hides when empty so a
 * quiet morning stays quiet.
 *
 * Aesthetic · gold eyebrow + 13px body · matches the other Nicks*
 * briefs across the OS.
 */

import { useEffect, useState } from "react";
import { Brain } from "lucide-react";

export function NicksGoalsBrief() {
  const [brief, setBrief] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/ai/goals-brief", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
        });
        if (!res.ok) throw new Error("goals_brief_failed");
        const data = (await res.json()) as { brief: string };
        if (!cancelled) setBrief(data.brief?.trim() || null);
      } catch {
        // Silent · the page renders without it.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!brief) return null;

  return (
    <section
      aria-label="nick's goals brief"
      className="rounded-lg border border-[var(--gold)]/30 bg-[var(--gold)]/[0.04] px-4 py-3"
    >
      <div className="flex items-start gap-2">
        <Brain
          size={12}
          className="text-[var(--gold)] mt-0.5 shrink-0"
          strokeWidth={1.75}
        />
        <div className="flex-1 min-w-0">
          <p className="text-[9px] font-mono uppercase tracking-[0.18em] text-[var(--gold)]/80">
            nick · goals
          </p>
          <p className="mt-1 text-[13px] text-[var(--text-primary)] leading-snug whitespace-pre-line">
            {brief}
          </p>
        </div>
      </div>
    </section>
  );
}
