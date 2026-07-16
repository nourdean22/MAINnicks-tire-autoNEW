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

import { useState } from "react";
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

interface ExecutionPanelProps {
  task: Task;
  mission?: Project | null;
  onComplete: (id: string) => void | Promise<void>;
  onStart: (id: string) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onEdit: (task: Task) => void;
  onUpdateTask: (id: string, fields: any) => void | Promise<void>;
  onExit: () => void;
}

function tomorrow6am(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(6, 0, 0, 0);
  return d.toISOString();
}

function nextMonday6am(): string {
  const d = new Date();
  const dow = d.getDay();
  const daysUntilNextMon = dow === 1 ? 7 : (8 - dow) % 7 || 7;
  d.setDate(d.getDate() + daysUntilNextMon);
  d.setHours(6, 0, 0, 0);
  return d.toISOString();
}

export function ExecutionPanel({
  task,
  mission,
  onComplete,
  onStart,
  onDelete,
  onEdit,
  onUpdateTask,
  onExit,
}: ExecutionPanelProps) {
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [showBlockForm, setShowBlockForm] = useState(false);
  const [blockReason, setBlockReason] = useState("");
  const [showSnoozeOptions, setShowSnoozeOptions] = useState(false);
  const [showAbandonConfirm, setShowAbandonConfirm] = useState(false);

  const isDoing = task.status === "DOING";
  const isDone = task.status === "DONE";

  const handleStartPause = async () => {
    setSubmitting("start");
    try {
      if (isDoing) {
        await onUpdateTask(task.id, { status: "READY" });
      } else {
        await onStart(task.id);
      }
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
          <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
          <h2 className="text-[11px] font-mono uppercase tracking-[0.2em] text-amber-400 font-bold">
            Execution Mode · active task
          </h2>
        </div>
        <button
          onClick={onExit}
          className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          Exit Focus <X size={10} />
        </button>
      </div>

      {/* Focused Task Card */}
      <div className="rounded-xl border border-[var(--gold)]/35 bg-[var(--gold)]/[0.04] p-6 shadow-[0_0_35px_rgba(253,185,19,0.06)] relative overflow-hidden space-y-4">
        {/* Glow decoration */}
        <div className="absolute -top-10 -right-10 h-32 w-32 rounded-full bg-[var(--gold)]/5 blur-3xl pointer-events-none" />

        {/* Task Title */}
        <div className="space-y-1">
          {mission && (
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--gold)]/80">
              {mission.title}
            </p>
          )}
          <h1 className="text-[20px] font-bold text-[var(--text-primary)] leading-snug">
            {task.title}
          </h1>
          {task.finishCondition && (
            <p className="text-xs text-[var(--text-secondary)] italic mt-1.5 leading-relaxed">
              Target: {task.finishCondition}
            </p>
          )}
        </div>

        {/* Current status info */}
        <div className="flex items-center gap-2 flex-wrap text-[9px] font-mono uppercase tracking-[0.12em] text-[var(--text-tertiary)] bg-zinc-950/40 p-2 rounded-md border border-zinc-900/60">
          <span className="text-zinc-500">Status:</span>
          <span
            className={cn(
              "px-1.5 py-0.5 rounded text-[8px] font-bold",
              isDoing
                ? "bg-amber-400/10 border border-amber-500/30 text-amber-300 animate-pulse"
                : "bg-blue-500/10 border border-blue-500/30 text-blue-300",
            )}
          >
            {task.status}
          </span>
          {task.dueDate && (
            <>
              <span className="text-zinc-700">·</span>
              <span>due {new Date(task.dueDate).toLocaleDateString()}</span>
            </>
          )}
          {task.effort && (
            <>
              <span className="text-zinc-700">·</span>
              <span>effort: {task.effort}</span>
            </>
          )}
        </div>

        {/* Sub-form: Block/Wait Input */}
        {showBlockForm && (
          <form
            onSubmit={handleBlockSubmit}
            className="p-3 bg-zinc-950/60 rounded-lg border border-violet-500/20 space-y-2.5 animate-slide-down"
          >
            <label
              htmlFor="blocker-input"
              className="block text-[10px] font-mono uppercase tracking-wider text-violet-300"
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
              className="w-full rounded-md border border-violet-500/30 bg-zinc-900/40 px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-violet-500/60 placeholder:text-zinc-600"
            />
            <div className="flex justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => {
                  setShowBlockForm(false);
                  setBlockReason("");
                }}
                className="px-2.5 py-1.5 rounded border border-zinc-800 text-zinc-400 hover:text-zinc-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting === "block"}
                className="px-2.5 py-1.5 rounded bg-violet-600/80 hover:bg-violet-600 text-white font-medium"
              >
                {submitting === "block" ? "Saving..." : "Mark Blocked"}
              </button>
            </div>
          </form>
        )}

        {/* Sub-form: Snooze options */}
        {showSnoozeOptions && (
          <div className="p-3 bg-zinc-950/60 rounded-lg border border-violet-500/20 space-y-2 animate-slide-down">
            <p className="text-[10px] font-mono uppercase tracking-wider text-violet-300">
              Snooze / Defer Task Until
            </p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <button
                type="button"
                onClick={() => handleSnooze(tomorrow6am())}
                disabled={submitting === "snooze"}
                className="flex items-center justify-center gap-1.5 p-2 rounded border border-zinc-800 hover:bg-zinc-900/60 text-zinc-200"
              >
                <Clock size={12} /> Tomorrow 6am
              </button>
              <button
                type="button"
                onClick={() => handleSnooze(nextMonday6am())}
                disabled={submitting === "snooze"}
                className="flex items-center justify-center gap-1.5 p-2 rounded border border-zinc-800 hover:bg-zinc-900/60 text-zinc-200"
              >
                <Clock size={12} /> Next Mon 6am
              </button>
            </div>
            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => setShowSnoozeOptions(false)}
                className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 hover:text-zinc-300"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Sub-form: Abandon confirmation */}
        {showAbandonConfirm && (
          <div className="p-3 bg-zinc-950/60 rounded-lg border border-rose-500/20 space-y-3 animate-slide-down">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-[11px] font-mono uppercase tracking-wider text-rose-300 font-semibold">
                  Confirm Abandonment
                </p>
                <p className="text-xs text-zinc-400 leading-snug">
                  Are you sure you want to abandon “{task.title}”? It will be archived and removed from execution.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => setShowAbandonConfirm(false)}
                className="px-2.5 py-1.5 rounded border border-zinc-800 text-zinc-400 hover:text-zinc-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAbandon}
                disabled={submitting === "abandon"}
                className="px-2.5 py-1.5 rounded bg-rose-600/80 hover:bg-rose-600 text-white font-medium flex items-center gap-1"
              >
                <Trash2 size={12} /> Yes, Abandon
              </button>
            </div>
          </div>
        )}

        {/* 3-5 Primary Execution Controls */}
        {!showBlockForm && !showSnoozeOptions && !showAbandonConfirm && (
          <div className="grid grid-cols-2 gap-2.5 pt-2">
            {/* Start / Pause */}
            <button
              type="button"
              onClick={handleStartPause}
              disabled={submitting != null}
              className={cn(
                "flex items-center justify-center gap-2 rounded-lg py-3.5 border text-xs font-semibold uppercase tracking-wider transition-all active:scale-[0.98]",
                isDoing
                  ? "bg-amber-400/10 border-amber-500/40 text-amber-300 hover:bg-amber-400/20"
                  : "bg-emerald-500/10 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/20",
              )}
            >
              {isDoing ? (
                <>
                  <Pause size={14} fill="currentColor" /> Pause Task
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
              className="flex items-center justify-center gap-2 rounded-lg py-3.5 bg-[var(--gold)]/20 border border-[var(--gold)]/40 text-[var(--gold)] hover:bg-[var(--gold)]/30 text-xs font-semibold uppercase tracking-wider transition-all active:scale-[0.98]"
            >
              <Check size={14} strokeWidth={3} /> Complete Task
            </button>

            {/* Block / Wait */}
            <button
              type="button"
              onClick={() => setShowBlockForm(true)}
              disabled={submitting != null}
              className="flex items-center justify-center gap-1.5 rounded-lg py-2.5 border border-violet-500/20 bg-violet-500/5 text-violet-300 hover:bg-violet-500/10 text-xs font-medium uppercase tracking-wider transition-all active:scale-[0.98]"
            >
              ⏸ Mark Blocked
            </button>

            {/* Snooze / Defer */}
            <button
              type="button"
              onClick={() => setShowSnoozeOptions(true)}
              disabled={submitting != null}
              className="flex items-center justify-center gap-1.5 rounded-lg py-2.5 border border-zinc-800 bg-zinc-950 text-zinc-300 hover:bg-zinc-900/60 text-xs font-medium uppercase tracking-wider transition-all active:scale-[0.98]"
            >
              <Clock size={12} /> Snooze / Defer
            </button>

            {/* Break Smaller / Edit */}
            <button
              type="button"
              onClick={() => onEdit(task)}
              disabled={submitting != null}
              className="flex items-center justify-center gap-1.5 rounded-lg py-2.5 border border-zinc-800 bg-zinc-950 text-zinc-300 hover:bg-zinc-900/60 text-xs font-medium uppercase tracking-wider transition-all active:scale-[0.98]"
            >
              <Pencil size={12} /> Break / Edit
            </button>

            {/* Abandon Cleanly */}
            <button
              type="button"
              onClick={() => setShowAbandonConfirm(true)}
              disabled={submitting != null}
              className="flex items-center justify-center gap-1.5 rounded-lg py-2.5 border border-rose-500/20 bg-rose-500/5 text-rose-300 hover:bg-rose-500/10 text-xs font-medium uppercase tracking-wider transition-all active:scale-[0.98]"
            >
              <Trash2 size={12} /> Abandon Task
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
