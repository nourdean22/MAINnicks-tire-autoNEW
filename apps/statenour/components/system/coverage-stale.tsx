"use client";

/**
 * /system/stale — one-click stale-data cleanup.
 *
 * Shows the output of /api/system/stale-data (scanner) with a purge
 * button per category + a "purge all" button at the top. Every
 * category card displays its description, purge-action blurb, and up
 * to 5 example rows with their age.
 *
 * The purge endpoint tells us exactly what it did after the fact
 * (count + note) so we can surface a precise toast instead of the
 * generic "done."
 */

import { useState } from "react";
import { Panel } from "@/components/panel";
// PageHeader removed · parent /system/coverage page provides one
import { cn } from "@/lib/utils/cn";
import { toast } from "sonner";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { FreshnessChip } from "@/components/ui/freshness-chip";

import { trpc } from "@/lib/trpc/client";
interface StaleExample {
  id: string | number;
  label: string;
  ageDays: number;
}

interface StaleCategory {
  id: string;
  title: string;
  description: string;
  purgeAction: string;
  count: number;
  examples: StaleExample[];
}

interface StaleReport {
  generatedAt: string;
  totalStaleRows: number;
  categories: StaleCategory[];
}

export function CoverageStaleView() {
  const [purging, setPurging] = useState<string | null>(null); // category id or "all"

  // Phase VV (2026-05-22) · REST→tRPC · the scanner read is a typed
  // query (system.staleData), the two purge actions are one typed
  // mutation (system.purgeStaleData — category present = single, absent
  // = purge-all). Both legacy routes returned their payload directly
  // (no `{data}` wrap). After every purge the scanner query is
  // invalidated so the report re-runs, matching the prior `await load()`.
  const utils = trpc.useUtils();
  const staleQuery = trpc.system.staleData.useQuery();
  const report: StaleReport | null = staleQuery.data ?? null;
  const loading = staleQuery.isPending || staleQuery.isFetching;
  const load = () => void staleQuery.refetch();
  const purgeMutation = trpc.system.purgeStaleData.useMutation();

  async function purgeCategory(category: string, title: string) {
    if (
      !window.confirm(
        `Purge "${title}"?\n\nThis will modify DB rows — see the action blurb on the card for exactly what happens. The scanner will re-run afterward so you can verify.`,
      )
    ) {
      return;
    }
    setPurging(category);
    try {
      const res = await purgeMutation.mutateAsync({ category });
      const result = res.mode === "single" ? res.result : null;
      toast.success(result?.note ?? `Purged ${title}`);
      await utils.system.staleData.invalidate();
    } catch (e) {
      toast.error(
        `Purge failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setPurging(null);
    }
  }

  async function purgeAll() {
    if (!report || report.totalStaleRows === 0) return;
    if (
      !window.confirm(
        `Purge ALL stale data? ${report.totalStaleRows} rows across ${report.categories.filter((c) => c.count > 0).length} categories will be affected. Each category's action is listed on its card. This is reversible in the sense that nothing is destructively deleted beyond the DeviceEvents + orphan conversations — but the action-markers on drift/contradictions/actions are final.`,
      )
    ) {
      return;
    }
    setPurging("all");
    try {
      const res = await purgeMutation.mutateAsync({});
      if (res.mode === "all") {
        toast.success(
          `Purged ${res.totalPurged} rows across ${res.results.length} categories`,
        );
      }
      await utils.system.staleData.invalidate();
    } catch (e) {
      toast.error(
        `Purge all failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setPurging(null);
    }
  }

  const nonEmpty = report?.categories.filter((c) => c.count > 0) ?? [];
  const empty = report?.categories.filter((c) => c.count === 0) ?? [];

  return (
    <div className="space-y-4">
      {/* Mini-header replaces full PageHeader · parent /coverage
          renders canonical title. */}
      <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--text-secondary)]">
        <span>
          {report
            ? `${report.totalStaleRows} stale rows across ${nonEmpty.length} categories`
            : "scanning…"}
        </span>
        <div className="flex items-center gap-2">
          <FreshnessChip
            lastFetchedAt={report?.generatedAt}
            source="scanner · 8 categories"
            onReload={load}
          />
          <button
            onClick={purgeAll}
            disabled={loading || purging !== null || !report || report.totalStaleRows === 0}
            className={cn(
              "rounded-lg border px-3 py-1 text-xs font-medium transition",
              report && report.totalStaleRows > 0
                ? "border-rose-500/50 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20"
                : "border-zinc-700 bg-zinc-900/40 text-zinc-500",
              purging === "all" && "opacity-50 animate-pulse",
            )}
          >
            {purging === "all" ? "purging…" : "purge all"}
          </button>
        </div>
      </div>

      {report && report.totalStaleRows === 0 && (
        <Panel className="border-emerald-500/30 bg-emerald-500/[0.03] py-12 text-center">
          <div className="mb-2 text-4xl">✓</div>
          <h2 className="text-lg font-semibold text-emerald-300">
            Nothing stale
          </h2>
          <p className="mt-2 text-xs text-zinc-400">
            All 8 categories are clean. Drift alerts fresh, actions
            triaged, skills graduated, contradictions resolved, tasks
            active, conversations healthy, reviews current, events
            pruned.
          </p>
        </Panel>
      )}

      {/* Non-empty categories first — the stuff Nour actually needs to
           clear. Rendered as individual cards with per-category purge. */}
      {nonEmpty.map((cat) => (
        <Panel
          key={cat.id}
          className="border-amber-500/20 bg-amber-500/[0.02]"
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-semibold text-white">
                  {cat.title}
                </h2>
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-mono tabular-nums text-amber-300">
                  <AnimatedCounter value={cat.count} /> stale
                </span>
              </div>
              <p className="mt-1 text-[11px] text-zinc-400">
                {cat.description}
              </p>
              <p className="mt-1 text-[10px] italic text-zinc-500">
                <span className="font-mono uppercase tracking-wider text-[var(--gold)]/70">
                  purge →
                </span>{" "}
                {cat.purgeAction}
              </p>
            </div>
            <button
              onClick={() => purgeCategory(cat.id, cat.title)}
              disabled={purging !== null}
              className={cn(
                "shrink-0 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-[11px] font-medium text-rose-200 transition hover:bg-rose-500/20 disabled:opacity-50",
                purging === cat.id && "animate-pulse",
              )}
            >
              {purging === cat.id ? "purging…" : "purge"}
            </button>
          </div>

          {cat.examples.length > 0 && (
            <div className="space-y-1 rounded-lg bg-zinc-900/40 p-2">
              <div className="mb-1 text-[9px] font-mono uppercase tracking-wider text-zinc-500">
                sample · oldest first
              </div>
              {cat.examples.map((ex) => (
                <div
                  key={String(ex.id)}
                  className="grid grid-cols-[1fr_auto] items-center gap-3 rounded px-2 py-1 text-[11px] hover:bg-white/[0.03]"
                >
                  <span className="truncate text-zinc-300" title={ex.label}>
                    {ex.label}
                  </span>
                  <span className="font-mono tabular-nums text-amber-300">
                    <AnimatedCounter value={ex.ageDays} />d old
                  </span>
                </div>
              ))}
              {cat.count > cat.examples.length && (
                <div className="pt-1 text-center text-[9px] text-zinc-600">
                  + <AnimatedCounter value={cat.count - cat.examples.length} /> more
                </div>
              )}
            </div>
          )}
        </Panel>
      ))}

      {/* Empty categories rolled up at the bottom — keeps the full list
           visible so Nour knows what WAS scanned, not just what's dirty. */}
      {empty.length > 0 && (
        <Panel className="border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02]">
          <h2 className="mb-2 text-sm font-semibold text-emerald-300">
            Clean ({empty.length})
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {empty.map((cat) => (
              <span
                key={cat.id}
                className="rounded-full bg-emerald-500/[0.04] px-2 py-0.5 text-[10px] text-emerald-400/80"
              >
                ✓ {cat.title}
              </span>
            ))}
          </div>
        </Panel>
      )}

      <p className="pt-2 text-center text-[10px] text-zinc-600">
        scanner: lib/system/stale-data-scanner.ts · purger: lib/system/stale-data-purger.ts
        <br />
        rows are marked resolved / archived where possible; only
        DeviceEvents &gt; 180d and orphan conversations are hard-deleted.
      </p>
    </div>
  );
}
