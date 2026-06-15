/**
 * WaveMetricWins — wave-181.x Today page Phase 4
 *
 * Surfaces the closed-loop framework's daily measurements as a
 * tile on the Today page. "Did the work we shipped move the needle?"
 *
 * The closed-loop cron writes a row to wave_metrics every time a
 * shipped wave hits its 14-day measurement window. This tile reads
 * the most recent N measurements and displays them with their delta
 * vs baseline.
 *
 * CLARITY-GATE DECISIONS (resolved before coding)
 *   · No measurements yet? → render NULL (don't show empty tile)
 *   · "Lift" threshold? → uses server-side status (lifted/no_lift/regression)
 *   · Sort? → most recent measuredAt first
 *   · Surface? → tile slot above the "More Detail" chevron (visible by default)
 *
 * DATA SOURCE
 *   · trpc.closedLoop.recent · returns last 8 measurements with deltas
 *   · trpc.closedLoop.summary · aggregate counts (lifted/no_lift/regression)
 *
 * COOL FEATURES STOLEN FROM SKILLS
 *   · closed-loop-delivery · the framework we shipped yesterday
 *   · kpi-dashboard-design · status-accented tile + delta arrows
 *   · clarity-gate · only render when there's real signal
 */
import { trpc } from "@/lib/trpc";
import { TrendingUp, TrendingDown, Minus, Target } from "lucide-react";

function formatDelta(deltaPct: number | null): string {
  if (deltaPct === null || deltaPct === undefined) return "—";
  const sign = deltaPct > 0 ? "+" : "";
  return `${sign}${deltaPct.toFixed(1)}%`;
}

function formatTime(d: Date | string | null): string {
  if (!d) return "";
  const t = new Date(d);
  const now = Date.now();
  const ageMs = now - t.getTime();
  const ageDay = Math.floor(ageMs / 86_400_000);
  if (ageDay === 0) return "today";
  if (ageDay === 1) return "yesterday";
  if (ageDay < 7) return `${ageDay}d ago`;
  return t.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function WaveMetricWins() {
  const { data: summary } = trpc.closedLoop.summary.useQuery(undefined, {
    staleTime: 5 * 60_000,
  });
  const { data: recent } = trpc.closedLoop.recent.useQuery({ limit: 8 }, {
    staleTime: 5 * 60_000,
  });

  // Clarity-gate · don't render the tile if there are no measurements yet
  if (!summary || summary.total === 0) return null;

  const measurements = recent?.measurements ?? [];
  if (measurements.length === 0) return null;

  return (
    <div className="stat-card !p-5 !border-emerald-500/20 transition-all">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <h3 className="text-xs font-semibold text-emerald-400 tracking-wide uppercase flex items-center gap-2">
          <Target className="w-3.5 h-3.5" />
          Wave-metric wins
          <span className="ml-1 text-[10px] text-foreground/40 normal-case tracking-normal">
            did the work move the needle?
          </span>
        </h3>
        <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-[0.12em]">
          {summary.lifted > 0 && (
            <span className="bg-emerald-500/15 text-emerald-400 px-2 py-0.5 rounded-full">
              {summary.lifted} lifted
            </span>
          )}
          {summary.noLift > 0 && (
            <span className="bg-foreground/10 text-foreground/60 px-2 py-0.5 rounded-full">
              {summary.noLift} no-lift
            </span>
          )}
          {summary.regression > 0 && (
            <span className="bg-red-500/15 text-red-400 px-2 py-0.5 rounded-full">
              {summary.regression} regression
            </span>
          )}
          {summary.pending > 0 && (
            <span className="bg-amber-500/10 text-amber-400/70 px-2 py-0.5 rounded-full">
              {summary.pending} pending
            </span>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        {measurements.slice(0, 5).map((m: typeof measurements[number]) => {
          const tone =
            m.status === "lifted"
              ? "border-emerald-500/30 bg-emerald-500/[0.04]"
              : m.status === "regression"
                ? "border-red-500/30 bg-red-500/[0.04]"
                : m.status === "resolver_error"
                  ? "border-amber-500/30 bg-amber-500/[0.04]"
                  : "border-border/20";
          const deltaTone =
            m.status === "lifted"
              ? "text-emerald-400"
              : m.status === "regression"
                ? "text-red-400"
                : "text-foreground/50";
          const TrendIcon =
            m.status === "lifted" ? TrendingUp : m.status === "regression" ? TrendingDown : Minus;
          return (
            <div
              key={m.id}
              className={`flex items-center gap-3 px-3 py-2 border ${tone} rounded`}
            >
              <TrendIcon className={`w-3.5 h-3.5 shrink-0 ${deltaTone}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[12px] text-foreground truncate">{m.waveId}</span>
                  <span className="text-[10px] text-foreground/45 truncate">{m.metricKey}</span>
                </div>
                {m.notes && (
                  <p className="text-[10px] text-foreground/40 truncate">{m.notes}</p>
                )}
              </div>
              <div className="text-right shrink-0">
                <div className={`font-bold text-[13px] tabular-nums ${deltaTone}`}>
                  {formatDelta(m.deltaPercent)}
                </div>
                <div className="text-[9px] text-foreground/35 tracking-wider uppercase">
                  {formatTime(m.measuredAt)}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {measurements.length > 5 && (
        <p className="text-[11px] text-foreground/40 text-center mt-2">
          + {measurements.length - 5} older measurements
        </p>
      )}
    </div>
  );
}
