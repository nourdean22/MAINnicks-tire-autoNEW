"use client";

/**
 * GlobalActivityStream · v8.1 · Apr 29.
 *
 * Cross-session continuity surface: the last N entity-audit events
 * across the WHOLE personal-OS, regardless of entity or actor.
 *
 * Drops into /brain/continuity to give Nour a one-glance pulse of
 * "what's been happening in Nick's head" since he last looked.
 *
 *   · Auto-refreshes every 60s (cheap; the API caches at 30s upstream).
 *   · Action-tinted badges (created/updated/soft_deleted/restored).
 *   · Each row links to /system/history?type=&id= for the full diff.
 *   · Empty state explains the entity-audit story so the surface
 *     never reads as broken.
 */

import { useState } from "react";

// Phase B.6d (2026-05-22) · migrated off `authedFetch("/api/audit/
// entity?firehose=1&limit=N")` onto `trpc.brain.activityStream` ·
// reactive read · the 60s `setInterval` is now React Query's
// refetchInterval · the pagination "load older" still bumps the limit.
import { trpc } from "@/lib/trpc/client";
import { GlassCard } from "@/components/ui/glass-card";
interface ActivityEntry {
  id: string;
  entityType: string;
  entityId: string;
  action: "created" | "updated" | "soft_deleted" | "restored" | "purged";
  actor: string;
  reason: string | null;
  source: string | null;
  createdAt: string;
}

const ACTION_TINT: Record<ActivityEntry["action"], string> = {
  created: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  updated: "bg-blue-500/15 text-blue-300 ring-blue-500/30",
  soft_deleted: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  restored: "bg-violet-500/15 text-violet-300 ring-violet-500/30",
  purged: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
};

function tinyRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "now";
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`;
  return `${Math.round(ms / 86_400_000)}d`;
}

function formatActor(actor: string): string {
  if (actor === "user") return "you";
  if (actor === "nick") return "Nick";
  if (actor === "system") return "system";
  if (actor.startsWith("cron:")) return actor.slice(5);
  if (actor.startsWith("bridge:")) return `bridge·${actor.slice(7)}`;
  return actor;
}

export function GlobalActivityStream({ limit = 30 }: { limit?: number }) {
  // v8.6 BATCH 36 — pagination. `windowSize` grows by `limit` each
  // time Nour clicks "Load more". The query passes the current total
  // so the server gives us everything in one shot (cheap because the
  // entity_audits index is on (entityType, entityId, createdAt) — no
  // full scan).
  const [windowSize, setWindowSize] = useState(limit);

  // The 60s cadence the legacy `setInterval` provided is React Query's
  // refetchInterval · the windowSize bump re-keys the query.
  const activityQuery = trpc.brain.activityStream.useQuery(
    { limit: windowSize },
    { refetchInterval: 60_000 },
  );
  const entries =
    (activityQuery.data?.entries as ActivityEntry[] | undefined) ??
    (activityQuery.isError ? [] : null);
  const loading = activityQuery.isLoading;
  const error = activityQuery.isError
    ? activityQuery.error.message
    : null;
  // `loadingMore` is true while a bumped-windowSize fetch is in flight.
  const loadingMore = activityQuery.isFetching && !activityQuery.isLoading;

  if (loading) {
    return (
      <GlassCard className="p-4 text-sm text-zinc-500">
        Loading activity stream…
      </GlassCard>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-rose-800 bg-rose-950/40 p-4 text-sm text-rose-200">
        {error}
      </div>
    );
  }

  if (!entries || entries.length === 0) {
    return (
      <GlassCard className="p-6 text-center">
        <div className="text-sm font-medium text-zinc-300">No recorded activity yet</div>
        <p className="mt-1 text-xs text-zinc-500">
          Once tasks, missions, goals, or pinned memories change, every mutation
          shows up here as a queryable event. The audit trail came online with
          v8.0 Phase 2A.
        </p>
      </GlassCard>
    );
  }

  return (
    <GlassCard>
      <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-300">
          Activity stream · last {entries.length}
        </h3>
        {/* v8.3 alive-UI E2: small breathing dot + label so the
            "60s refresh" cadence is visible, not just declared. */}
        <span className="inline-flex items-center gap-1.5 text-[10px] text-zinc-600">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400/60 animate-ping" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
          </span>
          live · 60s
        </span>
      </header>
      <ol className="divide-y divide-zinc-800/60">
        {entries.map((e) => (
          <li
            key={e.id}
            className="flex items-center gap-3 px-4 py-2 text-sm"
          >
            <span
              className={
                "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 " +
                ACTION_TINT[e.action]
              }
            >
              {e.action.replace("_", " ")}
            </span>
            <span className="shrink-0 font-mono text-[11px] text-zinc-500">
              {tinyRelative(e.createdAt)}
            </span>
            <span className="shrink-0 text-zinc-400">{formatActor(e.actor)}</span>
            <span className="text-zinc-500">·</span>
            <a
              // 2026-08-12 · /system/history never existed (dead link) —
              // point at the Continuity tab's merged timeline instead.
              href="/brain?tab=continuity"
              className="truncate text-zinc-300 underline-offset-2 hover:text-zinc-100 hover:underline"
            >
              {e.entityType}
              <span className="ml-1 font-mono text-[11px] text-zinc-500">
                {e.entityId.slice(0, 12)}
              </span>
            </a>
            {e.reason && (
              <span className="ml-auto truncate text-[11px] text-zinc-500">
                {e.reason}
              </span>
            )}
          </li>
        ))}
      </ol>
      {/* v8.6 BATCH 36 — load more button. Disables when there's
          almost-certainly nothing more (entries.length < windowSize),
          so we don't burn a query when the firehose ran dry. */}
      {entries.length >= windowSize && (
        <div className="flex items-center justify-center border-t border-zinc-800 px-4 py-2">
          <button
            type="button"
            onClick={() => {
              setWindowSize((w) => Math.min(w + limit, 500));
            }}
            disabled={loadingMore || windowSize >= 500}
            className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 hover:text-zinc-100 disabled:opacity-40"
          >
            {loadingMore
              ? "loading…"
              : windowSize >= 500
                ? "max reached (500)"
                : `load older (+${limit})`}
          </button>
        </div>
      )}
    </GlassCard>
  );
}
