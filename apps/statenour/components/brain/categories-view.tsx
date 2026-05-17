"use client";

/**
 * BrainCategoriesView · v10.0.330 · BrainMemory category observability.
 *
 * Extracted from /brain/categories for cluster-merge with health +
 * continuity views. Strips outer wrapper + PageHeader since the unified
 * /brain/health shell provides those.
 *
 * What this view shows:
 *   · Top rollup grid · total rows + registered/deprecated/unregistered
 *   · Filter pills (all/registered/deprecated/unregistered) + search
 *   · Tables grouped by domain · per-row count, perm, conf, ages, status
 *   · Footer helper · how to read registered / deprecated / unregistered
 *
 * Drift signal: unregistered categories show with a rose chip · that's
 * the writer-flowed-to-bucket-not-in-registry telltale.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Panel } from "@/components/panel";
import { authedFetch } from "@/hooks/use-authed-fetch";
import { cn } from "@/lib/utils/cn";
import { AlertTriangle, CheckCircle2, ArrowRight, Database } from "lucide-react";

type StatStatus = "registered" | "deprecated" | "unregistered";

interface StatRow {
  category: string;
  rows: number;
  permanentRows: number;
  latestAt: string | null;
  oldestAt: string | null;
  avgConfidence: number;
  domain: string;
  status: StatStatus;
  canonicalTarget: string | null;
}

interface Payload {
  totalRows: number;
  totalCategories: number;
  categoriesRegistered: number;
  categoriesDeprecated: number;
  categoriesUnregistered: number;
  stats: StatRow[];
  generatedAt: string;
}

function ageChip(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86400_000);
  if (days >= 365) return `${Math.floor(days / 365)}y`;
  if (days >= 30) return `${Math.floor(days / 30)}mo`;
  if (days >= 1) return `${days}d`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `${hours}h`;
  return "<1h";
}

export function BrainCategoriesView() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | StatStatus>("all");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authedFetch("/api/brain/category-stats", {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json.data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const byDomain = useMemo(() => {
    if (!data) return new Map<string, StatRow[]>();
    const map = new Map<string, StatRow[]>();
    const rows = Array.isArray(data.stats) ? data.stats : [];
    for (const row of rows) {
      if (filter !== "all" && row.status !== filter) continue;
      if (
        search &&
        !row.category.toLowerCase().includes(search.toLowerCase())
      )
        continue;
      const arr = map.get(row.domain) ?? [];
      arr.push(row);
      map.set(row.domain, arr);
    }
    return map;
  }, [data, filter, search]);

  return (
    <div className="space-y-4">
      {error && (
        <Panel className="border-rose-500/40 bg-rose-500/10">
          <div className="flex items-center gap-2 p-3 text-sm text-rose-200">
            <AlertTriangle className="h-4 w-4" />
            <span>{error}</span>
          </div>
        </Panel>
      )}

      {/* Top rollup grid */}
      {data && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <RollupTile
            label="Total rows"
            value={data.totalRows.toLocaleString()}
            tone="neutral"
          />
          <RollupTile
            label="Registered"
            value={data.categoriesRegistered.toString()}
            tone="ok"
          />
          <RollupTile
            label="Deprecated"
            value={data.categoriesDeprecated.toString()}
            tone={data.categoriesDeprecated > 0 ? "warn" : "ok"}
            hint="codemod target"
          />
          <RollupTile
            label="Unregistered"
            value={data.categoriesUnregistered.toString()}
            tone={data.categoriesUnregistered > 0 ? "critical" : "ok"}
            hint="drift — add to registry"
          />
        </div>
      )}

      {/* Filter + search */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.02] p-1 text-xs">
          {(["all", "registered", "deprecated", "unregistered"] as const).map(
            (f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={cn(
                  "rounded-md px-2 py-1 transition-colors",
                  filter === f
                    ? "bg-white/10 text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:bg-white/5",
                )}
              >
                {f}
              </button>
            ),
          )}
        </div>
        <input
          type="text"
          placeholder="filter categories..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[160px] rounded-lg border border-white/10 bg-white/[0.02] px-3 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-white/20"
        />
      </div>

      {/* Tables by domain */}
      {loading && !data && (
        <Panel>
          <div className="p-6 text-center text-sm text-[var(--text-muted)]">
            Loading categories…
          </div>
        </Panel>
      )}

      {[...byDomain.entries()].map(([domain, rows]) => (
        <Panel key={domain}>
          <div className="border-b border-white/5 px-3 py-2 text-xs uppercase tracking-wide text-[var(--text-muted)]">
            {domain} · {rows.length} categories ·{" "}
            {rows.reduce((s, r) => s + r.rows, 0).toLocaleString()} rows
          </div>
          <table className="w-full text-xs">
            <thead className="text-[var(--text-muted)]">
              <tr>
                <th className="px-3 py-2 text-left font-medium">category</th>
                <th className="px-2 py-2 text-right font-medium">rows</th>
                <th className="px-2 py-2 text-right font-medium">perm</th>
                <th className="px-2 py-2 text-right font-medium">conf</th>
                <th className="px-2 py-2 text-right font-medium">latest</th>
                <th className="px-2 py-2 text-right font-medium">oldest</th>
                <th className="px-3 py-2 text-left font-medium">status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.category}
                  className="border-t border-white/5 text-[var(--text-secondary)] hover:bg-white/[0.02]"
                >
                  <td className="px-3 py-1.5 font-mono">
                    {r.category}
                    {r.canonicalTarget && (
                      <span className="ml-2 inline-flex items-center gap-1 text-[10px] text-amber-300">
                        <ArrowRight className="h-3 w-3" />
                        <span className="font-mono">{r.canonicalTarget}</span>
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {r.rows.toLocaleString()}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {r.permanentRows.toLocaleString()}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {(r.avgConfidence * 100).toFixed(0)}%
                  </td>
                  <td
                    className="px-2 py-1.5 text-right tabular-nums"
                    title={r.latestAt ?? ""}
                  >
                    {ageChip(r.latestAt)}
                  </td>
                  <td
                    className="px-2 py-1.5 text-right tabular-nums"
                    title={r.oldestAt ?? ""}
                  >
                    {ageChip(r.oldestAt)}
                  </td>
                  <td className="px-3 py-1.5">
                    <StatusBadge status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      ))}

      {!loading && data && byDomain.size === 0 && (
        <Panel>
          <div className="p-6 text-center text-sm text-[var(--text-muted)]">
            No categories match this filter.
          </div>
        </Panel>
      )}

      {/* Footer helper */}
      <Panel>
        <div className="flex items-start gap-3 p-3 text-xs text-[var(--text-secondary)]">
          <Database className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
          <div className="space-y-1">
            <div className="font-semibold text-[var(--text-primary)]">
              How to read this
            </div>
            <div>
              <span className="font-semibold text-emerald-300">
                Registered
              </span>
              : category is in{" "}
              <code className="font-mono text-[var(--text-secondary)]">
                lib/brain/categories.ts
              </code>
              .
            </div>
            <div>
              <span className="font-semibold text-amber-300">Deprecated</span>:
              still in the registry for historical reads, but writes are
              auto-rewritten to the canonical target (shown with →).
            </div>
            <div>
              <span className="font-semibold text-rose-300">Unregistered</span>
              : drift. Either add to the registry or migrate the writer.
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function RollupTile({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone: "ok" | "warn" | "critical" | "neutral";
  hint?: string;
}) {
  const border =
    tone === "critical"
      ? "border-rose-500/40"
      : tone === "warn"
        ? "border-amber-500/30"
        : tone === "ok"
          ? "border-emerald-500/30"
          : "border-white/10";
  const bg =
    tone === "critical"
      ? "bg-rose-500/[0.08]"
      : tone === "warn"
        ? "bg-amber-500/[0.06]"
        : tone === "ok"
          ? "bg-emerald-500/[0.05]"
          : "bg-white/[0.02]";
  return (
    <div className={cn("rounded-lg border p-3", border, bg)}>
      <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-[var(--text-primary)]">
        {value}
      </div>
      {hint && (
        <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">
          {hint}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: StatStatus }) {
  if (status === "registered") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-px text-[10px] text-emerald-300">
        <CheckCircle2 className="h-2.5 w-2.5" />
        registered
      </span>
    );
  }
  if (status === "deprecated") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-px text-[10px] text-amber-300">
        deprecated
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/10 px-1.5 py-px text-[10px] text-rose-300">
      <AlertTriangle className="h-2.5 w-2.5" />
      unregistered
    </span>
  );
}
