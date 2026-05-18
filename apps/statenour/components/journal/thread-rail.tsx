"use client";

/**
 * ThreadRail · ADR-0013 · Phase D (2026-05-18)
 *
 * Pinned active threads above the feed. Quiet by default · each
 * thread shows name + member count + last activity + 1-line preview
 * of the most-recent member excerpt.
 *
 * Click a thread to expand inline · shows all 3 recent excerpts.
 * Threads with no joins in 30d auto-fade to a collapsed "Dormant"
 * section (operator can still see them but they don't compete with
 * active threads visually).
 */

import { useEffect, useMemo, useState } from "react";
import { useAuthedFetch } from "@/hooks/use-authed-fetch";

interface Thread {
  id: string;
  name: string;
  summary: string | null;
  status: string;
  coherence: number | null;
  memberCount: number;
  detectedAt: string;
  namedAt: string;
  lastJoinAt: string | null;
  recentExcerpts: string[];
}

export function ThreadRail({
  refreshSignal,
}: {
  refreshSignal?: number;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showDormant, setShowDormant] = useState(false);

  // Phase D · audit-fix #1 (2026-05-18) · useAuthedFetch instead of
  // bespoke state-mgmt + manual reload effect. Same semantics ·
  // ~22 LOC removed · the refreshSignal prop bumps trigger reload().
  const { data, error, loading, reload } = useAuthedFetch<{
    data: Thread[];
  }>("/api/journal/threads?includeDormant=true");
  const threads = data?.data ?? [];

  useEffect(() => {
    if (refreshSignal != null) reload();
  }, [refreshSignal, reload]);

  const { active, dormant } = useMemo(() => {
    const a: Thread[] = [];
    const d: Thread[] = [];
    for (const t of threads) {
      (t.status === "active" ? a : d).push(t);
    }
    return { active: a, dormant: d };
  }, [threads]);

  if (loading) return null;
  if (error) return null;
  if (active.length === 0 && dormant.length === 0) return null;

  return (
    <section className="mb-8 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xs uppercase tracking-[0.22em] text-white/40">
          Threads · {active.length} active
        </h2>
        {dormant.length > 0 ? (
          <button
            type="button"
            onClick={() => setShowDormant((s) => !s)}
            className="text-[10px] uppercase tracking-wider text-white/40 hover:text-white/70"
          >
            {showDormant ? "hide" : "show"} {dormant.length} dormant
          </button>
        ) : null}
      </div>

      {active.length > 0 ? (
        <ul className="space-y-2">
          {active.map((t) => (
            <ThreadCard
              key={t.id}
              thread={t}
              expanded={expandedId === t.id}
              onToggle={() =>
                setExpandedId((cur) => (cur === t.id ? null : t.id))
              }
            />
          ))}
        </ul>
      ) : null}

      {showDormant && dormant.length > 0 ? (
        <div className="pt-2 mt-3 border-t border-white/5">
          <p className="text-[10px] uppercase tracking-[0.18em] text-white/30 mb-2">
            Dormant · 30+ days quiet
          </p>
          <ul className="space-y-2 opacity-60">
            {dormant.map((t) => (
              <ThreadCard
                key={t.id}
                thread={t}
                expanded={expandedId === t.id}
                onToggle={() =>
                  setExpandedId((cur) => (cur === t.id ? null : t.id))
                }
              />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function ThreadCard({
  thread,
  expanded,
  onToggle,
}: {
  thread: Thread;
  expanded: boolean;
  onToggle: () => void;
}) {
  const lastActivity = useMemo(() => {
    const t = thread.lastJoinAt
      ? new Date(thread.lastJoinAt)
      : new Date(thread.namedAt);
    const days = Math.floor((Date.now() - t.getTime()) / 86_400_000);
    if (days === 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 14) return `${days}d ago`;
    if (days < 60) return `${Math.floor(days / 7)}w ago`;
    return `${Math.floor(days / 30)}mo ago`;
  }, [thread.lastJoinAt, thread.namedAt]);

  return (
    <li className="rounded-lg border border-white/10 bg-white/[0.02] transition hover:bg-white/[0.04]">
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left px-4 py-3 min-h-[44px] flex items-start justify-between gap-3"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-white truncate">
              {thread.name}
            </p>
            {thread.status === "dormant" ? (
              <span className="text-[10px] uppercase tracking-wider text-white/40 border border-white/15 rounded px-1.5 py-0.5">
                dormant
              </span>
            ) : null}
          </div>
          {!expanded && thread.recentExcerpts[0] ? (
            <p className="text-xs text-white/50 mt-1 line-clamp-1">
              {thread.recentExcerpts[0]}
            </p>
          ) : null}
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs tabular-nums text-white/70">
            {thread.memberCount}{" "}
            {thread.memberCount === 1 ? "entry" : "entries"}
          </p>
          <p className="text-[10px] uppercase tracking-wider text-white/40">
            {lastActivity}
          </p>
        </div>
      </button>

      {expanded ? (
        <div className="px-4 pb-4 border-t border-white/5 pt-3 space-y-2">
          {thread.summary ? (
            <p className="text-xs text-white/60 italic">
              "{thread.summary}"
            </p>
          ) : null}
          <ul className="space-y-1.5">
            {thread.recentExcerpts.map((e, i) => (
              <li
                key={i}
                className="text-xs text-white/70 flex gap-2"
              >
                <span className="text-white/30 tabular-nums shrink-0">
                  {i + 1}.
                </span>
                <span className="line-clamp-2">{e}</span>
              </li>
            ))}
          </ul>
          {thread.coherence != null ? (
            <p className="text-[10px] uppercase tracking-wider text-white/30 pt-1">
              coherence {(thread.coherence * 100).toFixed(0)}%
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
