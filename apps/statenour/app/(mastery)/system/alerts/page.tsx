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
 *     grouped, uses sinceDays/limit query params)
 *   · /system/history?type=brainMemory&id= for the audit trail
 *
 * UI v3 W5b (2026-10-18): Priority and Other lanes (lib/brain/alert-lanes.ts), one state block
 * with Retry, and row verbs. Dismiss is a SUPPRESSION, not a delete: an expiring alert_dismiss row
 * the producers never read, so it cannot bias their idempotency keys; every listing honours it
 * through lib/brain/alert-suppression.ts.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { StandardPage } from "@/components/layout/standard-page";
import { SortDropdown } from "@/components/ui/sort-dropdown";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { AnimatedCounter } from "@/components/ui/animated-counter";
// Phase B.7a (2026-05-22) · REST→tRPC system-pages slice · the
// authedFetch read is now `trpc.brain.activeAlerts.useQuery` (the
// procedure already shipped in the brain-domain slice). React Query
// keys on `{ sinceDays }` so changing the window refetches.
import { trpc } from "@/lib/trpc/client";
// 2026-09-15 · UI workbench: rows are inspectable objects (resolve / mute
// live in the alert inspector, this list had no verbs at all).
import { Eye } from "lucide-react";
import { useInspector } from "@/hooks/use-inspector";
import { ALERTS_DEFAULT_VIEW, alertLane } from "@/lib/brain/alert-lanes";
import { ALERT_MUTE_DAYS, ALERT_RESOLVE_ARM_MS } from "@/components/inspector/panels/alert-inspector";
import { AlertDismissSheet } from "@/components/alerts/alert-dismiss-sheet";
import { toast } from "sonner";

const ACTION_CLASS =
  "inline-flex min-h-[44px] items-center px-2 text-[13px] text-fg-secondary transition-colors duration-[var(--motion-state)] hover:text-fg disabled:opacity-50";

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
  { label: string; tint: string }
> = {
  correlation_alert: {
    label: "Correlation",
    tint: "border-sky-500/40 bg-sky-500/10 text-sky-200",
  },
  decision_quality_drift: {
    label: "Decision drift",
    tint: "border-rose-500/40 bg-rose-500/10 text-rose-200",
  },
  schema_drift_alert: {
    label: "Schema drift",
    tint: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  },
  storage_quota_alert: {
    label: "Storage quota",
    tint: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  },
  creation_spike_alert: {
    label: "Creation spike",
    tint: "border-edge-default bg-surface-interactive text-fg-secondary",
  },
  update_spike_alert: {
    label: "Update spike",
    tint: "border-edge-default bg-surface-interactive text-fg-secondary",
  },
  brain_bus_alert: {
    label: "Brain-bus probe",
    tint: "border-sky-500/40 bg-sky-500/10 text-sky-200",
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
  // Opens on the view the /system tower and hub tile count (ALERTS_DEFAULT_VIEW), so the numbers match.
  const [sinceDays, setSinceDays] = useState<number>(ALERTS_DEFAULT_VIEW.sinceDays);
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

  // Phase B.7a · React Query keys on `{ sinceDays }` · changing the
  // window refetches automatically. `limit:50` matches the legacy URL.
  const { openInspector } = useInspector();
  const alertsQuery = trpc.brain.activeAlerts.useQuery({
    sinceDays,
    limit: ALERTS_DEFAULT_VIEW.limit,
  });
  const payload: AlertsPayload | null =
    (alertsQuery.data as AlertsPayload | undefined) ?? null;
  const readFailed = alertsQuery.isError;
  const lastFetchedAt =
    alertsQuery.dataUpdatedAt > 0
      ? new Date(alertsQuery.dataUpdatedAt)
      : null;
  const load = useCallback(() => {
    void alertsQuery.refetch();
  }, [alertsQuery]);

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
  // W5b: one exhaustive category -> lane map (lib/brain/alert-lanes.ts); sort order holds inside each lane.
  const priority = flattened.filter((a) => alertLane(a.category) === "priority");
  const other = flattened.filter((a) => alertLane(a.category) === "other");
  const [otherOpen, setOtherOpen] = useState(false);

  // W5b row verbs: the inspector's Resolve (two taps, no native confirm) and Mute, plus Dismiss.
  const utils = trpc.useUtils();
  const refresh = () => void utils.brain.activeAlerts.invalidate();
  const [armedId, setArmedId] = useState<string | null>(null);
  // An armed Resolve expires like the inspector's; arming another row restarts the window for it.
  useEffect(() => {
    if (!armedId) return;
    const t = window.setTimeout(() => setArmedId(null), ALERT_RESOLVE_ARM_MS);
    return () => window.clearTimeout(t);
  }, [armedId]);
  const [dismissing, setDismissing] = useState<Alert | null>(null);
  const resolve = trpc.brain.resolveAlert.useMutation({
    onSuccess: (res) => {
      refresh();
      if (res.ok) toast.success("Alert resolved");
      else toast.error("Nothing to resolve: it was already gone");
    },
    onError: () => toast.error("Could not resolve the alert"),
  });
  const mute = trpc.brain.muteAlertCategory.useMutation({
    onSuccess: (res) => {
      refresh();
      toast.success(`Muted until ${new Date(res.until).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`);
    },
    onError: () => toast.error("Could not mute the category"),
  });
  const dismiss = trpc.brain.dismissAlert.useMutation({
    // Completion closes the sheet only if it is still the alert that was submitted: a later
    // sheet for another alert is never closed by an earlier write finishing.
    onSuccess: (_res, vars) => {
      setDismissing((open) => (open && open.id === vars.id ? null : open));
      refresh();
      toast.success("Alert dismissed");
    },
    onError: () => toast.error("Could not dismiss the alert"),
  });

  function renderRow(alert: Alert) {
    const meta = CATEGORY_META[alert.category];
    return (
      <li
        key={alert.id}
        data-entity={`alert:${alert.id}`}
        data-entity-label={alert.content.slice(0, 80)}
        className="py-2 data-[entity-focused=true]:ring-1 data-[entity-focused=true]:ring-edge-strong data-[entity-selected=true]:bg-accent-soft"
      >
        <div className="flex flex-wrap items-center gap-x-2 font-mono text-[12px] text-fg-secondary">
          <span>{meta?.label ?? alert.category}</span>
          <span className="text-fg-tertiary">{relTime(alert.createdAt)}</span>
          <span className="ml-auto flex flex-wrap items-center font-sans">
            <button
              type="button"
              aria-pressed={armedId === alert.id}
              disabled={resolve.isPending}
              onClick={() => {
                if (armedId !== alert.id) {
                  setArmedId(alert.id);
                  return;
                }
                setArmedId(null);
                resolve.mutate({ id: alert.id });
              }}
              className={ACTION_CLASS}
            >
              {armedId === alert.id ? "Tap again to resolve" : "Resolve"}
            </button>
            <button
              type="button"
              disabled={mute.isPending}
              onClick={() => mute.mutate({ category: alert.category, days: ALERT_MUTE_DAYS })}
              className={ACTION_CLASS}
            >
              Mute {ALERT_MUTE_DAYS} days
            </button>
            <button type="button" onClick={() => setDismissing(alert)} className={ACTION_CLASS}>
              Dismiss
            </button>
          </span>
          <button
            type="button"
            onClick={() => openInspector({ kind: "alert", id: alert.id })}
            aria-label="inspect alert"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-control text-fg-tertiary transition-colors duration-[var(--motion-state)] hover:text-fg"
          >
            <Eye size={14} strokeWidth={2} />
          </button>
        </div>
        <p className="text-[14px] leading-snug text-fg">{alert.content}</p>
      </li>
    );
  }

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
    <StandardPage
      eyebrow="System"
      title="Alerts inspector"
      description="Every alert across the seven brain-side detectors · filter · drill into the audit trail."
      width="xl"
      rhythm="comfortable"
      className="px-4 py-6"
    >

      <section className="mt-4 border-l-2 border-edge-strong pl-4 sm:pl-5">
        {/* Controls row */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {/* W5b self-review: no answer yet (or a failed read) has no count; never print 0. */}
          {!payload || readFailed ? (
            <span className="text-[13px] text-fg-tertiary">{readFailed ? "Count unknown" : "Counting"}</span>
          ) : (
          <div className="flex items-center gap-3">
            <div className="flex items-baseline gap-1.5">
              <AnimatedCounter
                value={totalVisible}
                className="text-xl font-bold text-fg"
              />
              <span className="font-mono text-[11px] text-fg-tertiary">
                Visible
              </span>
            </div>
            <span className="text-[11px] text-fg-tertiary">/</span>
            <div className="flex items-baseline gap-1.5">
              <AnimatedCounter
                value={totalAcrossAllCats}
                className="text-base font-semibold text-fg-secondary"
              />
              <span className="font-mono text-[11px] text-fg-tertiary">
                Total
              </span>
            </div>
          </div>
          )}
          <FreshnessChip className="min-h-11"
            lastFetchedAt={lastFetchedAt}
            source="api/brain/active-alerts"
            onReload={() => void load()}
          />
        </div>

        {/* Window selector */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] text-fg-tertiary">
            Window:
          </span>
          {SINCE_OPTIONS.map((opt) => (
            <button
              key={opt.v}
              type="button"
              onClick={() => setSinceDays(opt.v)}
              className={
                "inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border px-3 text-[12px] font-mono transition-colors " +
                (sinceDays === opt.v
                  ? "border-edge-strong bg-surface-interactive text-fg"
                  : "border-edge-subtle bg-canvas text-fg-tertiary hover:text-fg")
              }
            >
              {opt.label}
            </button>
          ))}
          <span className="ml-3 font-mono text-[11px] text-fg-tertiary">
            Sort:
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
        <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] text-fg-tertiary">
            Categories:
          </span>
          {ALL_CATS.map((cat) => {
            const meta = CATEGORY_META[cat];
            const count = payload && !readFailed ? (payload.counts[cat] ?? 0) : null;
            const active = activeCategories.has(cat);
            return (
              <button
                key={cat}
                type="button"
                onClick={() => toggleCategory(cat)}
                onDoubleClick={() => selectOnly(cat)}
                title={`Click to toggle. Double-click to isolate.`}
                className={
                  "inline-flex min-h-[44px] items-center gap-1 rounded-full border px-3 text-[12px] font-mono transition-colors " +
                  (active
                    ? meta.tint
                    : "border-edge-subtle bg-canvas text-fg-tertiary hover:text-fg")
                }
              >
                <span>{meta.label}</span>
                {count !== null && (
                  <>
                    <span className="opacity-70">·</span>
                    <AnimatedCounter value={count} />
                  </>
                )}
              </button>
            );
          })}
          {activeCategories.size !== ALL_CATS.length && (
            <button
              type="button"
              onClick={selectAll}
              className="ml-2 inline-flex min-h-[44px] items-center rounded-full border border-emerald-500/40 px-3 text-[12px] font-mono text-emerald-300 hover:bg-emerald-500/10"
            >
              Show all
            </button>
          )}
        </div>
      </section>

      <section className="mt-4 border-l-2 border-edge-strong pl-4 sm:pl-5">
        {/* W5b: one state block. A failed read (stale data kept by React Query included) is
            unknown with a Retry, never "no alerts" (skill empty-vs-error). */}
        {readFailed && (
          <div role="alert" className="flex flex-wrap items-center gap-x-4 gap-y-1 border-y border-edge py-2">
            <p className="text-[14px] text-fg-secondary">
              Couldn&apos;t load alerts: state unknown, not an empty list.
            </p>
            <button
              type="button"
              onClick={load}
              className="inline-flex min-h-[44px] items-center text-[14px] font-medium text-fg underline-offset-4 transition-colors duration-[var(--motion-state)] hover:underline"
            >
              Retry
            </button>
          </div>
        )}

        {!readFailed && !payload && (
          <p role="status" className="py-6 text-[14px] text-fg-tertiary">
            Reading alerts.
          </p>
        )}

        {!readFailed && payload && totalVisible === 0 && (
          <div className="py-6">
            <p className="text-[14px] text-fg">
              {totalAcrossAllCats === 0
                ? `No alerts in the last ${sinceDays} days.`
                : `No alerts match the active filters in the last ${sinceDays} days.`}
            </p>
            {totalAcrossAllCats > 0 && (
              <p className="mt-1 text-[13px] text-fg-tertiary">
                Toggle more categories above or expand the window to see them.
              </p>
            )}
          </div>
        )}

        {!readFailed && totalVisible > 0 && (
          <div className="space-y-5" data-selection-scope="system-alerts">
            <section aria-labelledby="alerts-priority-heading" className="space-y-2">
              <h2 id="alerts-priority-heading" className="text-[13px] font-medium text-fg-secondary">
                Priority
                <span className="ml-2 font-mono text-[12px] tabular-nums text-fg-tertiary">{priority.length}</span>
              </h2>
              {priority.length === 0 ? (
                <p className="text-[14px] text-fg-tertiary">No priority alerts in this view.</p>
              ) : (
                <ul className="divide-y divide-edge border-y border-edge">{priority.map(renderRow)}</ul>
              )}
            </section>
            {other.length > 0 && (
              <section aria-label="Other alerts" className="space-y-2">
                <button
                  type="button"
                  aria-expanded={otherOpen}
                  aria-controls="alerts-other-list"
                  onClick={() => setOtherOpen((v) => !v)}
                  className="inline-flex min-h-[44px] items-center gap-2 text-[14px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:text-fg"
                >
                  Other, {other.length}
                  <span className="font-mono text-[12px] text-fg-tertiary">{otherOpen ? "shown" : "hidden"}</span>
                </button>
                {otherOpen && (
                  <ul id="alerts-other-list" className="divide-y divide-edge border-y border-edge">
                    {other.map(renderRow)}
                  </ul>
                )}
              </section>
            )}
          </div>
        )}
      </section>
      {dismissing && (
        <AlertDismissSheet
          alert={{
            category: dismissing.category,
            key: dismissing.key,
            label: CATEGORY_META[dismissing.category]?.label ?? dismissing.category,
          }}
          pending={dismiss.isPending}
          onCancel={() => {
            if (!dismiss.isPending) setDismissing(null);
          }}
          onConfirm={(reason) => dismiss.mutate({ id: dismissing.id, reason })}
        />
      )}
    </StandardPage>
  );
}
