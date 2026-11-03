/**
 * The journal's day view (job 2026-11-02-nour-os-interconnect W7, Tana T3): what got done that day and who he was
 * in contact with, beside that day's entries.
 *
 * relatedActivity (related-activity.ts) answers "everything about ONE goal, mission or person"; it has no key for
 * "everything on one day", so this is the day-bounded helper beside it, reading the same tables the same way:
 * task completions (TaskEvent kind "completed") and relationship-ledger CONTACT rows (contactRowsOnly). The day is
 * an America/New_York calendar day. Each read fails on its own and is named in `failed` (empty-vs-error).
 */
import { TRPCError } from "@trpc/server";

import { prisma } from "@/lib/prisma";
import { contactRowsOnly } from "@/lib/services/people/contact-rows";
import { etMidnightToUtc } from "@/lib/utils/datetime";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("services/journal-day");

/** CONTROLS RULE: rows read per table for one day, named once. */
export const DAY_ROWS_CAP = 100;

export interface DayActivity {
  date: string;
  tasksDone: { taskId: string; title: string; at: string; goal: { id: string; title: string } | null }[];
  contacts: { id: string; person: { id: string; name: string }; note: string; source: string; at: string }[];
  /** "tasks" | "contacts": reads that threw. Their rows are missing, not zero. */
  failed: string[];
  /** "tasks" | "contacts": reads that filled DAY_ROWS_CAP. The latest rows are shown, older ones are not. */
  truncated: string[];
}

/** [start, end) of an ET calendar day given as YYYY-MM-DD; the DST days are 23 and 25 hours long. */
export function etDayBounds(date: string): { start: Date; end: Date } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const [y, mo, d] = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
  // Rebuilt through Date.UTC: a day the month does not have (Feb 31) rolls over, and is refused rather than read.
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (!m || check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `not a calendar date: ${date}` });
  }
  return { start: etMidnightToUtc(y, mo, d), end: etMidnightToUtc(y, mo, d + 1) };
}

type LiveGoal = { id: string; title: string; deletedAt: Date | null } | null | undefined;
const live = (g: LiveGoal) => (g && !g.deletedAt ? { id: g.id, title: g.title } : null);

export async function dayActivity(date: string): Promise<DayActivity> {
  const { start, end } = etDayBounds(date);
  const createdAt = { gte: start, lt: end };
  const [events, ledger] = await Promise.allSettled([
    prisma.taskEvent.findMany({
      where: { kind: "completed", createdAt },
      // Newest first: when a day overflows the cap, the oldest rows drop, never the latest.
      orderBy: { createdAt: "desc" },
      take: DAY_ROWS_CAP,
      select: {
        id: true,
        createdAt: true,
        task: {
          select: {
            id: true,
            title: true,
            goal: { select: { id: true, title: true, deletedAt: true } },
            mission: { select: { lifeGoal: { select: { id: true, title: true, deletedAt: true } } } },
          },
        },
      },
    }),
    prisma.relationshipLedger.findMany({
      where: { createdAt },
      orderBy: { createdAt: "desc" },
      take: DAY_ROWS_CAP,
      select: {
        id: true,
        note: true,
        source: true,
        createdAt: true,
        metadata: true,
        person: { select: { id: true, name: true, deletedAt: true } },
      },
    }),
  ]);

  const failed: string[] = [];
  const fail = (read: string, reason: unknown) => {
    log.warn("day_read_failed", { read, date, err: reason instanceof Error ? reason.message : String(reason) });
    failed.push(read);
  };

  const truncated: string[] = [];
  const tasksDone: DayActivity["tasksDone"] = [];
  if (events.status === "fulfilled") {
    if (events.value.length >= DAY_ROWS_CAP) truncated.push("tasks");
    const seen = new Set<string>();
    for (const e of [...events.value].reverse()) {
      // A recurring task completed twice in a day is one done task on this list.
      if (!e.task || seen.has(e.task.id)) continue;
      seen.add(e.task.id);
      // The task's own goal overrides its mission's (lib/missions/task-goal.ts taskGoal).
      const goal = live(e.task.goal) ?? live(e.task.mission?.lifeGoal);
      tasksDone.push({ taskId: e.task.id, title: e.task.title, at: e.createdAt.toISOString(), goal });
    }
  } else fail("tasks", events.reason);

  const contacts: DayActivity["contacts"] = [];
  if (ledger.status === "fulfilled") {
    if (ledger.value.length >= DAY_ROWS_CAP) truncated.push("contacts");
    for (const l of contactRowsOnly([...ledger.value].reverse())) {
      if (!l.person || l.person.deletedAt) continue;
      contacts.push({
        id: l.id,
        person: { id: l.person.id, name: l.person.name },
        note: l.note,
        source: l.source,
        at: l.createdAt.toISOString(),
      });
    }
  } else fail("contacts", ledger.reason);

  return { date, tasksDone, contacts, failed, truncated };
}
