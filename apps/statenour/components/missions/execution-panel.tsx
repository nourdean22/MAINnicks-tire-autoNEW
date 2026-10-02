"use client";

/**
 * ExecutionPanel · Candidate 1: Execution Mode · 2026-06-11.
 *
 * A focused mode that shows one recommended task, why it matters,
 * and 3-5 direct, highly actionable controls:
 *   · Start / Pause (Resume)
 *   · Complete (DONE)
 *   · Break smaller / edit (opens TaskEditSheet)
 *   · Block / Wait (prompts waitingOn reason, marks WAITING)
 *   · Snooze / Defer (snoozes task until tomorrow or next Mon)
 *   · Abandon cleanly (soft-deletes)
 *
 * Reduces choice fatigue completely.
 */

import { MAX_RESUME_LINKS, type ResumeRecordInput } from "@/lib/missions/resume-record";
import { useEffect, useState } from "react";
import {
  Play,
  Pause,
  Check,
  Clock,
  Pencil,
  Trash2,
  X,
  AlertTriangle,
  HelpCircle,
  ChevronRight,
  ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Task, Project } from "@/components/actions/shared";
// 2026-09-15 · the snooze instants are shared with the task row and the inspector (lib/missions/snooze-presets.ts).
import { nextMonday6am, tomorrow6am } from "@/lib/missions/snooze-presets";

interface ExecutionPanelProps {
  task: Task;
  mission?: Project | null;
  onComplete: (id: string) => void | Promise<void>;
  onStart: (id: string) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onEdit: (task: Task) => void;
  onUpdateTask: (id: string, fields: any) => void | Promise<void>;
  /** Execution Deck (2026-09-01): park a DOING task with a ready-to-resume
   *  note. When absent, Pause falls back to a bare status flip. */
  onPark?: (id: string, note: string, record?: ResumeRecordInput) => void | Promise<void>;
  onExit: () => void;
}

export function ExecutionPanel({
  task,
  mission,
  onComplete,
  onStart,
  onDelete,
  onEdit,
  onUpdateTask,
  onPark,
  onExit,
}: ExecutionPanelProps) {
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [showBlockForm, setShowBlockForm] = useState(false);
  const [blockReason, setBlockReason] = useState("");
  const [showSnoozeOptions, setShowSnoozeOptions] = useState(false);
  const [showAbandonConfirm, setShowAbandonConfirm] = useState(false);
  const [showParkForm, setShowParkForm] = useState(false);
  const [parkNote, setParkNote] = useState("");
  // U5 (2026-09-07) · optional resume record. Collapsed by default: the one-line
  // note stays the fast path; the record is for parks you expect to outlive a day.
  const [showRecord, setShowRecord] = useState(false);
  const [record, setRecord] = useState<ResumeRecordInput>({});
  const [evidenceText, setEvidenceText] = useState("");
  const resetPark = () => {
    setShowParkForm(false);
    setParkNote("");
    setShowRecord(false);
    setRecord({});
    setEvidenceText("");
  };

  const isDoing = task.status === "DOING";
  const isDone = task.status === "DONE";

  // Focus session keeps the screen alive while a task is in flight
  // (Screen Wake Lock — full iOS PWA support since 18.4). Best-effort:
  // every path is try/caught, and visibility loss releases it anyway.
  useEffect(() => {
    if (!isDoing) return;
    let lock: { release: () => Promise<void> } | null = null;
    let cancelled = false;
    const request = async () => {
      try {
        const wl = (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock;
        if (!wl) return;
        const acquired = await wl.request("screen");
        if (cancelled) void acquired.release();
        else lock = acquired;
      } catch {
        /* denied or unsupported — a focus session works without it */
      }
    };
    void request();
    const onVisible = () => {
      if (document.visibilityState === "visible") void request();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      if (lock) void lock.release().catch(() => {});
    };
  }, [isDoing, task.id]);

  const handleStartPause = async () => {
    if (isDoing) {
      // Park, don't just pause: the one-line "where I stopped" note is
      // what makes the next block start clean (attention residue).
      setShowParkForm(true);
      return;
    }
    setSubmitting("start");
    try {
      await onStart(task.id);
    } finally {
      setSubmitting(null);
    }
  };

  const handleParkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting("park");
    try {
      if (onPark) {
        const evidenceLinks = evidenceText
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
          .slice(0, MAX_RESUME_LINKS);
        const rec: ResumeRecordInput = { ...record, evidenceLinks: evidenceLinks.length ? evidenceLinks : undefined };
        await onPark(task.id, parkNote, showRecord ? rec : undefined);
      } else {
        await onUpdateTask(task.id, { status: "READY" });
      }
      resetPark();
    } finally {
      setSubmitting(null);
    }
  };

  const handleComplete = async () => {
    setSubmitting("complete");
    try {
      await onComplete(task.id);
    } finally {
      setSubmitting(null);
    }
  };

  const handleBlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!blockReason.trim()) return;
    setSubmitting("block");
    try {
      await onUpdateTask(task.id, {
        status: "WAITING",
        waitingOn: blockReason.trim(),
      });
      setBlockReason("");
      setShowBlockForm(false);
    } finally {
      setSubmitting(null);
    }
  };

  const handleSnooze = async (dateIso: string) => {
    setSubmitting("snooze");
    try {
      await onUpdateTask(task.id, {
        status: "WAITING",
        snoozedUntil: dateIso,
      });
      setShowSnoozeOptions(false);
    } finally {
      setSubmitting(null);
    }
  };

  const handleAbandon = async () => {
    setSubmitting("abandon");
    try {
      await onDelete(task.id);
      setShowAbandonConfirm(false);
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <div className="space-y-4 max-w-xl mx-auto">
      {/* Header bar with focused title + Exit */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 rounded-full bg-amber-400", isDoing && "pulse-live")} />
          <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
            Execution Mode · active task
          </h2>
        </div>
        <button
          onClick={onExit}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-control border border-edge-default bg-content px-3 py-2 text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg"
        >
          Exit Focus <X size={10} />
        </button>
      </div>

      {/* Focused Task Card */}
      <div className="rounded-surface border border-edge-subtle bg-content p-6 relative overflow-hidden space-y-4">

        {/* Task Title */}
        <div className="space-y-1">
          {mission && (
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
              {mission.title}
            </p>
          )}
          <h1 className="text-[20px] font-semibold text-fg leading-snug">
            {task.title}
          </h1>
          {task.finishCondition && (
            <p className="text-[13px] text-fg-secondary italic mt-1.5 leading-relaxed">
              Target: {task.finishCondition}
            </p>
          )}
        </div>

        {/* Current status info */}
        <div className="flex items-center gap-2 flex-wrap font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary bg-surface-raised p-2 rounded-control border border-edge-subtle">
          <span className="text-fg-tertiary">Status:</span>
          <span
            className={cn(
              "px-1.5 py-0.5 rounded-micro text-[11px] font-semibold",
              isDoing
                ? "bg-amber-400/10 border border-amber-500/30 text-amber-300 pulse-live"
                : "bg-blue-500/10 border border-blue-500/30 text-blue-300",
            )}
          >
            {task.status}
          </span>
          {task.dueDate && (
            <>
              <span className="text-fg-tertiary">·</span>
              <span>due {new Date(task.dueDate).toLocaleDateString()}</span>
            </>
          )}
          {task.effort && (
            <>
              <span className="text-fg-tertiary">·</span>
              <span>effort: {task.effort}</span>
            </>
          )}
        </div>

        {/* Sub-form: Park with a ready-to-resume note */}
        {showParkForm && (
          <form
            onSubmit={handleParkSubmit}
            className="p-3 bg-surface-raised rounded-surface border border-edge-default space-y-2.5 animate-slide-down"
          >
            <label
              htmlFor="park-note-input"
              className="block font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary"
            >
              Where did you stop? What&apos;s the next physical step?
            </label>
            <input
              id="park-note-input"
              autoFocus
              type="text"
              maxLength={500}
              value={parkNote}
              onChange={(e) => setParkNote(e.target.value)}
              placeholder="e.g. drywall cut — tape the seam next"
              className="w-full rounded-control border border-edge-default bg-content px-3 py-2 text-[13px] text-fg focus:outline-none focus:border-accent placeholder:text-fg-tertiary"
            />
            {/* U5 · resume record — what future-you needs after 48 h away */}
            <button
              type="button"
              onClick={() => setShowRecord((v) => !v)}
              aria-expanded={showRecord}
              className="text-[13px] font-medium text-fg-tertiary transition-colors duration-[var(--motion-state)] hover:text-fg min-h-[44px]"
            >
              {showRecord ? "hide resume record" : "add resume record (for parks that outlive today)"}
            </button>
            {showRecord && (
              <div className="space-y-2">
                {(
                  [
                    ["intendedOutcome", "Intended outcome", "what done looks like"],
                    ["lastVerifiedStep", "Last verified step", "what you actually confirmed, not what you assume"],
                    ["openQuestion", "Open question", "what you still do not know"],
                    ["nextPhysicalAction", "Next physical action", "the first concrete move on resume"],
                  ] as const
                ).map(([key, label, hint]) => (
                  <label key={key} className="block">
                    <span className="block font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">{label}</span>
                    <input
                      type="text"
                      maxLength={300}
                      value={record[key] ?? ""}
                      onChange={(e) => setRecord((r) => ({ ...r, [key]: e.target.value }))}
                      placeholder={hint}
                      className="w-full rounded-control border border-edge-default bg-content px-3 py-2 text-[13px] text-fg focus:outline-none focus:border-accent placeholder:text-fg-tertiary"
                    />
                  </label>
                ))}
                <label className="block">
                  <span className="block font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">Evidence links, one per line, max {MAX_RESUME_LINKS}</span>
                  <textarea
                    rows={2}
                    value={evidenceText}
                    onChange={(e) => setEvidenceText(e.target.value)}
                    placeholder="https://... or /journal"
                    className="w-full rounded-control border border-edge-default bg-content px-3 py-2 text-[13px] text-fg focus:outline-none focus:border-accent placeholder:text-fg-tertiary"
                  />
                </label>
              </div>
            )}
            <div className="flex justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={resetPark}
                className="px-3 py-1.5 rounded-control border border-edge-default text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg min-h-[44px]"
              >
                Keep going
              </button>
              <button
                type="submit"
                disabled={submitting === "park"}
                className="px-3 py-1.5 rounded-control border border-edge-default bg-content text-[13px] font-medium text-fg transition-colors duration-[var(--motion-state)] hover:border-edge-strong min-h-[44px]"
              >
                {submitting === "park" ? "Parking…" : "Park task"}
              </button>
            </div>
          </form>
        )}

        {/* Sub-form: Block/Wait Input */}
        {showBlockForm && (
          <form
            onSubmit={handleBlockSubmit}
            className="p-3 bg-surface-raised rounded-surface border border-violet-500/20 space-y-2.5 animate-slide-down"
          >
            <label
              htmlFor="blocker-input"
              className="block font-mono text-[11px] uppercase tracking-[0.12em] text-violet-300"
            >
              What is blocking this task?
            </label>
            <input
              id="blocker-input"
              autoFocus
              type="text"
              required
              value={blockReason}
              onChange={(e) => setBlockReason(e.target.value)}
              placeholder="e.g. waiting on doctor's signature, parts delivery..."
              className="w-full rounded-control border border-violet-500/30 bg-content px-3 py-2 text-[13px] text-fg focus:outline-none focus:border-violet-500/60 placeholder:text-fg-tertiary"
            />
            <div className="flex justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => {
                  setShowBlockForm(false);
                  setBlockReason("");
                }}
                className="min-h-[44px] px-3 py-1.5 rounded-control border border-edge-default text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting === "block"}
                className="min-h-[44px] px-3 py-1.5 rounded-control bg-violet-600/80 hover:bg-violet-600 text-[13px] text-white font-medium transition-colors duration-[var(--motion-state)]"
              >
                {submitting === "block" ? "Saving..." : "Mark Blocked"}
              </button>
            </div>
          </form>
        )}

        {/* Sub-form: Snooze options */}
        {showSnoozeOptions && (
          <div className="p-3 bg-surface-raised rounded-surface border border-violet-500/20 space-y-2 animate-slide-down">
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-violet-300">
              Snooze / Defer Task Until
            </p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <button
                type="button"
                onClick={() => handleSnooze(tomorrow6am())}
                disabled={submitting === "snooze"}
                className="flex min-h-[44px] items-center justify-center gap-1.5 p-2 rounded-control border border-edge-default text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg"
              >
                <Clock size={12} /> Tomorrow 6am
              </button>
              <button
                type="button"
                onClick={() => handleSnooze(nextMonday6am())}
                disabled={submitting === "snooze"}
                className="flex min-h-[44px] items-center justify-center gap-1.5 p-2 rounded-control border border-edge-default text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg"
              >
                <Clock size={12} /> Next Mon 6am
              </button>
            </div>
            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => setShowSnoozeOptions(false)}
                className="min-h-[44px] text-[13px] font-medium text-fg-tertiary transition-colors duration-[var(--motion-state)] hover:text-fg"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Sub-form: Abandon confirmation */}
        {showAbandonConfirm && (
          <div className="p-3 bg-surface-raised rounded-surface border border-rose-500/20 space-y-3 animate-slide-down">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-rose-300">
                  Confirm Abandonment
                </p>
                <p className="text-[13px] text-fg-secondary leading-snug">
                  Are you sure you want to abandon “{task.title}”? It will be archived and removed from execution.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => setShowAbandonConfirm(false)}
                className="min-h-[44px] px-3 py-1.5 rounded-control border border-edge-default text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAbandon}
                disabled={submitting === "abandon"}
                className="min-h-[44px] px-3 py-1.5 rounded-control bg-rose-600/80 hover:bg-rose-600 text-[13px] text-white font-medium transition-colors duration-[var(--motion-state)] flex items-center gap-1"
              >
                <Trash2 size={12} /> Yes, Abandon
              </button>
            </div>
          </div>
        )}

        {/* 3-5 Primary Execution Controls */}
        {!showBlockForm && !showSnoozeOptions && !showAbandonConfirm && !showParkForm && (
          <div className="grid grid-cols-2 gap-2.5 pt-2">
            {/* Start / Pause */}
            <button
              type="button"
              onClick={handleStartPause}
              disabled={submitting != null}
              className={cn(
                "flex min-h-[44px] items-center justify-center gap-2 rounded-control py-3.5 border text-[13px] font-medium transition-colors duration-[var(--motion-state)] active:scale-[0.98] disabled:opacity-50",
                isDoing
                  ? "bg-amber-400/10 border-amber-500/40 text-amber-300 hover:bg-amber-400/20"
                  : "bg-emerald-500/10 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/20",
              )}
            >
              {isDoing ? (
                <>
                  <Pause size={14} fill="currentColor" /> Park Task
                </>
              ) : (
                <>
                  <Play size={14} fill="currentColor" /> Start / Resume
                </>
              )}
            </button>

            {/* Complete */}
            <button
              type="button"
              onClick={handleComplete}
              disabled={submitting != null}
              className="flex min-h-[44px] items-center justify-center gap-2 rounded-control py-3.5 bg-accent px-4 text-[14px] font-semibold text-[var(--text-inverse)] hover:bg-accent-hover transition-colors duration-[var(--motion-state)] active:scale-[0.98] disabled:opacity-50"
            >
              <Check size={14} strokeWidth={3} /> Complete Task
            </button>

            {/* Block / Wait */}
            <button
              type="button"
              onClick={() => setShowBlockForm(true)}
              disabled={submitting != null}
              className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-control py-2.5 border border-violet-500/20 bg-violet-500/5 text-violet-300 hover:bg-violet-500/10 text-[13px] font-medium transition-colors duration-[var(--motion-state)] active:scale-[0.98] disabled:opacity-50"
            >
              Mark Blocked
            </button>

            {/* Snooze / Defer */}
            <button
              type="button"
              onClick={() => setShowSnoozeOptions(true)}
              disabled={submitting != null}
              className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-control py-2.5 border border-edge-default bg-content text-fg-secondary hover:border-edge-strong hover:text-fg text-[13px] font-medium transition-colors duration-[var(--motion-state)] active:scale-[0.98] disabled:opacity-50"
            >
              <Clock size={12} /> Snooze / Defer
            </button>

            {/* Break Smaller / Edit */}
            <button
              type="button"
              onClick={() => onEdit(task)}
              disabled={submitting != null}
              className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-control py-2.5 border border-edge-default bg-content text-fg-secondary hover:border-edge-strong hover:text-fg text-[13px] font-medium transition-colors duration-[var(--motion-state)] active:scale-[0.98] disabled:opacity-50"
            >
              <Pencil size={12} /> Break / Edit
            </button>

            {/* Abandon Cleanly */}
            <button
              type="button"
              onClick={() => setShowAbandonConfirm(true)}
              disabled={submitting != null}
              className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-control py-2.5 border border-rose-500/20 bg-rose-500/5 text-rose-300 hover:bg-rose-500/10 text-[13px] font-medium transition-colors duration-[var(--motion-state)] active:scale-[0.98] disabled:opacity-50"
            >
              <Trash2 size={12} /> Abandon Task
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
