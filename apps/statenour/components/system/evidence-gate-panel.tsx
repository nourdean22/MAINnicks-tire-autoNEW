"use client";

/**
 * EvidenceGatePanel — the readout AGENTS.md §4 L6 blocks promotion on.
 *
 * L6 says the evidence gate "runs in SHADOW … Enforcement goes live on the
 * buffered path once the shadow false-positive rate is known." Verdicts have
 * been persisted since 2026-09-10; `buildEvidenceGateCalibration` made the
 * number computable, and then NOTHING RENDERED IT — a procedure with no
 * consumer, which is the same unwired shape the census panel next door exists
 * to expose. A decision gated on a number nobody can see does not get made.
 *
 * WHY A PANEL EVEN THOUGH THE ANSWER IS CURRENTLY "NOT YET". The verdict is
 * "DO NOT PROMOTE, n=12 against a floor of 40". That is precisely why this is
 * worth rendering: the only thing standing between here and a decision is
 * SAMPLE GROWTH, and a progress bar is how that becomes visible instead of
 * something a future session has to rediscover by writing a script.
 *
 * ⚠ THIS PANEL NEVER COMPUTES A RATE. `wouldBlockPct` is null below the floor
 * BY DESIGN — the module refuses to state a rate on a thin sample, because
 * "4 of 12" rendered as 33.3% invites exactly the promotion this readout is
 * supposed to gate. A panel that divided `wouldBlock / turns` itself would
 * silently undo that discipline at the last step. It renders what the server
 * decided, or it renders "withheld".
 */

import { trpc } from "@/lib/trpc/client";
import { AlertCircle, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils/cn";

const DRIVER_LABELS: Record<string, { label: string; tone: string; note?: string }> = {
  named_claim: { label: "named claim", tone: "text-amber-300" },
  fact_check: { label: "fact-check", tone: "text-rose-300" },
  // Called out because it is not an evidence signal at all — a long reply is
  // not an unsupported one, and promoting on an aggregate would promote this.
  length: { label: "length", tone: "text-zinc-500", note: "not an evidence signal" },
  other: { label: "other", tone: "text-zinc-400" },
};

function Cohort({
  title,
  cohort,
  subtitle,
}: {
  title: string;
  subtitle: string;
  cohort: {
    turns: number;
    wouldBlock: number;
    wouldBlockPct: number | null;
    byDriver: Record<string, number>;
  };
}) {
  const drivers = Object.entries(cohort.byDriver).filter(([, n]) => n > 0);
  return (
    <div className="flex-1 min-w-0 rounded border border-white/6 bg-white/[0.01] p-2.5 space-y-1.5">
      <p className="text-[9px] uppercase tracking-[0.16em] text-zinc-400 font-semibold">{title}</p>
      <p className="text-[9px] font-mono text-zinc-600">{subtitle}</p>
      <p className="font-mono text-zinc-200">
        {cohort.wouldBlockPct === null ? (
          // The refusal, rendered as a refusal. Never a computed number.
          <span className="text-[11px] text-amber-300">rate withheld</span>
        ) : (
          <span className="text-[15px]">{cohort.wouldBlockPct.toFixed(1)}%</span>
        )}
        <span className="ml-1.5 text-[9px] text-zinc-500">
          {cohort.wouldBlock}/{cohort.turns} turns
        </span>
      </p>
      {drivers.length > 0 && (
        <ul className="space-y-0.5">
          {drivers.map(([k, n]) => {
            const d = DRIVER_LABELS[k] ?? { label: k, tone: "text-zinc-400" };
            return (
              <li key={k} className="flex items-baseline gap-1.5 text-[9px] font-mono">
                <span className={d.tone}>{d.label}</span>
                <span className="text-zinc-500">{n}</span>
                {d.note && <span className="text-zinc-600 italic">· {d.note}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function EvidenceGatePanel() {
  const q = trpc.system.evidenceGateCalibration.useQuery(undefined, { staleTime: 60_000 });

  if (q.isLoading) {
    return (
      <section aria-label="evidence-gate-calibration" className="rounded-xl border border-white/5 p-4 space-y-2">
        <div className="h-3 w-44 rounded bg-white/5 animate-pulse" />
        <div className="h-16 rounded bg-white/[0.03] animate-pulse" />
      </section>
    );
  }
  if (q.isError || !q.data) {
    return (
      <section
        aria-label="evidence-gate-calibration"
        className="rounded-xl border border-red-500/15 bg-red-500/5 p-4"
      >
        <p className="text-[11px] text-red-400 flex items-center gap-1.5">
          <AlertCircle className="h-3.5 w-3.5" />
          {/* Unknown, not safe. The same wording the census panel uses, for the
              same reason: a failed read must never read as an all-clear. */}
          Gate calibration couldn&apos;t load — promotion readiness unknown, not ready.
        </p>
      </section>
    );
  }

  const d = q.data;
  const after = d.afterFix;
  const pct = Math.min(100, Math.round((after.turns / d.minSample) * 100));

  return (
    <section
      aria-label="evidence-gate-calibration"
      className="rounded-xl border border-white/8 bg-white/[0.01] p-4 flex flex-col space-y-3"
    >
      <div className="flex items-center justify-between gap-2 flex-wrap border-b border-white/6 pb-2">
        <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-300 font-semibold flex items-center gap-1.5">
          <ShieldAlert className="h-3.5 w-3.5 text-[var(--gold)]/80" /> Evidence Gate · promotion readout
        </p>
        <span
          data-testid="gate-verdict"
          className={cn(
            "text-[9px] font-mono uppercase tracking-wider rounded border px-1.5 py-px",
            d.sufficient
              ? "border-emerald-400/25 text-emerald-300"
              : "border-amber-400/25 text-amber-300",
          )}
        >
          {d.sufficient ? "sample sufficient" : "do not promote"}
        </span>
      </div>

      {/* Sample growth toward the floor — the ONLY thing between here and a
          decision, so it is the headline rather than a footnote. */}
      <div className="space-y-1">
        <div className="flex items-baseline justify-between text-[9px] font-mono">
          <span className="text-zinc-400">post-fix sample</span>
          <span data-testid="sample-progress" className="text-zinc-300">
            {after.turns} / {d.minSample} turns
          </span>
        </div>
        <div className="h-1.5 rounded bg-white/5 overflow-hidden">
          <div
            className={cn("h-full rounded", d.sufficient ? "bg-emerald-400/60" : "bg-amber-400/50")}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="flex gap-2 flex-wrap sm:flex-nowrap">
        <Cohort
          title="before fix"
          subtitle={`< ${d.cohortSince.slice(0, 16).replace("T", " ")}`}
          cohort={d.beforeFix}
        />
        <Cohort
          title="after fix"
          subtitle={`>= ${d.cohortSince.slice(0, 16).replace("T", " ")}`}
          cohort={after}
        />
      </div>

      <p className="border-t border-white/6 pt-2 text-[9px] text-zinc-600 leading-snug">{d.caveat}</p>
    </section>
  );
}
