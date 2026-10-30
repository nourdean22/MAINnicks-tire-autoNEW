/**
 * The recall line in task detail · 2026-10-29 (task upgrades phase 2,
 * benchmark pick 2: Rosebud / Jarvis "it remembers you").
 *
 * One sourced line: the newest thing the relationship ledger recorded about
 * the task's person, with its date and source, so it can be judged. Exact
 * links only. The semantic recall lanes have no min-score (memory-recall.ts),
 * so a top-1 hit on a task title would always return something, often wrong;
 * the benchmark's kill criterion is more than 1 wrong line in 5.
 *
 * Contact rows only (contactRowsOnly): a synthetic mention or a status flip is
 * not something the person said or did. The filter is fetch-then-filter
 * because a Prisma JSON NOT drops the NULL-metadata rows, which are most rows.
 *
 * States: none (no person on the task), empty (person, nothing recorded),
 * line. A failed read throws so the panel shows it failed, never "none".
 */
import { prisma } from "@/lib/prisma";
import { contactRowsOnly } from "@/lib/services/people/contact-rows";
import { isDemoMode } from "@/lib/runtime";

export type TaskRecallLine =
  | { state: "none" }
  | { state: "empty"; personName: string }
  | { state: "line"; personName: string; note: string; source: string; at: string };

const NOTE_MAX = 160;
/** Page size; the read pages on until a contact row or the end, so a run of non-contact rows cannot hide one. */
const PAGE = 20;

export async function getTaskRecallLine(taskId: string): Promise<TaskRecallLine> {
  if (isDemoMode) return { state: "none" };
  const task = await prisma.task.findFirst({
    where: { id: taskId, deletedAt: null },
    select: { personId: true, person: { select: { name: true } } },
  });
  if (!task?.personId || !task.person) return { state: "none" };
  let row: { note: string; source: string; createdAt: Date } | undefined;
  for (let skip = 0; !row; skip += PAGE) {
    const page = await prisma.relationshipLedger.findMany({
      where: { personId: task.personId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip,
      take: PAGE,
      select: { note: true, source: true, createdAt: true, metadata: true },
    });
    row = contactRowsOnly(page)[0];
    if (page.length < PAGE) break;
  }
  if (!row) return { state: "empty", personName: task.person.name };
  const note = row.note.length > NOTE_MAX ? `${row.note.slice(0, NOTE_MAX - 1)}…` : row.note;
  return { state: "line", personName: task.person.name, note, source: row.source, at: row.createdAt.toISOString() };
}
