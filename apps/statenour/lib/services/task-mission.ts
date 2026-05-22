/**
 * lib/services/task-mission.ts · actions-surface REST→tRPC slice
 * (2026-05-22 · legacy-modernizer · components/actions/* slice).
 *
 * The "leave the current project" operation for a task. The legacy
 * call-sites (ProjectDetail clear-inbox + remove-from-project,
 * LinkProjectPicker "leave mission") all PATCH'd /api/tasks/[id] with
 * `{ missionId: null }`.
 *
 * That payload was STRUCTURALLY DEAD on two layers:
 *   1. `Task.missionId` is a non-nullable `String` FK with
 *      `onDelete: Restrict` (prisma/schema.prisma:295) — Prisma rejects
 *      a `null` write outright.
 *   2. The shared `taskUpdateSchema` types `missionId` as a required
 *      string — `updateTask()` rejects `{ missionId: null }` at
 *      `.parse()` before it ever reaches the DB.
 * So the old "leave a project" affordance never worked — it surfaced a
 * generic failure toast every time.
 *
 * The DB-valid interpretation of "leave a project" on a non-nullable FK
 * is to re-point the task at the catch-all **Inbox** mission. That is
 * exactly what the UI copy promises ("keeps the task, clears the link",
 * "task lives on NOW"), and it mirrors the precedent set by the
 * `task.domainSwap` procedure (which moves a task to a per-domain Inbox
 * mission because `domain` lives on Mission, not Task). This service is
 * the single source of truth for that move — the REST route and the new
 * `task.leaveMission` tRPC procedure both call it.
 */

import { prisma } from "@/lib/prisma";
import { resolveInboxMissionId } from "@/lib/services/missions";
import { ServiceError } from "@/lib/utils/service-error";

/** The result of moving a task off its project · the new Inbox binding. */
export interface LeaveMissionResult {
  task: {
    id: string;
    missionId: string;
    mission: { id: string; title: string; domain: string } | null;
  };
}

/**
 * Move a task off its current project by re-pointing it at the canonical
 * Inbox mission. The REST route and the `task.leaveMission` procedure
 * both call this. Throws `ServiceError(404)` when the task does not
 * exist so both transports reject identically.
 */
export async function leaveMission(
  taskId: string,
): Promise<LeaveMissionResult> {
  const existing = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true },
  });
  if (!existing) {
    throw new ServiceError("Task not found", 404);
  }

  const inboxId = await resolveInboxMissionId();

  const task = await prisma.task.update({
    where: { id: taskId },
    data: { missionId: inboxId, lastTouchedAt: new Date() },
    include: { mission: true },
  });

  return {
    task: {
      id: task.id,
      missionId: task.missionId,
      mission: task.mission
        ? {
            id: task.mission.id,
            title: task.mission.title,
            domain: task.mission.domain,
          }
        : null,
    },
  };
}
