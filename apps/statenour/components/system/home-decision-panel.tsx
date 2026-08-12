"use client";

/**
 * HomeDecisionPanel — BDN-104 (2026-08-12).
 *
 * The compact-Home composition shipped with a cheap test and no sensor.
 * This is the readout: did the operator actually decide anything on
 * Home, and did the resume cue get used? Kept deliberately small — it
 * answers one question, and an empty reading says "unmeasured", never
 * "unused".
 */

import { trpc } from "@/lib/trpc/client";
import { AlertCircle, MousePointerClick } from "lucide-react";

export function HomeDecisionPanel() {
  const metricsQ = trpc.system.homeDecisionMetrics.useQuery(
    { windowDays: 7 },
    { staleTime: 120_000 },
  );

  if (metricsQ.isLoading) {
    return (
      <section aria-label="home-decisions" className="rounded-xl border border-white/5 p-4 space-y-2">
        <div className="h-3 w-36 rounded bg-white/5 animate-pulse" />
        <div className="h-12 rounded bg-white/[0.03] animate-pulse" />
      </section>
    );
  }
  if (metricsQ.isError) {
    return (
      <section aria-label="home-decisions" className="rounded-xl border border-red-500/15 bg-red-500/5 p-4">
        <p className="text-[11px] text-red-400 flex items-center gap-1.5">
          <AlertCircle className="h-3.5 w-3.5" />
          Home decision metrics couldn&apos;t load — unmeasured, not zero.
        </p>
      </section>
    );
  }

  const m = metricsQ.data;

  return (
    <section
      aria-label="home-decisions"
      className="rounded-xl border border-white/8 bg-white/[0.01] p-4 flex flex-col space-y-3"
    >
      <div className="flex items-center justify-between gap-2 border-b border-white/6 pb-2">
        <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-300 font-semibold flex items-center gap-1.5">
          <MousePointerClick className="h-3.5 w-3.5 text-[var(--gold)]/80" /> Home Decisions
        </p>
        <span className="text-[9px] font-mono text-zinc-500">last {m?.windowDays}d</span>
      </div>

      <div className="flex items-baseline gap-4">
        <div>
          <p className="text-lg font-semibold text-white/90">{m?.verdicts ?? 0}</p>
          <p className="text-[9px] font-mono uppercase tracking-wider text-zinc-500">verdicts</p>
        </div>
        <div>
          <p className="text-lg font-semibold text-white/90">{m?.resumes ?? 0}</p>
          <p className="text-[9px] font-mono uppercase tracking-wider text-zinc-500">resumes</p>
        </div>
        <div>
          <p className="text-lg font-semibold text-white/90">{m?.activeDays ?? 0}</p>
          <p className="text-[9px] font-mono uppercase tracking-wider text-zinc-500">active days</p>
        </div>
      </div>

      {m?.note ? (
        <p className="text-[10px] text-zinc-500 leading-relaxed">{m.note}</p>
      ) : (
        <p className="text-[9px] text-zinc-600 leading-relaxed">
          The BDN-001 cheap test: if Home is where decisions happen, these move. If they stay flat,
          the composition gets marked untested-and-unused in the ledger — not quietly kept.
        </p>
      )}
    </section>
  );
}
