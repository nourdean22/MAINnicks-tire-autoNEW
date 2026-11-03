"use client";

/**
 * PromisesSection · R3 (2026-11-03). The commitments Nick reads every chat, finally listed and
 * editable where work lives. Nour: "i have no where to even see the commitments or edit them".
 *
 * Collapsed to one count line by default; #promises (Home's proposed row, Nick's chip) opens it.
 * Active rows: Done (kept), Drop (abandoned), Edit, Make it a task. Proposed rows: Accept /
 * Dismiss through the existing operator procedures. Writes go through lib/services/commitments.ts.
 * Unknown is not empty: a failed read never renders "No open promises."
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { trpc } from "@/lib/trpc/client";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { ReadFailed } from "@/components/ui/read-failed";
import { isUserProject } from "@/lib/services/mission-helpers";
import { cn } from "@/lib/utils";

type PromiseRow = {
  id: number;
  description: string;
  toWhom: string;
  deadline: string | null;
  ageDays: number;
  deadlineDays: number | null;
  task: { id: string; status: string } | null;
};
type MissionOption = { id: string; title: string; status?: string; systemKind?: string | null };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const BUTTON =
  "inline-flex min-h-[44px] items-center rounded-control border border-edge-default px-3 text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg disabled:opacity-50";
const FIELD = "w-full rounded-control border border-edge-default bg-transparent px-3 py-2 text-[15px] text-fg";

function age(days: number): string {
  if (days < 1) return "today";
  if (days < 7) return `${days} d`;
  if (days < 30) return `${Math.floor(days / 7)} wk`;
  if (days < 365) return `${Math.floor(days / 30)} mo`;
  return `${Math.floor(days / 365)} yr`;
}

/** YYYY-MM-DD read as written: no Date parse, so no UTC shift on an Eastern phone. */
function due(deadline: string | null, days: number | null): string {
  if (!deadline) return "no date";
  // A legacy free-text deadline the server could not date: show it as written.
  if (days === null) return `due ${deadline}`;
  const [y, m, d] = deadline.split("-").map(Number);
  const label = `${MONTHS[m - 1]} ${d}${Math.abs(days) > 300 ? ` ${y}` : ""}`;
  if (days === 0) return "due today";
  return days > 0 ? `due ${label}` : `was due ${label}`;
}

function meta(r: PromiseRow): string {
  const to = r.toWhom && r.toWhom.toLowerCase() !== "self" ? [`to ${r.toWhom}`] : [];
  return [...to, due(r.deadline, r.deadlineDays), age(r.ageDays)].join(" · ");
}

export function PromisesSection({ missions }: { missions: MissionOption[] }) {
  const [open, setOpen] = useState(false);
  const [gone, setGone] = useState<Set<number>>(() => new Set());
  const [busy, setBusy] = useState<number | null>(null);
  const [panel, setPanel] = useState<{ id: number; kind: "edit" | "task" } | null>(null);
  const { confirm, dialog } = useConfirmDialog();

  const list = trpc.operator.promisesList.useQuery();
  const resolve = trpc.operator.promiseResolve.useMutation();
  const edit = trpc.operator.promiseEdit.useMutation();
  const toTask = trpc.operator.promiseToTask.useMutation();
  const accept = trpc.operator.commitmentAccept.useMutation();
  const dismiss = trpc.operator.commitmentDismiss.useMutation();
  const utils = trpc.useUtils();

  // Home's proposed row and Nick's chip link to /missions#promises: land open.
  useEffect(() => {
    const sync = () => {
      if (window.location.hash === "#promises") setOpen(true);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const refresh = () => {
    void utils.operator.promisesList.invalidate();
    void utils.operator.commitmentsProposed.invalidate();
  };

  /** Hide the row at once; a failed write brings it back with a toast. */
  async function close(id: number, run: () => Promise<{ resolved?: boolean; ok?: boolean }>, done: string) {
    setBusy(id);
    setGone((s) => new Set(s).add(id));
    try {
      const out = await run();
      // false = no open row matched (closed in chat, the pulse ticker or another tab): never claim it was ours.
      if (out.resolved === false || out.ok === false) toast.message("Already closed elsewhere.");
      else toast.success(done);
      refresh();
    } catch {
      setGone((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
      toast.error("That did not save. The promise is still open.");
    } finally {
      setBusy(null);
    }
  }

  async function drop(r: PromiseRow) {
    const ok = await confirm({
      title: "Drop this promise?",
      body: `"${r.description.slice(0, 120)}" leaves the list and does not count as kept.`,
      confirmLabel: "Drop",
      tone: "danger",
    });
    if (ok) await close(r.id, () => resolve.mutateAsync({ id: r.id, action: "drop" }), "Dropped.");
  }

  async function makeTask(id: number, missionId: string | null) {
    setBusy(id);
    try {
      const out = await toTask.mutateAsync({ id, missionId });
      if (out.taskId === null) {
        if (out.reason === "in_flight") toast.message("That task is still being made.");
        else toast.error("This promise is no longer open.");
      } else if (out.created) {
        toast.success("Task made. The promise stays open until you mark it Done.");
        void utils.task.list.invalidate();
        void utils.task.deck.invalidate();
      } else {
        toast.message("Already a task.");
      }
      setPanel(null);
      refresh();
    } catch {
      toast.error("The task was not made. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const data = list.data;
  const active = (data?.active ?? []).filter((r) => !gone.has(r.id));
  const proposed = (data?.proposed ?? []).filter((r) => !gone.has(r.id));
  const missionOptions = missions.filter((m) => (m.status ?? "ACTIVE") === "ACTIVE" && isUserProject(m));

  return (
    <section id="promises" aria-labelledby="promises-heading" className="scroll-mt-24 space-y-4">
      {dialog}
      {/* Disclosure pattern: the heading holds the button (a heading inside a button is invalid HTML). */}
      <h2 id="promises-heading" className="border-b border-edge pb-3">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="promises-body"
          onClick={() => setOpen((v) => !v)}
          className="flex min-h-[44px] w-full items-end justify-between gap-3 text-left"
        >
          <span className="vt-eyebrow text-fg-secondary">promises</span>
          <span className="font-mono text-[11px] tabular-nums text-fg-tertiary">
            {/* A count is a claim: shown only once the read has answered. */}
            {data
              ? `${data.activeCount - (data.active.length - active.length)} promises · ${data.proposedCount - (data.proposed.length - proposed.length)} proposed`
              : list.isError
                ? "not read"
                : "loading"}
            <span aria-hidden className="ml-2">
              {open ? "Hide" : "Show"}
            </span>
          </span>
        </button>
      </h2>

      {list.isError && (
        <ReadFailed onRetry={() => void list.refetch()}>Couldn&apos;t load promises (state unknown, not empty)</ReadFailed>
      )}

      {open && (
        <div id="promises-body" className="space-y-6">
          <p className="max-w-prose text-[13px] leading-relaxed text-fg-secondary">
            Promises Nick caught in your chats and journal, plus ones you made with /commit. Nick reads the active ones every
            chat. Undated ones expire after 90 days.
          </p>

          {list.isLoading && (
            <p role="status" className="font-mono text-[11px] text-fg-tertiary">
              loading promises
            </p>
          )}

          {data && (
            <>
              {active.length === 0 ? (
                <p className="text-[13px] text-fg-secondary">No open promises.</p>
              ) : (
                <ul className="divide-y divide-edge">
                  {active.map((r) => (
                    <li key={r.id} data-promise={r.id} className="space-y-2 py-3">
                      <p className="text-[15px] leading-snug text-fg">{r.description}</p>
                      <p
                        className={cn(
                          "font-mono text-[11px] tabular-nums",
                          r.deadlineDays !== null && r.deadlineDays < 0 ? "text-amber-300/90" : "text-fg-tertiary",
                        )}
                      >
                        {meta(r)}
                      </p>
                      {r.task && (
                        <p className="text-[13px] text-fg-secondary">
                          {r.task.status === "DONE" ? "Its task is done. Mark the promise Done when it is kept. " : "Task made. "}
                          <Link href={`/missions#task-row-${r.task.id}`} className="underline underline-offset-2 hover:text-fg">
                            Open task
                          </Link>
                        </p>
                      )}

                      {panel?.id === r.id && panel.kind === "edit" ? (
                        <EditForm
                          row={r}
                          busy={busy === r.id}
                          onCancel={() => setPanel(null)}
                          onSave={async (patch) => {
                            setBusy(r.id);
                            try {
                              const out = await edit.mutateAsync({ id: r.id, ...patch });
                              if (out.ok) toast.success("Saved.");
                              else toast.error("This promise is no longer open.");
                              setPanel(null);
                              refresh();
                            } catch {
                              toast.error("That did not save. Your edit is still here.");
                            } finally {
                              setBusy(null);
                            }
                          }}
                        />
                      ) : panel?.id === r.id && panel.kind === "task" ? (
                        <TaskForm
                          missions={missionOptions}
                          busy={busy === r.id}
                          onCancel={() => setPanel(null)}
                          onMake={(missionId) => void makeTask(r.id, missionId)}
                        />
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className={BUTTON}
                            disabled={busy === r.id}
                            onClick={() => void close(r.id, () => resolve.mutateAsync({ id: r.id, action: "done" }), "Marked kept.")}
                          >
                            Done
                          </button>
                          <button type="button" className={BUTTON} disabled={busy === r.id} onClick={() => void drop(r)}>
                            Drop
                          </button>
                          <button type="button" className={BUTTON} onClick={() => setPanel({ id: r.id, kind: "edit" })}>
                            Edit
                          </button>
                          {!r.task && (
                            <button type="button" className={BUTTON} onClick={() => setPanel({ id: r.id, kind: "task" })}>
                              Make it a task
                            </button>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {data.activeCount > data.active.length && (
                <p className="font-mono text-[11px] tabular-nums text-fg-tertiary">
                  First {data.active.length} of {data.activeCount}
                </p>
              )}

              {proposed.length > 0 && (
                <div className="space-y-2">
                  <h3 className="vt-eyebrow text-fg-tertiary">proposed · not on your list until you accept</h3>
                  <ul className="divide-y divide-edge">
                    {proposed.map((r) => (
                      <li key={r.id} data-promise={r.id} className="space-y-2 py-3">
                        <p className="text-[15px] leading-snug text-fg-secondary">{r.description}</p>
                        <p className="font-mono text-[11px] tabular-nums text-fg-tertiary">{meta(r)}</p>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className={BUTTON}
                            disabled={busy === r.id}
                            onClick={() => void close(r.id, () => accept.mutateAsync({ id: r.id }), "Accepted. It is on your list now.")}
                          >
                            Accept
                          </button>
                          <button
                            type="button"
                            className={BUTTON}
                            disabled={busy === r.id}
                            onClick={() => void close(r.id, () => dismiss.mutateAsync({ id: r.id }), "Dismissed. Nick will not propose it again.")}
                          >
                            Dismiss
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                  {data.proposedCount > data.proposed.length && (
                    <p className="font-mono text-[11px] tabular-nums text-fg-tertiary">
                      Newest {data.proposed.length} of {data.proposedCount}
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function EditForm({
  row,
  busy,
  onSave,
  onCancel,
}: {
  row: PromiseRow;
  busy: boolean;
  onSave: (patch: { description?: string; toWhom?: string; deadline?: string | null }) => Promise<void>;
  onCancel: () => void;
}) {
  const initialTo = row.toWhom.toLowerCase() === "self" ? "" : row.toWhom;
  const [description, setDescription] = useState(row.description);
  const [toWhom, setToWhom] = useState(initialTo);
  const [deadline, setDeadline] = useState(row.deadline ?? "");
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!description.trim()) return;
        // Only what changed: a legacy free-text deadline the date field cannot show must survive a text edit.
        const patch = {
          ...(description.trim() !== row.description ? { description: description.trim() } : {}),
          ...(toWhom.trim() !== initialTo ? { toWhom: toWhom.trim() } : {}),
          ...(deadline !== (row.deadline ?? "") ? { deadline: deadline || null } : {}),
        };
        if (Object.keys(patch).length === 0) return onCancel();
        void onSave(patch);
      }}
    >
      <label className="block space-y-1">
        <span className="text-[13px] text-fg-secondary">Promise</span>
        <textarea name="description" rows={3} className={FIELD} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label className="block space-y-1">
        <span className="text-[13px] text-fg-secondary">To (leave empty for yourself)</span>
        <input name="toWhom" className={FIELD} value={toWhom} onChange={(e) => setToWhom(e.target.value)} />
      </label>
      <div className="flex flex-wrap items-end gap-2">
        <label className="block min-w-0 flex-1 space-y-1">
          <span className="text-[13px] text-fg-secondary">Deadline</span>
          <input name="deadline" type="date" className={cn(FIELD, "min-h-[44px]")} value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </label>
        <button type="button" className={BUTTON} onClick={() => setDeadline("")}>
          No date
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={BUTTON} disabled={busy || !description.trim()}>
          Save
        </button>
        <button type="button" className={BUTTON} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function TaskForm({
  missions,
  busy,
  onMake,
  onCancel,
}: {
  missions: MissionOption[];
  busy: boolean;
  onMake: (missionId: string | null) => void;
  onCancel: () => void;
}) {
  const [missionId, setMissionId] = useState("");
  return (
    <div className="space-y-3">
      <label className="block space-y-1">
        <span className="text-[13px] text-fg-secondary">Put the task in</span>
        <select className={cn(FIELD, "min-h-[44px]")} value={missionId} onChange={(e) => setMissionId(e.target.value)}>
          <option value="">Inbox</option>
          {missions.map((m) => (
            <option key={m.id} value={m.id}>
              {m.title}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={BUTTON} disabled={busy} onClick={() => onMake(missionId || null)}>
          Make the task
        </button>
        <button type="button" className={BUTTON} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
