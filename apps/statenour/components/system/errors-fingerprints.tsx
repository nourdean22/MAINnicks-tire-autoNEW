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
import { authedFetch } from "@/hooks/use-authed-fetch";

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

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

function levelTint(level: string): string {
  const l = level.toLowerCase();
  if (l === "fatal") return "text-rose-400 bg-rose-500/10 border-rose-500/20";
  if (l === "error") return "text-rose-300 bg-rose-500/5 border-rose-500/10";
  if (l === "warn")  return "text-amber-300 bg-amber-500/5 border-amber-500/10";
  return "text-zinc-300 bg-zinc-500/5 border-zinc-500/10";
}

export function ErrorsFingerprints() {
  const [groups, setGroups] = useState<Grouped[]>([]);
  const [recent, setRecent] = useState<LogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [levelFilter, setLevelFilter] = useState<Level>("all");
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const prevCountRef = useRef(0);
  const fetchRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    fetchRef.current?.abort();
    const ac = new AbortController();
    fetchRef.current = ac;

    try {
      const levelQuery = levelFilter !== "all" ? `&level=${levelFilter}` : "";
      const [gRes, rRes] = await Promise.all([
        authedFetch(`/api/system/errors?grouped=true${levelQuery}`, { signal: ac.signal, cache: "no-store" }),
        authedFetch(`/api/system/errors?pageSize=50${levelQuery}`, { signal: ac.signal, cache: "no-store" }),
      ]);
      if (!gRes.ok || !rRes.ok) throw new Error("fetch failed");
      const gJson = await gRes.json();
      const rJson = await rRes.json();
      const gData = gJson.data ?? gJson;
      const rData = rJson.data ?? rJson;
      setGroups(gData.groups ?? []);
      setRecent(Array.isArray(rData.data) ? rData.data : rData.data?.data ?? []);
      const newTotal = rData.total ?? 0;
      setTotal((oldTotal) => {
        prevCountRef.current = oldTotal;
        return newTotal;
      });
    } catch (e) {
      if ((e as { name?: string }).name !== "AbortError") {
        // best-effort · auto-refresh will retry
      }
    } finally {
      setLoading(false);
    }
  }, [levelFilter]);

  useEffect(() => {
    load();
    const i = setInterval(load, 30_000);
    return () => clearInterval(i);
  }, [load]);

  const newSinceLast = total - prevCountRef.current;
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

  async function openAsTask(msg: string) {
    try {
      const res = await authedFetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: `investigate: ${msg.slice(0, 80)}`,
          notes: `Auto-created from /system/logs (errors view).\n\n${msg}`,
          priority: "normal",
          tags: ["ops", "investigate"],
        }),
      });
      if (res.ok) toast.success("task created");
      else toast.error(`task creation failed (${res.status})`);
    } catch (e) {
      toast.error(`error: ${e instanceof Error ? e.message : e}`);
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
