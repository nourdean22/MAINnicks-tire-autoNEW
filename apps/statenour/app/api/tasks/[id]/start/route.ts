/**
 * POST /api/tasks/[id]/start — start the DOING timer on a task.
 *
 * Sets status = DOING and startedAt = now. Paired with the
 * existing POST /api/tasks/[id]/check which computes the time
 * diff and bumps actualMinutes when the task gets completed.
 *
 * Idempotent: if the task is already DOING, updates startedAt
 * only if it's null (so a stale timer gets refreshed).
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

import { requireSession } from "@/lib/auth-guard";
import { auditUpdate } from "@/lib/db/actor";
import { logUpdate, stripNoise } from "@/lib/db/entity-audit";
import { emitTaskEventAsync } from "@/lib/brain/task-events";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireSession(req);
  const { id } = await params;

  const task = await prisma.task.findUnique({
    where: { id },
    select: { id: true, status: true, startedAt: true, lastTouchedAt: true },
  });

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const now = new Date();
  const updated = await prisma.task.update({
    where: { id },
    data: {
      status: "DOING",
      startedAt: task.startedAt && task.status === "DOING" ? undefined : now,
      lastTouchedAt: now,
      // v9.1.19 · attach actor (resolves to "user" from session via
      // ALS) so the row records who started the timer.
      ...auditUpdate(),
    },
    select: { id: true, status: true, startedAt: true, lastTouchedAt: true },
  });

  // v9.1.19 · entity-audit log fire-and-forget.
  void logUpdate(
    "task",
    id,
    stripNoise(task as unknown as Record<string, unknown>),
    stripNoise(updated as unknown as Record<string, unknown>),
    { source: "api:tasks.start", reason: "timer started" },
  );

  // v10.0.529.106 · Wave 52 · pre-Wave-52 this endpoint silently never
  // emitted the TaskEvent.started bus event, while the equivalent
  // status=DOING transition through services/tasks.ts:updateTask did.
  // Result: the per-task-event substrate (used by /tasks history view,
  // streak math, agent traces, drift detector) saw "started" events
  // only when the user PATCHed status=DOING via the standard edit
  // endpoint · the dedicated start-button path bypassed it entirely.
  // Skip the emit when the task was already DOING (re-press of start
  // shouldn't double-record an already-active timer).
  if (task.status !== "DOING") {
    emitTaskEventAsync({ taskId: id, kind: "started", source: "api:tasks.start" });
  }

  return NextResponse.json({ ok: true, task: updated });
}
