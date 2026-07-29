/**
 * Closed-loop lift panel — the first admin consumer of closedLoop.*.
 *
 * Audit-#11 gate (2026-07-29): the lift math shipped long ago —
 * closedLoop.summary/recent compute A/B-tested 14-day booking-rate
 * lift with control groups and lifted/no_lift/regression classes —
 * but had ZERO client consumers; the only reader was a Telegram
 * digest. This panel answers the operator question the math was
 * built for: "is the automation winning, flat, or hurting?" with
 * one primary verdict and the receipts underneath.
 *
 * Honest states per house rules: loading skeleton, failure reads as
 * failure, measured-zero says the cron hasn't fired — never a
 * fabricated green.
 */
import { trpc } from "@/lib/trpc";
import { Activity, Loader2, TrendingDown, TrendingUp, Minus } from "lucide-react";

// Router's dynamic imports defeat tRPC inference for the row array —
// mirror the mapped select in closedLoop.recent explicitly.
interface LiftMeasurement {
  id: number;
  waveId: string;
  metricKey: string;
  baselineValue: number;
  measuredValue: number | null;
  deltaPercent: number | null;
  status: string;
  measuredAt: string | Date | null;
  notes: string | null;
}

function verdictOf(s: { lifted: number; noLift: number; regression: number; total: number }) {
  if (s.total === 0) return null;
  if (s.regression > 0 && s.regression >= s.lifted)
    return { label: "HURTING", cls: "text-red-500", Icon: TrendingDown, detail: "regressions match or beat lifts — review thresholds before more sends" };
  if (s.lifted > s.noLift + s.regression)
    return { label: "WINNING", cls: "text-emerald-500", Icon: TrendingUp, detail: "majority of measured waves show lift" };
  return { label: "FLAT / MIXED", cls: "text-amber-500", Icon: Minus, detail: "no clear lift majority — hold caps, keep measuring" };
}

export default function ClosedLoopLiftPanel() {
  const summaryQ = trpc.closedLoop.summary.useQuery(undefined, { staleTime: 120_000, retry: 1 });
  const recentQ = trpc.closedLoop.recent.useQuery({ limit: 6 }, { staleTime: 120_000, retry: 1 });

  if (summaryQ.isLoading || recentQ.isLoading) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading automation lift…
        </div>
      </div>
    );
  }
  if (summaryQ.isError || recentQ.isError) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4">
        <p className="text-sm text-red-500">Automation lift couldn&apos;t load — state unknown, not healthy.</p>
      </div>
    );
  }

  const s = summaryQ.data ?? { lifted: 0, noLift: 0, regression: 0, pending: 0, total: 0 };
  const measurements: LiftMeasurement[] = (recentQ.data?.measurements ?? []) as LiftMeasurement[];
  const verdict = verdictOf(s);
  const newest = measurements[0]?.measuredAt ? new Date(measurements[0].measuredAt) : null;

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" /> Automation Lift
        </h3>
        {newest && (
          <span className="text-[10px] text-muted-foreground tabular-nums">
            measured {newest.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </span>
        )}
      </div>

      {s.total === 0 ? (
        <p className="text-xs text-muted-foreground">
          No wave measurements yet — the daily closed-loop cron hasn&apos;t produced its first
          non-pending result. This is a measured zero, not a failure.
        </p>
      ) : (
        <>
          {verdict && (
            <div className="flex items-center gap-2">
              <verdict.Icon className={`w-5 h-5 ${verdict.cls}`} />
              <span className={`text-base font-bold ${verdict.cls}`}>{verdict.label}</span>
              <span className="text-[11px] text-muted-foreground">{verdict.detail}</span>
            </div>
          )}
          <div className="grid grid-cols-4 gap-2 text-center">
            <div className="rounded-lg bg-emerald-500/10 py-1.5">
              <div className="text-sm font-bold text-emerald-500 tabular-nums">{s.lifted}</div>
              <div className="text-[10px] text-muted-foreground">lifted</div>
            </div>
            <div className="rounded-lg bg-muted py-1.5">
              <div className="text-sm font-bold tabular-nums">{s.noLift}</div>
              <div className="text-[10px] text-muted-foreground">no lift</div>
            </div>
            <div className="rounded-lg bg-red-500/10 py-1.5">
              <div className="text-sm font-bold text-red-500 tabular-nums">{s.regression}</div>
              <div className="text-[10px] text-muted-foreground">regression</div>
            </div>
            <div className="rounded-lg bg-muted/50 py-1.5">
              <div className="text-sm font-bold text-muted-foreground tabular-nums">{s.pending}</div>
              <div className="text-[10px] text-muted-foreground">pending</div>
            </div>
          </div>

          {measurements.length > 0 && (
            <div className="space-y-1">
              {measurements.slice(0, 4).map((m) => (
                <div key={m.id} className="flex items-center justify-between text-[11px]">
                  <span className="truncate text-muted-foreground" title={m.metricKey}>
                    {m.waveId} · {m.metricKey}
                  </span>
                  <span
                    className={`tabular-nums font-medium ${
                      m.status === "lifted" ? "text-emerald-500" : m.status === "regression" ? "text-red-500" : "text-muted-foreground"
                    }`}
                  >
                    {m.deltaPercent != null ? `${m.deltaPercent > 0 ? "+" : ""}${m.deltaPercent.toFixed(1)}%` : "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
