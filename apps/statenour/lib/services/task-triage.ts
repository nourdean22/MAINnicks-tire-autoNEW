/**
 * Mandatory-exit task triage (spine-5, 2026-07-28).
 *
 * The task system could count the Inbox and mutate tasks; nothing made
 * commitment clarity a BEHAVIOR. This is the decision machine's server
 * contract: ONE item at a time, and every exit is a real choice mapped
 * onto the EXISTING status vocabulary (no new enum):
 *
 *   do_today  → READY  + dueDate today EOD (actionable, due now)
 *   schedule  → WAITING + snoozedUntil = startAt (the existing
 *               task-resurface mechanic brings it back on that day —
 *               start date is deliberately NOT the deadline)
 *   available → READY (actionable, no artificial date)
 *   someday   → WAITING + snoozedUntil +30d (a real Someday: leaves the
 *               Inbox, resurfaces monthly instead of rotting)
 *   kill      → ARCHIVED (delete-adjacent without breaking the event FK)
 *
 * Every decision appends a TaskEvent kind="triaged" with the decision
 * payload — the rolled-forward counter is COUNTED from these events,
 * not stored as a mutable field that can drift.
 */
import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/utils/error-log";

export type TriageDecision = "do_today" | "schedule" | "available" | "someday" | "kill";

export interface TriageNextItem {
  id: string;
  title: string;
  createdAt: Date;
  inboxAgeDays: number;
  timesTriaged: number;
  inboxRemaining: number;
}

/** The single oldest INBOX task, with its triage history. */
export async function triageNext(): Promise<TriageNextItem | null> {
  const [item, remaining] = await Promise.all([
    prisma.task.findFirst({
      where: { status: "INBOX", deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: { id: true, title: true, createdAt: true },
    }),
    prisma.task.count({ where: { status: "INBOX", deletedAt: null } }),
  ]);
  if (!item) return null;
  const timesTriaged = await prisma.taskEvent.count({
    where: { taskId: item.id, kind: "triaged" },
  });
  return {
    id: item.id,
    title: item.title,
    createdAt: item.createdAt,
    inboxAgeDays: Math.floor((Date.now() - item.createdAt.getTime()) / 86_400_000),
    timesTriaged,
    inboxRemaining: remaining,
  };
}

function endOfToday(): Date {
  const d = new Date();
  d.setHours(23, 59, 59, 0);
  return d;
}

export async function triageDecide(params: {
  taskId: string;
  decision: TriageDecision;
  /** For `schedule` — the START date (not the deadline). */
  startAt?: Date | null;
  by: string;
}): Promise<{ ok: true; applied: TriageDecision } | { ok: false; error: string }> {
  const task = await prisma.task.findUnique({
    where: { id: params.taskId },
    select: { id: true, status: true, deletedAt: true },
  });
  if (!task || task.deletedAt) return { ok: false, error: "task not found" };
  if (task.status !== "INBOX") {
    return { ok: false, error: `not in INBOX (currently ${task.status}) — triage only decides Inbox items` };
  }

  const data: Record<string, unknown> = (() => {
    switch (params.decision) {
      case "do_today":
        return { status: "READY", dueDate: endOfToday() };
      case "schedule": {
        if (!params.startAt) return {};
        return { status: "WAITING", snoozedUntil: params.startAt };
      }
      case "available":
        return { status: "READY" };
      case "someday":
        return { status: "WAITING", snoozedUntil: new Date(Date.now() + 30 * 86_400_000) };
      case "kill":
        return { status: "ARCHIVED" };
    }
  })();
  if (params.decision === "schedule" && !params.startAt) {
    return { ok: false, error: "schedule requires a start date" };
  }

  await prisma.task.update({ where: { id: params.taskId }, data });

  // Append-only decision receipt; failures are loud but never undo the
  // decision (the status change IS the commitment; the event is the audit).
  await prisma.taskEvent
    .create({
      data: {
        taskId: params.taskId,
        kind: "triaged",
        payload: {
          decision: params.decision,
          by: params.by,
          ...(params.startAt ? { startAt: params.startAt.toISOString() } : {}),
        },
        source: "triage",
      },
    })
    .catch((e) => logError("tasks.triage", e, { stage: "event", taskId: params.taskId }, "warn"));

  return { ok: true, applied: params.decision };
}
