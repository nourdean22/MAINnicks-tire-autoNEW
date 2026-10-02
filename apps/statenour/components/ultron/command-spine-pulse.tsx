"use client";

/**
 * CommandSpinePulse · v9.1.2 · Apr 30.
 *
 * Compact HQ surface that consumes `/api/command-center/state` —
 * the v9.0 unified contract. First Ultron-home consumer of the
 * Command Spine, demonstrating that the same shape NICK reads via
 * `NickPrimeContext` is also driving operator-visible UI.
 *
 * What it shows (in 3 tight lines):
 *   1. Active command title + priority pill (or "between commands")
 *   2. Today's proof ratio — N tasks done / M with proof
 *   3. Active risk count + noProofDay flag when fired
 *
 * Silent when:
 *   · No active command AND no proof today AND no risks (clean slate)
 *   · API unreachable — failure is a transient signal, not worth
 *     persistent operator anxiety on HQ
 *
 * Design rationale: the existing /system/command-center page is the
 * deep dive. This pulse is the at-a-glance pointer that lives on
 * Ultron home alongside SystemHealthCard / SinceLastVisitCard.
 */

import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { Target, CheckCircle2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CommandCenterState } from "@/lib/ai/context/command-center-state";

const PRIORITY_TINT: Record<string, string> = {
  critical: "border-rose-500/40 bg-rose-500/[0.04] text-rose-200",
  high: "border-amber-500/40 bg-amber-500/[0.04] text-amber-200",
  medium: "border-sky-500/30 bg-sky-500/[0.03] text-sky-200",
  low: "border-edge-strong bg-surface-raised/30 text-fg-secondary",
};

export function CommandSpinePulse() {
  // Phase B.6a (2026-05-22) · migrated off `authedFetch` onto
  // `trpc.operator.commandCenterState`. React Query's refetchInterval
  // replaces the manual setInterval (60s cadence preserved). The
  // procedure returns the CommandCenterState directly (the legacy
  // route's `data` envelope is gone). Silent on failure — `isError`
  // or no data → render null, matching the legacy `error` state.
  const { data: state, isError } = trpc.operator.commandCenterState.useQuery(
    undefined,
    { refetchInterval: 60_000, retry: false },
  );

  if (isError || !state) return null;

  const totalRisks =
    state.risks.driftAlerts.length +
    state.risks.brainAlerts.length +
    state.risks.staleCommands.length +
    (state.risks.noProofDay.fired ? 1 : 0);

  const proof = state.proof.today;
  const isCleanSlate =
    !state.commands.active &&
    proof.tasksDone === 0 &&
    proof.autonomousActionsOk === 0 &&
    totalRisks === 0;
  if (isCleanSlate) return null;

  const proofRatio =
    proof.tasksDone > 0
      ? `${proof.tasksDoneWithProof}/${proof.tasksDone}`
      : "0/0";

  return (
    <Link
      href="/system"
      className="block rounded-surface border border-edge-subtle bg-content p-3 transition-colors duration-[var(--motion-state)] hover:border-edge-strong"
      title="Open command center · v9.0 Command Spine"
    >
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
          🎯 command spine · v9.0
        </span>
        <span className="font-mono text-[11px] text-fg-tertiary">
          tap to expand →
        </span>
      </div>

      {/* Active command */}
      <div className="mb-1.5 flex items-center gap-2">
        <Target size={11} className="shrink-0 text-fg-tertiary" />
        {state.commands.active ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span
              className={cn(
                "shrink-0 rounded-full border px-1.5 py-px font-mono text-[11px] uppercase tracking-[0.12em]",
                PRIORITY_TINT[state.commands.active.priority] ??
                  PRIORITY_TINT.low,
              )}
            >
              {state.commands.active.priority}
            </span>
            <span className="truncate text-[11px] text-fg">
              {state.commands.active.title}
            </span>
          </div>
        ) : (
          <span className="text-[11px] text-fg-tertiary">
            between commands · {state.commands.open.length} queued
          </span>
        )}
      </div>

      {/* Proof + risks row */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px]">
        <span className="inline-flex items-center gap-1 text-emerald-300">
          <CheckCircle2 size={10} />
          proof {proofRatio}
        </span>
        {totalRisks > 0 && (
          <span
            className={cn(
              "inline-flex items-center gap-1",
              state.risks.noProofDay.fired ? "text-amber-300" : "text-rose-300",
            )}
          >
            <AlertTriangle size={10} />
            {totalRisks} risk{totalRisks === 1 ? "" : "s"}
            {state.risks.noProofDay.fired && " · 📎 no-proof day"}
          </span>
        )}
        {totalRisks === 0 && state.commands.active && (
          <span className="text-fg-tertiary">risks · clear</span>
        )}
      </div>
    </Link>
  );
}
