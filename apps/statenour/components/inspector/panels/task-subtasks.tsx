"use client";

/**
 * Subtask checklist · 2026-10-29 (benchmark pick 3, Google Tasks). Ruled
 * rows with 44 px checks; ticking goes through task.update, the same
 * completion path the board uses. One level deep: a step has no steps.
 */

import { useState } from "react";
import { Check } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

export function TaskSubtasks({ taskId, isChild }: { taskId: string; isChild: boolean }) {
  const utils = trpc.useUtils();
  const list = trpc.task.subtasks.useQuery({ parentId: taskId }, { staleTime: 15_000, retry: 1, enabled: !isChild });
  const [title, setTitle] = useState("");
  // Steps are Task rows: the board, deck and mission counts read them too.
  const refresh = () => utils.task.invalidate();
  const add = trpc.task.subtaskAdd.useMutation({
    onSuccess: async () => {
      setTitle("");
      await refresh();
    },
  });
  const toggle = trpc.task.update.useMutation({ onSettled: refresh });

  if (isChild) return null;
  const rows = list.data ?? [];
  const done = rows.filter((r) => r.status === "DONE").length;

  return (
    <section aria-label="Steps" data-task-subtasks={taskId}>
      <p className="mb-1 font-mono text-[11px] text-fg-tertiary">
        Steps{rows.length > 0 ? ` · ${done} of ${rows.length}` : ""}
      </p>
      {list.isError ? (
        <button type="button" onClick={() => void list.refetch()} className="inline-flex min-h-[44px] items-center font-mono text-[12px] text-amber-300">
          Steps did not load · retry
        </button>
      ) : (
        <ul className="divide-y divide-edge-default border-y border-edge-default">
          {rows.map((r) => {
            const isDone = r.status === "DONE";
            const pending = toggle.isPending && toggle.variables?.id === r.id;
            return (
              <li key={r.id} className="flex items-center gap-2">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={isDone}
                  aria-label={isDone ? `Mark not done: ${r.title}` : `Mark done: ${r.title}`}
                  disabled={pending}
                  onClick={() => toggle.mutate({ id: r.id, fields: { status: isDone ? "READY" : "DONE" } })}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center"
                >
                  <span
                    className={cn(
                      "flex h-5 w-5 items-center justify-center rounded-micro border",
                      isDone ? "border-accent bg-accent-soft text-fg" : "border-edge-strong",
                      pending && "opacity-50",
                    )}
                  >
                    {isDone ? <Check size={14} strokeWidth={2.5} /> : null}
                  </span>
                </button>
                <span className={cn("min-w-0 flex-1 py-2 text-[15px]", isDone ? "text-fg-tertiary line-through" : "text-fg")}>{r.title}</span>
              </li>
            );
          })}
          <li>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (title.trim() && !add.isPending) add.mutate({ parentId: taskId, title });
              }}
              className="flex items-center gap-2"
            >
              <span aria-hidden className="inline-flex h-11 w-11 shrink-0 items-center justify-center text-fg-tertiary">+</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Add a step"
                aria-label="Add a step"
                maxLength={500}
                disabled={add.isPending}
                className="min-h-[44px] min-w-0 flex-1 border-0 bg-transparent px-0 text-[16px] text-fg placeholder:text-fg-tertiary focus:outline-none"
              />
            </form>
          </li>
        </ul>
      )}
      {add.isError ? <p className="mt-1 font-mono text-[12px] text-amber-300">Not added: {add.error.message}</p> : null}
      {toggle.isError ? <p className="mt-1 font-mono text-[12px] text-amber-300">Not changed: {toggle.error.message}</p> : null}
    </section>
  );
}
