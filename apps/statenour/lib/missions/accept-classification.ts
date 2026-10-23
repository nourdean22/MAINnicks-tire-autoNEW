/**
 * Accept the parked mission/goal suggestion on a task (the operator's explicit
 * yes from the /missions chip). Moved out of the tRPC router (2026-10-23) so
 * the target check is testable: a suggestion aimed at a mission that is no
 * longer ACTIVE, or is soft-deleted, is refused, never applied (map F3).
 * goalId/statHints only fill when still unset.
 */
import { prisma } from "@/lib/prisma";
import { ServiceError } from "@/lib/utils/service-error";

export async function acceptTaskClassification(taskId: string) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { goalId: true, statHints: true, pendingClassification: true },
  });
  if (!task) throw new ServiceError("Task not found", 404);
  const pc = (task.pendingClassification ?? null) as {
    missionId?: string | null;
    goalId?: string | null;
    statHints?: string[] | null;
  } | null;
  if (!pc) return { ok: true as const, noop: true as const };

  const data: Record<string, unknown> = { pendingClassification: null };
  if (pc.missionId) {
    const live = await prisma.mission.findFirst({
      where: { id: pc.missionId, status: "ACTIVE", deletedAt: null },
      select: { id: true },
    });
    if (!live) throw new ServiceError("The suggested mission is not active. File the task yourself.", 409);
    data.missionId = pc.missionId;
  }
  if (pc.goalId && !task.goalId) data.goalId = pc.goalId;
  if (Array.isArray(pc.statHints) && pc.statHints.length > 0 && task.statHints.length === 0) {
    data.statHints = pc.statHints;
  }
  await prisma.task.update({ where: { id: taskId }, data });
  return {
    ok: true as const,
    applied: {
      missionId: (data.missionId as string | undefined) ?? null,
      goalId: (data.goalId as string | undefined) ?? null,
    },
  };
}
