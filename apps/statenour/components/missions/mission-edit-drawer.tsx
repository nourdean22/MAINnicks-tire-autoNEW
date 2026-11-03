"use client";

/**
 * MissionEditDrawer · Wave AB.c · 2026-05-28.
 *
 * Bottom-sheet / center modal for editing or creating a Mission. Same
 * pattern as Wave AB.b's PersonEditDrawer: outer wrapper short-circuits
 * to null on closed; inner body uses useState initializers so the
 * parent's `key` prop drives target-switch remounts (sidesteps the
 * setState-in-effect anti-pattern).
 *
 * Edits via PATCH /api/missions/[id] (existing endpoint).
 * Creates via trpc.task.createMission.
 *
 * Status options match the Prisma enum · ACTIVE · PAUSED · COMPLETE ·
 * KILLED. The page operates "complete mission" via the retro modal
 * (Wave AA) which sets COMPLETE on its own · this drawer only flips to
 * PAUSED (snooze) or KILLED (operator decided not to pursue).
 *
 * W8c (2026-11-03) · the goal is editable on an existing mission: a select of the active goals (and "No goal")
 * writes fields.lifeGoalId through the same PATCH (services/missions.updateMission, which refuses any id that is
 * not an active goal's). Above it, "Suggested: <goal> · Use" (trpc.task.suggestMissionGoal) links in one tap.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { isGeneralAnchor } from "@/lib/services/mission-helpers";

const STATUSES = ["ACTIVE", "PAUSED", "COMPLETE", "KILLED"] as const;

export interface MissionEditDrawerProps {
  open: boolean;
  onClose: () => void;
  /** When null, the drawer is in CREATE mode. */
  missionId: string | null;
  initial?: {
    title: string;
    status: string;
    domain: string | null;
    /** "What does done look like" (Mission.completionCriteria). Sent as `description` until 2026-11-02, which no schema accepted. */
    completionCriteria: string | null;
    deadline: string | null;
    /** The goal this mission sits under (Mission.lifeGoalId). */
    goal?: { id: string; title: string } | null;
    /** "GENERAL" for a system lane; such a mission cannot be deleted. */
    systemKind?: string | null;
  };
  /** The active goals the select offers (the page's task.goals read, status active). */
  goals?: { id: string; title: string }[];
  /** The field the drawer opens at: the card's "Align to goal" opens at the goal select. */
  focusField?: "goal" | null;
  onSaved?: (missionId: string) => void;
}

export function MissionEditDrawer(props: MissionEditDrawerProps) {
  if (!props.open) return null;
  return <MissionEditDrawerBody {...props} />;
}

function MissionEditDrawerBody({
  onClose,
  missionId,
  initial,
  goals = [],
  focusField = null,
  onSaved,
}: MissionEditDrawerProps) {
  const isCreate = missionId === null;
  const [title, setTitle] = useState(() => initial?.title ?? "");
  const [status, setStatus] = useState(() => initial?.status ?? "ACTIVE");
  const [domain, setDomain] = useState(() => initial?.domain ?? "");
  const [description, setDescription] = useState(() => initial?.completionCriteria ?? "");
  const [deadline, setDeadline] = useState(() =>
    initial?.deadline ? initial.deadline.slice(0, 10) : "",
  );
  // "" is No goal. The value is always an id from `goals` (or the mission's own current goal), never typed text.
  const [lifeGoalId, setLifeGoalId] = useState(() => initial?.goal?.id ?? "");
  const [submitting, setSubmitting] = useState(false);
  const goalRef = useRef<HTMLSelectElement>(null);

  // iOS-PWA-safe confirm · window.confirm() is silently suppressed in
  // standalone mode so the delete guard always took the cancel path.
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const createMission = trpc.task.createMission.useMutation();
  const utils = trpc.useUtils();
  // Ruling: the suggestion is read when the drawer opens, for that one mission, not at page load for all of them.
  const suggestQ = trpc.task.suggestMissionGoal.useQuery(
    { missionId: missionId ?? "" },
    { enabled: !isCreate && !initial?.goal, staleTime: 5 * 60_000, retry: false, refetchOnWindowFocus: false },
  );

  useEffect(() => {
    if (focusField === "goal") goalRef.current?.focus();
  }, [focusField]);

  // The current goal may no longer be active (paused, achieved): keep it selectable so a save leaves it as it is.
  const currentGoal = initial?.goal ?? null;
  const goalOptions =
    currentGoal && !goals.some((g) => g.id === currentGoal.id)
      ? [...goals, { id: currentGoal.id, title: `${currentGoal.title} (not active)` }]
      : goals;

  const patchMission = useCallback(
    async (body: Record<string, unknown>) => {
      const res = await fetch(`/api/missions/${missionId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(res.status === 400 ? "That goal is not active any more." : `HTTP ${res.status}`);
      await Promise.all([utils.task.missions.invalidate(), utils.task.deck.invalidate()]);
    },
    [missionId, utils],
  );

  const handleUseSuggestion = useCallback(
    async (goal: { goalId: string; title: string }) => {
      setSubmitting(true);
      try {
        await patchMission({ lifeGoalId: goal.goalId });
        setLifeGoalId(goal.goalId);
        toast.success(`Linked to “${goal.title}”.`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Link failed.");
      } finally {
        setSubmitting(false);
      }
    },
    [patchMission],
  );

  const handleSave = useCallback(async () => {
    const trimmed = title.trim();
    if (!trimmed) {
      toast.error("Mission needs a title.");
      return;
    }
    setSubmitting(true);
    try {
      if (isCreate) {
        await createMission.mutateAsync({
          title: trimmed,
          status,
          domain: domain.trim() || undefined,
          completionCriteria: description.trim() || undefined,
          deadline: deadline.trim() || undefined,
        });
        toast.success(`Created mission “${trimmed}”.`);
        // task.deck feeds the lanes and the hero; task.missions alone left them stale for up to 45 s.
        await Promise.all([utils.task.missions.invalidate(), utils.task.deck.invalidate()]);
        onSaved?.("");
        onClose();
      } else {
        // Existing /api/missions/[id] PATCH path · uses the same
        // updateMission service the legacy code calls.
        await patchMission({
          title: trimmed,
          status,
          domain: domain.trim() || null,
          completionCriteria: description.trim() || null,
          deadline: deadline.trim() || null,
          lifeGoalId: lifeGoalId || null,
        });
        toast.success(`Updated “${trimmed}”.`);
        onSaved?.(missionId!);
        onClose();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSubmitting(false);
    }
  }, [
    isCreate,
    title,
    status,
    domain,
    description,
    deadline,
    lifeGoalId,
    missionId,
    createMission,
    patchMission,
    utils,
    onSaved,
    onClose,
  ]);

  const handleHardDelete = useCallback(async () => {
    if (!missionId) return;
    const confirmed = await confirm({
      title: `Delete mission "${initial?.title ?? missionId}"?`,
      // deleteMission soft-deletes the mission AND every task in it (lib/services/missions.ts); the old
      // copy said the tasks "become unattached", which is not what happens.
      body: "Its tasks are deleted with it. This cannot be undone.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!confirmed) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/missions/${missionId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("Mission deleted.");
      await Promise.all([
        utils.task.missions.invalidate(),
        utils.task.list.invalidate(),
        utils.task.deck.invalidate(),
      ]);
      onSaved?.(missionId);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setSubmitting(false);
    }
  }, [missionId, initial, utils, onSaved, onClose, confirm]);

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !submitting) onClose();
      }}
    >
      <DialogContent
        unstyled
        showCloseButton={false}
        initialFocus={focusField === "goal" ? goalRef : undefined}
        overlayClassName="z-[70] bg-canvas/60"
        className={cn(
          "fixed inset-x-0 bottom-0 z-[70] max-h-[90dvh] overflow-y-auto overscroll-contain rounded-t-float border-t border-edge-default bg-overlay pb-[env(safe-area-inset-bottom,0px)] outline-none lg:inset-x-auto lg:bottom-auto lg:left-1/2 lg:top-1/2 lg:w-full lg:max-w-lg lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-overlay lg:border",
          "shadow-l2",
        )}
      >
        <header className="sticky top-0 z-10 bg-overlay flex items-center gap-2 border-b border-edge-subtle px-4 py-3">
          <div className="flex-1 min-w-0">
            <p className="font-mono text-[11px] text-fg-tertiary">
              {isCreate ? "new mission" : "edit mission"}
            </p>
            <DialogTitle className="mt-0.5 truncate text-[15px] font-semibold text-fg">
              {isCreate ? "Create" : initial?.title ?? "Edit"}
            </DialogTitle>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="close"
            className="inline-flex h-11 w-11 items-center justify-center rounded-control text-fg-tertiary transition-colors duration-[var(--motion-state)] hover:bg-surface-hover hover:text-fg"
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
              placeholder="mission title"
              className={inputCls}
            />
          </Field>

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

          <Field label="domain">
            <input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              disabled={submitting}
              placeholder="e.g. growth, health, money"
              className={inputCls}
            />
          </Field>

          <Field label="deadline · YYYY-MM-DD">
            <input
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              disabled={submitting}
              className={inputCls}
            />
          </Field>

          {!isCreate && (
            <div className="space-y-1">
              {!lifeGoalId && (
                <GoalSuggestionLine
                  query={suggestQ}
                  disabled={submitting}
                  onUse={(s) => void handleUseSuggestion(s)}
                />
              )}
              <Field label="goal">
                <select
                  ref={goalRef}
                  aria-label="goal"
                  value={lifeGoalId}
                  onChange={(e) => setLifeGoalId(e.target.value)}
                  disabled={submitting}
                  className={inputCls}
                >
                  <option value="">No goal</option>
                  {goalOptions.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.title}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}

          <Field label="done when">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={submitting}
              rows={3}
              placeholder="what does done look like · 1-2 sentences"
              className={cn(inputCls, "resize-none")}
            />
          </Field>
        </div>

        <footer className="sticky bottom-0 z-10 bg-overlay flex items-center gap-2 border-t border-edge-subtle px-4 py-3">
          {!isCreate && isGeneralAnchor(initial) && (
            <p className="min-h-11 flex-1 py-2.5 text-[12px] leading-snug text-fg-tertiary">
              System lane. It cannot be deleted.
            </p>
          )}
          {!isCreate && !isGeneralAnchor(initial) && (
            <button
              type="button"
              onClick={handleHardDelete}
              disabled={submitting}
              className="inline-flex min-h-11 items-center gap-1.5 px-2 text-[13px] font-medium text-rose-300/80 transition-colors duration-[var(--motion-state)] hover:text-rose-300 disabled:opacity-50"
            >
              <Trash2 size={11} strokeWidth={1.75} />
              Delete
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="ml-auto min-h-11 px-2 text-[13px] font-medium text-fg-tertiary transition-colors duration-[var(--motion-state)] hover:text-fg disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={submitting || !title.trim()}
            className={cn(
              "inline-flex min-h-11 items-center gap-2 rounded-control bg-accent px-4 py-2 text-[14px] font-semibold text-[var(--text-inverse)] hover:bg-accent-hover",
              "disabled:opacity-50 transition-colors duration-[var(--motion-state)]",
            )}
          >
            {submitting && <Loader2 size={12} className="animate-spin" strokeWidth={2} />}
            {isCreate ? "Create" : "Save"}
          </button>
        </footer>
        {/* iOS-PWA-safe confirm mount · renders null when idle. */}
        {confirmDialog}
      </DialogContent>
    </Dialog>
  );
}

type Suggestion = { goalId: string; title: string; score: number; basis: "embedding" | "words" };

/** One line above the goal select: the suggestion and its one-tap Use, "couldn't suggest", or a measured no-match. */
function GoalSuggestionLine({
  query,
  disabled,
  onUse,
}: {
  query: { data?: Suggestion | null; isError: boolean; isLoading: boolean };
  disabled: boolean;
  onUse: (s: Suggestion) => void;
}) {
  if (query.isError) {
    return (
      <p role="status" className="text-[12px] text-amber-300">
        Couldn&apos;t suggest a goal
      </p>
    );
  }
  if (query.data === undefined) return null;
  if (query.data === null) return <p className="text-[12px] text-fg-tertiary">No goal matched closely</p>;
  const s = query.data;
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-[12px] text-fg-secondary">
      <span className="min-w-0 truncate">
        Suggested: {s.title}
        {s.basis === "words" && <span className="text-fg-tertiary"> · from shared words</span>}
      </span>
      <button
        type="button"
        onClick={() => onUse(s)}
        disabled={disabled}
        className="inline-flex min-h-11 items-center px-2 font-medium text-sky-300 hover:underline disabled:opacity-50"
      >
        Use
      </button>
    </p>
  );
}

// wave-AB.d · mobile · text-[16px] is the iOS Safari no-zoom-on-focus
// floor · min-h-[44px] meets Apple HIG tap-target minimum on selects +
// inputs (some browsers render selects shorter without it).
const inputCls =
  "w-full min-h-[44px] rounded-control border border-edge-default bg-content px-2.5 py-2 text-[16px] text-fg placeholder:text-fg-tertiary/70 focus:border-accent focus:outline-none transition-colors duration-[var(--motion-state)] disabled:opacity-50";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="font-mono text-[11px] text-fg-tertiary">
        {label}
      </span>
      {children}
    </label>
  );
}
