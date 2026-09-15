"use client";

/**
 * CronInspector · a scheduled job as an object · 2026-09-15 (System flagship).
 *
 * Two reads, both already served to /system/crons: the deck row (schedule,
 * mode, enabled, description — `systemAutomation.cronDeck`, the page's own
 * 30s-cached query, so opening the inspector from the page costs nothing)
 * and the run history (`systemAutomation.cronRunHistory`, the same builder the
 * per-job runs view uses). Read-only: run-now and the kill switch stay on
 * the row, where their pending state and confirm already live.
 *
 * Honest states: a name the deck does not know → not-found; a failed read →
 * error; a job with no runs in the window → a ZERO empty state that says
 * "no runs", never a 100% success rate over nothing (successRate is null).
 */

import { History } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { errorCodeOf } from "@/lib/services/metric-result";
import { formatAge } from "@/lib/ui/metric-datum";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { Metric } from "@/components/ui/metric";
import { InspectorNotice } from "@/components/inspector/inspector-notice";
import { EntityActionRow } from "@/components/inspector/entity-action-row";
import type { InspectorPanelProps } from "@/components/inspector/panels/memory-inspector";

export const CRON_HISTORY_DAYS = 7;
export const CRON_HISTORY_LIMIT = 12;

interface DeckRow {
  name: string;
  schedule: string | null;
  mode: string;
  category: string;
  description: string;
  enabled: boolean;
  foldedInto?: string;
  lastRunAt: string | null;
  lastStatus: string | null;
  nextRunAt: string | null;
  drift: number | null;
}

const STATUS_TONE: Record<string, string> = {
  success: "bg-emerald-400",
  partial: "bg-amber-400",
  failed: "bg-rose-400",
  error: "bg-rose-400",
};

export function CronInspector({ entity }: InspectorPanelProps) {
  const deck = trpc.systemAutomation.cronDeck.useQuery(undefined, { staleTime: 30_000, retry: 1 });
  const history = trpc.systemAutomation.cronRunHistory.useQuery(
    { jobName: entity.id, sinceDays: CRON_HISTORY_DAYS, limit: CRON_HISTORY_LIMIT },
    { staleTime: 15_000, retry: 1 },
  );
  const now = new Date();

  if (deck.isLoading || history.isLoading) return <InspectorNotice state="loading" kind="cron" />;
  if (deck.isError) return <InspectorNotice state="error" kind="cron" code={errorCodeOf(deck.error)} />;
  const rows = ((deck.data as { rows?: DeckRow[] } | undefined)?.rows ?? []) as DeckRow[];
  const row = rows.find((r) => r.name === entity.id) ?? null;
  if (!row) {
    return (
      <div className="space-y-4">
        <InspectorNotice state="not-found" kind="cron" />
        <EntityActionRow entities={[entity]} />
      </div>
    );
  }

  const h = history.data;
  const measuredAt = h?.generatedAt ?? now.toISOString();

  return (
    <div className="space-y-5" data-cron-inspector={row.name}>
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "rounded border px-1.5 py-px font-mono text-[10px] uppercase tracking-wide",
              row.enabled ? "border-edge text-fg-tertiary" : "border-amber-500/30 bg-amber-500/10 text-amber-300",
            )}
          >
            {row.mode === "folded" ? `folded → ${row.foldedInto ?? "?"}` : row.mode}
            {!row.enabled && row.mode === "active" ? " · killed" : ""}
          </span>
          <span className="rounded border border-edge px-1.5 py-px font-mono text-[10px] uppercase tracking-wide text-fg-tertiary">{row.category}</span>
          {row.drift !== null && row.drift > 0 ? (
            <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-px font-mono text-[10px] uppercase tracking-wide text-amber-300">
              drifted {row.drift}m
            </span>
          ) : null}
        </div>
        <h2 className="font-display text-xl font-bold leading-tight text-fg">{row.name}</h2>
        <p className="text-[13px] leading-relaxed text-fg-secondary">{row.description}</p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[11px] text-fg-tertiary">
          <div>
            <dt className="uppercase tracking-[0.14em]">schedule</dt>
            <dd className="text-fg-secondary">{row.schedule ?? "—"}</dd>
          </div>
          <div>
            <dt className="uppercase tracking-[0.14em]">last run</dt>
            <dd className="text-fg-secondary">
              {row.lastRunAt ? `${formatAge(row.lastRunAt, now)}${row.lastStatus ? ` · ${row.lastStatus}` : ""}` : "never"}
            </dd>
          </div>
          <div>
            <dt className="uppercase tracking-[0.14em]">next run</dt>
            <dd className="text-fg-secondary">{row.nextRunAt ? formatAge(row.nextRunAt, now).replace(" ago", "") : "—"}</dd>
          </div>
        </dl>
      </header>

      <section aria-label="Runs" data-cron-runs={h ? h.counts.total : "unread"}>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-tertiary">last {CRON_HISTORY_DAYS}d</p>
        {history.isError ? (
          <InspectorNotice state="error" kind="cron" code={errorCodeOf(history.error)} />
        ) : !h ? null : h.counts.total === 0 ? (
          <EmptyState
            provenance="ZERO"
            icon={History}
            title={`No runs in the last ${CRON_HISTORY_DAYS}d`}
            why={row.mode === "active" && row.enabled ? "The log has nothing for this name in the window — expected only if its schedule is longer than a week." : "Not scheduled to fire on its own."}
          />
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <Metric
                now={now}
                result={
                  h.successRate === null
                    ? { status: "unavailable", source: "cron_job_log", errorCode: "NO_RUNS" }
                    : { status: "ok", value: h.successRate, measuredAt, source: "cron_job_log", sampleSize: h.counts.total }
                }
                spec={{ label: "success", unit: "%", range: { lo: 95, hi: 100 }, higherIsBetter: true, window: `${CRON_HISTORY_DAYS}d` }}
              />
              <Metric
                now={now}
                result={h.median === null ? { status: "unavailable", source: "cron_job_log", errorCode: "NO_SUCCESS" } : { status: "ok", value: h.median, measuredAt, source: "cron_job_log" }}
                spec={{ label: "median", unit: "ms", higherIsBetter: false }}
              />
              <Metric
                now={now}
                result={h.p95 === null ? { status: "unavailable", source: "cron_job_log", errorCode: "NO_SUCCESS" } : { status: "ok", value: h.p95, measuredAt, source: "cron_job_log" }}
                spec={{ label: "p95", unit: "ms", higherIsBetter: false }}
              />
            </div>
            <p className="font-mono text-[11px] text-fg-tertiary">
              {h.counts.total} runs · {h.counts.success} ok · {h.counts.fail} failed
            </p>
            <ul className="divide-y divide-white/5">
              {h.runs.map((r) => (
                <li key={r.id} className="flex items-start gap-2 py-1.5 font-mono text-[11px]" data-cron-run={r.status}>
                  <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", STATUS_TONE[r.status] ?? "bg-zinc-500")} aria-hidden />
                  <span className="w-[4.5rem] shrink-0 text-fg-tertiary">{formatAge(r.createdAt, now)}</span>
                  <span className="w-14 shrink-0 text-fg-secondary">{r.durationMs !== null ? `${r.durationMs}ms` : "—"}</span>
                  <span className={cn("min-w-0 flex-1 truncate", r.errorPreview ? "text-rose-300" : "text-fg-tertiary")}>
                    {r.errorPreview ?? r.status}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <EntityActionRow entities={[entity]} labelOf={() => row.name} />
      <p className="font-mono text-[10px] text-fg-tertiary">run now · kill switch stay on the /system/crons row, where their confirm lives</p>
    </div>
  );
}
