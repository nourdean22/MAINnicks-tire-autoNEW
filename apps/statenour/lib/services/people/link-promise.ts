/**
 * Link a promise task to the person it names (people W0, 2026-10-30).
 *
 * Task.personId was only set when the model passed a real profile id, so in
 * prod 0 tasks were linked and "open promises to X" always read empty, while
 * 15 promise tasks named someone in `promiseTo`. Exact or case-insensitive
 * name only: he never confirmed this link, so a fuzzy tier must not guess.
 * Compare-and-set on personId so a deliberate link is never overwritten.
 */
import { prisma } from "@/lib/prisma";
import { resolvePersonByName } from "@/lib/brain/person-profile-fuzzy";
import { logError } from "@/lib/utils/error-log";

const SELF = /^(me|myself|self|i)$/i;

export type LinkPromiseOutcome = "linked" | "skipped" | "no_match" | "error";

export async function linkPromiseToPerson(taskId: string): Promise<LinkPromiseOutcome> {
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, personId: true, promiseTo: true },
    });
    const name = task?.promiseTo?.trim();
    if (!task || task.personId || !name || SELF.test(name)) return "skipped";

    const res = await resolvePersonByName(name, { createIfMissing: false });
    if (!res.person || (res.matchTier !== "exact" && res.matchTier !== "case_insensitive")) return "no_match";

    const out = await prisma.task.updateMany({ where: { id: task.id, personId: null }, data: { personId: res.person.id } });
    return out.count > 0 ? "linked" : "skipped";
  } catch (err) {
    // The caller ignores the outcome, so this log is the only trace a link failed.
    logError("people.link-promise", err, { taskId });
    return "error";
  }
}
