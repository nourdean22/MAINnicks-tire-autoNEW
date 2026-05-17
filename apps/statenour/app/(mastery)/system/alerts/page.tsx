"use client";

/**
 * /system/alerts · v8.11.2 · Apr 29.
 *
 * Cross-category alerts inspector. The HQ ActiveAlertsCard surfaces
 * the most-recent items per category but is silent on history; this
 * page exposes the full window with filter + sort + drill-down to
 * /system/history.
 *
 * Composes:
 *   · GET /api/brain/active-alerts (already returns all 6 categories
 *     grouped — uses sinceDays/limit query params)
 *   · /system/history?type=brainMemory&id= for the audit trail
 *
 * NOT a "clear" mechanic — alerts auto-collapse via per-hour idempotency
 * keys at the source crons. Adding a manual "dismiss" surface here
 * would compete with that and silently bias future runs.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/ui";
import { Panel } from "@/components/panel";
import { SortDropdown } from "@/components/ui/sort-dropdown";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { authedFetch } from "@/hooks/use-authed-fetch";

interface Alert {
  id: string;
  category: string;
  key: string;
  content: string;
  createdAt: string;
  metadata: Record<string, unknown> | null;
}

interface AlertsPayload {
  sinceDays: number;
  counts: Record<string, number>;
  alerts: Record<string, Alert[]>;
}

const CATEGORY_META: Record<
  string,
  { label: string; emoji: string; tint: string }
> = {
  correlation_alert: {
    label: "Correlation",
    emoji: "🔗",
    tint: "border-blue-500/40 bg-blue-500/10 text-blue-200",
  },
  decision_quality_drift: {
    label: "Decision drift",
    emoji: "📉",
    tint: "border-rose-500/40 bg-rose-500/10 text-rose-200",
  },
  schema_drift_alert: {
    label: "Schema drift",
    emoji: "⚠️",
    tint: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  },
  storage_quota_alert: {
    label: "Storage quota",
    emoji: "💾",
    tint: "border-orange-500/40 bg-orange-500/10 text-orange-200",
  },
  creation_spike_alert: {
    label: "Creation spike",
    emoji: "🌊",
    tint: "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-200",
  },
  update_spike_alert: {
    label: "Update spike",
    emoji: "🔁",
    tint: "border-violet-500/40 bg-violet-500/10 text-violet-200",
  },
  brain_bus_alert: {
    label: "Brain-bus probe",
    emoji: "🛰️",
    tint: "border-cyan-500/40 bg-cyan-500/10 text-cyan-200",
  },
};

const ALL_CATS = Object.keys(CATEGORY_META);

const SINCE_OPTIONS: Array<{ v: number; label: string }> = [
  { v: 1, label: "1d" },
  { v: 7, label: "7d" },
  { v: 30, label: "30d" },
  { v: 90, label: "90d" },
  { v: 180, label: "180d" },
];

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

export default function AlertsInspectorPage() {
  const [payload, setPayload] = useState<AlertsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  const [sinceDays, setSinceDays] = useState(30);
  const [activeCategories, setActiveCategories] = useState<Set<string>>(
    new Set(ALL_CATS),
  );
  // v10.0.437 · expanded sort key · 4 modes (was newest/oldest only)
  type AlertSort = "newest" | "oldest" | "category-alpha" | "key-alpha";
  const [sortDir, setSortDir] = useState<AlertSort>(() => {
    if (typeof window === "undefined") return "newest";
    const saved = window.localStorage.getItem("system-alerts:sortKey");
    const valid: AlertSort[] = ["newest", "oldest", "category-alpha", "key-alpha"];
    return saved && valid.includes(saved as AlertSort) ? (saved as AlertSort) : "newest";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("system-alerts:sortKey", sortDir);
  }, [sortDir]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authedFetch(
        `/api/brain/active-alerts?sinceDays=${sinceDays}&limit=50`,
      );
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const j = (await res.json()) as { data?: AlertsPayload } & AlertsPayload;
      setPayload(j.data ?? (j as AlertsPayload));
      setLastFetchedAt(new Date());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [sinceDays]);

  useEffect(() => {
    void load();
  }, [load]);

  const flattened = useMemo(() => {
    if (!payload) return [];
    const all: Alert[] = [];
    for (const cat of ALL_CATS) {
      if (!activeCategories.has(cat)) continue;
      all.push(...(payload.alerts[cat] ?? []));
    }
    all.sort((a, b) => {
      switch (sortDir) {
        case "category-alpha": {
          const c = a.category.localeCompare(b.category);
          if (c !== 0) return c;
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        }
        case "key-alpha":
          return a.key.localeCompare(b.key);
        case "oldest":
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case "newest":
        default:
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
    });
    return all;
  }, [payload, activeCategories, sortDir]);

  const totalAcrossAllCats = useMemo(() => {
    if (!payload) return 0;
    return Object.values(payload.counts).reduce((a, b) => a + b, 0);
  }, [payload]);

  const totalVisible = flattened.length;

  function toggleCategory(cat: string): void {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  function selectOnly(cat: string): void {
    setActiveCategories(new Set([cat]));
  }

  function selectAll(): void {
    setActiveCategories(new Set(ALL_CATS));
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <PageHeader parentHref="/system" parentLabel="system"
        eyebrow="System"
        title="Alerts inspector"
        description="Every alert across the 7 brain-side detectors · filter · drill into audit trail"
      />

      <Panel className="mt-4">
        {/* Controls row */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-baseline gap-1.5">
              <AnimatedCounter
                value={totalVisible}
                className="text-xl font-bold text-[var(--text-primary)]"
              />
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">
                visible
              </span>
            </div>
            <span className="text-[10px] text-[var(--text-tertiary)]">/</span>
            <div className="flex items-baseline gap-1.5">
              <AnimatedCounter
                value={totalAcrossAllCats}
                className="text-base font-semibold text-[var(--text-secondary)]"
              />
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">
                total
              </span>
            </div>
          </div>
          <FreshnessChip
            lastFetchedAt={lastFetchedAt}
            source="api/brain/active-alerts"
            onReload={() => void load()}
          />
        </div>

        {/* Window selector */}
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
            window:
          </span>
          {SINCE_OPTIONS.map((opt) => (
            <button
              key={opt.v}
              type="button"
              onClick={() => setSinceDays(opt.v)}
              className={
                "rounded-full border px-2 py-0.5 text-[10px] font-mono transition-colors " +
                (sinceDays === opt.v
                  ? "border-zinc-500 bg-zinc-700/50 text-zinc-100"
                  : "border-zinc-800 bg-zinc-950 text-zinc-500 hover:text-zinc-200")
              }
            >
              {opt.label}
            </button>
          ))}
          <span className="ml-3 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
            sort:
          </span>
          {/* v10.0.437 · was a 2-mode toggle · now 4-mode SortDropdown */}
          <SortDropdown<AlertSort>
            value={sortDir}
            onChange={setSortDir}
            defaultValue="newest"
            ariaLabel="Sort alerts"
            options={[
              { value: "newest", label: "newest first" },
              { value: "oldest", label: "oldest first" },
              { value: "category-alpha", label: "category · A→Z" },
              { value: "key-alpha", label: "key · A→Z" },
            ]}
          />
        </div>

        {/* Category filter chips */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
            categories:
          </span>
          {ALL_CATS.map((cat) => {
            const meta = CATEGORY_META[cat];
            const count = payload?.counts[cat] ?? 0;
            const active = activeCategories.has(cat);
            return (
              <button
                key={cat}
                type="button"
                onClick={() => toggleCategory(cat)}
                onDoubleClick={() => selectOnly(cat)}
                title={`Click to toggle. Double-click to isolate.`}
                className={
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-mono transition-colors " +
                  (active
                    ? meta.tint
                    : "border-zinc-800 bg-zinc-950 text-zinc-500 hover:text-zinc-200")
                }
              >
                <span>{meta.emoji}</span>
                <span>{meta.label}</span>
                <span className="opacity-70">·</span>
                <AnimatedCounter value={count} />
              </button>
            );
          })}
          {activeCategories.size !== ALL_CATS.length && (
            <button
              type="button"
              onClick={selectAll}
              className="ml-2 rounded-full border border-emerald-500/40 px-2 py-0.5 text-[10px] font-mono text-emerald-300 hover:bg-emerald-500/10"
            >
              show all
            </button>
          )}
        </div>
      </Panel>

      <Panel className="mt-4">
        {error && (
          <div className="rounded-md border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-200">
            {error}
          </div>
        )}

        {loading && !payload && (
          <p className="py-8 text-center text-xs text-zinc-500">
            Loading alerts…
          </p>
        )}

        {payload && totalVisible === 0 && (
          <div className="py-8 text-center">
            <p className="text-sm text-zinc-300">
              {totalAcrossAllCats === 0
                ? "✅ No alerts in the last "
                : "No alerts match the active filters in the last "}
              {sinceDays}d.
            </p>
            {totalAcrossAllCats > 0 && (
              <p className="mt-1 text-[11px] text-zinc-500">
                Toggle more categories above or expand the window to see them.
              </p>
            )}
          </div>
        )}

        {totalVisible > 0 && (
          <ul className="space-y-2 stagger-in">
            {flattened.map((alert) => {
              const meta = CATEGORY_META[alert.category];
              return (
                <li
                  key={alert.id}
                  className={"rounded-lg border p-3 " + (meta?.tint ?? "")}
                >
                  <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[10px] font-mono uppercase tracking-wider">
                    <span>
                      {meta?.emoji} {meta?.label ?? alert.category}
                    </span>
                    <span className="opacity-60">·</span>
                    <span className="opacity-80">{relTime(alert.createdAt)}</span>
                    <span className="opacity-60">·</span>
                    <Link
                      href={`/system/history?type=brainMemory&id=${encodeURIComponent(alert.id)}`}
                      className="underline underline-offset-2 hover:opacity-100 opacity-80"
                    >
                      audit trail →
                    </Link>
                  </div>
                  <p className="text-[12px] leading-snug">{alert.content}</p>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </main>
  );
}
