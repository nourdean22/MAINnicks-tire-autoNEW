/**
 * Subtask checklist for task detail · 2026-10-29 (task upgrades phase 2,
 * benchmark pick 3: Google Tasks / Structured).
 *
 * Children are ordinary Task rows with parentTaskId (one level only). Ticking
 * one goes through the existing task.update path, so completion side effects
 * stay in one place; this module only lists and adds.
 */
import { prisma } from "@/lib/prisma";
import { ServiceError } from "@/lib/utils/service-error";
import { createTask } from "@/lib/services/tasks";

export async function listSubtasks(parentId: string) {
  return prisma.task.findMany({
    where: { parentTaskId: parentId, deletedAt: null, status: { not: "ARCHIVED" } },
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true, status: true },
  });
}

export async function addSubtask(parentId: string, rawTitle: string) {
  const title = rawTitle.trim();
  if (!title) throw new ServiceError("A step needs a title.", 400);
  const parent = await prisma.task.findFirst({
    where: { id: parentId, deletedAt: null },
    select: { id: true, missionId: true, parentTaskId: true },
  });
  if (!parent) throw new ServiceError("Task not found.", 404);
  if (parent.parentTaskId) throw new ServiceError("Steps go one level deep: add this to the parent task.", 400);
  // createTask (not createTaskFromAPI): no Telegram ping per checklist line.
  const vm = await createTask({ title, missionId: parent.missionId, parentTaskId: parent.id, status: "READY" });
  if (!vm) throw new ServiceError("The step was not saved.", 500);
  return { id: vm.id, title: vm.title, status: vm.status };
}
