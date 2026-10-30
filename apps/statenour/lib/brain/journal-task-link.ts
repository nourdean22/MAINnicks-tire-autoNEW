/**
 * A journal entry's tasks follow its goal link (2026-10-30, job goals-system W3b).
 *
 * journal-ingest.ts creates Inbox tasks from an entry's action items before the async
 * grounding pass (journal-brain.ts) links the entry to a goal, so those tasks never got a
 * goalId and goal progress never followed the journal. Ingest now records the ids it created
 * in the entry's extractedItems JSON (`createdTaskIds`); a trusted link gives exactly those
 * tasks the goal, only where goalId is still empty. (The task's autoPriorityExplanation stamp
 * could not do this: the priority scorer overwrites it, 0 of 233 live tasks kept it.)
 */
import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("brain/journal-task-link");

/** extractedItems JSON with `createdTaskIds` added; an unreadable blob is left as it was. */
export function withCreatedTaskIds(extractedItems: string, ids: string[]): string {
  try {
    const obj = JSON.parse(extractedItems) as Record<string, unknown>;
    return JSON.stringify({ ...obj, createdTaskIds: ids });
  } catch {
    return extractedItems;
  }
}

export function createdTaskIdsOf(extractedItems: string | null): string[] {
  if (!extractedItems) return [];
  try {
    const ids = (JSON.parse(extractedItems) as { createdTaskIds?: unknown }).createdTaskIds;
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

async function taskIdsOfEntry(dumpId: string): Promise<string[]> {
  const row = await prisma.brainDump.findUnique({ where: { id: dumpId }, select: { extractedItems: true } });
  return createdTaskIdsOf(row?.extractedItems ?? null);
}

/** Give the entry's own live tasks the goal, only where goalId is still empty (one atomic update). */
export async function linkJournalTasksToGoal(dumpId: string, goalId: string): Promise<number> {
  try {
    const ids = await taskIdsOfEntry(dumpId);
    if (ids.length === 0) return 0;
    const r = await prisma.task.updateMany({ where: { id: { in: ids }, goalId: null, deletedAt: null }, data: { goalId } });
    return r.count;
  } catch (err) {
    log.warn("link_failed", { dumpId, err: err instanceof Error ? err.message.slice(0, 200) : String(err) });
    return 0;
  }
}

/** Take back only what a link gave: this entry's tasks that point at this goal. */
export async function unlinkJournalTasksFromGoal(dumpId: string, goalId: string): Promise<number> {
  try {
    const ids = await taskIdsOfEntry(dumpId);
    if (ids.length === 0) return 0;
    const r = await prisma.task.updateMany({ where: { id: { in: ids }, goalId }, data: { goalId: null } });
    return r.count;
  } catch (err) {
    log.warn("unlink_failed", { dumpId, err: err instanceof Error ? err.message.slice(0, 200) : String(err) });
    return 0;
  }
}
