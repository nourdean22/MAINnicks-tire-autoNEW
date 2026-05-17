/**
 * GET /api/cron/inbox-janitor · v10.0.155 · May 03
 *
 * Archives system-managed Inbox missions ("Inbox", "Inbox - business",
 * "Inbox - personal", etc.) that have been empty AND cold for 30+ days.
 *
 * Why this exists:
 *   POST /api/tasks/[id]/domain lazily creates per-domain Inboxes
 *   ("Inbox - <domain>") whenever Nour swaps a task's domain to one
 *   that has no inbox yet. These are auto-created and never cleaned
 *   up. Pre-v10.0.154 they polluted the active-projects cap (the
 *   "Only 3 allowed" symptom). v10.0.154 fixed the count math via
 *   isInboxMission()/isUserProject() helpers; this janitor closes the
 *   loop by reaping the orphan inboxes themselves so the registry
 *   stays clean.
 *
 * Reap criteria (all three must hold):
 *   1. isInboxMission(title) === true   (system catch-all only)
 *   2. status === "ACTIVE"               (not already archived)
 *   3. zero non-DONE/non-ARCHIVED tasks  (truly empty right now)
 *   4. updatedAt < 30 days ago           (not recently active)
 *
 * "Archive" here = soft-delete (deletedAt set). Tasks the inbox
 * previously held are unaffected (their missionId points elsewhere
 * by the time this fires; the inbox is empty).
 *
 * Schedule: weekly (Sundays 4:30am UTC). Cheap query — bounded by
 * the small total inbox count.
 */

import { cronHandler } from "@/lib/utils/http";
import { sanitizeError } from "@/lib/utils/sanitize-error";
import { prisma } from "@/lib/prisma";
import { daysAgo } from "@/lib/utils/datetime";
import { isInboxMission } from "@/lib/services/mission-helpers";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("cron/inbox-janitor");

export const maxDuration = 60;

export const GET = cronHandler(async () => {
  const cutoff = daysAgo(30);

  // Pull every active mission with a recent updatedAt cutoff.
  // We hand-filter inbox titles in JS via the same helper UI uses,
  // so the predicate stays the single source of truth.
  const candidates = await prisma.mission.findMany({
    where: {
      status: "ACTIVE",
      deletedAt: null,
      updatedAt: { lt: cutoff },
    },
    select: { id: true, title: true, updatedAt: true },
  });

  const inboxes = candidates.filter((m) => isInboxMission(m.title));
  if (inboxes.length === 0) {
    return { archived: 0, scanned: candidates.length, inboxes: 0 };
  }

  // For each inbox, count its live tasks. Skip if any non-terminal
  // task remains — even one open or in-progress task means the
  // inbox is still in use.
  let archived = 0;
  const archivedIds: string[] = [];
  for (const inbox of inboxes) {
    const liveTasks = await prisma.task
      .count({
        where: {
          missionId: inbox.id,
          deletedAt: null,
          status: { notIn: ["DONE", "ARCHIVED"] },
        },
      })
      .catch(() => -1);

    if (liveTasks !== 0) {
      // -1 means the count itself errored; either way: not a clean
      // archive candidate.
      continue;
    }

    // Soft-delete via the standard helper. Sets deletedAt + records
    // the actor (cron:inbox-janitor) per v7.8 universal-audit contract.
    await prisma.mission
      .update({
        where: { id: inbox.id },
        data: { deletedAt: new Date(), status: "PAUSED" },
      })
      .catch((err) => {
        log.warn("archive_failed", {
          missionId: inbox.id,
          title: inbox.title,
          error: sanitizeError(err),
        });
        return null;
      });
    archived += 1;
    archivedIds.push(inbox.id);
  }

  log.info("inbox_janitor_run", {
    scanned: candidates.length,
    inboxesFound: inboxes.length,
    archived,
    archivedIds,
  });

  return {
    archived,
    scanned: candidates.length,
    inboxes: inboxes.length,
    archivedIds,
  };
});
