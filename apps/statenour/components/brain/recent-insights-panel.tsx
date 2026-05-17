"use client";

/**
 * RecentInsightsPanel · Wave 23 (v10.0.529.79) · #4
 *
 * Lists last-7d AI-enriched task insights grouped by 8-axis identity.
 * Mounted on /trends (inside KommandoTrack) so the operator can read
 * back what the brain captured this week without leaving the work
 * surface.
 *
 * Each insight shows:
 *   · content (LLM-enriched lesson or task title fallback)
 *   · axis tag
 *   · wisdom-thread suggestion (if present)
 *   · enrichment time (if AI-enriched)
 *
 * Auto-hides when there are no insights in the window.
 */

import { useCallback, useEffect, useState } from "react";
import { authedFetch } from "@/hooks/use-authed-fetch";
import { TipChip } from "@/components/ui/tip-chip";
import { BookOpen } from "lucide-react";

interface Insight {
  key: string;
  content: string;
  axis: string | null;
  wisdomQuery: string | null;
  confidence: number;
  lastSeen: string;
  enrichedAt: string | null;
}

const PANEL_TIP =
  "every task that reads like a learning ('researched', 'studied', 'watched', 'figured out') gets saved here. nick enriches each one in the background with the axis it lifts + a thread to pull.";

export function RecentInsightsPanel() {
  const [insights, setInsights] = useState<Insight[] | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await authedFetch("/api/brain/recent-insights?days=7&limit=30", {
        cache: "no-store",
      });
      if (!r.ok) {
        setError(true);
        return;
      }
      const body = await r.json();
      const payload = (body?.data ?? body) as { insights: Insight[] };
      setInsights(payload.insights ?? []);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error || !insights) return null;
  if (insights.length === 0) return null;

  // Group by axis (null → "unsorted")
  const groups = new Map<string, Insight[]>();
  for (const i of insights) {
    const axis = i.axis ?? "unsorted";
    const list = groups.get(axis) ?? [];
    list.push(i);
    groups.set(axis, list);
  }

  // Sort axes by member count desc
  const orderedAxes = Array.from(groups.keys()).sort(
    (a, b) => (groups.get(b)?.length ?? 0) - (groups.get(a)?.length ?? 0),
  );

  return (
    <section
      aria-label="recent task insights"
      className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)]/[0.03] p-4 space-y-3"
    >
      <header className="flex items-center gap-2">
        <BookOpen size={13} className="text-[var(--gold)]" strokeWidth={1.75} />
        <h3 className="text-[11px] font-mono uppercase tracking-[0.18em] text-[var(--text-primary)]">
          last 7 days · what you learned
        </h3>
        <TipChip tip={PANEL_TIP} title="recent insights" size="xs" />
        <span className="ml-auto text-[10px] font-mono tabular-nums text-[var(--text-tertiary)]">
          {insights.length} insights
        </span>
      </header>
      <div className="space-y-3">
        {orderedAxes.map((axis) => {
          const items = groups.get(axis)!;
          return (
            <div key={axis} className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-[var(--gold)]">
                  {axis.replace(/_/g, " ")}
                </span>
                <span className="text-[10px] font-mono tabular-nums text-[var(--text-tertiary)]">
                  · {items.length}
                </span>
              </div>
              <ul className="pl-2 border-l border-[var(--border-default)] space-y-0.5">
                {items.slice(0, 4).map((i) => (
                  <li key={i.key} className="text-[11px] leading-snug">
                    <span className="text-[var(--text-secondary)]">· {i.content}</span>
                    {i.wisdomQuery && (
                      <span className="block text-[10px] italic text-[var(--text-tertiary)] ml-2 mt-0.5">
                        → {i.wisdomQuery}
                      </span>
                    )}
                  </li>
                ))}
                {items.length > 4 && (
                  <li className="text-[10px] italic text-[var(--text-tertiary)] pl-2">
                    +{items.length - 4} more
                  </li>
                )}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
