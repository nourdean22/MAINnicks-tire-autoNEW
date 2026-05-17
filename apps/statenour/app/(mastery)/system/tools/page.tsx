"use client";

/**
 * /system/tools — Nick's tool inventory.
 *
 * Before this page existed, 114 tools lived in one 3621-line file with
 * zero observability. What tools does Nick have? What's expensive?
 * Which ones mutate data? How do I find the one I need?
 *
 * Now: full inventory grouped by family, color-coded, searchable,
 * filterable by mutation/cost. Click a tool row for full description +
 * tags. Drift detector flags any tool in the live toolset that's not
 * in the TOOL_FAMILIES registry — add it to the registry to clear.
 *
 * Alive+dynamic touches: family chips are clickable (scroll to section),
 * the rollup grid color-codes each family via the registry-defined
 * palette, search filters both tool name AND description.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { StandardPage } from "@/components/layout/standard-page";
import { Panel } from "@/components/panel";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { SortDropdown } from "@/components/ui/sort-dropdown";
import { authedFetch } from "@/hooks/use-authed-fetch";
import { cn } from "@/lib/utils/cn";
import { AlertCircle, Beaker, CheckCircle2, DollarSign, Pencil, Search } from "lucide-react";

interface ToolRow {
  name: string;
  description: string;
  family: string;
  familyLabel: string;
  mutates: boolean;
  cost: "cheap" | "medium" | "expensive";
  tags: string[];
  registered: boolean;
  liveInToolset: boolean;
  telemetry?: {
    totalCalls: number;
    successRate: number;
    avgDurationMs: number;
    failCount: number;
    lastCallAt?: number;
  };
}

interface FamilyRollup {
  family: string;
  label: string;
  color: string;
  toolCount: number;
  mutatingCount: number;
  expensiveCount: number;
}

interface Payload {
  totalTools: number;
  totalRegistered: number;
  drift: {
    inToolsetMissingFromRegistry: string[];
    inRegistryMissingFromToolset: string[];
  };
  tools: ToolRow[];
  families: FamilyRollup[];
  generatedAt: string;
}

const COST_COLOR: Record<string, string> = {
  cheap: "text-emerald-300",
  medium: "text-amber-300",
  expensive: "text-rose-300",
};

// Keep palette tokens stable so Tailwind's JIT compiles them.
const FAMILY_BG: Record<string, string> = {
  sky: "bg-sky-500/10 border-sky-500/30 text-sky-200",
  violet: "bg-violet-500/10 border-violet-500/30 text-violet-200",
  emerald: "bg-emerald-500/10 border-emerald-500/30 text-emerald-200",
  amber: "bg-amber-500/10 border-amber-500/30 text-amber-200",
  indigo: "bg-indigo-500/10 border-indigo-500/30 text-indigo-200",
  purple: "bg-violet-500/10 border-violet-500/30 text-violet-200",
  rose: "bg-rose-500/10 border-rose-500/30 text-rose-200",
  slate: "bg-slate-500/10 border-slate-500/30 text-slate-200",
  blue: "bg-blue-500/10 border-blue-500/30 text-blue-200",
  cyan: "bg-cyan-500/10 border-cyan-500/30 text-cyan-200",
  orange: "bg-orange-500/10 border-orange-500/30 text-orange-200",
  fuchsia: "bg-fuchsia-500/10 border-fuchsia-500/30 text-fuchsia-200",
  pink: "bg-pink-500/10 border-pink-500/30 text-pink-200",
  yellow: "bg-yellow-500/10 border-yellow-500/30 text-yellow-200",
  teal: "bg-teal-500/10 border-teal-500/30 text-teal-200",
  zinc: "bg-zinc-500/10 border-zinc-500/30 text-zinc-200",
};

export default function ToolsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "mutating" | "expensive" | "unregistered">("all");
  const [selectedFamily, setSelectedFamily] = useState<string | null>(null);
  // v10.0.439 · sort key · 5 modes within each family group
  type ToolSort = "name" | "calls-most" | "fail-rate-highest" | "duration-longest" | "last-call-newest";
  const [sortKey, setSortKey] = useState<ToolSort>(() => {
    if (typeof window === "undefined") return "name";
    const saved = window.localStorage.getItem("system-tools:sortKey");
    const valid: ToolSort[] = ["name", "calls-most", "fail-rate-highest", "duration-longest", "last-call-newest"];
    return saved && valid.includes(saved as ToolSort) ? (saved as ToolSort) : "name";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("system-tools:sortKey", sortKey);
  }, [sortKey]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authedFetch("/api/system/tools/stats", { cache: "no-store" });
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

  const filteredByFamily = useMemo(() => {
    if (!data) return new Map<string, ToolRow[]>();
    const map = new Map<string, ToolRow[]>();
    const tools = Array.isArray(data.tools) ? data.tools : [];
    for (const t of tools) {
      if (selectedFamily && t.family !== selectedFamily) continue;
      if (filter === "mutating" && !t.mutates) continue;
      if (filter === "expensive" && t.cost !== "expensive") continue;
      if (filter === "unregistered" && t.registered) continue;
      if (
        search &&
        !t.name.toLowerCase().includes(search.toLowerCase()) &&
        !t.description.toLowerCase().includes(search.toLowerCase())
      )
        continue;
      const arr = map.get(t.family) ?? [];
      arr.push(t);
      map.set(t.family, arr);
    }
    // v10.0.439 · sort within each family bucket
    for (const [fam, list] of map) {
      const sorted = [...list].sort((a, b) => {
        switch (sortKey) {
          case "calls-most":
            return (b.telemetry?.totalCalls ?? 0) - (a.telemetry?.totalCalls ?? 0);
          case "fail-rate-highest": {
            const fa = a.telemetry ? 1 - (a.telemetry.successRate ?? 1) : 0;
            const fb = b.telemetry ? 1 - (b.telemetry.successRate ?? 1) : 0;
            return fb - fa;
          }
          case "duration-longest":
            return (b.telemetry?.avgDurationMs ?? 0) - (a.telemetry?.avgDurationMs ?? 0);
          case "last-call-newest":
            return (b.telemetry?.lastCallAt ?? 0) - (a.telemetry?.lastCallAt ?? 0);
          case "name":
          default:
            return a.name.localeCompare(b.name);
        }
      });
      map.set(fam, sorted);
    }
    return map;
  }, [data, search, filter, selectedFamily, sortKey]);

  const totalFiltered = useMemo(() => {
    let n = 0;
    for (const arr of filteredByFamily.values()) n += arr.length;
    return n;
  }, [filteredByFamily]);

  return (
    <StandardPage
      eyebrow="NOUR OS · System"
      title="Tool inventory"
      description={
        data
          ? `${data.totalTools} live tools · ${data.totalRegistered} registered · ${data.families.length} families`
          : ""
      }
      width="2xl"
      rhythm="loose"
      actions={
        <FreshnessChip
          lastFetchedAt={data?.generatedAt ?? null}
          source="tool-families"
          onReload={load}
        />
      }
    >
      {error && (
        <Panel className="border-rose-500/40 bg-rose-500/10">
          <div className="flex items-center gap-2 p-3 text-sm text-rose-200">
            <AlertCircle className="h-4 w-4" />
            <span>{error}</span>
          </div>
        </Panel>
      )}

      {/* Drift detector — urgent panel when tools and registry disagree */}
      {data &&
        (data.drift.inToolsetMissingFromRegistry.length > 0 ||
          data.drift.inRegistryMissingFromToolset.length > 0) && (
          <Panel className="border-amber-500/40 bg-amber-500/[0.05]">
            <div className="space-y-2 p-3 text-xs">
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-200">
                <AlertCircle className="h-4 w-4" />
                Registry drift detected
              </div>
              {data.drift.inToolsetMissingFromRegistry.length > 0 && (
                <div>
                  <div className="text-[var(--text-muted)]">
                    Live tools WITHOUT a registry entry (add to lib/ai/tool-families.ts):
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {data.drift.inToolsetMissingFromRegistry.map((n) => (
                      <span
                        key={n}
                        className="font-mono rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-200"
                      >
                        {n}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {data.drift.inRegistryMissingFromToolset.length > 0 && (
                <div>
                  <div className="text-[var(--text-muted)]">
                    Registered tools NOT in nourTools (remove from registry):
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {data.drift.inRegistryMissingFromToolset.map((n) => (
                      <span
                        key={n}
                        className="font-mono rounded border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-[11px] text-rose-200"
                      >
                        {n}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Panel>
        )}

      {/* Family chips — click to filter */}
      {data && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setSelectedFamily(null)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs transition-colors",
              !selectedFamily
                ? "border-white/20 bg-white/10 text-[var(--text-primary)]"
                : "border-white/10 bg-white/[0.02] text-[var(--text-secondary)] hover:bg-white/5",
            )}
          >
            All ({data.tools.length})
          </button>
          {data.families
            .filter((f) => f.toolCount > 0)
            .map((f) => (
              <button
                key={f.family}
                type="button"
                onClick={() => setSelectedFamily(f.family === selectedFamily ? null : f.family)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                  selectedFamily === f.family
                    ? FAMILY_BG[f.color] ?? "bg-white/10 text-[var(--text-primary)]"
                    : "border-white/10 bg-white/[0.02] text-[var(--text-secondary)] hover:bg-white/5",
                )}
              >
                <span>{f.label}</span>
                <span className="tabular-nums opacity-70">{f.toolCount}</span>
              </button>
            ))}
        </div>
      )}

      {/* Filter + search row */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.02] p-1 text-xs">
          {(["all", "mutating", "expensive", "unregistered"] as const).map((f) => (
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
          ))}
        </div>
        <div className="flex flex-1 min-w-[160px] items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-1.5">
          <Search className="h-3.5 w-3.5 text-[var(--text-muted)]" />
          <input
            type="text"
            placeholder="name or description..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
          />
        </div>
        {/* v10.0.439 · sort dropdown · 5 modes */}
        <SortDropdown<ToolSort>
          value={sortKey}
          onChange={setSortKey}
          defaultValue="name"
          ariaLabel="Sort tools"
          options={[
            { value: "name", label: "name · A→Z" },
            { value: "calls-most", label: "calls · most" },
            { value: "fail-rate-highest", label: "fail rate · highest" },
            { value: "duration-longest", label: "duration · longest" },
            { value: "last-call-newest", label: "last call · newest" },
          ]}
        />
        <div className="text-xs text-[var(--text-muted)]">
          {totalFiltered} {totalFiltered === 1 ? "tool" : "tools"}
        </div>
      </div>

      {loading && !data && (
        <Panel>
          <div className="p-6 text-center text-sm text-[var(--text-muted)]">
            Loading tools...
          </div>
        </Panel>
      )}

      {/* Per-family sections */}
      {data &&
        data.families
          .filter((f) => filteredByFamily.has(f.family))
          .map((fam) => (
            <Panel key={fam.family}>
              <div
                className={cn(
                  "flex items-center justify-between border-b border-white/5 px-3 py-2 text-xs",
                )}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                      FAMILY_BG[fam.color] ?? "bg-white/5 text-[var(--text-primary)]",
                    )}
                  >
                    {fam.label}
                  </span>
                  <span className="text-[var(--text-muted)]">
                    {filteredByFamily.get(fam.family)!.length} of {fam.toolCount}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-[var(--text-muted)]">
                  {fam.mutatingCount > 0 && (
                    <span title="mutates state">
                      <Pencil className="inline h-3 w-3" /> {fam.mutatingCount}
                    </span>
                  )}
                  {fam.expensiveCount > 0 && (
                    <span title="expensive">
                      <DollarSign className="inline h-3 w-3" /> {fam.expensiveCount}
                    </span>
                  )}
                </div>
              </div>
              <table className="w-full text-xs">
                <thead className="text-[var(--text-muted)]">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">tool</th>
                    <th className="px-2 py-2 text-left font-medium">description</th>
                    <th className="px-2 py-2 text-right font-medium" title="Total calls">calls</th>
                    <th className="px-2 py-2 text-right font-medium" title="Success rate">ok%</th>
                    <th className="px-2 py-2 text-right font-medium" title="Avg duration">ms</th>
                    <th className="px-2 py-2 text-center font-medium">cost</th>
                    <th className="px-2 py-2 text-center font-medium">mutates</th>
                    <th className="px-3 py-2 text-left font-medium">tags</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredByFamily.get(fam.family)!.map((t) => (
                    <tr
                      key={t.name}
                      className="border-t border-white/5 text-[var(--text-secondary)] hover:bg-white/[0.02]"
                    >
                      <td className="px-3 py-1.5 font-mono">
                        {t.name}
                        {!t.registered && (
                          <span className="ml-2 rounded border border-rose-500/40 bg-rose-500/10 px-1 text-[10px] text-rose-300">
                            unreg
                          </span>
                        )}
                        {!t.liveInToolset && (
                          <span className="ml-2 rounded border border-amber-500/40 bg-amber-500/10 px-1 text-[10px] text-amber-300">
                            dead
                          </span>
                        )}
                      </td>
                      <td className="max-w-md px-2 py-1.5">{t.description}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-[11px]">
                        {t.telemetry ? (
                          <span className={t.telemetry.totalCalls > 0 ? "text-[var(--text-secondary)]" : "text-[var(--text-muted)]"}>
                            {t.telemetry.totalCalls}
                          </span>
                        ) : (
                          <span className="text-[var(--text-muted)] opacity-40">—</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-[11px]">
                        {t.telemetry && t.telemetry.totalCalls > 0 ? (
                          <span
                            className={cn(
                              t.telemetry.successRate >= 0.9
                                ? "text-emerald-300"
                                : t.telemetry.successRate >= 0.7
                                  ? "text-amber-300"
                                  : "text-rose-300",
                            )}
                          >
                            {Math.round(t.telemetry.successRate * 100)}
                          </span>
                        ) : (
                          <span className="text-[var(--text-muted)] opacity-40">—</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-[11px] text-[var(--text-muted)]">
                        {t.telemetry?.avgDurationMs ? t.telemetry.avgDurationMs : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <span className={cn("text-[11px]", COST_COLOR[t.cost])}>
                          {t.cost}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        {t.mutates ? (
                          <span title="mutates state">
                            <Pencil className="inline h-3 w-3 text-amber-300" />
                          </span>
                        ) : (
                          <span title="read-only">
                            <CheckCircle2 className="inline h-3 w-3 text-emerald-300 opacity-50" />
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex flex-wrap gap-1">
                          {t.tags.map((tag) => (
                            <span
                              key={tag}
                              className="rounded-full border border-white/10 bg-white/5 px-1.5 py-px text-[10px]"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          ))}

      {!loading && data && totalFiltered === 0 && (
        <Panel>
          <div className="p-6 text-center text-sm text-[var(--text-muted)]">
            No tools match this filter.
          </div>
        </Panel>
      )}

      {/* Footer helper */}
      <Panel>
        <div className="flex items-start gap-3 p-3 text-xs text-[var(--text-secondary)]">
          <Beaker className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
          <div className="space-y-1">
            <div className="font-semibold text-[var(--text-primary)]">
              How this works
            </div>
            <div>
              Tools are defined in{" "}
              <code className="font-mono text-[var(--text-secondary)]">
                lib/ai/tools.ts
              </code>{" "}
              (3621 LOC, single source of executable truth). Metadata lives
              in{" "}
              <code className="font-mono text-[var(--text-secondary)]">
                lib/ai/tool-families.ts
              </code>{" "}
              — add a new tool there after adding it to nourTools.
            </div>
            <div>
              <span className="font-semibold text-rose-300">unreg</span>{" "}
              chip: tool exists in nourTools but not in the registry → add
              metadata.{" "}
              <span className="font-semibold text-amber-300">dead</span> chip:
              in the registry but not in nourTools → remove from registry or
              restore the tool.
            </div>
          </div>
        </div>
      </Panel>
    </StandardPage>
  );
}
