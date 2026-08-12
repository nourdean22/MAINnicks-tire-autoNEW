"use client";

/**
 * TrustLadderPanel — BDN-102's surface (2026-08-12).
 *
 * The graduation mechanism has existed since June (confidence-tier's
 * canAutoExecute); the tallies behind it were never rendered, so the
 * NICK_CONFIDENCE_TIER flip was a leap instead of a reading. This is the
 * scoreboard: per action type, the operator's own 45-day verdict record
 * and whether that record clears the auto bar.
 *
 * Read-only. Nothing here promotes anything — flipping the flag stays a
 * deliberate operator act, which is the entire point of the ladder.
 */

import { trpc } from "@/lib/trpc/client";
import { AlertCircle, Gauge } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export function TrustLadderPanel() {
  const ladderQ = trpc.system.trustLadder.useQuery(undefined, { staleTime: 60_000 });

  if (ladderQ.isLoading) {
    return (
      <section aria-label="trust-ladder" className="rounded-xl border border-white/5 p-4 space-y-2">
        <div className="h-3 w-36 rounded bg-white/5 animate-pulse" />
        <div className="h-16 rounded bg-white/[0.03] animate-pulse" />
      </section>
    );
  }
  if (ladderQ.isError) {
    return (
      <section aria-label="trust-ladder" className="rounded-xl border border-red-500/15 bg-red-500/5 p-4">
        <p className="text-[11px] text-red-400 flex items-center gap-1.5">
          <AlertCircle className="h-3.5 w-3.5" />
          Trust ladder couldn&apos;t load — acceptance record unknown, not empty.
        </p>
      </section>
    );
  }

  const rows = ladderQ.data?.rows ?? [];
  const flagOn = ladderQ.data?.flagOn === true;
  const ready = rows.filter((r) => r.meetsBar).length;

  return (
    <section
      aria-label="trust-ladder"
      className="rounded-xl border border-white/8 bg-white/[0.01] p-4 flex flex-col space-y-3"
    >
      <div className="flex items-center justify-between gap-2 flex-wrap border-b border-white/6 pb-2">
        <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-300 font-semibold flex items-center gap-1.5">
          <Gauge className="h-3.5 w-3.5 text-[var(--gold)]/80" /> Trust Ladder
        </p>
        <span className="text-[9px] font-mono text-zinc-500">
          {ladderQ.data?.windowDays}d verdicts · auto-execute {flagOn ? "ON" : "OFF"}
        </span>
      </div>

      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li
            key={r.actionType}
            className="flex items-center justify-between gap-3 p-2 rounded bg-white/1 border border-white/3"
          >
            <div className="min-w-0">
              <p className="text-[10px] font-mono text-zinc-300 truncate">{r.actionType}</p>
              <p className="text-[9px] text-zinc-500 mt-0.5">
                {r.decided === 0 ? (
                  "no verdicts yet — nothing to grade"
                ) : (
                  <>
                    {r.approved}/{r.decided} accepted
                    {r.acceptanceRate !== null && ` · ${Math.round(r.acceptanceRate * 100)}%`}
                  </>
                )}
              </p>
            </div>
            <span
              className={cn(
                "text-[8px] font-mono uppercase tracking-wider shrink-0 rounded px-1.5 py-0.5 border",
                r.wouldAutoExecute
                  ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/5"
                  : r.meetsBar
                    ? "text-[var(--gold)] border-[var(--gold)]/30 bg-[var(--gold)]/5"
                    : "text-zinc-500 border-white/10",
              )}
              title={
                r.wouldAutoExecute
                  ? "clears the bar AND the flag is on — runs unattended"
                  : r.meetsBar
                    ? "clears the bar; only the NICK_CONFIDENCE_TIER flag stands between this type and unattended execution"
                    : "does not clear the bar — stays approval-gated"
              }
            >
              {r.wouldAutoExecute ? "auto" : r.meetsBar ? "ready" : "gated"}
            </span>
          </li>
        ))}
      </ul>

      <p className="text-[9px] text-zinc-600 leading-relaxed border-t border-white/6 pt-2">
        {ready > 0 && !flagOn
          ? `${ready} type${ready === 1 ? "" : "s"} clear the bar. Flipping NICK_CONFIDENCE_TIER would let ${ready === 1 ? "it" : "them"} run unattended — allowlisted internal actions only; messaging and money can never pass.`
          : "A type graduates only on the operator's own accepted/rejected record — allowlisted internal actions only; messaging and money can never pass."}
      </p>
    </section>
  );
}
