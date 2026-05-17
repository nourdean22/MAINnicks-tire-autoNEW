"use client";

/**
 * /system/features · v10.0.108 · 2026-05-02.
 *
 * Surfaces the feature-status registry (lib/system/feature-status.ts)
 * that has been LIVE on /api/system/feature-status since v10.0.93
 * but never had a UI consumer. The honest map of what's actually
 * working vs scaffolded vs dormant.
 *
 * Why this matters: gives Nour (or any operator) a one-click view
 * of "what's still dormant and what would activate it" — making
 * the activation triggers actionable instead of just documented.
 */

import { useAuthedFetch } from "@/hooks/use-authed-fetch";
import { GlassCard } from "@/components/ui/glass-card";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  Circle,
  AlertTriangle,
  Loader2,
  Activity,
} from "lucide-react";

type FeatureStatus = "LIVE" | "DORMANT" | "PARTIAL";

interface FeatureMeta {
  name: string;
  endpoint?: string;
  status: FeatureStatus;
  activationTrigger?: string;
  notes?: string;
}

interface Summary {
  total: number;
  live: number;
  dormant: number;
  partial: number;
  livePct: number;
  activationsNeeded: Array<{ name: string; trigger?: string }>;
}

interface FeatureStatusPayload {
  generatedAt: string;
  summary: Summary;
  features: FeatureMeta[];
}

const STATUS_TONE: Record<FeatureStatus, string> = {
  LIVE: "border-emerald-500/30 bg-emerald-500/[0.04] text-emerald-300",
  PARTIAL: "border-amber-500/30 bg-amber-500/[0.04] text-amber-300",
  DORMANT: "border-rose-500/30 bg-rose-500/[0.04] text-rose-300",
};

export default function FeaturesPage() {
  const { data, loading, error, reload } = useAuthedFetch<FeatureStatusPayload>(
    "/api/system/feature-status",
    { retryOn401: true },
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-[var(--font-display)] font-bold uppercase tracking-wider text-[var(--text-primary)]">
          Feature status
        </h1>
        <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
          honest map · live · partial · dormant · activation triggers
        </p>
      </div>

      {loading && !data && (
        <GlassCard>
          <div className="flex items-center gap-2 text-[11px] text-[var(--text-tertiary)] py-4 justify-center">
            <Loader2 size={12} className="animate-spin" />
            reading registry…
          </div>
        </GlassCard>
      )}

      {error && (
        <GlassCard className="border-rose-500/30 bg-rose-500/5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-bold text-rose-300">
                feature-status fetch failed
              </p>
              <p className="text-[10px] text-rose-300/70 mt-0.5 break-words font-mono">
                {error}
              </p>
            </div>
            <button
              onClick={reload}
              className="shrink-0 text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded border border-rose-400/40 text-rose-300 hover:bg-rose-400/10"
            >
              retry
            </button>
          </div>
        </GlassCard>
      )}

      {data && (
        <>
          {/* ── Summary ── */}
          <GlassCard>
            <div className="flex items-center gap-2 mb-3">
              <Activity size={13} className="text-[var(--gold)]" />
              <span className="section-label">Summary · {data.summary.livePct}% live</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Counter label="total" value={data.summary.total} tone="tertiary" />
              <Counter label="live" value={data.summary.live} tone="emerald" />
              <Counter label="partial" value={data.summary.partial} tone="amber" />
              <Counter label="dormant" value={data.summary.dormant} tone="rose" />
            </div>
            <div className="mt-3 pt-3 border-t border-[var(--border-default)]/50">
              <LivenessBar
                live={data.summary.live}
                partial={data.summary.partial}
                dormant={data.summary.dormant}
              />
            </div>
          </GlassCard>

          {/* ── Activation queue (DORMANT + PARTIAL) ── */}
          {data.summary.activationsNeeded.length > 0 && (
            <GlassCard>
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle size={13} className="text-amber-400" />
                <span className="section-label">
                  Activation queue · {data.summary.activationsNeeded.length}
                </span>
              </div>
              <div className="space-y-1.5">
                {data.summary.activationsNeeded.map((a) => (
                  <div
                    key={a.name}
                    className="px-2 py-1.5 rounded border border-amber-500/25 bg-amber-500/[0.03]"
                  >
                    <p className="text-[11px] font-medium text-[var(--text-secondary)] mb-0.5">
                      {a.name}
                    </p>
                    {a.trigger && (
                      <p className="text-[10px] text-amber-300/80 font-mono leading-relaxed">
                        → {a.trigger}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </GlassCard>
          )}

          {/* ── Per-feature list ── */}
          <GlassCard>
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 size={13} className="text-[var(--gold)]" />
              <span className="section-label">All features · {data.features.length}</span>
            </div>
            <div className="space-y-1.5">
              {data.features.map((f) => (
                <FeatureRow key={f.name} f={f} />
              ))}
            </div>
          </GlassCard>

          <p className="text-[9px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] text-center">
            generated · {new Date(data.generatedAt).toLocaleTimeString()}
          </p>
        </>
      )}
    </div>
  );
}

function Counter({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "emerald" | "amber" | "rose" | "tertiary";
}) {
  const colorMap = {
    emerald: "text-emerald-300",
    amber: "text-amber-300",
    rose: "text-rose-300",
    tertiary: "text-[var(--text-secondary)]",
  };
  return (
    <div className="rounded-lg bg-[var(--bg-base)]/40 border border-[var(--border-default)] px-2 py-2 text-center">
      <div className={cn("text-lg font-bold tabular-nums", colorMap[tone])}>
        <AnimatedCounter value={value} />
      </div>
      <p className="text-[9px] font-mono uppercase tracking-[0.16em] text-[var(--text-tertiary)] mt-0.5">
        {label}
      </p>
    </div>
  );
}

function LivenessBar({
  live,
  partial,
  dormant,
}: {
  live: number;
  partial: number;
  dormant: number;
}) {
  const total = live + partial + dormant;
  if (total === 0) return null;
  const pl = (live / total) * 100;
  const pp = (partial / total) * 100;
  const pd = (dormant / total) * 100;
  return (
    <div>
      <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider mb-1">
        <span className="text-[var(--text-tertiary)]">liveness</span>
        <span className="text-[var(--text-secondary)] tabular-nums">
          {live}L · {partial}P · {dormant}D
        </span>
      </div>
      <div className="h-2 rounded-full bg-[var(--bg-void)] overflow-hidden flex">
        <div className="h-full bg-emerald-400" style={{ width: `${pl}%` }} />
        <div className="h-full bg-amber-400" style={{ width: `${pp}%` }} />
        <div className="h-full bg-rose-400" style={{ width: `${pd}%` }} />
      </div>
    </div>
  );
}

function FeatureRow({ f }: { f: FeatureMeta }) {
  return (
    <div className="px-2 py-2 rounded border border-[var(--border-default)] bg-[var(--bg-base)]/40">
      <div className="flex items-center gap-2 mb-1">
        <span
          className={cn(
            "text-[9px] font-mono uppercase tracking-[0.14em] px-1.5 py-0.5 rounded border",
            STATUS_TONE[f.status],
          )}
        >
          {f.status === "LIVE" ? <CheckCircle2 size={9} className="inline mr-0.5 -mt-0.5" /> : <Circle size={9} className="inline mr-0.5 -mt-0.5" />}
          {f.status}
        </span>
        <span className="text-[11px] font-medium text-[var(--text-secondary)] flex-1 min-w-0 truncate">
          {f.name}
        </span>
      </div>
      {f.endpoint && (
        <p className="text-[10px] font-mono text-[var(--gold)]/70 mb-1 truncate">
          {f.endpoint}
        </p>
      )}
      {f.activationTrigger && (
        <p className="text-[10px] font-mono text-amber-300/80 mb-1 leading-relaxed">
          → {f.activationTrigger}
        </p>
      )}
      {f.notes && (
        <p className="text-[10px] text-[var(--text-tertiary)] leading-snug line-clamp-2">
          {f.notes}
        </p>
      )}
    </div>
  );
}
