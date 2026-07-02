"use client";

/**
 * CronFoldTree · v8.9 BATCH 53 · Apr 29.
 *
 * Visualizes the cron-folding hierarchy on /system/crons. Renders:
 *   · Active standalone crons (each its own Vercel slot)
 *   · Folded crons grouped by foldedInto target (e.g. mega-morning,
 *     mega-evening, weekly-review)
 *   · Retired crons (collapsed by default)
 *
 * Why a tree: after v8.7.1/v8.7.2, ~17 crons fold into the mega
 * router. Without a visualization, "which thing actually runs and
 * when" is opaque. The tree makes the lineage explicit.
 *
 * Data source: /api/system/crons (already exposes mode + foldedInto
 * per row).
 */

import { useState } from "react";
import { GlassCard } from "@/components/ui/glass-card";
import { ChevronDown, ChevronRight } from "lucide-react";
import { AnimatedCounter } from "@/components/ui/animated-counter";

import { trpc } from "@/lib/trpc/client";
interface CronRow {
  name: string;
  schedule: string | null;
  mode: "active" | "folded" | "retired" | "dormant";
  category: string;
  description: string;
  foldedInto?: string;
  retireAfter?: string;
  enabled?: boolean;
  successRate?: number;
  drift?: number | null;
  lastRunAt?: string | null;
}

interface ApiResponse {
  rows: CronRow[];
  summary: {
    active: number;
    folded: number;
    retired: number;
    runs24h: number;
    failures24h: number;
    drifted: number;
  };
  generatedAt: string;
}

const ACTIVE_TINT: Record<string, string> = {
  compose: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  ingest: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  brain: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  hygiene: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
  signals: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  review: "bg-pink-500/15 text-pink-300 border-pink-500/30",
  device: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  alert: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

export function CronFoldTree() {
  const [showRetired, setShowRetired] = useState(false);

  // Phase VV (2026-05-22) · REST→tRPC · system.cronTree. The legacy
  // route returned `{ rows, summary, generatedAt }` directly (no
  // `{data}` wrap); the procedure returns the same shape. One-shot
  // fetch on mount — no interval, matching the prior behaviour.
  const treeQuery = trpc.systemAutomation.cronTree.useQuery();
  const data: ApiResponse | null = treeQuery.data ?? null;
  const error = treeQuery.error
    ? treeQuery.error.message || "load failed"
    : null;

  if (error) {
    return (
      <GlassCard>
        <p className="text-[11px] text-rose-400">cron tree unavailable: {error}</p>
      </GlassCard>
    );
  }
  if (!data) {
    return (
      <GlassCard>
        <p className="text-[11px] text-[var(--text-tertiary)]">loading cron lineage…</p>
      </GlassCard>
    );
  }

  const active = data.rows
    .filter((r) => r.mode === "active" && r.schedule)
    .sort((a, b) => a.category.localeCompare(b.category));
  const folded = data.rows.filter((r) => r.mode === "folded");
  const retired = data.rows.filter((r) => r.mode === "retired");

  // Group folded crons by their target.
  const byTarget = new Map<string, CronRow[]>();
  for (const c of folded) {
    const t = c.foldedInto ?? "(unknown)";
    if (!byTarget.has(t)) byTarget.set(t, []);
    byTarget.get(t)!.push(c);
  }

  const headroom = 40 - active.length;
  const headroomColor =
    headroom <= 1 ? "text-rose-300" : headroom <= 4 ? "text-amber-300" : "text-emerald-300";

  return (
    <GlassCard>
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
        <span className="section-label">Cron lineage</span>
        <span
          className={
            "text-[10px] font-mono uppercase tracking-wider leading-tight " + headroomColor
          }
        >
          <AnimatedCounter value={active.length} /> active ·{" "}
          <AnimatedCounter value={folded.length} /> folded ·{" "}
          <AnimatedCounter value={retired.length} /> retired ·{" "}
          <AnimatedCounter value={headroom} /> slot(s) headroom
        </span>
      </div>

      {/* Active standalone */}
      <section className="mb-4">
        <h4 className="mb-1.5 text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">
          standalone schedules ({active.length})
        </h4>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {active.map((c) => (
            <div
              key={c.name}
              className={
                "flex items-center justify-between gap-2 rounded border px-2 py-1 " +
                (ACTIVE_TINT[c.category] ?? ACTIVE_TINT.hygiene)
              }
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] font-mono">{c.name}</div>
                <div className="text-[9px] opacity-70">{c.schedule}</div>
              </div>
              {c.drift !== null && c.drift !== undefined && c.drift > 0 && (
                <span className="text-[9px] text-rose-300 font-bold">drift +{c.drift}m</span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Folded — grouped by fold target */}
      {byTarget.size > 0 && (
        <section className="mb-4">
          <h4 className="mb-1.5 text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">
            folded ({folded.length})
          </h4>
          <div className="space-y-2">
            {[...byTarget.entries()].map(([target, list]) => (
              <div
                key={target}
                className="rounded border border-[var(--border-default)] bg-[var(--bg-elevated)]/30 p-2"
              >
                <div className="mb-1 flex items-center gap-1.5">
                  <ChevronRight size={11} className="text-[var(--text-tertiary)]" />
                  <span className="text-[10px] font-mono font-bold text-[var(--gold)]">
                    →
                  </span>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-secondary)]">
                    {target}
                  </span>
                  <span className="text-[10px] text-[var(--text-tertiary)]">
                    ({list.length})
                  </span>
                </div>
                <div className="ml-3 grid grid-cols-1 gap-0.5 sm:grid-cols-2">
                  {list.map((c) => (
                    <div
                      key={c.name}
                      className="flex flex-wrap items-center gap-x-1.5 gap-y-0 text-[10px] text-[var(--text-secondary)]"
                      title={c.description}
                    >
                      <span className="font-mono break-all">{c.name}</span>
                      <span className="text-[9px] opacity-50">·</span>
                      <span className="text-[9px] opacity-60">{c.category}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Retired — collapsed by default */}
      {retired.length > 0 && (
        <section>
          <button
            type="button"
            onClick={() => setShowRetired((v) => !v)}
            className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
          >
            {showRetired ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            retired ({retired.length})
          </button>
          {showRetired && (
            <div className="mt-1.5 grid grid-cols-1 gap-0.5 sm:grid-cols-2">
              {retired.map((c) => (
                <div
                  key={c.name}
                  className="flex flex-wrap items-center gap-x-1.5 gap-y-0 text-[10px] text-[var(--text-tertiary)]"
                  title={c.description}
                >
                  <span className="font-mono opacity-60 line-through break-all">
                    {c.name}
                  </span>
                  {c.retireAfter && (
                    <span className="text-[9px] opacity-50">
                      delete {c.retireAfter}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </GlassCard>
  );
}
