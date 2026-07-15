"use client";

/**
 * Metacognition card · UI wave (audit 2026-07-15).
 *
 * trpc.journal.metacognition existed since Phase TT with a docstring
 * claiming it "powers the small metacognition card at the top of
 * /journal" — no such card was ever rendered (the procedure had zero
 * callers). This is that card: Nick's nightly self-assessment of his
 * own brain. Self-hides when no cron run has landed.
 */

import { trpc } from "@/lib/trpc/client";
import { BrainCircuit, TrendingUp, TrendingDown, AlertTriangle } from "lucide-react";

export function MetacognitionCard() {
  const { data } = trpc.journal.metacognition.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 30 * 60 * 1000, // nightly cron output — fresh for the session
  });

  if (!data || !data.selfAssessment) return null;

  const trend = data.learningRate?.trend;

  return (
    <section
      aria-label="nick metacognition"
      className="rounded-xl border border-cyan-500/20 bg-zinc-950/40 p-4 space-y-2"
    >
      <header className="flex items-center gap-2">
        <BrainCircuit size={13} className="text-cyan-400" strokeWidth={2} />
        <h3 className="text-[11px] font-mono uppercase tracking-[0.18em] text-cyan-300">
          nick&apos;s metacognition
        </h3>
        {trend === "accelerating" && (
          <span className="ml-auto flex items-center gap-1 text-[9px] font-mono text-emerald-400">
            <TrendingUp size={10} aria-hidden /> accelerating
          </span>
        )}
        {trend === "decelerating" && (
          <span className="ml-auto flex items-center gap-1 text-[9px] font-mono text-amber-400">
            <TrendingDown size={10} aria-hidden /> decelerating
          </span>
        )}
      </header>

      <p className="text-[12px] text-zinc-300 leading-relaxed">{data.selfAssessment}</p>

      {data.stagnationAlert && (
        <p className="flex items-start gap-1.5 text-[11px] text-amber-300/90 leading-snug">
          <AlertTriangle size={11} aria-hidden className="shrink-0 mt-0.5" />
          {data.stagnationAlert}
        </p>
      )}
    </section>
  );
}
