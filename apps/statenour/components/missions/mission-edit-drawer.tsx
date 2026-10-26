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
 */

import { useCallback, useState } from "react";
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
    description: string | null;
    deadline: string | null;
    /** "GENERAL" for a system lane; such a mission cannot be deleted. */
    systemKind?: string | null;
  };
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
  onSaved,
}: MissionEditDrawerProps) {
  const isCreate = missionId === null;
  const [title, setTitle] = useState(() => initial?.title ?? "");
  const [status, setStatus] = useState(() => initial?.status ?? "ACTIVE");
  const [domain, setDomain] = useState(() => initial?.domain ?? "");
  const [description, setDescription] = useState(() => initial?.description ?? "");
  const [deadline, setDeadline] = useState(() =>
    initial?.deadline ? initial.deadline.slice(0, 10) : "",
  );
  const [submitting, setSubmitting] = useState(false);

  // iOS-PWA-safe confirm · window.confirm() is silently suppressed in
  // standalone mode so the delete guard always took the cancel path.
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const createMission = trpc.task.createMission.useMutation();
  const utils = trpc.useUtils();

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
          description: description.trim() || undefined,
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
        const res = await fetch(`/api/missions/${missionId}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: trimmed,
            status,
            domain: domain.trim() || null,
            description: description.trim() || null,
            deadline: deadline.trim() || null,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        toast.success(`Updated “${trimmed}”.`);
        await Promise.all([utils.task.missions.invalidate(), utils.task.deck.invalidate()]);
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
    missionId,
    createMission,
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

          <Field label="description">
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
