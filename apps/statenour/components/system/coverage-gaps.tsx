"use client";

/**
 * /system/gaps — "nothing missing" detector (W11.4).
 *
 * Automated scan for rotting stuff: unscheduled crons, empty API
 * shells, tool-catalog drift, models with zero writes, unset env
 * vars, retired-cron deletion windows. One pass, one list.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { Panel } from "@/components/panel";
// PageHeader removed · parent /system/coverage page provides one
import { cn } from "@/lib/utils/cn";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { FreshnessChip } from "@/components/ui/freshness-chip";

import { authedFetch } from "@/hooks/use-authed-fetch";
interface Gap {
  category: string;
  severity: "info" | "warn" | "critical";
  key: string;
  detail: string;
  fix?: string;
}
interface Feed {
  gaps: Gap[];
  summary: {
    total: number;
    bySeverity: Record<string, number>;
    byCategory: Record<string, number>;
  };
  generatedAt: string;
}

const SEVERITY_BG: Record<Gap["severity"], string> = {
  critical: "border-rose-500/40 bg-rose-500/[0.04]",
  warn: "border-amber-500/30 bg-amber-500/[0.03]",
  info: "border-zinc-700 bg-zinc-900/30",
};
const SEVERITY_TEXT: Record<Gap["severity"], string> = {
  critical: "text-rose-300",
  warn: "text-amber-300",
  info: "text-zinc-400",
};

export function CoverageGapsView() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<string | "all">("all");

  const load = useCallback(async () => {
    try {
      const res = await authedFetch("/api/system/gaps", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setFeed(json.data ?? json);
    } catch (e) {
      console.error("gaps fetch failed", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!feed) return [];
    if (categoryFilter === "all") return feed.gaps;
    return feed.gaps.filter((g) => g.category === categoryFilter);
  }, [feed, categoryFilter]);

  return (
    <div className="space-y-4">
      {/* Mini-header replaces the full PageHeader · parent /coverage
          page renders the canonical title. This row keeps the freshness
          chip + re-scan action inline. */}
      <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--text-secondary)]">
        <span>
          {feed
            ? `${feed.summary.total} gaps · ${feed.summary.bySeverity.critical ?? 0} critical · ${feed.summary.bySeverity.warn ?? 0} warn · ${feed.summary.bySeverity.info ?? 0} info`
            : "scanning…"}
        </span>
        <div className="flex items-center gap-2">
          <FreshnessChip
            lastFetchedAt={feed?.generatedAt}
            source="scanner · crons/api/tools/models/env"
            onReload={load}
          />
          <button
            onClick={load}
            disabled={loading}
            className="rounded-lg border border-[var(--border-hover)] bg-[var(--bg-raised)]/5 px-3 py-1 text-xs font-medium text-[var(--text-secondary)] transition hover:bg-[var(--bg-raised)]/10 disabled:opacity-50"
          >
            {loading ? "scanning…" : "re-scan"}
          </button>
        </div>
      </div>

      {feed && feed.summary.total === 0 ? (
        <Panel className="border-emerald-500/30 bg-emerald-500/[0.03] py-12 text-center">
          <div className="mb-2 text-4xl">✓</div>
          <h2 className="text-lg font-semibold text-emerald-300">nothing missing</h2>
          <p className="mt-2 text-xs text-zinc-400">
            no unscheduled crons · no empty API shells · no tool-catalog drift · no stale models · no missing env · no retired deletions overdue
          </p>
        </Panel>
      ) : (
        <>
          {/* Category filter */}
          {feed && (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setCategoryFilter("all")}
                className={cn(
                  "rounded-full px-3 py-1 text-xs transition",
                  categoryFilter === "all" ? "bg-white/10 text-white" : "bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800/60",
                )}
              >
                all · <AnimatedCounter value={feed.summary.total} />
              </button>
              {Object.entries(feed.summary.byCategory)
                .sort(([, a], [, b]) => b - a)
                .map(([cat, count]) => (
                  <button
                    key={cat}
                    onClick={() => setCategoryFilter(cat === categoryFilter ? "all" : cat)}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs transition",
                      categoryFilter === cat ? "bg-amber-500/20 text-amber-200" : "bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800/60",
                    )}
                  >
                    {cat} · <AnimatedCounter value={count} />
                  </button>
                ))}
            </div>
          )}

          {/* Gap list */}
          <Panel className="border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02]">
            <div className="space-y-2">
              {filtered.map((g, i) => (
                <div
                  key={`${g.category}-${g.key}-${i}`}
                  className={cn("rounded-lg border px-3 py-2.5", SEVERITY_BG[g.severity])}
                >
                  <div className="grid grid-cols-[auto_auto_1fr] items-start gap-3">
                    <span className={cn("font-mono text-[9px] uppercase tracking-wider w-16 pt-[2px]", SEVERITY_TEXT[g.severity])}>
                      {g.severity}
                    </span>
                    <span className="rounded bg-white/[0.04] px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-zinc-400">
                      {g.category}
                    </span>
                    <div className="min-w-0">
                      <div className="font-mono text-xs text-zinc-100">{g.key}</div>
                      <div className="mt-0.5 text-[11px] text-zinc-400">{g.detail}</div>
                      {g.fix && (
                        <div className="mt-1 flex items-center gap-2">
                          <span className="rounded bg-emerald-500/10 px-1.5 py-[1px] text-[9px] uppercase tracking-wider text-emerald-300">fix</span>
                          <code className="overflow-x-auto rounded bg-black/40 px-2 py-1 text-[10px] font-mono text-zinc-300">
                            {g.fix}
                          </code>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </>
      )}

      <p className="pt-2 text-center text-[10px] text-zinc-600">
        scans: CRONS manifest · /api filesystem · TOOL_CATALOG vs nourTools · 23 model write-rates · ENV_SPEC required vs runtime
      </p>
    </div>
  );
}
