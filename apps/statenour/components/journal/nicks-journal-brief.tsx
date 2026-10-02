"use client";

/**
 * NicksJournalBrief · Wave AP · 2026-05-28.
 *
 * Sam-Altman frame for /journal · the 2-3 sentence narrative anchor
 * at the top. Pre-this-fix /journal opened onto the composer + the
 * thread radar without a summary of recent activity. Sam would say:
 * "the journal is INPUT · Nick reads it + tells you what you've been
 * doing so you don't have to re-scan your own entries."
 *
 * Cached daily server-side at /api/ai/journal-brief · reads the last
 * 14 days of Reflections + brain_dumps + journal threads, synthesizes
 * via tracedAiChat into a brief that names ·
 *   · sentence 1 · what threads compounded this week (by name)
 *   · sentence 2-3 · the open question · the stalled thread to revisit
 *
 * Self-hides on empty. Mirrors NicksGoalsBrief + NicksHomeBrief +
 * NicksRelationshipsBrief mono-eyebrow pattern · cohesive voice across
 * the OS.
 */

import { useEffect, useState } from "react";
import { Brain } from "lucide-react";
import { rawFetch } from "@/lib/utils/api-fetch";

export function NicksJournalBrief() {
  const [brief, setBrief] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await rawFetch<{ brief: string }>("/api/ai/journal-brief", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
        });
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
      aria-label="nick's journal brief"
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
            nick · journal
          </p>
          <p className="mt-1 text-[13px] text-fg leading-snug whitespace-pre-line">
            {brief}
          </p>
        </div>
      </div>
    </section>
  );
}
