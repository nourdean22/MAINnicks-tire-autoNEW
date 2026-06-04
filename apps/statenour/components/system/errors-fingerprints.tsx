"use client";

/**
 * ErrorsFingerprints · v10.0.306 · grouped error-fingerprint deck.
 *
 * Extracted from app/(mastery)/system/errors/page.tsx as part of the
 * elon merge campaign · /system/errors deleted, this component now
 * mounts on /system/logs as a "GROUPED" view-mode tab so the operator
 * gets the deduplicated fingerprint deck without a separate page.
 *
 * Reads ErrorLog via /api/system/errors (supports grouped=true).
 *
 * Alive elements:
 *   · pulse dot on just-occurred errors (< 2min old)
 *   · severity tint (fatal=rose, error=rose/amber, warn=amber)
 *   · auto-refresh 30s
 *   · "N new since last refresh" badge when error count grows
 *   · per-row open-as-task action
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Panel } from "@/components/panel";
import { cn } from "@/lib/utils/cn";
import { toast } from "sonner";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { trpc } from "@/lib/trpc/client";
import { relativeTimeSeconds as timeAgo } from "@/lib/utils/datetime";

interface Grouped {
  message: string;
  count: number;
  lastSeen: string | null;
}

interface LogRow {
  id: string;
  level: string;
  message: string;
  stack: string | null;
  context: unknown;
  createdAt: string;
}

type Level = "all" | "fatal" | "error" | "warn";

function levelTint(level: string): string {
  const l = level.toLowerCase();
  if (l === "fatal") return "text-rose-400 bg-rose-500/10 border-rose-500/20";
  if (l === "error") return "text-rose-300 bg-rose-500/5 border-rose-500/10";
  if (l === "warn")  return "text-amber-300 bg-amber-500/5 border-amber-500/10";
  return "text-zinc-300 bg-zinc-500/5 border-zinc-500/10";
}

export function ErrorsFingerprints() {
  const [levelFilter, setLevelFilter] = useState<Level>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // prevTotalRef holds the total from the PRIOR successful fetch;
  // lastSeenUpdateRef de-dupes so the same fetch isn't counted twice.
  const prevTotalRef = useRef(0);
  const lastSeenTotalRef = useRef(0);
  const lastSeenUpdateRef = useRef(0);

  // Phase VV (2026-05-22) · REST→tRPC · the fingerprint deck + the
  // recent feed are two typed queries (system.errorsGrouped +
  // system.errorsRecent), each keyed on the level filter so switching
  // it re-fetches automatically. The legacy route multiplexed both off
  // one URL with `?grouped=true`; the procedures split them, and each
  // returns its payload directly (no `{data}` wrap). 30s auto-refresh
  // moves to refetchInterval.
  const level = levelFilter === "all" ? undefined : levelFilter;
  const groupedQuery = trpc.system.errorsGrouped.useQuery(
    { level },
    { refetchInterval: 30_000 },
  );
  const recentQuery = trpc.system.errorsRecent.useQuery(
    { level, pageSize: 50 },
    { refetchInterval: 30_000 },
  );
  const groups: Grouped[] = groupedQuery.data?.groups ?? [];
  const recent: LogRow[] = recentQuery.data?.data ?? [];
  const total = recentQuery.data?.total ?? 0;
  const loading = groupedQuery.isPending || recentQuery.isPending;
  const load = () => {
    void groupedQuery.refetch();
    void recentQuery.refetch();
  };

  // "N new since last refresh" — each time a genuinely new fetch lands
  // (dataUpdatedAt changed), roll the prior total forward. The old
  // imperative loader did this inside a setTotal callback; here an
  // effect keyed on dataUpdatedAt reproduces it exactly.
  useEffect(() => {
    const upd = recentQuery.dataUpdatedAt;
    if (upd && upd !== lastSeenUpdateRef.current) {
      prevTotalRef.current = lastSeenTotalRef.current;
      lastSeenTotalRef.current = recentQuery.data?.total ?? 0;
      lastSeenUpdateRef.current = upd;
    }
  }, [recentQuery.dataUpdatedAt, recentQuery.data]);
  const newSinceLast = total - prevTotalRef.current;

  const fatalCount = useMemo(
    () => groups.filter((g) => g.message.toLowerCase().includes("fatal")).length,
    [groups],
  );

  const toggleExpand = useCallback((id: string) => {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  // Phase VV (2026-05-22) · REST→tRPC · the "open as task" action wrote
  // to POST /api/tasks (the `task` domain · already migrated). It now
  // goes through trpc.task.create — the createTaskFromAPI service the
  // procedure delegates to does its own Zod validation on the payload.
  const createTaskMutation = trpc.task.create.useMutation();

  async function openAsTask(msg: string) {
    try {
      await createTaskMutation.mutateAsync({
        title: `investigate: ${msg.slice(0, 80)}`,
        notes: `Auto-created from /system/logs (errors view).\n\n${msg}`,
        priority: "normal",
        tags: ["ops", "investigate"],
      });
      toast.success("task created");
    } catch (e) {
      toast.error(
        `task creation failed: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  return (
    <div className="space-y-4">
      {/* Summary line */}
      <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)]/[0.04] px-3 py-2">
        <span className="text-xs text-[var(--text-secondary)]">
          {loading
            ? "loading…"
            : `${total} total · ${groups.length} unique fingerprints · ${fatalCount} fatal${
                newSinceLast > 0 ? ` · ${newSinceLast} new` : ""
              }`}
        </span>
        <button
          onClick={load}
          disabled={loading}
          className="rounded-lg border border-[var(--border-hover)] bg-[var(--bg-raised)]/5 px-3 py-1 text-xs font-medium text-[var(--text-secondary)] transition hover:bg-[var(--bg-raised)]/10 disabled:opacity-50"
        >
          {loading ? "refreshing…" : "refresh"}
        </button>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2">
        {(["all", "fatal", "error", "warn"] as Level[]).map((l) => (
          <button
            key={l}
            onClick={() => setLevelFilter(l)}
            className={cn(
              "rounded-full px-3 py-1 text-xs transition",
              levelFilter === l
                ? l === "all"
                  ? "bg-white/10 text-white"
                  : cn(levelTint(l), "border")
                : "bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800/60",
            )}
          >
            {l}
          </button>
        ))}
        {newSinceLast > 0 && (
          <span className="ml-auto rounded-full bg-rose-500/10 px-3 py-1 text-xs text-rose-300 animate-pulse">
            {newSinceLast} new since last refresh
          </span>
        )}
      </div>

      {/* Fingerprints (groups) */}
      <Panel className="border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02]">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Fingerprints · top 20</h2>
          <span className="text-xs text-[var(--text-tertiary)]">grouped by message</span>
        </div>
        {groups.length === 0 ? (
          <p className="text-xs text-[var(--text-tertiary)]">
            {loading ? "loading…" : "✅ no errors in the selected window"}
          </p>
        ) : (
          <div className="space-y-1">
            {groups.map((g, i) => (
              <div
                key={i}
                className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 rounded-lg border border-zinc-800/40 bg-[var(--bg-raised)]/[0.02] px-3 py-2 transition hover:border-zinc-700/60"
              >
                <span className="inline-flex h-6 min-w-[2rem] items-center justify-center rounded bg-rose-500/10 px-2 text-[10px] font-semibold text-rose-300 tabular-nums">
                  ×<AnimatedCounter value={g.count} duration={600} />
                </span>
                <span className="truncate font-mono text-xs text-zinc-300" title={g.message}>
                  {g.message}
                </span>
                <span className="text-[10px] text-zinc-500">{timeAgo(g.lastSeen)}</span>
                <button
                  onClick={() => openAsTask(g.message)}
                  className="rounded bg-white/[0.04] px-2 py-1 text-[10px] text-zinc-300 transition hover:bg-white/[0.08]"
                  title="open as task"
                >
                  → task
                </button>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* Recent feed */}
      <Panel className="border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02]">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Recent · last 50</h2>
          <span className="text-xs text-[var(--text-tertiary)]">click to expand</span>
        </div>
        {recent.length === 0 ? (
          <p className="text-xs text-[var(--text-tertiary)]">
            {loading ? "loading…" : "✅ no recent errors"}
          </p>
        ) : (
          <div className="space-y-1">
            {recent.map((row) => {
              const isOpen = expanded.has(row.id);
              const freshSeconds = (Date.now() - new Date(row.createdAt).getTime()) / 1000;
              const isFresh = freshSeconds < 120;
              return (
                <div
                  key={row.id}
                  className={cn(
                    "rounded-lg border px-3 py-2 transition",
                    levelTint(row.level),
                    isOpen ? "border-opacity-60" : "border-opacity-20 hover:border-opacity-40",
                  )}
                >
                  <button
                    onClick={() => toggleExpand(row.id)}
                    className="grid w-full grid-cols-[auto_auto_1fr_auto] items-center gap-3 text-left"
                  >
                    <span
                      className={cn(
                        "inline-block h-2 w-2 rounded-full",
                        row.level === "fatal" ? "bg-rose-400" : row.level === "warn" ? "bg-amber-400" : "bg-rose-300",
                        isFresh && "animate-pulse",
                      )}
                    />
                    <span className="rounded px-1.5 py-[1px] text-[9px] uppercase tracking-wider">
                      {row.level}
                    </span>
                    <span className="truncate font-mono text-xs">{row.message}</span>
                    <span className="text-[10px] opacity-70">{timeAgo(row.createdAt)}</span>
                  </button>
                  {isOpen && (
                    <div className="mt-2 space-y-2 border-t border-white/5 pt-2">
                      {row.stack && (
                        <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-black/40 p-2 text-[10px] text-zinc-400">
                          {row.stack}
                        </pre>
                      )}
                      {row.context !== null && row.context !== undefined && (
                        <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-black/30 p-2 text-[10px] text-zinc-500">
                          {JSON.stringify(row.context, null, 2)}
                        </pre>
                      )}
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => openAsTask(row.message)}
                          className="rounded bg-white/[0.04] px-2 py-1 text-[10px] text-zinc-300 transition hover:bg-white/[0.08]"
                        >
                          open as task
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <p className="pt-2 text-center text-[10px] text-zinc-600">
        auto-refresh 30s · source: ErrorLog + /api/system/errors
      </p>
    </div>
  );
}
