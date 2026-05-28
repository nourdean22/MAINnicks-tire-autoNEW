"use client";

/**
 * NicksScoreboardBrief · Wave AQ · 2026-05-28.
 *
 * Sam-Altman frame for /scoreboard · gold-eyebrow brief at the top.
 * Pre-this-fix the page opened onto OperatorPulse → NickHealthSection
 * → anomalies → anchors · operator scanned to know the score. The
 * brief names the ONE number that matters + the open risk + the
 * concrete next move BEFORE any cards.
 *
 * Cached daily server-side at /api/ai/scoreboard-brief · reads the
 * same buildMetaScoreboard() data the page uses · zero drift between
 * narrative and cards.
 *
 * Self-hides on empty. Mirrors NicksHomeBrief + NicksGoalsBrief +
 * NicksJournalBrief + NicksMorningBrief gold-eyebrow pattern.
 */

import { useEffect, useState } from "react";
import { Brain } from "lucide-react";

export function NicksScoreboardBrief() {
  const [brief, setBrief] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/ai/scoreboard-brief", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
        });
        if (!res.ok) throw new Error("scoreboard_brief_failed");
        const data = (await res.json()) as { brief: string };
        if (!cancelled) setBrief(data.brief?.trim() || null);
      } catch {
        // Silent · page renders without it.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!brief) return null;

  return (
    <section
      aria-label="nick's scoreboard brief"
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
            nick · scoreboard
          </p>
          <p className="mt-1 text-[13px] text-[var(--text-primary)] leading-snug whitespace-pre-line">
            {brief}
          </p>
        </div>
      </div>
    </section>
  );
}
