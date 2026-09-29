import { AlertCircle, Route } from "lucide-react";
import { trpc } from "@/lib/trpc/client";

function rate(value: number | null): string {
  return value === null ? "unmeasured" : `${value.toFixed(1)}%`;
}

export function ToolGapPanel() {
  const report = trpc.system.toolGapReport.useQuery(
    { windowDays: 30 },
    { staleTime: 60_000 },
  );
  const lifecycle = trpc.system.capabilityLifecycleReport.useQuery(
    { windowDays: 30 },
    { staleTime: 60_000 },
  );

  if (report.isLoading) {
    return (
      <section className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)] p-4">
        <div className="h-16 animate-pulse rounded bg-white/[0.03]" />
      </section>
    );
  }

  if (report.isError || !report.data) {
    return (
      <section className="rounded-lg border border-red-500/20 bg-red-500/[0.04] p-4">
        <p className="flex items-center gap-2 text-xs text-red-300">
          <AlertCircle size={14} />
          Tool-gap telemetry unavailable — no gap conclusion is safe.
        </p>
      </section>
    );
  }
  const data = report.data;
  const lifecycleData = lifecycle.data;
  if (!data.available) {
    return (
      <section className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-4">
        <p className="flex items-center gap-2 text-xs text-amber-300">
          <AlertCircle size={14} />
          {data.caveat}
        </p>
      </section>
    );
  }

  return (
    <section
      aria-label="tool-gap-intelligence"
      className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)] overflow-hidden"
    >
      <header className="flex items-center justify-between gap-3 border-b border-[var(--border-default)] px-4 py-3">
        <div>
          <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--gold)]">
            <Route size={13} /> Tool Gap Intelligence
          </p>
          <p className="mt-1 text-[10px] text-[var(--text-tertiary)]">
            Existing recovery telemetry · 30-day window · no duplicate event store
          </p>
        </div>
        <span className="text-[9px] font-mono text-[var(--text-tertiary)]">
          {data.totalTurns} turns
        </span>
      </header>
      <div className="grid grid-cols-2 gap-px bg-[var(--border-default)] md:grid-cols-4">
        {[
          ["Recovery searches", data.recoverySearches],
          ["Existing tools recovered", data.recoveredExistingTools],
          ["Unresolved searches", data.unresolvedSearches],
          ["Semantic skipped", rate(data.semanticSkippedRatePct)],
        ].map(([label, value]) => (
          <div key={String(label)} className="bg-[var(--bg-raised)] px-4 py-3">
            <p className="text-[9px] uppercase tracking-wider text-[var(--text-tertiary)]">
              {label}
            </p>
            <p className="mt-1 font-mono text-lg text-white">{value}</p>
          </div>
        ))}
      </div>

      <div className="p-4">
        {data.topGaps.length === 0 ? (
          <p className="text-xs text-[var(--text-tertiary)]">
            No recovery-search gaps were recorded in this window.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[10px]">
              <thead className="text-[8px] uppercase tracking-wider text-[var(--text-tertiary)]">
                <tr>
                  <th className="pb-2 font-normal">Class</th>
                  <th className="pb-2 font-normal">Recovered capability</th>
                  <th className="pb-2 font-normal">Lifecycle response</th>
                  <th className="pb-2 font-normal text-right">Occurrences</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-default)]/50 font-mono">
                {data.topGaps.map((gap, index) => (
                  <tr key={`${gap.classification}:${gap.toolName ?? "unresolved"}`}>
                    <td className="py-2 pr-4 text-amber-300">{gap.classification}</td>
                    <td className="py-2 pr-4 text-[var(--text-secondary)]">
                      {gap.toolName ?? "unresolved — investigate capability need"}
                    </td>
                    <td className="py-2 pr-4 text-sky-300">
                      {lifecycleData?.gapRecommendations[index]?.recommendedAction ??
                        "unmeasured"}
                    </td>
                    <td className="py-2 text-right text-white">{gap.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {lifecycleData && (
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-[var(--border-default)] pt-3 md:grid-cols-4">
            {[
              ["Proposed", lifecycleData.counts.proposed],
              ["Approved", lifecycleData.counts.approved],
              ["Built · unverified", lifecycleData.counts.implementedUnverified],
              ["Verified", lifecycleData.counts.verified],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <p className="text-[8px] uppercase tracking-wider text-[var(--text-tertiary)]">{label}</p>
                <p className="mt-1 font-mono text-sm text-white">{value}</p>
              </div>
            ))}
          </div>
        )}
        <div className="mt-3 space-y-1 border-t border-[var(--border-default)] pt-3 text-[9px] leading-relaxed text-[var(--text-tertiary)]">
          <p>
            {data.caveat} Budget-truncated {rate(data.budgetTruncatedRatePct)} ·
            semantic cold cache {rate(data.coldCacheRatePct)}.
          </p>
          {lifecycleData && <p>{lifecycleData.caveat}</p>}
        </div>
      </div>
    </section>
  );
}
