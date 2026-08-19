"use client";

/**
 * TODODESK — the TodoDesk surface. Replaces the old WorkWidget.
 *
 * Design brief (Nour, Apr 18):
 *   "simpler on the front, super intelligent underneath"
 *
 * Front (what Nour sees, in order):
 *   ┌──────────────────────────────────────────────────────┐
 *   │ [⚔ DESK · deep work · energy 8/10]   [●●○○○○○ 7d]     │
 *   ├──────────────────────────────────────────────────────┤
 *   │ ▶ Active task (if DOING)                              │
 *   │   title · p · effort · elapsed · progress bar         │
 *   │   why: … · commitment · reality: est/actual           │
 *   │   [finish] [pause] [skip] [? decide] [chain]         │
 *   ├──────────────────────────────────────────────────────┤
 *   │ QUEUE (4)                                             │
 *   │ ○ Task title                       p · effort [▶]   │
 *   │ ○ Task title                       p · effort [▶]   │
 *   ├──────────────────────────────────────────────────────┤
 *   │ AGING BACKLOG (3)                                     │
 *   │ ⚠ aged task · 9d      ·  [resolve] [park]           │
 *   │ ⚠ drift alert · 5d    ·  [resolve]                  │
 *   │ ⚠ capture · 12d       ·  [triage]                   │
 *   ├──────────────────────────────────────────────────────┤
 *   │ TOMORROW  mit: set ✓ · note: drafted · 3 queued [▶] │
 *   │           +12 parked · +5 stale · +3 commitments     │
 *   └──────────────────────────────────────────────────────┘
 *
 * Smart under:
 *   • Time-of-day window drives which effort bands bubble up
 *   • Today's DailyScore energyLevel feeds energy-match filter
 *   • Aged tasks (5d+) sink into backlog; 10d+ get stale warning;
 *     30d+ auto-parked by backlog-triage cron
 *   • Reality-gap chip: compares actualMinutes avg vs effort target
 *   • Commitment lineage: titles matching active Commitment words
 *     get ⚖ chip and priority boost
 *   • Post-complete: toast + NextActionWhisperer fires
 *   • Ranking: autoPriority (higher = hotter) + windowFit(+10) + energyMatch(+8) +
 *     commitment(-12) + aged penalty
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { notifyDataChanged, onDataChanged } from "@/lib/events/data-change";
import {
  Play, CheckCircle2, ChevronRight,
  Flame, Moon, AlertTriangle, Scale, Archive,
  Inbox, Circle,
} from "lucide-react";
import { ActiveTaskCompanion } from "./active-task-companion";
import { Badge } from "@/components/ui/badge";
import { usePromptDialog } from "@/components/ui/confirm-dialog";

import { trpc } from "@/lib/trpc/client";
// ── Types mirroring /api/ultron/todo-desk response ──────────
type WorkWindow = "deep" | "ops" | "review" | "rest";

interface TaskLink {
  relationship: string;
  targetType: string;
  targetId: string;
  label: string;
  strength: number;
}

interface DeskTask {
  id: string;
  title: string;
  status: string;
  effort: string;
  effortLabel: string;
  context: string;
  autoPriority: number | null;
  autoPriorityExplanation: string | null;
  missionTitle: string | null;
  missionDomain: string | null;
  startedAt: string | null;
  lastTouchedAt: string | null;
  agedDays: number;
  windowFit: boolean;
  energyMatch: boolean;
  isCommitment: boolean;
  elapsedMinutes: number | null;
  targetMinutes: number;
  predictedMinutes: number | null;
  realityGapPercent: number | null;
  links: TaskLink[];
}

interface BacklogItem {
  kind: "task" | "capture" | "drift";
  id: string;
  title: string;
  detail: string;
  ageDays: number;
  severity: "info" | "warning" | "critical";
}

interface DeskPayload {
  window: { kind: WorkWindow; label: string };
  energyLevel: number | null;
  scoreLogged: boolean;
  active: DeskTask | null;
  queue: DeskTask[];
  backlog: BacklogItem[];
  tomorrow: {
    mitSet: boolean;
    mitText: string | null;
    tomorrowNote: { focus: string; avoid: string; anchor: string } | null;
    queued: Array<{ id: string; title: string; effort: string }>;
  };
  counts: {
    aging: number;
    stale: number;
    parked: number;
    commitments: number;
  };
  momentum: { doneToday: number; streak: number };
}

// Apr 19 · useElapsedMinutes ticker, WINDOW_META, BACKLOG_META dropped
// from HQ DESK. Ticker only mattered when this surface rendered a
// timer; WINDOW_META fed the window-pill chip; BACKLOG_META fed the
// aging-backlog list. All three moved to /tasks.
void Moon; void AlertTriangle; void Archive; void Inbox;
// ^ the imports are still referenced elsewhere in the file (aged
//   chip, tomorrow strip helper, etc.) — void-refs here keep them
//   alive without a dead-code warning when those sections drop too.

export function TodoDesk() {
  // iOS-PWA-safe prompt · window.prompt() is silently suppressed in
  // standalone mode (returns undefined) so the skip flow died silently.
  const { prompt, dialog: promptDialog } = usePromptDialog();
  const [busyId, setBusyId] = useState<string | null>(null);
  // showWhy state dropped Apr 19 — the why-this-now expander lived
  // on the active-task row which no longer renders expanders on HQ.

  // Phase B.6a (2026-05-22) · ONLY the todo-desk read migrated off
  // `authedFetch` onto `trpc.operator.todoDesk`. The task-mutation
  // calls below (`patchTask` → /api/tasks/[id], `resolveDrift` →
  // /api/drift) are INTENTIONALLY left on `authedFetch` — they belong
  // to later sub-slices. React Query's refetchInterval replaces the
  // manual 60s setInterval; `load` is now `refetch`, so every existing
  // caller (the onDataChanged listener, post-mutation refresh) keeps
  // working unchanged. `loading` mirrors the query's initial fetch.
  const {
    data,
    isLoading: loading,
    refetch,
  } = trpc.operator.todoDesk.useQuery(undefined, {
    refetchInterval: 60_000,
    retry: false,
  });
  const load = useCallback(() => {
    void refetch();
  }, [refetch]);

  // Phase B.6b (2026-05-22) · the `patchTask` helper migrated off
  // `authedFetch("/api/tasks/[id]")` onto `trpc.task.update`.
  // scattered-components slice (2026-05-22) · the `resolveDrift` call
  // (`/api/drift`) now hits `trpc.system.resolveDrift` — the last
  // `authedFetch` in this file, so the import is gone. `task.update`
  // takes `{ id, fields }` where `fields` is the shared
  // `taskUpdateSchema` (`.partial()`) · every `patchTask` caller passes
  // a valid task-field subset (`{ status }`, `{ status,
  // autoPriorityExplanation }`).
  const updateTask = trpc.task.update.useMutation();
  const resolveDriftMut = trpc.system.resolveDrift.useMutation();

  useEffect(() => {
    return onDataChanged(["tasks", "any"], (e) => {
      if (e.source === "ultron-desk") return;
      load();
    });
  }, [load]);

  // ── Mutations (optimistic) ────────────────────────────────
  const patchTask = useCallback(
    async (id: string, body: Record<string, unknown>, toastText: string) => {
      setBusyId(id);
      try {
        await updateTask.mutateAsync({
          id,
          // `body` is a heterogeneous task-field map ({ status } ·
          // { status, autoPriorityExplanation }) · `taskUpdateSchema`
          // is `.partial()` so each shape validates. Cast to the
          // mutation's `fields` input type at this boundary — the
          // procedure re-validates against the shared schema anyway.
          fields: body as Parameters<
            typeof updateTask.mutateAsync
          >[0]["fields"],
        });
        toast.success(toastText);
        notifyDataChanged("tasks", { source: "ultron-desk", id });
        load();
      } catch {
        toast.error("failed");
        load();
      } finally {
        setBusyId(null);
      }
    },
    [load, updateTask],
  );

  const start = (id: string) => patchTask(id, { status: "DOING" }, "started");
  const finish = (id: string) => patchTask(id, { status: "DONE" }, "done · whisperer next");
  const pause = (id: string) => patchTask(id, { status: "READY" }, "paused · on deck");
  const archive = (id: string) =>
    patchTask(id, { status: "ARCHIVED", autoPriorityExplanation: "parked via desk" }, "parked");
  const skip = async (id: string) => {
    const reason = await prompt({
      title: "skip reason?",
      placeholder: "one line — logged",
    });
    if (reason === null) return;
    const explanation = reason.trim() ? `skipped · ${reason.trim()}` : "skipped";
    await patchTask(id, { status: "INBOX", autoPriorityExplanation: explanation }, "skipped · logged");
  };

  const resolveDrift = async (id: string) => {
    setBusyId(id);
    try {
      // scattered-components slice · resolve a drift alert via
      // trpc.system.resolveDrift. The BacklogItem `id` for a drift row
      // arrives as a string ("drift-42"-stripped) · the procedure
      // accepts string|number and coerces, mirroring the legacy route's
      // Int-column tolerance.
      await resolveDriftMut.mutateAsync({ id });
      toast.success("resolved");
      load();
    } catch {
      toast.error("failed");
    } finally {
      setBusyId(null);
    }
  };

  // ── Live elapsed for active task ──────────────────────────
  const active = data?.active ?? null;
  // Apr 19 · Elapsed timer + progress math removed from HQ DESK —
  // see useElapsedMinutes below (kept unused for now in case /tasks
  // wants to lift the same pattern; safe to delete when that view
  // gets its own native hook).

  // ── Render ────────────────────────────────────────────────
  if (loading) {
    return (
      <section className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)] px-3 py-3">
        <div className="h-5 rounded animate-pulse bg-[var(--bg-void)]" />
      </section>
    );
  }

  if (!data) {
    return (
      <section className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)] px-3 py-2 text-[10px] text-[var(--text-tertiary)]">
        desk offline
      </section>
    );
  }

  const hasActive = !!data.active;
  const hasQueue = data.queue.length > 0;
  const hasBacklog = data.backlog.length > 0;

  // Apr 19 · Empty state is now "queue empty" — HQ doesn't show
  // backlog, so we key off active+queue only. `hasBacklog` still
  // feeds /tasks via the shared API payload; keeping the reference
  // here so the empty state stays accurate on no-backlog days too.
  void hasBacklog;
  if (!hasActive && !hasQueue) {
    return (
      <section className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5 flex items-center gap-3">
        <Flame size={14} className="text-emerald-400 shrink-0" />
        <div className="flex-1">
          <p className="text-[9px] font-[var(--font-display)] font-bold uppercase tracking-[0.22em] text-emerald-400">
            desk clear
          </p>
          <p className="text-[11px] text-[var(--text-secondary)]">
            nothing queued — capture something below or plan the next move
          </p>
        </div>
        <Link
          href="/missions"
          className="text-[9px] font-bold uppercase tracking-wider text-emerald-400 hover:underline flex items-center gap-0.5"
        >
          tasks <ChevronRight size={9} />
        </Link>
      </section>
    );
  }

  // Apr 19 · HQ DESK kept minimal per Nour's brief — quick smart
  // to-do, no timer, no window pill, no chip stack. The heavy detail
  // (window, energy, time ghost, aging/stale/commits, reality gap,
  // auto-linker chips, decide-inline) all moved to /tasks. HQ is just:
  // brand · count · → · active/queue rows. Ranking still comes from
  // the server's auto-priority pipeline so "quick" doesn't mean dumb.
  const todoCount = (active ? 1 : 0) + data.queue.length;

  // Active → subtle gold ring to show something's in progress. No
  // more over-run/flow-zone glow states on HQ — those visual cues
  // depended on the elapsed timer which this surface no longer runs.
  const primaryBorder = active
    ? "border-[var(--gold)]/40 bg-[var(--gold)]/5"
    : "border-[var(--border-default)] bg-[var(--bg-raised)]";

  return (
    <section className={cn("rounded-lg border transition-all", primaryBorder)}>
      {/* ── HEADER: quick, smart, minimal ──
       *  Apr 19 · Stripped per "less bells, more powerful" brief. Tap
       *  anywhere → /tasks for the full queue + window + energy +
       *  time ghost + aging + reality gap. HQ just shows: brand,
       *  count, arrow. Nothing else competes.
       */}
      <Link
        href="/missions"
        className={cn(
          "group flex items-center justify-between gap-2 px-3 py-2 border-b border-[var(--border-default)]/60",
          "hover:bg-[var(--bg-raised)]/40 transition-colors",
        )}
        title="open full task queue"
      >
        <span
          className={cn(
            "font-[var(--font-display)] font-bold uppercase tracking-[0.26em] text-[12px] leading-none text-[var(--text-primary)]",
            "group-hover:text-[var(--gold)] transition-colors",
          )}
        >
          ⚔ DESK
        </span>
        <span className="flex items-center gap-2 text-[10px] font-mono tabular-nums">
          <span className="text-[var(--text-tertiary)]">
            {todoCount > 0 ? `${todoCount} to do` : "empty"}
          </span>
          <ChevronRight
            size={11}
            className="text-[var(--text-tertiary)] group-hover:text-[var(--gold)] transition-colors"
          />
        </span>
      </Link>

      {/* ── ACTIVE TASK ──
       *  When a task is DOING, the row stays minimal but the
       *  ActiveTaskCompanion strip mounts underneath and turns the
       *  tile into a working session: ask Nick, take notes, snap
       *  photos, dictate voice, log progress. Everything persists
       *  to /api/tasks/:id/session so /tasks can replay the whole
       *  transcript.
       */}
      {active && (
        <>
          <TaskRow
            task={active}
            isActive
            busy={busyId === active.id}
            onStart={() => start(active.id)}
            onFinish={() => finish(active.id)}
          />
          <ActiveTaskCompanion task={{ id: active.id, title: active.title }} />
        </>
      )}

      {/* ── QUEUE ──
       *  Apr 19 · Stripped the tiny "queue · N" header row — the
       *  zone header already shows the count. Rows render directly,
       *  ranked by server-side auto-priority (the "smart" part).
       */}
      {hasQueue && (
        <div className={cn(
          hasActive ? "border-t border-[var(--border-default)]/60" : "",
          "divide-y divide-[var(--border-default)]/40",
        )}>
          {data.queue.slice(0, 5).map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              isActive={false}
              busy={busyId === t.id || hasActive /* disable starting queue while active */}
              onStart={() => start(t.id)}
              onFinish={() => finish(t.id)}
              compact
            />
          ))}
          {data.queue.length > 5 && (
            <Link
              href="/missions"
              className="block px-3 py-1.5 text-[9px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] hover:text-[var(--gold)] hover:bg-[var(--bg-raised)]/40 transition-colors text-center"
            >
              +{data.queue.length - 5} more · open tasks →
            </Link>
          )}
        </div>
      )}

      {/* Apr 19 · Backlog list removed from HQ surface. Aging tasks,
       *  drift alerts, and stale captures now live on /tasks — tap
       *  the DESK header to drill in. HQ stays focused on "what's
       *  next right now", not "what's rotting". */}

      {/* Apr 19 · Aging backlog + TomorrowStrip moved out of the HQ
       *  DESK surface per the "less bells, more powerful" brief. Both
       *  still live on /tasks where they belong — HQ stays focused on
       *  "what to do right now". */}
      {/* iOS-PWA-safe prompt mount · renders null when idle. */}
      {promptDialog}
    </section>
  );
}

// ── Task row (shared between active + queue) ──────────────
function TaskRow({
  task,
  isActive,
  busy,
  onStart,
  onFinish,
  compact = false,
}: {
  task: DeskTask;
  isActive: boolean;
  busy: boolean;
  // Apr 19 · Timer, progress bar, flow-zone, reality-gap, decide,
  // pause/skip/park dropped from the HQ DESK per "quick smart to-do"
  // brief. All of those live on /tasks now; HQ is just:
  //   active → finish · queue → start. One tap, no orchestration.
  onStart: () => void;
  onFinish: () => void;
  compact?: boolean;
}) {
  // Aged chip kept only for critical-stale tasks (≥10d). Mild amber
  // aging was noise on the HQ view — /tasks shows the gradient.
  const agedChip =
    !isActive && task.agedDays >= 10 ? (
      <Badge
        className="shrink-0 h-auto gap-0.5 rounded px-1 py-0 border-red-500/30 bg-red-500/10 text-red-400 text-[8px] font-mono font-bold uppercase tracking-wider"
        title={`last touched ${task.agedDays} days ago · stale`}
      >
        stale {task.agedDays}d
      </Badge>
    ) : null;

  return (
    <div className={cn("px-3 flex items-center gap-2", compact ? "py-1.5" : "py-2")}>
      <span className="shrink-0">
        {isActive ? (
          <Play size={10} className="text-[var(--gold)]" fill="currentColor" />
        ) : (
          <Circle size={9} className="text-[var(--text-tertiary)]" />
        )}
      </span>
      <p
        className={cn(
          "flex-1 min-w-0 text-[12px] text-[var(--text-primary)] truncate",
          isActive ? "font-semibold" : "font-medium",
        )}
        title={task.title}
      >
        {task.title}
      </p>
      {/* Apr 19 · On ACTIVE rows the companion strip below is the
       *  context surface — commit/priority/effort chips fall away so
       *  the row reads cleanly as "this is what I'm doing right now".
       *  On queued rows the chips still earn their keep — they tell
       *  Nour why a task matters before he taps start. */}
      {!isActive && task.isCommitment && (
        <span
          className="shrink-0 inline-flex items-center gap-0.5 text-[8px] font-bold uppercase tracking-wider text-violet-400 bg-violet-500/10 border border-violet-500/30 rounded px-1 py-0"
          title="tied to an active commitment"
        >
          <Scale size={8} />
          commit
        </span>
      )}
      {!isActive && typeof task.autoPriority === "number" && task.autoPriority >= 60 && (
        <span
          className={cn(
            "shrink-0 text-[8px] font-mono font-bold tabular-nums px-1 py-0 rounded",
            task.autoPriority >= 80
              ? "text-red-400 bg-red-500/10"
              : "text-amber-400 bg-amber-500/10",
          )}
          title="auto-priority (higher = sharper)"
        >
          p{task.autoPriority}
        </span>
      )}
      {!isActive && (
        <span
          className="shrink-0 text-[9px] font-mono text-[var(--text-tertiary)]"
          title="target effort"
        >
          {task.effortLabel}
        </span>
      )}
      {agedChip}
      {isActive ? (
        <ActionBtn
          onClick={onFinish}
          disabled={busy}
          icon={<CheckCircle2 size={10} />}
          label="finish"
          tone="emerald"
          compact
        />
      ) : (
        <ActionBtn
          onClick={onStart}
          disabled={busy}
          icon={<Play size={10} fill="currentColor" />}
          label="start"
          tone="gold"
          compact
        />
      )}
    </div>
  );
}

// Apr 19 · TomorrowStrip deleted — moved to /tasks along with the
// other deeper surfaces (backlog, reality-gap, auto-linker, decide).
// HQ DESK stays quick + smart per "less bells, more powerful" brief.

// ── ActionBtn helper ────────────────────────────────────────
function ActionBtn({
  onClick,
  disabled,
  icon,
  label,
  tone,
  compact = false,
}: {
  onClick: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  tone: "gold" | "emerald" | "neutral";
  compact?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center gap-1 rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
        compact ? "px-1.5 py-0 text-[9px]" : "px-2 py-0.5 text-[9px]",
        "font-bold uppercase tracking-wider",
        tone === "gold" &&
          "border-[var(--gold)]/40 bg-[var(--gold)]/10 text-[var(--gold)] hover:bg-[var(--gold)]/20",
        tone === "emerald" &&
          "border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20",
        tone === "neutral" &&
          "border-[var(--border-default)] bg-[var(--bg-raised)] text-[var(--text-secondary)] hover:text-[var(--gold)] hover:border-[var(--gold)]/30",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
