"use client";

/**
 * /system/coach-events · Wave AU · 2026-05-28.
 *
 * Historical viewer for the Coach Channel. The reader-side `includeAcked`
 * flag was plumbed in Wave Y but no surface consumed it · 9 detectors
 * write events that vanish after ack, with no way to audit what fired
 * or replay the channel.
 *
 * What this surface gives the operator:
 *   · last 50 events across all 5 daily-driver surfaces
 *   · filter by surface · kind · priority · acked
 *   · grouped by surface · color-coded by priority (P0 amber · P1 gold
 *     · P2 neutral) matching the in-page CoachEventBanner
 *   · ack/expire metadata visible · helps debug detector misfires
 *
 * NOT a manual fan-out tool · this is read-only. Acking still flows
 * through POST /api/coach/events/:key/ack from the per-surface banners.
 *
 * Pure REST · no tRPC procedure for coach-events (the surface endpoint
 * is a thin wrapper around getActiveCoachEvents) · usePollingFetch
 * mirrors the CoachEventBanner pattern.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { StandardPage } from "@/components/layout/standard-page";
import { usePollingFetch } from "@/hooks/use-polling-fetch";
import { useLocalStorageState } from "@/hooks/use-local-storage-state";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { SortDropdown } from "@/components/ui/sort-dropdown";
import { cn } from "@/lib/utils";
import type {
  CoachEvent,
  CoachEventKind,
  CoachEventPriority,
  CoachEventSurface,
} from "@/lib/services/coach-events-types";

interface CoachEventsResponse {
  events: CoachEvent[];
}

const SURFACE_OPTIONS: ReadonlyArray<{
  value: CoachEventSurface | "all";
  label: string;
}> = [
  { value: "all", label: "all surfaces" },
  { value: "tasks", label: "tasks" },
  { value: "goals", label: "goals" },
  { value: "journal", label: "journal" },
  { value: "brain", label: "brain" },
  { value: "scoreboard", label: "scoreboard" },
];

const PRIORITY_OPTIONS: ReadonlyArray<{
  value: CoachEventPriority | "all";
  label: string;
}> = [
  { value: "all", label: "all priorities" },
  { value: "P0", label: "P0 · critical" },
  { value: "P1", label: "P1 · attention" },
  { value: "P2", label: "P2 · info" },
];

const PRIORITY_TONE: Record<CoachEventPriority, string> = {
  P0: "border-amber-500/40 bg-amber-500/[0.06] text-amber-200",
  P1: "border-[var(--gold)]/30 bg-[var(--gold)]/[0.04] text-[var(--gold)]",
  P2: "border-[var(--border-default)] bg-[var(--bg-raised)]/[0.04] text-[var(--text-secondary)]",
};

const KIND_LABEL: Record<CoachEventKind, string> = {
  "pricing-advisory": "pricing advisory",
  "prune-candidate": "prune candidate",
  "drift-recovery": "drift recovery",
  "idle-nudge": "idle nudge",
  "goal-pace-shift": "goal pace shift",
  "mission-deadline-check": "mission deadline",
  "proactive-nick": "proactive nick",
  anomaly: "anomaly",
  "system-alert": "system alert",
};

function formatRelative(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const diff = (Date.now() - t) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

export default function CoachEventsPage() {
  const [surfaceFilter, setSurfaceFilter] = useLocalStorageState<
    CoachEventSurface | "all"
  >(
    "coach-events:surface",
    "all",
    SURFACE_OPTIONS.map((o) => o.value),
  );
  const [priorityFilter, setPriorityFilter] = useLocalStorageState<
    CoachEventPriority | "all"
  >(
    "coach-events:priority",
    "all",
    PRIORITY_OPTIONS.map((o) => o.value),
  );
  const [includeAcked, setIncludeAcked] = useState(true);

  // Build query · server filters surface + acked, client filters priority +
  // groups by surface for the layout. Bumped limit to 50 (server caps 100).
  const qs = new URLSearchParams({
    limit: "50",
    includeAcked: includeAcked ? "1" : "0",
  });
  if (surfaceFilter !== "all") qs.set("surface", surfaceFilter);
  const { data, loading, error, reload } = usePollingFetch<CoachEventsResponse>(
    `/api/coach/events?${qs.toString()}`,
    { intervalMs: 30_000 },
  );

  const filteredEvents = useMemo(() => {
    if (!data?.events) return [];
    return priorityFilter === "all"
      ? data.events
      : data.events.filter((e) => e.priority === priorityFilter);
  }, [data, priorityFilter]);

  const groupedBySurface = useMemo(() => {
    const map = new Map<CoachEventSurface | "global", CoachEvent[]>();
    for (const ev of filteredEvents) {
      // Events with empty surfaces[] render everywhere · treat as "global".
      const keys: Array<CoachEventSurface | "global"> =
        ev.surfaces.length > 0 ? ev.surfaces : ["global"];
      for (const k of keys) {
        if (!map.has(k)) map.set(k, []);
        map.get(k)!.push(ev);
      }
    }
    return map;
  }, [filteredEvents]);

  const counts = useMemo(() => {
    const c = { total: 0, P0: 0, P1: 0, P2: 0, acked: 0 };
    for (const ev of data?.events ?? []) {
      c.total += 1;
      c[ev.priority] += 1;
      if (ev.ackedAt) c.acked += 1;
    }
    return c;
  }, [data]);

  return (
    <StandardPage
      eyebrow="system · observability"
      title="coach events"
      description="Historical viewer for the unified Coach Channel · 9 detectors write here · 5 surfaces consume · filter, group, debug"
      rhythm="comfortable"
      width="2xl"
      actions={
        <FreshnessChip
          lastFetchedAt={data?.events?.[0]?.updatedAt}
          source="coach channel"
          onReload={reload}
        />
      }
    >
      {/* Counts row */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="total" value={counts.total} tint="text-[var(--text-primary)]" />
        <Stat
          label="P0"
          value={counts.P0}
          tint={counts.P0 > 0 ? "text-amber-300" : "text-zinc-500"}
        />
        <Stat
          label="P1"
          value={counts.P1}
          tint={counts.P1 > 0 ? "text-[var(--gold)]" : "text-zinc-500"}
        />
        <Stat label="acked" value={counts.acked} tint="text-[var(--text-tertiary)]" />
      </div>

      {/* Filters */}
      <section className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] px-3 py-3 flex flex-wrap items-center gap-3">
        <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
          filter
        </span>
        <SortDropdown
          value={surfaceFilter}
          onChange={(v) => setSurfaceFilter(v as CoachEventSurface | "all")}
          ariaLabel="Filter by surface"
          options={SURFACE_OPTIONS.map((o) => ({
            value: o.value,
            label: o.label,
          }))}
        />
        <SortDropdown
          value={priorityFilter}
          onChange={(v) => setPriorityFilter(v as CoachEventPriority | "all")}
          ariaLabel="Filter by priority"
          options={PRIORITY_OPTIONS.map((o) => ({
            value: o.value,
            label: o.label,
          }))}
        />
        <label className="inline-flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.15em] text-[var(--text-secondary)] cursor-pointer min-h-[44px]">
          <input
            type="checkbox"
            checked={includeAcked}
            onChange={(e) => setIncludeAcked(e.target.checked)}
            className="h-4 w-4 rounded border-[var(--border-default)] bg-[var(--bg-raised)] text-[var(--gold)]"
          />
          include acked
        </label>
      </section>

      {/* Loading / error / empty */}
      {loading && !data && (
        <div className="text-sm text-[var(--text-tertiary)]">
          loading coach events…
        </div>
      )}
      {error && !data && (
        <div className="text-sm text-rose-300">
          coach channel unavailable · tap reload
        </div>
      )}
      {data && filteredEvents.length === 0 && (
        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)] p-6 text-center text-sm text-[var(--text-tertiary)]">
          no coach events match the current filters · channel may be quiet ·
          try removing surface or priority filters or toggle "include acked"
        </div>
      )}

      {/* Grouped event list */}
      {groupedBySurface.size > 0 && (
        <div className="space-y-4">
          {Array.from(groupedBySurface.entries()).map(([surface, events]) => (
            <section
              key={surface}
              aria-label={`${surface} coach events`}
              className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)]"
            >
              <header className="px-3 py-2.5 border-b border-[var(--border-default)]/60 flex items-center gap-2">
                <h2 className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
                  {surface}
                </h2>
                <span className="text-[9px] font-mono tabular-nums text-[var(--text-tertiary)]/70">
                  {events.length}
                </span>
              </header>
              <ul className="divide-y divide-[var(--border-default)]/40">
                {events.map((ev) => (
                  <CoachEventRow key={ev.eventId} ev={ev} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </StandardPage>
  );
}

function CoachEventRow({ ev }: { ev: CoachEvent }) {
  const tone = PRIORITY_TONE[ev.priority];
  return (
    <li className="px-3 py-3">
      <div className="flex items-start gap-2 flex-wrap">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-[0.15em] shrink-0",
            tone,
          )}
        >
          {ev.priority}
        </span>
        <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-[var(--text-tertiary)] shrink-0">
          {KIND_LABEL[ev.kind]}
        </span>
        {ev.ackedAt && (
          <span className="text-[9px] font-mono uppercase tracking-[0.15em] text-zinc-500 shrink-0">
            acked · {formatRelative(ev.ackedAt)}
          </span>
        )}
        <span className="ml-auto text-[10px] font-mono tabular-nums text-[var(--text-tertiary)]">
          {formatRelative(ev.createdAt)}
        </span>
      </div>
      <p className="mt-1.5 text-[13px] text-[var(--text-primary)] leading-snug">
        {ev.title}
      </p>
      {ev.body && (
        <p className="mt-1 text-[12px] text-[var(--text-secondary)] leading-snug">
          {ev.body}
        </p>
      )}
      <div className="mt-1.5 flex items-center gap-3 flex-wrap text-[10px] font-mono text-[var(--text-tertiary)]/80">
        <span>subject · {ev.subjectId}</span>
        {ev.deepLink && (
          <Link
            href={ev.deepLink}
            className="text-[var(--gold)]/80 hover:text-[var(--gold)] transition-colors"
          >
            → open
          </Link>
        )}
        {ev.expiresAt && (
          <span>expires · {formatRelative(ev.expiresAt)}</span>
        )}
      </div>
    </li>
  );
}

function Stat({
  label,
  value,
  tint,
}: {
  label: string;
  value: number;
  tint: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)] p-3 text-center">
      <div className={cn("text-2xl font-bold font-mono tabular-nums", tint)}>
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
        {label}
      </div>
    </div>
  );
}
