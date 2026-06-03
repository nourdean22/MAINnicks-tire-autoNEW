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

import { useCallback, useEffect, useState } from "react";
import { Loader2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";

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

  // Esc close · body only mounts when open=true.
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
        await utils.task.missions.invalidate();
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
        await utils.task.missions.invalidate();
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
      body: "All tasks attached to it become unattached. This cannot be undone.",
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
      await utils.task.missions.invalidate();
      await utils.task.list.invalidate();
      onSaved?.(missionId);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setSubmitting(false);
    }
  }, [missionId, initial, utils, onSaved, onClose, confirm]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end lg:items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={isCreate ? "create mission" : "edit mission"}
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
              {isCreate ? "new mission" : "edit mission"}
            </p>
            <h2 className="text-[14px] font-bold text-[var(--text-primary)] truncate mt-0.5">
              {isCreate ? "create" : initial?.title ?? "edit"}
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

        <footer className="sticky bottom-0 z-10 bg-[var(--bg-base)] flex items-center gap-2 border-t border-[var(--border-default)] px-4 py-3">
          {!isCreate && (
            <button
              type="button"
              onClick={handleHardDelete}
              disabled={submitting}
              className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-[0.15em] text-rose-300/80 hover:text-rose-300 disabled:opacity-50"
            >
              <Trash2 size={11} strokeWidth={1.75} />
              delete
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
            {isCreate ? "create" : "save"}
          </button>
        </footer>
      </div>
      {/* iOS-PWA-safe confirm mount · renders null when idle. */}
      {confirmDialog}
    </div>
  );
}

// wave-AB.d · mobile · text-[16px] is the iOS Safari no-zoom-on-focus
// floor · min-h-[44px] meets Apple HIG tap-target minimum on selects +
// inputs (some browsers render selects shorter without it).
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
