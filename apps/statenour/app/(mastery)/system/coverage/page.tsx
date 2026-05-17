"use client";

/**
 * /system/coverage · v10.0.309 · unified "what's missing / under-covered"
 * surface with 4 view-mode tabs:
 *
 *   · GAPS      · unscheduled crons · empty API shells · drift signals
 *                  (was /system/gaps)
 *   · STALE     · aging row cleanup with one-click purge per category
 *                  (was /system/stale)
 *   · SCHEMA    · index coverage audit · cross-refs slow queries
 *                  (was /system/schema-coverage)
 *   · EMBEDDING · pgvector migration health · dual-write · backfill
 *                  (was /system/embedding-coverage)
 *
 * URL ?view=gaps|stale|schema|embedding deep-links directly.
 *
 * Suspense shell wraps useSearchParams per Next 16 build requirement
 * (lesson from v10.0.307 logs Suspense fix).
 *
 * Operator workflow: 4 lenses on "is the OS complete and current?"
 * now share one page-load instead of 4 separate route hops.
 */

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/layout/ui";
import { cn } from "@/lib/utils/cn";
import { CoverageGapsView } from "@/components/system/coverage-gaps";
import { CoverageStaleView } from "@/components/system/coverage-stale";
import { CoverageSchemaView } from "@/components/system/coverage-schema";
import { CoverageEmbeddingView } from "@/components/system/coverage-embedding";

type CoverageView = "gaps" | "stale" | "schema" | "embedding";

const VIEW_META: Record<CoverageView, { label: string; tone: string }> = {
  gaps:      { label: "Gaps",      tone: "bg-amber-500/15 text-amber-200" },
  stale:     { label: "Stale",     tone: "bg-rose-500/15 text-rose-200" },
  schema:    { label: "Schema",    tone: "bg-violet-500/15 text-violet-200" },
  embedding: { label: "Embedding", tone: "bg-cyan-500/15 text-cyan-200" },
};

const DESCRIPTIONS: Record<CoverageView, string> = {
  gaps:      "Unscheduled crons · empty API shells · tool-catalog drift · stale models · missing env.",
  stale:     "One-click purge for aging rows · 8 categories · per-category preview before action.",
  schema:    "Row count × index count audit · cross-refs slow-queries · flags under-indexed hot tables.",
  embedding: "pgvector migration health · dual-write coverage · backfill progress · dedup telemetry.",
};

// Suspense shell (Next 16 useSearchParams requirement).
export default function CoveragePage() {
  return (
    <Suspense fallback={null}>
      <CoverageInner />
    </Suspense>
  );
}

function CoverageInner() {
  const params = useSearchParams();
  const initialView: CoverageView = (() => {
    const v = params?.get("view");
    if (v === "stale") return "stale";
    if (v === "schema") return "schema";
    if (v === "embedding") return "embedding";
    return "gaps";
  })();
  const [view, setView] = useState<CoverageView>(initialView);

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-3 py-4 sm:px-4 sm:py-6">
      <PageHeader parentHref="/system" parentLabel="system"
        eyebrow="NOUR OS · System"
        title="coverage"
        description={DESCRIPTIONS[view]}
        actions={
          <div className="hidden sm:flex items-center gap-0 rounded-lg border border-white/10 bg-white/[0.02] overflow-hidden">
            {(Object.keys(VIEW_META) as CoverageView[]).map((v) => (
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
        }
      />

      {view === "gaps" && <CoverageGapsView />}
      {view === "stale" && <CoverageStaleView />}
      {view === "schema" && <CoverageSchemaView />}
      {view === "embedding" && <CoverageEmbeddingView />}
    </div>
  );
}
