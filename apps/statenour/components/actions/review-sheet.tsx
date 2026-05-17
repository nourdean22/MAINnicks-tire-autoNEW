"use client";

/**
 * ReviewSheet — bottom-sheet that lists overdue + stale tasks and
 * gives Nour three decisive verbs per row.
 *
 * Apr 26 · F1 of the NOW-mode upgrades. Triggered by tapping the
 * smart headline when it surfaces decision-pressure language ("4
 * overdue · 2 are 21d+ — review"). Replaces the old read-only
 * count with a one-tap path to actually clear the queue.
 *
 * Shape:
 *   ┌──────────────────────────────────────────────────┐
 *   │ Review · 6 to decide                  [done]    │
 *   ├──────────────────────────────────────────────────┤
 *   │ ◌ Reassess strategies for Rising Dragon  21d    │
 *   │   [kill]  [reframe]  [+ blocker]                │
 *   │ ─────                                            │
 *   │ ◌ Begin reconditioning bay 5             8d     │
 *   │   [kill]  [reframe]  [+ blocker]                │
 *   └──────────────────────────────────────────────────┘
 *
 * No nav, no modal — actions resolve inline + the row collapses
 * to "killed / reframed / waiting on X" so Nour sees what he just
 * decided. Sheet auto-closes when the queue empties.
 */

import { useState, useCallback } from "react";
import { X, Skull, Edit3, Hourglass, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTaskReviewActions } from "@/hooks/use-task-review-actions";
import { daysSince as ds } from "@/components/actions/shared";
import type { Task } from "@/components/actions/shared";

interface ReviewSheetProps {
  open: boolean;
  onClose: () => void;
  tasks: Task[];
  onChange?: () => void | Promise<void>;
}

type RowOutcome =
  | { kind: "open" }
  | { kind: "killed" }
  | { kind: "reframed" }
  | { kind: "waiting"; on: string };

export function ReviewSheet({ open, onClose, tasks, onChange }: ReviewSheetProps) {
  const actions = useTaskReviewActions({ source: "page:tasks/now/review-sheet", onChange });
  const [outcomes, setOutcomes] = useState<Record<string, RowOutcome>>({});
  const [reframeId, setReframeId] = useState<string | null>(null);
  const [reframeText, setReframeText] = useState("");
  const [blockerId, setBlockerId] = useState<string | null>(null);
  const [blockerText, setBlockerText] = useState("");

  const handleKill = useCallback(
    async (id: string) => {
      await actions.kill(id);
      setOutcomes((m) => ({ ...m, [id]: { kind: "killed" } }));
    },
    [actions],
  );

  const handleReframeSubmit = useCallback(
    async (id: string) => {
      const next = reframeText.trim();
      if (!next) return;
      await actions.reframe(id, { title: next });
      setOutcomes((m) => ({ ...m, [id]: { kind: "reframed" } }));
      setReframeId(null);
      setReframeText("");
    },
    [actions, reframeText],
  );

  const handleBlockerSubmit = useCallback(
    async (id: string) => {
      const on = blockerText.trim();
      if (!on) return;
      await actions.blocker(id, on);
      setOutcomes((m) => ({ ...m, [id]: { kind: "waiting", on } }));
      setBlockerId(null);
      setBlockerText("");
    },
    [actions, blockerText],
  );

  if (!open) return null;

  const pendingCount = tasks.filter((t) => !outcomes[t.id] || outcomes[t.id].kind === "open").length;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      {/* Sheet */}
      <div
        role="dialog"
        aria-label="Review overdue and stale tasks"
        className="fixed inset-x-0 bottom-0 z-50 max-h-[80vh] overflow-y-auto rounded-t-2xl border-t border-zinc-800 bg-zinc-950 shadow-[0_-20px_60px_rgba(0,0,0,0.7)] animate-in slide-in-from-bottom duration-200"
      >
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-zinc-900 bg-zinc-950/95 px-4 py-3 backdrop-blur">
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold text-zinc-100">Review</h2>
            <p className="text-[10px] uppercase tracking-wider text-zinc-500">
              {pendingCount > 0
                ? `${pendingCount} to decide`
                : "Queue cleared — close when done"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
          >
            <X size={16} />
          </button>
        </header>

        <ul className="divide-y divide-zinc-900">
          {tasks.map((t) => {
            const outcome = outcomes[t.id];
            const stale = ds(t.lastTouchedAt || t.updatedAt) || 0;
            const isReframing = reframeId === t.id;
            const isBlocking = blockerId === t.id;
            const isBusy = actions.busyId === t.id;

            // Outcome rendering — collapse the row to a confirmation.
            if (outcome && outcome.kind !== "open") {
              const label =
                outcome.kind === "killed"
                  ? "killed"
                  : outcome.kind === "reframed"
                    ? "reframed"
                    : `waiting on ${outcome.on}`;
              return (
                <li
                  key={t.id}
                  className="flex items-center gap-2 px-4 py-2 text-xs text-zinc-600"
                >
                  <span className="font-mono uppercase tracking-wider text-emerald-400">
                    {outcome.kind === "killed" ? "✕" : outcome.kind === "reframed" ? "↻" : "⏸"}
                  </span>
                  <span className="flex-1 truncate line-through">{t.title}</span>
                  <span className="text-emerald-400/70">{label}</span>
                </li>
              );
            }

            return (
              <li key={t.id} className="px-4 py-3">
                <div className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-zinc-100 leading-snug">
                      {t.title}
                    </p>
                    <p className="text-[10px] text-zinc-500 mt-0.5 font-mono">
                      {stale}d untouched · {t.effort}
                    </p>
                  </div>
                </div>
                {isReframing ? (
                  <div className="flex gap-1.5 mt-2">
                    <input
                      autoFocus
                      value={reframeText}
                      onChange={(e) => setReframeText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handleReframeSubmit(t.id);
                        if (e.key === "Escape") {
                          setReframeId(null);
                          setReframeText("");
                        }
                      }}
                      placeholder="Smaller next action…"
                      className="flex-1 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-amber-500/40"
                    />
                    <button
                      onClick={() => void handleReframeSubmit(t.id)}
                      disabled={!reframeText.trim() || isBusy}
                      className="rounded-md bg-amber-500 px-3 py-1 text-xs font-medium text-black hover:bg-amber-400 disabled:opacity-50"
                    >
                      Save
                    </button>
                  </div>
                ) : isBlocking ? (
                  <div className="flex gap-1.5 mt-2">
                    <input
                      autoFocus
                      value={blockerText}
                      onChange={(e) => setBlockerText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handleBlockerSubmit(t.id);
                        if (e.key === "Escape") {
                          setBlockerId(null);
                          setBlockerText("");
                        }
                      }}
                      placeholder="Waiting on… (person, vendor, decision)"
                      className="flex-1 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-sky-500/40"
                    />
                    <button
                      onClick={() => void handleBlockerSubmit(t.id)}
                      disabled={!blockerText.trim() || isBusy}
                      className="rounded-md bg-sky-500 px-3 py-1 text-xs font-medium text-black hover:bg-sky-400 disabled:opacity-50"
                    >
                      Save
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-1.5 mt-2 ml-3.5">
                    <ActionBtn
                      onClick={() => void handleKill(t.id)}
                      busy={isBusy}
                      icon={<Skull size={11} />}
                      label="kill"
                      tone="rose"
                    />
                    <ActionBtn
                      onClick={() => {
                        setReframeId(t.id);
                        setReframeText(t.title);
                      }}
                      icon={<Edit3 size={11} />}
                      label="reframe"
                      tone="amber"
                    />
                    <ActionBtn
                      onClick={() => {
                        setBlockerId(t.id);
                        setBlockerText("");
                      }}
                      icon={<Hourglass size={11} />}
                      label="blocker"
                      tone="sky"
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}

function ActionBtn({
  onClick,
  busy = false,
  icon,
  label,
  tone,
}: {
  onClick: () => void;
  busy?: boolean;
  icon: React.ReactNode;
  label: string;
  tone: "rose" | "amber" | "sky";
}) {
  const palette = {
    rose: "border-rose-500/30 text-rose-300 hover:bg-rose-500/10",
    amber: "border-amber-500/30 text-amber-300 hover:bg-amber-500/10",
    sky: "border-sky-500/30 text-sky-300 hover:bg-sky-500/10",
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border bg-zinc-950 px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-50",
        palette,
      )}
    >
      {busy ? <Loader2 size={11} className="animate-spin" /> : icon}
      <span>{label}</span>
    </button>
  );
}
