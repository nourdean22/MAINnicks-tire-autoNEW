"use client";

/**
 * TaskEditSheet · Wave AB.c · 2026-05-28.
 *
 * The replacement for the old /tasks LoopRowItem edit modal · scoped
 * to the fields that matter on /missions:
 *
 *   · title
 *   · status (READY / DOING / WAITING / DONE / etc)
 *   · dueDate
 *   · energyRequired (low / medium / high)
 *   · effort (s / m / l)
 *   · finishCondition (what does done look like)
 *   · waitingOn (when status=WAITING)
 *   · missionId (REASSIGN to a different mission, or unattach)
 *
 * Plus a delete button. All writes route through trpc.task.update +
 * trpc.task.delete. Same outer wrapper + body remount pattern as
 * Wave AB.b PersonEditDrawer.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, Trash2, X, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import type { Project, Task } from "@/components/actions/shared";

// wave-AB.c-audit · enum values mirror the Prisma TaskStatus + the
// taskUpdateSchema in lib/validators · the strings the schema accepts
// are CAPS for status, CAPS for energy (LOW/MEDIUM/HIGH), and the
// effort sentinel set (M5/M15/M30/H1/H2PLUS).
const STATUSES = ["INBOX", "READY", "DOING", "WAITING", "DONE"] as const;
type StatusValue = (typeof STATUSES)[number];
const ENERGIES = ["LOW", "MEDIUM", "HIGH"] as const;
type EnergyValue = (typeof ENERGIES)[number];
const EFFORTS = ["M5", "M15", "M30", "H1", "H2PLUS"] as const;
type EffortValue = (typeof EFFORTS)[number];
const EFFORT_LABELS: Record<EffortValue, string> = {
  M5: "5min",
  M15: "15min",
  M30: "30min",
  H1: "1h",
  H2PLUS: "2h+",
};

export interface TaskEditSheetProps {
  open: boolean;
  onClose: () => void;
  task: Task | null;
  /** Pass the live mission list so the operator can reassign. */
  missions: Project[];
  onSaved?: () => void;
}

export function TaskEditSheet(props: TaskEditSheetProps) {
  if (!props.open || !props.task) return null;
  return <TaskEditSheetBody {...props} task={props.task} />;
}

function TaskEditSheetBody({
  onClose,
  task,
  missions,
  onSaved,
}: TaskEditSheetProps & { task: Task }) {
  const [title, setTitle] = useState(() => task.title ?? "");
  const [status, setStatus] = useState(() => task.status ?? "READY");
  const [dueDate, setDueDate] = useState(() =>
    task.dueDate ? task.dueDate.slice(0, 10) : "",
  );
  const [energy, setEnergy] = useState(() => task.energyRequired ?? "");
  const [effort, setEffort] = useState(() => task.effort ?? "");
  const [finishCondition, setFinishCondition] = useState(
    () => task.finishCondition ?? "",
  );
  const [waitingOn, setWaitingOn] = useState(() => task.waitingOn ?? "");
  const [missionId, setMissionId] = useState(() => task.missionId ?? "");
  // Wave AL · 2026-05-28 · recurring tasks · loopKind exposed in UI for
  // the first time. ONCE = default · DAILY = recur tomorrow via the
  // existing WAITING+snoozedUntil mechanism + task-resurface cron.
  // PROMISE is a separate concept (commitment to someone) · we don't
  // expose it here for now · keeps the UI clean.
  const [loopKind, setLoopKind] = useState(
    () => (task as unknown as { loopKind?: string }).loopKind ?? "ONCE",
  );
  // 2026-06-06 · WEEKLY recurrence · selected weekdays (0=Sun..6=Sat).
  const [recurringDays, setRecurringDays] = useState<number[]>(
    () => (task as unknown as { recurringDays?: number[] }).recurringDays ?? [],
  );
  const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // iOS-PWA-safe confirm · window.confirm() is silently suppressed in
  // standalone mode so the delete guard always took the cancel path.
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const updateMutation = trpc.task.update.useMutation();
  const deleteMutation = trpc.task.delete.useMutation();
  // Unattach routes through the dedicated procedure — `{missionId: null}`
  // is structurally dead (non-nullable FK + requiredString in the shared
  // taskUpdateSchema), so leaveMission re-points the task at Inbox.
  const leaveMissionMutation = trpc.task.leaveMission.useMutation();
  const utils = trpc.useUtils();

  const submitting =
    updateMutation.isPending ||
    deleteMutation.isPending ||
    leaveMissionMutation.isPending;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !submitting) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  const handleSave = useCallback(async () => {
    const trimmed = title.trim();
    if (!trimmed) {
      toast.error("Title is required.");
      return;
    }
    if (loopKind === "WEEKLY" && recurringDays.length === 0) {
      toast.error("Pick at least one weekday for a weekly task.");
      return;
    }
    try {
      // Diff against the initial task snapshot. Under
      // taskUpdateSchema.partial() an absent key means "don't change",
      // so a cleared field mapped to `undefined` was a silent no-op —
      // clearing dueDate/waitingOn must send an explicit `null`, and
      // clearing finishCondition an explicit empty string. Unchanged
      // fields stay out of the payload entirely.
      type UpdateFields = Parameters<
        typeof updateMutation.mutateAsync
      >[0]["fields"];
      const fields: UpdateFields = {};

      if (trimmed !== (task.title ?? "")) fields.title = trimmed;
      if (status !== (task.status ?? "READY"))
        fields.status = status as StatusValue;

      const initialDue = task.dueDate ? task.dueDate.slice(0, 10) : "";
      if (dueDate.trim() !== initialDue)
        fields.dueDate = dueDate.trim() || null;

      // energy/effort are non-nullable enums in the schema — only a
      // change TO a concrete value can persist (clearing stays a no-op
      // by schema design).
      if (energy && energy !== (task.energyRequired ?? ""))
        fields.energyRequired = energy as EnergyValue;
      if (effort && effort !== (task.effort ?? ""))
        fields.effort = effort as EffortValue;

      if (finishCondition.trim() !== (task.finishCondition ?? ""))
        fields.finishCondition = finishCondition.trim();
      if (waitingOn.trim() !== (task.waitingOn ?? ""))
        fields.waitingOn = waitingOn.trim() || null;

      const initialLoopKind =
        (task as unknown as { loopKind?: string }).loopKind ?? "ONCE";
      if (loopKind !== initialLoopKind)
        fields.loopKind = loopKind as "ONCE" | "DAILY" | "PROMISE" | "WEEKLY";

      const initialRecurring =
        (task as unknown as { recurringDays?: number[] }).recurringDays ?? [];
      const nextRecurring = loopKind === "WEEKLY" ? recurringDays : [];
      if (JSON.stringify(nextRecurring) !== JSON.stringify(initialRecurring))
        fields.recurringDays = nextRecurring;

      const initialMissionId = task.missionId ?? "";
      const missionChanged = missionId !== initialMissionId;
      if (missionChanged && missionId) fields.missionId = missionId;
      const unattach = missionChanged && !missionId;

      let persisted = false;
      if (Object.keys(fields).length > 0) {
        await updateMutation.mutateAsync({ id: task.id, fields });
        persisted = true;
      }
      if (unattach) {
        await leaveMissionMutation.mutateAsync({ id: task.id });
        persisted = true;
      }

      if (persisted) {
        toast.success("Saved.");
        await Promise.all([
          utils.task.list.invalidate(),
          utils.task.missions.invalidate(),
        ]);
        onSaved?.();
      }
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed.");
    }
  }, [
    task,
    title,
    status,
    dueDate,
    energy,
    effort,
    finishCondition,
    waitingOn,
    loopKind,
    recurringDays,
    missionId,
    updateMutation,
    leaveMissionMutation,
    utils,
    onSaved,
    onClose,
  ]);

  const handleDelete = useCallback(async () => {
    const confirmed = await confirm({
      title: `Delete task "${task.title}"?`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      await deleteMutation.mutateAsync({ id: task.id });
      toast.success("Deleted.");
      await utils.task.list.invalidate();
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed.");
    }
  }, [task, deleteMutation, utils, onSaved, onClose, confirm]);

  const decomposeMutation = trpc.task.decompose.useMutation();

  const isComplex = !task.parentTaskId && (
    task.effort === "H1" || task.effort === "H2PLUS" ||
    ["setup", "implement", "create", "build", "refactor", "reengineer", "migrate", "integrate", "analyze", "design", "configure", "deconstruct", "reconcile", "audit", "optimize", "orchestrate", "decomposing", "decomposition"].some(k => (task.title ?? "").toLowerCase().includes(k))
  );

  const handleDecompose = useCallback(async () => {
    const promise = decomposeMutation.mutateAsync({ taskId: task.id });
    toast.promise(promise, {
      loading: `Decomposing “${task.title}” into subtasks...`,
      success: (res) => {
        void utils.task.list.invalidate();
        void utils.task.missions.invalidate();
        onSaved?.();
        onClose();
        return `Successfully created ${res.subtasksCount} subtasks!`;
      },
      error: (err) => `Failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }, [task.id, task.title, decomposeMutation, utils, onSaved, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end lg:items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="edit task"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "w-full lg:max-w-lg bg-[var(--bg-base)] border-t lg:border border-[var(--gold)]/30 rounded-t-2xl lg:rounded-2xl",
          "shadow-[0_-20px_60px_rgba(0,0,0,0.5),0_0_40px_rgba(253,185,19,0.1)]",
          "max-h-[90vh] overflow-y-auto pb-[env(safe-area-inset-bottom,0px)]",
        )}
      >
        <header className="sticky top-0 z-10 bg-[var(--bg-base)] flex items-center gap-2 border-b border-[var(--border-default)] px-4 py-3">
          <div className="flex-1 min-w-0">
            <p className="text-[9px] font-mono uppercase tracking-[0.18em] text-[var(--gold)]/80">
              edit task
            </p>
            <h2 className="text-[14px] font-bold text-[var(--text-primary)] truncate mt-0.5">
              {task.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="close"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]/15"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </header>

        <div className="px-4 py-3 space-y-3">
          <Field label="title">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={submitting}
              className={inputCls}
            />
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="status">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                disabled={submitting}
                className={inputCls}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.toLowerCase()}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="due · YYYY-MM-DD">
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                disabled={submitting}
                className={inputCls}
              />
            </Field>
          </div>

          {/* Wave AL · 2026-05-28 · recurring tasks · "Repeat" select.
            * DAILY tasks resurface tomorrow on complete (status WAITING +
            * snoozedUntil = tomorrow midnight + streakCount++ · existing
            * task-resurface cron flips back to READY). ONCE is the
            * standard one-shot behavior. PROMISE is reserved for the
            * commitment-to-someone concept · not exposed here. */}
          <Field label="repeat · how often does this recur?">
            <select
              value={loopKind}
              onChange={(e) => setLoopKind(e.target.value)}
              disabled={submitting}
              className={inputCls}
            >
              <option value="ONCE">never · one-shot task</option>
              <option value="DAILY">daily · habit · resurfaces tomorrow</option>
              <option value="WEEKLY">weekly · specific days</option>
            </select>
          </Field>

          {loopKind === "WEEKLY" && (
            <Field label="on which days?">
              <div className="flex flex-wrap gap-1.5">
                {weekdayLabels.map((label, idx) => {
                  const on = recurringDays.includes(idx);
                  return (
                    <button
                      key={label}
                      type="button"
                      disabled={submitting}
                      aria-pressed={on}
                      onClick={() =>
                        setRecurringDays((prev) =>
                          prev.includes(idx)
                            ? prev.filter((d) => d !== idx)
                            : [...prev, idx].sort((a, b) => a - b),
                        )
                      }
                      className={`min-w-[44px] rounded-md border px-2 py-2 text-xs font-medium transition-colors ${
                        on
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border text-muted-foreground hover:border-primary/50"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </Field>
          )}

          <Field label="mission · move to a different one">
            <select
              value={missionId}
              onChange={(e) => setMissionId(e.target.value)}
              disabled={submitting}
              className={inputCls}
            >
              <option value="">(unattached)</option>
              {missions
                .filter((m) => m.status === "ACTIVE")
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="energy">
              <select
                value={energy}
                onChange={(e) => setEnergy(e.target.value)}
                disabled={submitting}
                className={inputCls}
              >
                <option value="">—</option>
                {ENERGIES.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="effort">
              <select
                value={effort}
                onChange={(e) => setEffort(e.target.value)}
                disabled={submitting}
                className={inputCls}
              >
                <option value="">—</option>
                {EFFORTS.map((eff) => (
                  <option key={eff} value={eff}>
                    {EFFORT_LABELS[eff]}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="finish condition · what does done look like">
            <textarea
              value={finishCondition}
              onChange={(e) => setFinishCondition(e.target.value)}
              disabled={submitting}
              rows={2}
              placeholder="e.g. PR merged + deployed"
              className={cn(inputCls, "resize-none")}
            />
          </Field>

          {status === "WAITING" && (
            <Field label="waiting on">
              <input
                type="text"
                value={waitingOn}
                onChange={(e) => setWaitingOn(e.target.value)}
                disabled={submitting}
                placeholder="person · vendor · decision"
                className={inputCls}
              />
            </Field>
          )}
        </div>

        <footer className="sticky bottom-0 z-10 bg-[var(--bg-base)] flex items-center gap-2 border-t border-[var(--border-default)] px-4 py-3">
          <button
            type="button"
            onClick={handleDelete}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-[0.15em] text-rose-300/80 hover:text-rose-300 disabled:opacity-50"
          >
            <Trash2 size={11} strokeWidth={1.75} />
            delete
          </button>
          {isComplex && (
            <button
              type="button"
              onClick={handleDecompose}
              disabled={submitting || decomposeMutation.isPending}
              className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-[0.15em] text-[var(--gold)]/80 hover:text-[var(--gold)] disabled:opacity-50 ml-2"
            >
              <Sparkles size={11} strokeWidth={1.75} />
              decompose
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="ml-auto text-[11px] font-mono uppercase tracking-[0.15em] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] disabled:opacity-50"
          >
            cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={submitting || !title.trim()}
            className={cn(
              "inline-flex items-center gap-2 rounded-md border border-[var(--gold)]/50 bg-[var(--gold)]/10 text-[var(--gold)] hover:bg-[var(--gold)]/15 px-3 py-2 text-[12px] font-medium",
              "disabled:opacity-50 transition-colors",
            )}
          >
            {submitting && <Loader2 size={12} className="animate-spin" strokeWidth={2} />}
            save
          </button>
        </footer>
      </div>
      {/* iOS-PWA-safe confirm mount · renders null when idle. */}
      {confirmDialog}
    </div>
  );
}

// wave-AB.d · mobile · 16px font prevents iOS Safari zoom-on-focus ·
// 44px min-h meets Apple HIG tap target for selects + inputs.
const inputCls =
  "w-full min-h-[44px] rounded-md border border-[var(--border-default)] bg-[var(--bg-raised)]/[0.06] px-2.5 py-2 text-[16px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]/70 focus:border-[var(--gold)]/40 focus:outline-none transition-colors disabled:opacity-50";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[9px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
        {label}
      </span>
      {children}
    </label>
  );
}
