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

  if (report.isLoading) {
    return (
      <section className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)] p-4">
        <div className="h-20 animate-pulse rounded bg-white/[0.03]" />
      </section>
    );
  }

  if (report.isError || !report.data) {
    return (
      <section className="rounded-lg border border-red-500/20 bg-red-500/[0.04] p-4 text-xs text-red-300">
        Decision Plane telemetry unavailable.
      </section>
    );
  }

  const data = report.data;

  return (
    <section
      aria-label="decision-plane-shadow"
      className="overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)]"
    >
      <header className="flex items-center justify-between gap-3 border-b border-[var(--border-default)] px-4 py-3">
        <div>
          <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--gold)]">
            <Gauge size={13} /> Decision Plane Shadow
          </p>
          <p className="mt-1 text-[10px] text-[var(--text-tertiary)]">
            Candidate typed decisions only · incumbent remains authoritative
          </p>
        </div>
        <span className="flex items-center gap-1 text-[9px] text-[var(--text-tertiary)]">
          <ShieldCheck size={12} />
          promotion blocked
        </span>
      </header>

      <div className="grid grid-cols-2 gap-px bg-[var(--border-default)] md:grid-cols-4">
        {[
          ["Evaluated", data.evaluated],
          ["Failed", data.failed],
          ["Configured", data.backends.filter((backend) => backend.configured).length],
          ["Authority", "shadow only"],
        ].map(([label, value]) => (
          <div key={String(label)} className="bg-[var(--bg-raised)] px-4 py-3">
            <p className="text-[9px] uppercase tracking-wider text-[var(--text-tertiary)]">
              {label}
            </p>
            <p className="mt-1 font-mono text-sm text-white">{value}</p>
          </div>
        ))}
      </div>

      <div className="space-y-4 p-4">
        <div className="grid gap-2 md:grid-cols-3">
          {data.backends.map((backend) => (
            <div
              key={backend.id}
              className="rounded border border-[var(--border-default)] px-3 py-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] text-white">{backend.id}</span>
                <span
                  className={
                    backend.configured
                      ? "text-[9px] text-emerald-300"
                      : backend.requested
                        ? "text-[9px] text-amber-300"
                        : "text-[9px] text-[var(--text-tertiary)]"
                  }
                >
                  {backend.configured ? backend.trust : backend.requested ? "blocked" : "off"}
                </span>
              </div>
              <p className="mt-1 text-[9px] leading-relaxed text-[var(--text-tertiary)]">
                {backend.reason}
              </p>
            </div>
          ))}
        </div>

        {data.rollups.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[10px]">
              <thead className="text-[8px] uppercase tracking-wider text-[var(--text-tertiary)]">
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
                    <td className="py-2 text-white">{row.backend}</td>
                    <td className="py-2 text-right text-[var(--text-secondary)]">
                      {row.evaluated}
                    </td>
                    <td className="py-2 text-right text-[var(--text-secondary)]">
                      {ms(row.avgLatencyMs)}
                    </td>
                    <td className="py-2 text-right text-[var(--text-secondary)]">
                      {pct(row.avgIncumbentAgreement)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="border-t border-[var(--border-default)] pt-3 text-[9px] leading-relaxed text-[var(--text-tertiary)]">
          {data.caveat}
        </p>
      </div>
    </section>
  );
}
