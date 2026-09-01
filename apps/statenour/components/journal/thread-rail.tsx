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
import { trpc } from "@/lib/trpc/client";
import { MasterySectionLabel } from "@/components/mastery/mastery-section-label";

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
  // Item E (2026-06-10) · arc data — computed server-side from real join
  // recency. "fading"/"stale" render via the existing drift/dormant chips;
  // "strengthening" gets its own emerald chip.
  joins7d: number;
  joinsPrior7d: number;
  trend: "strengthening" | "steady" | "fading" | "stale";
}

export function ThreadRail({
  refreshSignal,
}: {
  refreshSignal?: number;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showDormant, setShowDormant] = useState(false);
  // Operator-initiated thread creation · 2026-05-18 PM follow-up ·
  // closes the operator-control gap (previously threads could only
  // be born from convergence candidates).
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);

  // Phase TT.2 (2026-05-22) · REST→tRPC · useAuthedFetch swapped for
  // trpc.journal.threads.useQuery. The query owns the {data} envelope ·
  // the includeDormant flag is now a typed input rather than a query
  // string. Loading/error still collapse the component exactly as
  // before (both return null below).
  const threadsQuery = trpc.journal.threads.useQuery(
    { includeDormant: true },
    { refetchOnWindowFocus: false, staleTime: 60_000 },
  );
  const threads: Thread[] = threadsQuery.data ?? [];
  const error = threadsQuery.error;
  const loading = threadsQuery.isLoading;
  const reload = () => threadsQuery.refetch();

  useEffect(() => {
    // > 0, not != null: the page seeds useState(0), and 0 != null fired a
    // redundant refetch on every mount right after the initial fetch.
    if (refreshSignal != null && refreshSignal > 0) threadsQuery.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  // Phase TT.2 · operator-initiated thread creation is now a typed
  // mutation. The router maps a duplicate-name business rejection to
  // BAD_REQUEST · mutateAsync rejects with that message so the inline
  // createErr surface is preserved verbatim.
  const createThreadMutation = trpc.journal.createThread.useMutation();

  const submitNewThread = async () => {
    const name = newName.trim();
    if (!name || createBusy) return;
    setCreateBusy(true);
    setCreateErr(null);
    try {
      await createThreadMutation.mutateAsync({ name });
      setNewName("");
      setCreating(false);
      reload();
    } catch (e) {
      setCreateErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCreateBusy(false);
    }
  };

  const { active, dormant } = useMemo(() => {
    const a: Thread[] = [];
    const d: Thread[] = [];
    for (const t of threads) {
      (t.status === "active" ? a : d).push(t);
    }
    return { active: a, dormant: d };
  }, [threads]);

  if (loading) return null;
  // 2026-05-24 · Wave R · pre-fix this was `if (error) return null;` ·
  // tRPC error made the ENTIRE thread rail vanish (operator with 12
  // pinned threads would see zero rendered) · indistinguishable from
  // "no threads exist." Now: surface a rose banner with the error
  // message + a retry button. Loading is still silent because the
  // server is responsive enough that a flash-skeleton would create
  // more noise than it saves (matches the page-level pattern).
  if (error) {
    return (
      <section className="mb-8">
        <div className="flex items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-2 text-[10px] text-rose-300">
          <span className="flex-1">⚠ couldn&apos;t load threads · {error.message.slice(0, 80)}</span>
          <button
            type="button"
            onClick={() => void reload()}
            className="rounded border border-rose-500/40 px-2 py-0.5 font-mono uppercase tracking-wider hover:bg-rose-500/15"
          >
            retry
          </button>
        </div>
      </section>
    );
  }
  // No threads yet · still render a compact create-row so the operator
  // can manually start a thread without waiting for convergence.
  if (active.length === 0 && dormant.length === 0) {
    return (
      <section className="mb-8">
        {creating ? (
          <NewThreadForm
            newName={newName}
            setNewName={setNewName}
            busy={createBusy}
            err={createErr}
            onSubmit={submitNewThread}
            onCancel={() => {
              setCreating(false);
              setNewName("");
              setCreateErr(null);
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition min-h-[32px] inline-flex items-center"
          >
            + new thread
          </button>
        )}
      </section>
    );
  }

  return (
    <section className="mb-8 space-y-3">
      <MasterySectionLabel
        label="Threads"
        count={`${active.length} active`}
        action={
          <div className="flex items-center gap-3">
            {!creating ? (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              >
                + new
              </button>
            ) : null}
            {dormant.length > 0 ? (
              <button
                type="button"
                onClick={() => setShowDormant((s) => !s)}
                className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              >
                {showDormant ? "hide" : "show"} {dormant.length} dormant
              </button>
            ) : null}
          </div>
        }
      />

      {creating ? (
        <NewThreadForm
          newName={newName}
          setNewName={setNewName}
          busy={createBusy}
          err={createErr}
          onSubmit={submitNewThread}
          onCancel={() => {
            setCreating(false);
            setNewName("");
            setCreateErr(null);
          }}
        />
      ) : null}

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

  // 2026-05-24 · Wave S #6 · Drift pin. Active threads with 14+ days
  // since the last join are visually marked as drifting · gives the
  // operator a soft signal to either revive the thread or let it
  // formally go dormant. Cron-managed dormancy still happens at 30d
  // (see /system/policies · "convergence-thread-dormancy") · this is
  // the warning that triggers before that hard transition.
  const driftDays = useMemo(() => {
    if (thread.status !== "active") return null;
    const ref = thread.lastJoinAt
      ? new Date(thread.lastJoinAt)
      : new Date(thread.namedAt);
    const days = Math.floor((Date.now() - ref.getTime()) / 86_400_000);
    return days >= 14 ? days : null;
  }, [thread.status, thread.lastJoinAt, thread.namedAt]);

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
            ) : driftDays !== null ? (
              <span
                className="text-[10px] uppercase tracking-wider text-amber-300/80 border border-amber-500/30 rounded px-1.5 py-0.5 bg-amber-500/[0.06]"
                title={`No activity in ${driftDays} days · revive or let drift to dormant`}
              >
                drifting · {driftDays}d
              </span>
            ) : thread.trend === "strengthening" ? (
              /* Item E · arc chip — only shown when the trend is REAL
                 (≥2 joins this week AND more than the prior week). */
              <span
                className="text-[10px] uppercase tracking-wider text-emerald-300/90 border border-emerald-500/30 rounded px-1.5 py-0.5 bg-emerald-500/[0.06]"
                title={`${thread.joins7d} entries this week vs ${thread.joinsPrior7d} last week — this arc is compounding`}
              >
                strengthening · {thread.joins7d}/wk
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
        <div className="px-4 pb-4 border-t border-white/5 pt-3 space-y-3">
          {/* Item E · arc line — the thread's life in one honest row:
              when it started, how big it is, this week vs last. */}
          <p className="text-[10px] uppercase tracking-wider text-white/40 tabular-nums">
            arc · first seen{" "}
            {new Date(thread.detectedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            {" · "}{thread.memberCount} entries
            {" · "}{thread.joins7d} this wk vs {thread.joinsPrior7d} last
            {" · "}
            <span
              className={
                thread.trend === "strengthening"
                  ? "text-emerald-300/90"
                  : thread.trend === "fading" || thread.trend === "stale"
                    ? "text-amber-300/80"
                    : "text-white/50"
              }
            >
              {thread.trend}
            </span>
          </p>
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
          <div className="flex items-center justify-between gap-3 pt-1">
            {/* Phase D follow-up audit (2026-05-18) · cross-link #1 ·
                operator can now click "view in feed" to land on /journal
                pre-filtered by the thread name. Solves the audit's
                'ThreadRail name has no link to filtered /journal' gap.
                Search-by-name is the v1 mechanism · v2 could use a real
                ?threadId= filter once /api/journal accepts it. */}
            <a
              href={`/journal?search=${encodeURIComponent(thread.name)}`}
              className="text-[10px] uppercase tracking-wider text-amber-200/80 hover:text-amber-100 min-h-[32px] inline-flex items-center"
            >
              view in feed →
            </a>
            {thread.coherence != null ? (
              <p className="text-[10px] uppercase tracking-wider text-white/30">
                coherence {(thread.coherence * 100).toFixed(0)}%
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}

// Operator-initiated thread creation form · inline composer in
// ThreadRail. Type name → enter to submit · cancel button to bail.
// On success: thread is born empty (memberCount=0) · auto-join hook
// on future captures finds it via centroid-similarity scoring.
function NewThreadForm({
  newName,
  setNewName,
  busy,
  err,
  onSubmit,
  onCancel,
}: {
  newName: string;
  setNewName: (v: string) => void;
  busy: boolean;
  err: string | null;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-lg border border-[#FDB913]/30 bg-[#FDB913]/[0.04] p-3 space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
        New thread
      </p>
      <div className="flex gap-2 items-stretch">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value.slice(0, 120))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !busy) {
              e.preventDefault();
              onSubmit();
            }
            if (e.key === "Escape") onCancel();
          }}
          placeholder="theme name (e.g. 'the pricing puzzle')"
          autoFocus
          className="flex-1 min-h-[44px] px-3 rounded border border-white/15 bg-transparent text-sm text-[var(--text-primary)] placeholder:text-white/30 focus:outline-none focus:border-[#FDB913]/60"
        />
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy || newName.trim().length === 0}
          className="text-xs uppercase tracking-[0.14em] px-3 min-h-[44px] rounded bg-[#FDB913] text-black font-medium hover:bg-[#FDB913]/90 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {busy ? "..." : "create"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="text-xs uppercase tracking-[0.14em] px-3 min-h-[44px] rounded border border-white/15 text-white/70 hover:bg-white/5 disabled:opacity-30"
        >
          cancel
        </button>
      </div>
      {err ? (
        <p className="text-[11px] text-red-300">{err}</p>
      ) : (
        <p className="text-[11px] text-[var(--text-tertiary)]">
          Empty thread · auto-join populates it as new captures match
          its centroid (or pin members later).
        </p>
      )}
    </div>
  );
}
