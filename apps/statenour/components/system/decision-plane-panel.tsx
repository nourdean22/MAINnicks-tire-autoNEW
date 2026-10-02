import { Gauge, ShieldCheck } from "lucide-react";
import { trpc } from "@/lib/trpc/client";

function pct(value: number | null): string {
  return value === null ? "unmeasured" : `${(value * 100).toFixed(1)}%`;
}

function ms(value: number | null): string {
  return value === null ? "unmeasured" : `${Math.round(value)} ms`;
}

export function DecisionPlanePanel() {
  const report = trpc.system.decisionPlaneReport.useQuery(
    { windowDays: 30 },
    { staleTime: 60_000 },
  );
  const replay = trpc.system.decisionPlaneReplayReport.useQuery(
    { windowDays: 30 },
    { staleTime: 60_000 },
  );

  if (report.isLoading || replay.isLoading) {
    return (
      <section className="rounded-surface border border-edge-default bg-content p-4">
        <div className="h-20 animate-pulse rounded bg-surface-interactive" />
      </section>
    );
  }

  if (report.isError || replay.isError || !report.data || !replay.data) {
    return (
      <section className="rounded-surface border border-red-500/20 bg-red-500/[0.04] p-4 text-xs text-red-300">
        Decision Plane telemetry unavailable.
      </section>
    );
  }

  const data = report.data;
  const replayData = replay.data;

  return (
    <section
      aria-label="decision-plane-shadow"
      className="overflow-hidden rounded-surface border border-edge-default bg-content"
    >
      <header className="flex items-center justify-between gap-3 border-b border-edge-default px-4 py-3">
        <div>
          <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-secondary">
            <Gauge size={13} /> Decision Plane Shadow
          </p>
          <p className="mt-1 text-[11px] text-fg-tertiary">
            Candidate typed decisions only · incumbent remains authoritative
          </p>
        </div>
        <span className="flex items-center gap-1 text-[11px] text-fg-tertiary">
          <ShieldCheck size={12} />
          promotion blocked
        </span>
      </header>

      <div className="grid grid-cols-2 gap-px bg-[var(--border-default)] md:grid-cols-6">
        {[
          ["Evaluated", data.evaluated],
          ["Failed", data.failed],
          ["Configured", data.backends.filter((backend) => backend.configured).length],
          ["Labeled", replayData.labeledEpisodes],
          ["Scored", replayData.scoredAnswers],
          ["Authority", "shadow only"],
        ].map(([label, value]) => (
          <div key={String(label)} className="bg-content px-4 py-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
              {label}
            </p>
            <p className="mt-1 font-mono text-sm text-fg">{value}</p>
          </div>
        ))}
      </div>

      <div className="space-y-4 p-4">
        <div className="grid gap-2 md:grid-cols-3">
          {data.backends.map((backend) => (
            <div
              key={backend.id}
              className="rounded border border-edge-default px-3 py-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] text-fg">{backend.id}</span>
                <span
                  className={
                    backend.configured
                      ? "text-[11px] text-emerald-300"
                      : backend.requested
                        ? "text-[11px] text-amber-300"
                        : "text-[11px] text-fg-tertiary"
                  }
                >
                  {backend.configured ? backend.trust : backend.requested ? "blocked" : "off"}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-fg-tertiary">
                {backend.reason}
              </p>
            </div>
          ))}
        </div>

        {data.rollups.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <thead className="text-[12px] font-medium text-fg-secondary">
                <tr>
                  <th className="pb-2 font-normal">Backend</th>
                  <th className="pb-2 font-normal text-right">n</th>
                  <th className="pb-2 font-normal text-right">Latency</th>
                  <th className="pb-2 font-normal text-right">Incumbent agreement</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-[var(--border-default)]/50 font-mono">
                {data.rollups.map((row) => (
                  <tr key={row.backend}>
                    <td className="py-2 text-fg">{row.backend}</td>
                    <td className="py-2 text-right text-fg-secondary">
                      {row.evaluated}
                    </td>
                    <td className="py-2 text-right text-fg-secondary">
                      {ms(row.avgLatencyMs)}
                    </td>
                    <td className="py-2 text-right text-fg-secondary">
                      {pct(row.avgIncumbentAgreement)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {replayData.rollups.length > 0 && (
          <div className="overflow-x-auto border-t border-edge-default pt-3">
            <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
              Replay Lab · explicit observed labels only
            </p>
            <table className="w-full text-left text-[11px]">
              <thead className="text-[12px] font-medium text-fg-secondary">
                <tr>
                  <th className="pb-2 font-normal">Backend</th>
                  <th className="pb-2 font-normal text-right">Coverage</th>
                  <th className="pb-2 font-normal text-right">Scored</th>
                  <th className="pb-2 font-normal text-right">Brier ↓</th>
                  <th className="pb-2 font-normal text-right">Log loss ↓</th>
                  <th className="pb-2 font-normal text-right">ECE ↓</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-default)]/50 font-mono">
                {replayData.rollups.map((row) => (
                  <tr key={row.backend}>
                    <td className="py-2 text-fg">{row.backend}</td>
                    <td className="py-2 text-right text-fg-secondary">
                      {pct(row.labelCoverageRate)}
                    </td>
                    <td className="py-2 text-right text-fg-secondary">
                      {row.scoredAnswers}
                    </td>
                    <td className="py-2 text-right text-fg-secondary">
                      {row.meanBrier === null ? "unmeasured" : row.meanBrier.toFixed(3)}
                    </td>
                    <td className="py-2 text-right text-fg-secondary">
                      {row.meanLogLoss === null ? "unmeasured" : row.meanLogLoss.toFixed(3)}
                    </td>
                    <td className="py-2 text-right text-fg-secondary">
                      {row.categoricalEce === null ? "unmeasured" : row.categoricalEce.toFixed(3)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="space-y-1 border-t border-edge-default pt-3 text-[11px] leading-relaxed text-fg-tertiary">
          <p>{data.caveat}</p>
          <p>{replayData.caveat}</p>
        </div>
      </div>
    </section>
  );
}
