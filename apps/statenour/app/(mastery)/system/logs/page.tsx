"use client";

/**
 * /system/logs — CANONICAL retrospective log explorer.
 *
 * v10.0.80 · positioned as the canonical "what happened" surface.
 * v10.0.304 · /system/events sister page deleted (real-time HUD UX
 *             didn't earn its 404 LOC).
 * v10.0.306 · /system/errors absorbed as a "GROUPED" view-mode tab ·
 *             ErrorsFingerprints component renders the deduped
 *             fingerprint deck inline. One canonical surface for
 *             "what happened" with two views: STREAM (default) and
 *             GROUPED ERRORS.
 *
 * Merges ErrorLog + CronJobLog + SystemMetric + AutonomousAction +
 * ApiRequestLog (4xx/5xx only) into one chronological stream.
 *
 * Controls (STREAM mode):
 *   · source chips (filter by writer)
 *   · level chips (error/warn/success/info/metric)
 *   · window pills (5m/1h/24h)
 *   · auto-refresh toggle (10s)
 *   · "new since last refresh" amber-pulse badge
 *
 * GROUPED mode:
 *   · top-20 error fingerprints (deduped by message)
 *   · 50 most recent error rows (expandable for stack/context)
 *   · per-row open-as-task action
 */

import { Suspense, useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Panel } from "@/components/panel";
import { StandardPage } from "@/components/layout/standard-page";
import { SortDropdown } from "@/components/ui/sort-dropdown";
import { cn } from "@/lib/utils/cn";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { ErrorsFingerprints } from "@/components/system/errors-fingerprints";
import { trpc } from "@/lib/trpc/client";

type Level = "error" | "warn" | "info" | "success" | "metric";
type Source = "errors" | "crons" | "metrics" | "actions" | "requests";

const LEVEL_RANK: Record<string, number> = { error: 0, warn: 1, info: 2, debug: 3 };

interface LogEntry {
  id: string;
  ts: string;
  source: Source;
  level: Level;
  label: string;
  detail: string | null;
  meta?: Record<string, unknown>;
}

interface Feed {
  entries: LogEntry[];
  summary: {
    total: number;
    byLevel: Record<string, number>;
    bySource: Record<string, number>;
    sinceMs: number;
  };
  generatedAt: string;
}

type Window = "5m" | "1h" | "24h";
const WINDOW_MS: Record<Window, number> = {
  "5m": 5 * 60_000,
  "1h": 60 * 60_000,
  "24h": 24 * 60 * 60_000,
};

const SOURCE_TINT: Record<Source, string> = {
  errors:   "text-rose-300",
  crons:    "text-violet-300",
  metrics:  "text-sky-300",
  actions:  "text-fuchsia-300",
  requests: "text-amber-300",
};

const LEVEL_DOT: Record<Level, string> = {
  error:   "bg-rose-400",
  warn:    "bg-amber-400",
  info:    "bg-sky-400",
  success: "bg-emerald-400",
  metric:  "bg-fg-tertiary",
};

const LEVEL_TEXT: Record<Level, string> = {
  error:   "text-rose-300",
  warn:    "text-amber-300",
  info:    "text-sky-300",
  success: "text-emerald-300",
  metric:  "text-fg-secondary",
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 1000) return "now";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  return `${Math.round(ms / 3_600_000)}h ago`;
}

type ViewMode = "stream" | "errors";

// v10.0.306 · Next 16 requires useSearchParams to be wrapped in
// Suspense to keep static-export prerender happy. Default export is
// the Suspense shell · LogsPageInner has the actual page logic.
export default function LogsPage() {
  return (
    <Suspense fallback={null}>
      <LogsPageInner />
    </Suspense>
  );
}

function LogsPageInner() {
  const [win, setWin] = useState<Window>("1h");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [levelFilter, setLevelFilter] = useState<Level | "all">("all");
  const [sourceFilter, setSourceFilter] = useState<Set<Source>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [newSince, setNewSince] = useState(0);
  // v10.0.306 · view-mode toggle · STREAM (default chronological) or
  // ERRORS (deduped fingerprint deck, absorbed from deleted
  // /system/errors page). Initial state honors ?view=errors URL param
  // so deep-links from HQ ErrorsCard + nav-items + command-palette
  // land on the grouped view directly.
  const params = useSearchParams();
  const initialView: ViewMode = params?.get("view") === "errors" ? "errors" : "stream";
  const [view, setView] = useState<ViewMode>(initialView);
  // v10.0.437 · sort key for the log stream · localStorage-persisted ·
  // 5 modes · default = newest-first (the natural log order).
  type LogSort = "newest" | "oldest" | "worst-level" | "source-alpha" | "label-alpha";
  const [sortKey, setSortKey] = useState<LogSort>(() => {
    if (typeof window === "undefined") return "newest";
    const saved = window.localStorage.getItem("system-logs:sortKey");
    const valid: LogSort[] = ["newest", "oldest", "worst-level", "source-alpha", "label-alpha"];
    return saved && valid.includes(saved as LogSort) ? (saved as LogSort) : "newest";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("system-logs:sortKey", sortKey);
  }, [sortKey]);

  // Phase B.7b · React Query drives the unified-tail fetch (was a
  // manual authedFetch with an AbortController + `cache: "no-store"`).
  // The input object is the query key, so changing the window / level
  // / source filters refetches; `refetchInterval` reproduces the 10s
  // auto-refresh poll (only while the toggle is on). The Feed shape
  // flows from the procedure (SystemMetric/ErrorLog Json columns are
  // nested under each entry's `meta` bag · TS2589 firewall).
  const logsQuery = trpc.system.systemLogs.useQuery(
    {
      limit: 300,
      sinceMs: WINDOW_MS[win],
      level: levelFilter === "all" ? undefined : levelFilter,
      sources: sourceFilter.size > 0 ? [...sourceFilter] : undefined,
    },
    {
      staleTime: 0,
      refetchInterval: autoRefresh ? 10_000 : false,
    },
  );
  const feed = logsQuery.data ?? null;
  const loading = logsQuery.isLoading;
  const load = () => void logsQuery.refetch();

  // The "N new since last refresh" amber pulse · compares the entry
  // count against the prior render's count (was a setFeed-time diff).
  const prevTotalRef = useRef(0);
  useEffect(() => {
    if (!feed) {
      return;
    }
    const total = feed.entries.length;
    if (total > prevTotalRef.current && prevTotalRef.current > 0) {
      setNewSince(total - prevTotalRef.current);
      const t = setTimeout(() => setNewSince(0), 5000);
      prevTotalRef.current = total;
      return () => clearTimeout(t);
    }
    prevTotalRef.current = total;
    return undefined;
  }, [feed]);

  const sortedEntries = useMemo(() => {
    if (!feed) return [] as LogEntry[];
    const out = [...feed.entries];
    switch (sortKey) {
      case "oldest":
        out.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
        break;
      case "worst-level":
        out.sort((a, b) => (LEVEL_RANK[a.level] ?? 9) - (LEVEL_RANK[b.level] ?? 9));
        break;
      case "source-alpha":
        out.sort((a, b) => a.source.localeCompare(b.source));
        break;
      case "label-alpha":
        out.sort((a, b) => a.label.localeCompare(b.label));
        break;
      case "newest":
      default:
        out.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
        break;
    }
    return out;
  }, [feed, sortKey]);

  const toggleSource = (s: Source) => {
    setSourceFilter((prev) => {
      const n = new Set(prev);
      if (n.has(s)) n.delete(s);
      else n.add(s);
      return n;
    });
  };

  const toggleExpand = useCallback((id: string) => {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const summary = useMemo(() => {
    if (!feed) return { total: 0, err: 0, warn: 0 };
    return {
      total: feed.summary.total,
      err: feed.summary.byLevel.error ?? 0,
      warn: feed.summary.byLevel.warn ?? 0,
    };
  }, [feed]);

  return (
    <StandardPage
      eyebrow="NOUR OS · System"
      title="Logs"
      description={
        feed
          ? `${summary.total} entries in last ${win} · ${summary.err} errors · ${summary.warn} warnings${newSince > 0 ? ` · ${newSince} new` : ""}`
          : "loading…"
      }
      width="2xl"
      rhythm="comfortable"
      className="px-3 py-4 sm:px-4 sm:py-6"
      actions={
          <div className="flex items-center gap-2">
            {/* v10.0.306 · view-mode toggle · replaces stale /events
                cross-link (deleted v10.0.304) and absorbs the deleted
                /system/errors page as a GROUPED view */}
            <div className="hidden sm:flex items-center gap-0 rounded-surface border border-edge-subtle overflow-hidden">
              <button
                onClick={() => setView("stream")}
                className={cn(
                  "px-2.5 py-1.5 text-xs font-medium transition",
                  view === "stream"
                    ? "bg-white/[0.08] text-fg"
                    : "text-fg-secondary hover:text-fg hover:bg-surface-interactive",
                )}
                title="Chronological stream · 5 sources · windowed query"
              >
                stream
              </button>
              <button
                onClick={() => setView("errors")}
                className={cn(
                  "px-2.5 py-1.5 text-xs font-medium transition border-l border-edge-subtle",
                  view === "errors"
                    ? "bg-rose-500/15 text-rose-200"
                    : "text-fg-secondary hover:text-rose-200 hover:bg-rose-500/[0.06]",
                )}
                title="Grouped error fingerprints · deduped · per-row open-as-task"
              >
                grouped errors
              </button>
            </div>
            <FreshnessChip
              lastFetchedAt={feed?.generatedAt}
              source="unified tail · 5 tables"
              onReload={load}
            />
            <button
              onClick={() => setAutoRefresh((v) => !v)}
              className={cn(
                "rounded-control border px-3 py-2 text-xs font-medium transition",
                autoRefresh
                  ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-200"
                  : "border-edge-default bg-content text-fg-secondary",
              )}
            >
              {autoRefresh ? "● auto 10s" : "○ paused"}
            </button>
            <button
              onClick={load}
              disabled={loading}
              className="rounded-control border border-edge-strong bg-content px-3 py-2 text-xs font-medium text-fg-secondary transition hover:bg-surface-hover disabled:opacity-50"
            >
              {loading ? "…" : "refresh"}
            </button>
          </div>
        }
    >

      {/* v10.0.306 · GROUPED view · render the absorbed /errors deck
          and short-circuit (skip the stream filters/feed below). */}
      {view === "errors" ? (
        <ErrorsFingerprints />
      ) : (
      <>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {(["5m", "1h", "24h"] as Window[]).map((w) => (
          <button
            key={w}
            onClick={() => setWin(w)}
            className={cn(
              "rounded-full px-3 py-1 text-xs transition",
              win === w ? "bg-sky-500/15 text-sky-200" : "bg-content text-fg-secondary hover:bg-surface-hover",
            )}
          >
            {w}
          </button>
        ))}
        <span className="text-xs text-fg-tertiary">·</span>
        <button
          onClick={() => setLevelFilter("all")}
          className={cn(
            "rounded-full px-3 py-1 text-xs transition",
            levelFilter === "all" ? "bg-surface-interactive text-fg" : "bg-content text-fg-secondary hover:bg-surface-hover",
          )}
        >
          all levels
        </button>
        {(["error", "warn", "success", "info", "metric"] as Level[]).map((l) => (
          <button
            key={l}
            onClick={() => setLevelFilter(l === levelFilter ? "all" : l)}
            className={cn(
              "rounded-full px-3 py-1 text-xs transition",
              levelFilter === l ? "bg-surface-interactive" : "bg-content hover:bg-surface-hover",
              LEVEL_TEXT[l],
            )}
          >
            {l} · <AnimatedCounter value={feed?.summary.byLevel[l] ?? 0} />
          </button>
        ))}
        <span className="text-xs text-fg-tertiary">·</span>
        {(["errors", "crons", "metrics", "actions", "requests"] as Source[]).map((s) => (
          <button
            key={s}
            onClick={() => toggleSource(s)}
            className={cn(
              "rounded-full px-3 py-1 text-xs transition",
              sourceFilter.has(s) || sourceFilter.size === 0
                ? cn("bg-surface-interactive", SOURCE_TINT[s])
                : "bg-content text-fg-secondary hover:bg-surface-hover",
            )}
          >
            {s} · <AnimatedCounter value={feed?.summary.bySource[s] ?? 0} />
          </button>
        ))}
        {/* v10.0.437 · sort dropdown · 5 modes · default = newest first */}
        <div className="ml-auto">
          <SortDropdown<LogSort>
            value={sortKey}
            onChange={setSortKey}
            defaultValue="newest"
            ariaLabel="Sort log entries"
            options={[
              { value: "newest", label: "newest first" },
              { value: "oldest", label: "oldest first" },
              { value: "worst-level", label: "level · worst" },
              { value: "source-alpha", label: "source · A→Z" },
              { value: "label-alpha", label: "label · A→Z" },
            ]}
          />
        </div>
      </div>

      {/* Live tail */}
      <Panel className="border-edge-default">
        {!feed || feed.entries.length === 0 ? (
          <p className="py-8 text-center text-xs text-fg-tertiary">
            {loading ? "tailing…" : `no entries in the last ${win} · bump window or clear filters`}
          </p>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {sortedEntries.map((e, i) => {
              const isOpen = expanded.has(e.id);
              const isFresh = i < newSince;
              return (
                <div
                  key={e.id}
                  className={cn(
                    "grid grid-cols-[auto_auto_auto_1fr_auto] items-center gap-3 px-3 py-2 transition",
                    isFresh && "bg-emerald-500/[0.03]",
                    isOpen && "",
                  )}
                >
                  <span className={cn("inline-block h-2 w-2 rounded-full flex-shrink-0", LEVEL_DOT[e.level])} />
                  <span className={cn("font-mono text-[11px] w-16 flex-shrink-0", SOURCE_TINT[e.source])}>
                    {e.source}
                  </span>
                  <span className={cn("font-mono text-[11px] w-14 flex-shrink-0", LEVEL_TEXT[e.level])}>
                    {e.level}
                  </span>
                  <button
                    onClick={() => e.detail && toggleExpand(e.id)}
                    className={cn("min-w-0 text-left", e.detail && "hover:underline")}
                  >
                    <div className="truncate font-mono text-[11px] text-fg">{e.label}</div>
                    {isOpen && e.detail && (
                      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words rounded bg-content p-2 text-[11px] text-fg-secondary">
                        {e.detail}
                      </pre>
                    )}
                    {isOpen && e.meta && Object.keys(e.meta).length > 0 && (
                      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words rounded bg-content p-2 text-[11px] text-fg-tertiary">
                        {JSON.stringify(e.meta, null, 2)}
                      </pre>
                    )}
                  </button>
                  <span className="flex-shrink-0 font-mono text-[11px] text-fg-tertiary">{timeAgo(e.ts)}</span>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <p className="pt-2 text-center text-[11px] text-fg-tertiary">
        {autoRefresh ? "auto-refresh 10s · " : ""}source: ErrorLog + CronJobLog + SystemMetric + AutonomousAction + ApiRequestLog
      </p>

      </>
      )}
    </StandardPage>
  );
}
