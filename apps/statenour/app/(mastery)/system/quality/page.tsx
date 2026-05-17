"use client";

/**
 * /system/quality · v10.0.312 · unified quality + lessons + decisions
 * surface with 3 view-mode tabs:
 *
 *   · NICK      · "is Nick getting better?" · 4-axis reply quality
 *                  scorecard (was original /system/quality body)
 *   · LESSONS   · anti-pattern library · "I tried X, failed, lesson Y"
 *                  (was /system/anti-patterns)
 *   · DECISIONS · review-rate gauge + grade drift + overdue queue
 *                  (was /system/decision-drift)
 *
 * URL ?view=nick|lessons|decisions deep-links directly.
 * Suspense shell wraps useSearchParams (Next 16 build requirement).
 *
 * Operator workflow: 3 lenses on "is the operator + AI quality
 * compounding?" now share one page-load instead of 3 route hops.
 */

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/layout/ui";
import { cn } from "@/lib/utils/cn";
import { QualityNickView } from "@/components/system/quality-nick";
import { QualityLessonsView } from "@/components/system/quality-lessons";
import { QualityDecisionsView } from "@/components/system/quality-decisions";

type QualityView = "nick" | "lessons" | "decisions";

const VIEW_META: Record<QualityView, { label: string; tone: string }> = {
  nick:      { label: "Nick",      tone: "bg-emerald-500/15 text-emerald-200" },
  lessons:   { label: "Lessons",   tone: "bg-amber-500/15 text-amber-200" },
  decisions: { label: "Decisions", tone: "bg-violet-500/15 text-violet-200" },
};

const DESCRIPTIONS: Record<QualityView, string> = {
  nick:      "Is Nick getting better? · 4-axis reply quality · 7d/30d trend · regen rate.",
  lessons:   "Anti-pattern library · 'I tried X, failed, lesson Y' · the library compounds.",
  decisions: "Decision follow-through pulse · review rate · grade drift · overdue queue.",
};

// Suspense shell (Next 16 useSearchParams requirement).
export default function QualityPage() {
  return (
    <Suspense fallback={null}>
      <QualityInner />
    </Suspense>
  );
}

function QualityInner() {
  const params = useSearchParams();
  const initialView: QualityView = (() => {
    const v = params?.get("view");
    if (v === "lessons") return "lessons";
    if (v === "decisions") return "decisions";
    return "nick";
  })();
  const [view, setView] = useState<QualityView>(initialView);

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-3 py-4 sm:px-4 sm:py-6">
      <PageHeader parentHref="/system" parentLabel="system"
        eyebrow="NOUR OS · System"
        title="Quality"
        description={DESCRIPTIONS[view]}
        actions={
          <div className="hidden sm:flex items-center gap-0 rounded-lg border border-white/10 bg-white/[0.02] overflow-hidden">
            {(Object.keys(VIEW_META) as QualityView[]).map((v) => (
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

      {view === "nick" && <QualityNickView />}
      {view === "lessons" && <QualityLessonsView />}
      {view === "decisions" && <QualityDecisionsView />}
    </div>
  );
}
