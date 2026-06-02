"use client";

/**
 * NicksHomeBrief · Wave AC Phase 1A · 2026-05-28.
 *
 * The Sam-layer header for the home page. Cross-surface synthesis ·
 * unions Wave AA mission state + Wave AB relationship state + journal
 * activity + brain memory into one 2-3 sentence brief Nick speaks.
 *
 *   "3 missions in motion · Power Atlas leads at 64%. Manny silent 11d.
 *    Tyler's retro from Sunday is worth re-reading. Best move now: ship
 *    the ErrorBoundary task in Power Atlas."
 *
 * Replaces HomeNarrator's "single editorial sentence" as the lead.
 * Self-hides when there's nothing meaningful to say.
 *
 * Cached daily server-side · the home page open doesn't re-burn AI
 * tokens.
 */

import { useEffect, useState } from "react";
import { Brain } from "lucide-react";

export function NicksHomeBrief() {
  const [brief, setBrief] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/ai/home-brief", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
        });
        if (!res.ok) throw new Error("brief_failed");
        const data = (await res.json()) as { brief: string };
        if (!cancelled) setBrief(data.brief?.trim() || null);
      } catch {
        // Silent · home page renders without it.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <section
        aria-label="nick's home brief"
        aria-busy="true"
        className="rounded-lg border border-[var(--gold)]/20 bg-[var(--gold)]/[0.03] px-4 py-3"
      >
        <div className="flex items-start gap-2">
          <div className="mt-0.5 h-3 w-3 shrink-0 animate-pulse rounded bg-[var(--bg-elevated)]" />
          <div className="flex-1 space-y-2">
            <div className="h-2 w-20 animate-pulse rounded bg-[var(--bg-elevated)]" />
            <div className="h-3 w-full animate-pulse rounded bg-[var(--bg-elevated)]" />
            <div className="h-3 w-3/4 animate-pulse rounded bg-[var(--bg-elevated)]" />
          </div>
        </div>
      </section>
    );
  }

  if (!brief) return null;

  return (
    <section
      aria-label="nick's home brief"
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
            nick · today
          </p>
          <p className="mt-1 text-[13px] text-[var(--text-primary)] leading-relaxed max-w-[60ch] whitespace-pre-line">
            {brief}
          </p>
        </div>
      </div>
    </section>
  );
}
