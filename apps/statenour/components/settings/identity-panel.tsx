"use client";

/**
 * IdentityPanel — 8-axis self-model surface.
 *
 * Each axis is a horizontal bar 0-100 with the current value. Nour
 * can pin an override by clicking the pin icon, typing a value, and
 * saving. Pinned values win over computed values everywhere Nick
 * reads the snapshot. Hover shows the evidence strings that led to
 * the score.
 */

import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";
import { GlassCard } from "@/components/ui/glass-card";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { Loader2, Pin, PinOff, RefreshCw, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";

interface Axis {
  value: number;
  manual: number | null;
  direction: "rising" | "falling" | "stable";
  evidence: string[];
  updated_at: string;
}

type AxisKey =
  | "velocity"
  | "patience_horizon"
  | "promise_integrity"
  | "dopamine_discipline"
  | "business_vs_personal"
  | "risk_appetite"
  | "social_battery"
  | "reflection_cadence";

interface Snapshot {
  axes: Record<AxisKey, Axis>;
  computed_at: string;
  data_horizon_days: number;
}

interface HistoryPoint {
  date: string;
  axes: Partial<Record<AxisKey, number>>;
}

// ── Sparkline helper — flat SVG line ──────────────────────────────────
function Sparkline({ values, color = "var(--gold)" }: { values: number[]; color?: string }) {
  if (values.length < 2) return null;
  const w = 60;
  const h = 14;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = w / (values.length - 1);
  const points = values
    .map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / range) * (h - 2) - 1).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} className="shrink-0" aria-hidden>
      <polyline points={points} fill="none" stroke={color} strokeWidth={1} strokeLinecap="round" />
    </svg>
  );
}

const AXIS_LABELS: Record<AxisKey, string> = {
  velocity: "Velocity",
  patience_horizon: "Patience horizon",
  promise_integrity: "Promise integrity",
  dopamine_discipline: "Dopamine discipline",
  business_vs_personal: "Business / personal",
  risk_appetite: "Risk appetite",
  social_battery: "Social battery",
  reflection_cadence: "Reflection cadence",
};

const AXIS_TIPS: Record<AxisKey, string> = {
  velocity: "% of DONE tasks closed at-or-under your estimate (30d)",
  patience_horizon: "median days between commitment + deadline",
  promise_integrity: "kept / (kept + broken) commitments (60d)",
  dopamine_discipline: "capture cadence rhythm (sweet spot 4-12/day)",
  business_vs_personal: "% of DONE tasks that were business context (14d)",
  risk_appetite: "% of DONE tasks that were critical/high priority (21d)",
  social_battery: "distinct people mentioned in chat (14d)",
  reflection_cadence: "avg days between reflections (inverted)",
};

function directionGlyph(d: Axis["direction"]) {
  if (d === "rising") return <TrendingUp size={10} className="text-emerald-400" />;
  if (d === "falling") return <TrendingDown size={10} className="text-amber-400" />;
  return <Minus size={10} className="text-[var(--text-tertiary)]" />;
}

function barColor(value: number): string {
  if (value >= 75) return "bg-emerald-400";
  if (value >= 55) return "bg-[var(--gold)]";
  if (value >= 35) return "bg-amber-400";
  return "bg-red-400";
}

export function IdentityPanel() {
  const [pinning, setPinning] = useState<AxisKey | null>(null);
  const [pinValue, setPinValue] = useState("");
  const [busy, setBusy] = useState<AxisKey | null>(null);

  // Phase UU.2 (2026-05-22) · REST→tRPC · the snapshot + history are a
  // typed query (operator.identity). The legacy route wrapped the
  // payload in `{ data }`; the procedure returns { snapshot, history }
  // directly. recompute / pin are typed mutations that invalidate the
  // query — the prior code set `snap` straight from the mutation
  // response; invalidate-then-refetch reaches the same end state with
  // the server snapshot as the single source of truth.
  const utils = trpc.useUtils();
  const identityQuery = trpc.operator.identity.useQuery(
    { history: true },
    { refetchOnWindowFocus: false },
  );
  const snap: Snapshot | null = (identityQuery.data?.snapshot ??
    null) as Snapshot | null;
  const history: HistoryPoint[] | null = (identityQuery.data?.history ??
    null) as HistoryPoint[] | null;
  const loading = identityQuery.isPending;
  const loadedAt = identityQuery.dataUpdatedAt || null;
  const load = useCallback(
    () => void identityQuery.refetch(),
    [identityQuery],
  );

  const recomputeMutation = trpc.operator.recomputeIdentity.useMutation();
  const pinMutation = trpc.operator.pinIdentityAxis.useMutation();
  const refreshing = recomputeMutation.isPending;

  const recompute = useCallback(async () => {
    try {
      await recomputeMutation.mutateAsync();
      await utils.operator.identity.invalidate();
      toast.success("self-model refreshed");
    } catch (e) {
      toast.error(`recompute failed: ${e instanceof Error ? e.message : e}`);
    }
  }, [recomputeMutation, utils]);

  const savePin = useCallback(
    async (axis: AxisKey) => {
      const raw = pinValue.trim();
      const value = raw === "" ? null : Number(raw);
      if (value != null && (Number.isNaN(value) || value < 0 || value > 100)) {
        toast.error("value must be 0-100");
        return;
      }
      setBusy(axis);
      try {
        await pinMutation.mutateAsync({ axis, value });
        await utils.operator.identity.invalidate();
        toast.success(value == null ? "override cleared" : `pinned at ${value}`);
        setPinning(null);
        setPinValue("");
      } catch (e) {
        toast.error(`pin failed: ${e instanceof Error ? e.message : e}`);
      } finally {
        setBusy(null);
      }
    },
    [pinValue, pinMutation, utils],
  );

  return (
    <GlassCard>
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="section-label">Identity Snapshot</p>
            <FreshnessChip lastFetchedAt={loadedAt} source="brain" compact onReload={() => void load()} />
          </div>
          <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
            8-axis self-model · rolls daily 04:30 · pin any axis to override
          </p>
        </div>
        <button
          onClick={() => void recompute()}
          disabled={refreshing}
          className={cn(
            "text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded border transition-colors inline-flex items-center gap-1",
            refreshing
              ? "opacity-60 border-[var(--border-default)] text-[var(--text-tertiary)]"
              : "border-[var(--gold)]/30 text-[var(--gold)] hover:bg-[var(--gold)]/10",
          )}
        >
          {refreshing ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
          {refreshing ? "computing…" : "recompute"}
        </button>
      </div>

      {loading && !snap && (
        <div className="flex items-center gap-2 py-6 justify-center text-[11px] text-[var(--text-tertiary)]">
          <Loader2 size={12} className="animate-spin" />
          loading snapshot…
        </div>
      )}

      {snap && (
        <div className="space-y-2">
          {(Object.keys(AXIS_LABELS) as AxisKey[]).map((key) => {
            const a = snap.axes[key];
            if (!a) return null;
            const effective = a.manual ?? a.value;
            const isPinned = a.manual != null;
            const isEditing = pinning === key;
            const rowBusy = busy === key;
            return (
              <div key={key} className="px-2 py-2 rounded border border-[var(--border-default)] bg-[var(--bg-base)]">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="text-[11px] text-[var(--text-primary)] truncate">
                      {AXIS_LABELS[key]}
                    </span>
                    {directionGlyph(a.direction)}
                    {(() => {
                      const series = history
                        ?.map((p) => p.axes[key])
                        .filter((v): v is number => typeof v === "number");
                      if (!series || series.length < 2) return null;
                      return <Sparkline values={series} />;
                    })()}
                    {isPinned && (
                      <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--gold)]">
                        pinned
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      className="text-[11px] font-mono tabular-nums text-[var(--text-primary)]"
                      title={a.evidence.join(" · ")}
                    >
                      {effective}
                    </span>
                    {!isEditing && (
                      <button
                        onClick={() => {
                          setPinning(key);
                          setPinValue(a.manual != null ? String(a.manual) : "");
                        }}
                        disabled={rowBusy}
                        title={isPinned ? "edit / clear override" : "pin override"}
                        aria-label={isPinned ? `edit or clear ${AXIS_LABELS[key]} override` : `pin ${AXIS_LABELS[key]} override`}
                        className="h-9 w-9 sm:h-5 sm:w-5 rounded border border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-[var(--gold)] hover:border-[var(--gold)]/30 inline-flex items-center justify-center"
                      >
                        {isPinned ? <PinOff size={9} aria-hidden /> : <Pin size={9} aria-hidden />}
                      </button>
                    )}
                  </div>
                </div>

                {/* Bar */}
                <div className="relative mt-1.5 h-1.5 rounded-full bg-[var(--bg-overlay)] overflow-hidden">
                  <div
                    className={cn("absolute left-0 top-0 h-full transition-all", barColor(effective))}
                    style={{ width: `${effective}%` }}
                  />
                  {isPinned && (
                    <div
                      className="absolute top-0 h-full w-[1px] bg-white/40"
                      style={{ left: `${a.value}%` }}
                      title={`computed: ${a.value}`}
                    />
                  )}
                </div>

                <p className="text-[9px] font-mono text-[var(--text-tertiary)] mt-1">
                  {AXIS_TIPS[key]}
                </p>
                {a.evidence.length > 0 && (
                  <p className="text-[9px] text-[var(--text-tertiary)] mt-0.5">
                    · {a.evidence.join(" · ")}
                  </p>
                )}

                {isEditing && (
                  <div className="flex items-center gap-1.5 mt-2">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={pinValue}
                      onChange={(e) => setPinValue(e.target.value)}
                      placeholder="0-100 or blank to clear"
                      className="flex-1 px-2 py-1 bg-[var(--bg-overlay)] border border-[var(--border-default)] rounded text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--gold)]/30"
                    />
                    <button
                      onClick={() => void savePin(key)}
                      disabled={rowBusy}
                      className="h-6 px-2 text-[9px] font-mono uppercase tracking-wider rounded border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                    >
                      {rowBusy ? "…" : "save"}
                    </button>
                    <button
                      onClick={() => {
                        setPinning(null);
                        setPinValue("");
                      }}
                      disabled={rowBusy}
                      className="h-6 px-2 text-[9px] font-mono uppercase tracking-wider rounded border border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-red-400"
                    >
                      cancel
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {snap && (
        <p className="text-[9px] text-[var(--text-tertiary)] mt-3 leading-relaxed">
          Last computed {new Date(snap.computed_at).toLocaleString()}. Overrides persist; a thin
          marker on the bar shows the computed value underneath so you can see drift. Cron
          refresh-identity rolls daily at 04:30 and emits a brain_insight when any axis moves ≥15
          points.
        </p>
      )}
    </GlassCard>
  );
}
