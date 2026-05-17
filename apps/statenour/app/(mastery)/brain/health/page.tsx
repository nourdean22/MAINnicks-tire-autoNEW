"use client";

/**
 * /brain/health · v10.0.330 · unified brain telemetry surface with
 * three view-mode tabs:
 *
 *   · HEALTH      · per-category memory health rollup · live/permanent/
 *                   decayed/vectorized% + flags + per-category table
 *                   (was /brain/health · the canonical name kept)
 *   · CATEGORIES  · BrainMemory category observability · 138 categories
 *                   grouped by domain with registered/deprecated/
 *                   unregistered drift signals
 *                   (was /brain/categories)
 *   · CONTINUITY  · cross-session memory deltas · 24h/7d category
 *                   movers + 4-column recent activity + leaderboards
 *                   (was /brain/continuity)
 *
 * URL ?view=health|categories|continuity deep-links directly.
 *
 * v10.0.330 cluster-merge of 3 telemetry pages → 1. Same pattern as
 * v10.0.305-309 system clusters and v10.0.329 brain search+recall merge.
 * Each view is a self-contained component that handles its own data
 * fetching · the shell only owns the title + tab toggle + URL sync.
 *
 * Suspense shell wraps useSearchParams per Next 16 build requirement.
 */

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { BrainHealthView } from "@/components/brain/health-view";
import { BrainCategoriesView } from "@/components/brain/categories-view";
import { BrainContinuityView } from "@/components/brain/continuity-view";
import { onDataChanged } from "@/lib/events/data-change";

type View = "health" | "categories" | "continuity";

const VIEW_META: Record<View, { label: string; tone: string; description: string }> = {
  health: {
    label: "Health",
    tone: "bg-[var(--gold)]/15 text-[var(--gold)]",
    description: "per-category rollup · vectorization · decay · dormancy",
  },
  categories: {
    label: "Categories",
    tone: "bg-emerald-500/15 text-emerald-200",
    description: "138 categories · registered / deprecated / unregistered · drift signal",
  },
  continuity: {
    label: "Continuity",
    tone: "bg-violet-500/15 text-violet-200",
    description: "what Nick remembered · reinforced · decayed · new — across sessions",
  },
};

export default function BrainHealthPage() {
  return (
    <Suspense
      fallback={
        <div className="text-[11px] text-[var(--text-tertiary)] p-6">
          loading…
        </div>
      }
    >
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const params = useSearchParams();
  const initialView: View = (() => {
    const v = params?.get("view");
    if (v === "categories") return "categories";
    if (v === "continuity") return "continuity";
    return "health";
  })();
  const [view, setView] = useState<View>(initialView);
  // v10.0.529.89 · Wave 33 · refreshKey bump on "brain" bus events.
  // Each view component fetches on mount via its own internal effect ·
  // bumping the `key` forces a remount → fresh fetch. Cheapest correct
  // wire-up without touching each child component's internals.
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    return onDataChanged(["brain"], () => setRefreshKey((k) => k + 1));
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-[var(--font-display)] font-bold lowercase tracking-wider text-[var(--text-primary)]">
            brain telemetry
          </h1>
          <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
            {VIEW_META[view].description}
          </p>
        </div>
        <div className="flex items-center gap-0 rounded-lg border border-white/10 bg-white/[0.02] overflow-hidden">
          {(Object.keys(VIEW_META) as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                "px-2.5 py-1.5 text-xs font-medium transition border-l border-white/10 first:border-l-0",
                view === v
                  ? VIEW_META[v].tone
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]",
              )}
            >
              {VIEW_META[v].label.toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {view === "health" && <BrainHealthView key={`health-${refreshKey}`} />}
      {view === "categories" && <BrainCategoriesView key={`cat-${refreshKey}`} />}
      {view === "continuity" && <BrainContinuityView key={`cont-${refreshKey}`} />}
    </div>
  );
}
