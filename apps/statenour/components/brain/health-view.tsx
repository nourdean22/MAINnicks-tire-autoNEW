"use client";

/**
 * BrainHealthView · v10.0.330 · per-category memory health rollup.
 *
 * Extracted from /brain/health for cluster-merge with categories +
 * continuity views into a unified /brain/health page with tab toggle.
 *
 * What this view shows:
 *   · Top-line totals · live · permanent · decayed · vectorized %
 *   · Health flags · categories with no_vectors / all_decayed /
 *     dormant_30d (sorted by severity)
 *   · Per-category table · count · perm · decayed · vectorization % ·
 *     avg conf · age (newest)
 *
 * Visual surface for the LIVE /api/brain/memory-health endpoint.
 */

import { useCallback } from "react";
import { trpc } from "@/lib/trpc/client";
import { GlassCard } from "@/components/ui/glass-card";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { cn } from "@/lib/utils";
import {
  attentionTone,
  describeConfidenceAsAttention,
  sightingsFromConfidence,
} from "@/lib/brain/attention-label";
import {
  Activity,
  AlertCircle,
  Loader2,
  ShieldCheck,
  Database,
} from "lucide-react";

interface CategoryHealth {
  category: string;
  count: number;
  permanent: number;
  decayed: number;
  vectorized: number;
  vectorizedPct: number;
  avgConfidence: number;
  newest: string | null;
  oldest: string | null;
  ageNewestHours: number | null;
}

interface MemoryHealthPayload {
  generatedAt: string;
  totals: {
    live: number;
    permanent: number;
    decayed: number;
    vectorized: number;
    vectorizedPct: number;
    categoryCount: number;
  };
  categories: CategoryHealth[];
  flags: Array<{ category: string; flag: string }>;
}

const FLAG_TONE: Record<string, { tone: string; label: string }> = {
  no_vectors: { tone: "rose", label: "no vectors" },
  all_decayed: { tone: "amber", label: "all decayed" },
  dormant_30d: { tone: "tertiary", label: "dormant 30d+" },
};

export function BrainHealthView() {
  // scattered-components REST→tRPC slice (2026-05-22) · migrated off
  // `useAuthedFetch<MemoryHealthPayload>("/api/brain/memory-health")`
  // onto `trpc.brain.memoryHealth.useQuery()`. The procedure delegates
  // to the same `buildMemoryHealth` service the REST route also calls.
  // `loading` ← `isLoading`, `error` ← the TRPCClientError's `.message`
  // (the legacy hook surfaced a plain string), `reload` ← `refetch`.
  const {
    data,
    isLoading: loading,
    error: queryError,
    refetch,
  } = trpc.brain.memoryHealth.useQuery();
  const error = queryError?.message ?? null;
  const reload = useCallback(() => {
    void refetch();
  }, [refetch]);

  return (
    <div className="space-y-4">
      {loading && !data && (
        <GlassCard>
          <div className="flex items-center gap-2 text-[11px] text-[var(--text-tertiary)] py-4 justify-center">
            <Loader2 size={12} className="animate-spin" />
            inspecting categories…
          </div>
        </GlassCard>
      )}

      {error && (
        <GlassCard className="border-rose-500/30 bg-rose-500/5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-bold text-rose-300">
                memory-health fetch failed
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
          {/* ── Totals ── */}
          <GlassCard>
            <div className="flex items-center gap-2 mb-3">
              <Activity size={13} className="text-[var(--gold)]" />
              <span className="section-label">Totals</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Counter label="live rows" value={data.totals.live} tone="gold" />
              <Counter label="permanent" value={data.totals.permanent} tone="emerald" />
              <Counter label="decayed" value={data.totals.decayed} tone="rose" />
              <Counter label="categories" value={data.totals.categoryCount} tone="violet" />
            </div>
            <div className="mt-3 pt-3 border-t border-[var(--border-default)]/50">
              <VectorizationBar
                pct={data.totals.vectorizedPct}
                vectorized={data.totals.vectorized}
                total={data.totals.live}
              />
            </div>
          </GlassCard>

          {/* ── Flags ── */}
          {data.flags.length > 0 ? (
            <GlassCard>
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle size={13} className="text-amber-400" />
                <span className="section-label">
                  Health flags · {data.flags.length}
                </span>
              </div>
              <div className="space-y-1">
                {data.flags.map((f, i) => {
                  const meta = FLAG_TONE[f.flag] ?? {
                    tone: "tertiary",
                    label: f.flag,
                  };
                  const toneClass = {
                    rose: "border-rose-500/40 bg-rose-500/[0.06] text-rose-300",
                    amber:
                      "border-amber-500/40 bg-amber-500/[0.06] text-amber-300",
                    tertiary:
                      "border-[var(--border-default)] text-[var(--text-tertiary)]",
                  }[meta.tone];
                  return (
                    <div
                      key={`${f.category}-${f.flag}-${i}`}
                      className={cn(
                        "flex items-center justify-between gap-2 px-2 py-1.5 rounded border",
                        toneClass,
                      )}
                    >
                      <span className="text-[11px] font-mono">
                        {f.category.replace(/_/g, " ")}
                      </span>
                      <span className="text-[9px] font-mono uppercase tracking-wider">
                        {meta.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </GlassCard>
          ) : (
            <GlassCard className="border-emerald-500/20 bg-emerald-500/[0.03]">
              <div className="flex items-center gap-2 py-1">
                <ShieldCheck size={13} className="text-emerald-400" />
                <span className="text-[11px] text-emerald-300">
                  all categories healthy · no flags raised
                </span>
              </div>
            </GlassCard>
          )}

          {/* ── Per-category table ── */}
          <GlassCard>
            <div className="flex items-center gap-2 mb-2">
              <Database size={13} className="text-[var(--gold)]" />
              <span className="section-label">
                Per category · {data.categories.length}
              </span>
            </div>
            <div className="space-y-1">
              {data.categories.map((c) => (
                <CategoryRow key={c.category} c={c} />
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
  tone: "gold" | "emerald" | "rose" | "violet";
}) {
  const colorMap = {
    gold: "text-[var(--gold)]",
    emerald: "text-emerald-300",
    rose: "text-rose-300",
    violet: "text-violet-300",
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

function VectorizationBar({
  pct,
  vectorized,
  total,
}: {
  pct: number;
  vectorized: number;
  total: number;
}) {
  const tone = pct >= 95 ? "emerald" : pct >= 80 ? "gold" : pct >= 50 ? "amber" : "rose";
  const barColor = {
    emerald: "bg-emerald-400",
    gold: "bg-[var(--gold)]",
    amber: "bg-amber-400",
    rose: "bg-rose-400",
  }[tone];
  return (
    <div>
      <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider mb-1">
        <span className="text-[var(--text-tertiary)]">vectorization</span>
        <span className="text-[var(--text-secondary)] tabular-nums">
          {vectorized}/{total} · {pct.toFixed(1)}%
        </span>
      </div>
      <div className="h-2 rounded-full bg-[var(--bg-void)] overflow-hidden">
        <div
          className={cn("h-full transition-all", barColor)}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
}

function CategoryRow({ c }: { c: CategoryHealth }) {
  // 2026-08-19 · was `Math.round(avgConfidence * 100) + "%"`, which read as
  // a probability. confidence is a re-sighting counter (0.5 + 0.1×(n−1)),
  // so the mean inverts exactly to a mean sighting count — report that.
  const avgSightings = sightingsFromConfidence(c.avgConfidence);
  const attention = describeConfidenceAsAttention(c.avgConfidence);
  const tone = attentionTone(avgSightings);
  const confColor =
    tone === "hot"
      ? "text-emerald-300"
      : tone === "warm"
        ? "text-[var(--gold)]"
        : "text-[var(--text-tertiary)]";

  const stale = c.ageNewestHours !== null && c.ageNewestHours > 24 * 7;
  const dormant = c.ageNewestHours !== null && c.ageNewestHours > 24 * 30;
  const noVecs = c.vectorized === 0 && c.count > 5;

  const ageLabel =
    c.ageNewestHours === null
      ? "—"
      : c.ageNewestHours < 1
        ? `${Math.round(c.ageNewestHours * 60)}m`
        : c.ageNewestHours < 24
          ? `${Math.round(c.ageNewestHours)}h`
          : `${Math.round(c.ageNewestHours / 24)}d`;

  return (
    <div
      className={cn(
        "px-2 py-1.5 rounded border bg-[var(--bg-base)]/40 transition-colors",
        dormant
          ? "border-[var(--text-tertiary)]/30 opacity-60"
          : noVecs
            ? "border-rose-500/30"
            : "border-[var(--border-default)]",
      )}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[11px] font-mono text-[var(--text-secondary)] flex-1 min-w-0 truncate">
          {c.category.replace(/_/g, " ")}
        </span>
        <span className="text-[9px] font-mono tabular-nums text-[var(--gold)]">
          {c.count}
        </span>
      </div>
      <div className="flex items-center gap-2 flex-wrap text-[9px] font-mono">
        <span className="text-[var(--text-tertiary)]">
          perm{" "}
          <span className="text-[var(--text-secondary)] tabular-nums">
            {c.permanent}
          </span>
        </span>
        {c.decayed > 0 && (
          <span className="text-rose-300/80">
            decayed{" "}
            <span className="tabular-nums">{c.decayed}</span>
          </span>
        )}
        <span className="text-[var(--text-tertiary)]">
          vec{" "}
          <span
            className={cn(
              "tabular-nums",
              c.vectorizedPct >= 95
                ? "text-emerald-300"
                : c.vectorizedPct >= 80
                  ? "text-[var(--gold)]"
                  : "text-rose-300",
            )}
          >
            {c.vectorizedPct.toFixed(0)}%
          </span>
        </span>
        <span className="text-[var(--text-tertiary)]">
          <span className={cn("tabular-nums", confColor)}>{attention}</span>{" "}
          avg
        </span>
        <span
          className={cn(
            "ml-auto tabular-nums",
            dormant
              ? "text-[var(--text-tertiary)]/60"
              : stale
                ? "text-amber-400/80"
                : "text-[var(--text-tertiary)]",
          )}
        >
          age {ageLabel}
        </span>
      </div>
    </div>
  );
}
