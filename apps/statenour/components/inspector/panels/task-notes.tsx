"use client";

/**
 * Task notes · 2026-10-29. Plain text, saved as you type (800 ms after the
 * last key), on blur and when the panel closes. The state line says which:
 * saved, saving, or not saved with a retry. No Save button (Google Tasks'
 * save-on-leave rule, benchmark section 3).
 */

import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { TASK_NOTES_MAX_CHARS } from "@/lib/services/task-attachments-limits";

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; at: string } | { kind: "failed"; message: string };

const DEBOUNCE_MS = 800;

export function TaskNotes({ taskId, initial }: { taskId: string; initial: string | null }) {
  const [text, setText] = useState(initial ?? "");
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  const lastSaved = useRef(initial ?? "");
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const utils = trpc.useUtils();
  const { mutateAsync } = trpc.task.notesSave.useMutation();

  const flush = async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const value = pending.current;
    if (value === null || value === lastSaved.current) return;
    pending.current = null;
    setState({ kind: "saving" });
    try {
      const res = await mutateAsync({ id: taskId, notes: value });
      lastSaved.current = value;
      // Reopening the panel reads task.byId from cache; a stale copy there
      // would show the old text and the next keystroke would save over this.
      utils.task.byId.setData({ id: taskId }, (old) => (old ? { ...old, notes: res.notes } : old));
      setState({ kind: "saved", at: res.savedAt });
    } catch (err) {
      pending.current = value;
      setState({ kind: "failed", message: err instanceof Error ? err.message : "save failed" });
    }
  };
  // The timer and the unmount save call the latest flush, not the first render's.
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  });

  // Save on leave: closing the inspector must not drop the last keystrokes.
  useEffect(() => () => void flushRef.current(), []);

  const onChange = (value: string) => {
    setText(value);
    pending.current = value;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flushRef.current(), DEBOUNCE_MS);
  };

  const line =
    state.kind === "saving"
      ? "saving"
      : state.kind === "saved"
        ? `saved ${new Date(state.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
        : state.kind === "failed"
          ? `not saved: ${state.message}`
          : null;

  return (
    <section aria-label="Notes" data-task-notes={taskId}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <label htmlFor={`task-notes-${taskId}`} className="font-mono text-[11px] text-fg-tertiary">
          Notes
        </label>
        {line ? (
          <span
            role="status"
            className={state.kind === "failed" ? "font-mono text-[11px] text-amber-300" : "font-mono text-[11px] text-fg-tertiary"}
          >
            {line}
          </span>
        ) : null}
      </div>
      <textarea
        id={`task-notes-${taskId}`}
        value={text}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => void flush()}
        maxLength={TASK_NOTES_MAX_CHARS}
        rows={4}
        placeholder="Context, numbers, who said what"
        className="block min-h-[96px] w-full resize-y border-0 border-b border-edge-default bg-transparent px-0 py-2 text-[16px] leading-relaxed text-fg placeholder:text-fg-tertiary focus:border-accent focus:outline-none"
      />
      {state.kind === "failed" ? (
        <button
          type="button"
          onClick={() => void flush()}
          className="mt-1 inline-flex min-h-[44px] items-center font-mono text-[12px] text-fg-secondary hover:text-fg"
        >
          Retry save
        </button>
      ) : null}
    </section>
  );
}
