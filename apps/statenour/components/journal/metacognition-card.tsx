"use client";

/**
 * Metacognition row of the Journal "Signals" list: Nick's nightly self-assessment of his own brain
 * (trpc.journal.metacognition, written by a nightly cron). Wave E1 (2026-10-24): it was a bordered
 * card that rendered nothing while loading, empty or failed; as a row it says which of the four it is.
 */

import { trpc } from "@/lib/trpc/client";
import { TrendingUp, TrendingDown, AlertTriangle } from "lucide-react";
import { ReadStateNote } from "@/components/ui/read-state-note";
import { ShimmerSkeleton } from "@/components/ui/shimmer-skeleton";
import { isRetrying, readState } from "@/lib/query-state";

const LABEL = "Nick's self-assessment";

export function MetacognitionCard() {
  const query = trpc.journal.metacognition.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 30 * 60 * 1000, // nightly cron output: fresh for the session
  });
  const state = readState(query);
  const data = query.data;

  if (state === "loading") {
    return (
      <li className="py-3">
        <ShimmerSkeleton className="h-10 w-full" />
      </li>
    );
  }
  if (state === "error" || state === "offline") {
    return (
      <li className="py-3">
        <ReadStateNote state={state} label={LABEL} onRetry={() => void query.refetch()} retrying={isRetrying(query)} />
      </li>
    );
  }
  if (!data || !data.selfAssessment) {
    return <li className="py-3 text-[13px] text-fg-tertiary">No nightly self-assessment yet. It lands after the first nightly run.</li>;
  }

  const trend = data.learningRate?.trend;

  return (
    <li aria-label="nick metacognition" className="py-3 space-y-2">
      {state === "stale" && (
        <ReadStateNote state={state} label={LABEL} onRetry={() => void query.refetch()} retrying={isRetrying(query)} />
      )}
      <div className="flex items-center gap-2">
        <h4 className="text-xs font-medium text-fg-secondary">{LABEL}</h4>
        {trend === "accelerating" && (
          <span className="ml-auto flex items-center gap-1 text-[11px] text-emerald-300">
            <TrendingUp size={10} aria-hidden /> accelerating
          </span>
        )}
        {trend === "decelerating" && (
          <span className="ml-auto flex items-center gap-1 text-[11px] text-amber-300">
            <TrendingDown size={10} aria-hidden /> decelerating
          </span>
        )}
      </div>

      <p className="text-[13px] text-fg-secondary leading-relaxed">{data.selfAssessment}</p>

      {data.stagnationAlert && (
        <p className="flex items-start gap-1.5 text-[11px] text-amber-300 leading-snug">
          <AlertTriangle size={11} aria-hidden className="shrink-0 mt-0.5" />
          {data.stagnationAlert}
        </p>
      )}
    </li>
  );
}
