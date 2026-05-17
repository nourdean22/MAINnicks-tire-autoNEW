/**
 * GET /api/cron/task-resurface · Wave 26 (v10.0.529.82) · B1
 *
 * Closes the snooze broken-promise bug. Pre-Wave-26 the snooze UI
 * parked tasks in WAITING with no wake-up timestamp · they never came
 * back unless the operator manually unblocked them.
 *
 * This cron flips status WAITING → READY when snoozedUntil ≤ now,
 * clears the snoozedUntil field, and emits a "snoozed" event (kind:
 * "resurfaced") so the TaskEvent log carries the lifecycle move.
 *
 * Folded into mega-morning. Idempotent: the snoozedUntil null write
 * is the lock — second pass on the same row is a no-op.
 */

import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { emitTaskEventAsync } from "@/lib/brain/task-events";

export const dynamic = "force-dynamic";

export const GET = apiHandler(
  async () => {
    const now = new Date();

    const due = await prisma.task
      .findMany({
        where: {
          status: "WAITING",
          snoozedUntil: { not: null, lte: now },
          deletedAt: null,
        },
        select: { id: true, title: true },
        take: 100,
      })
      .catch((): Array<{ id: string; title: string }> => []);

    if (due.length === 0) {
      return { ok: true, resurfaced: 0 };
    }

    const ids = due.map((t) => t.id);
    await prisma.task.updateMany({
      where: { id: { in: ids } },
      data: {
        status: "READY",
        snoozedUntil: null,
        lastTouchedAt: now,
      },
    });

    // Fire-and-forget audit events · use "revived" kind which already
    // exists in the TaskEventKind union for ARCHIVED→READY moves. A
    // resurfaced snooze is semantically the same lifecycle: from
    // hidden back to actionable.
    for (const t of due) {
      emitTaskEventAsync({
        taskId: t.id,
        kind: "revived",
        source: "cron:task-resurface",
      });
    }

    return {
      ok: true,
      resurfaced: due.length,
      sample: due.slice(0, 5).map((t) => t.title),
    };
  },
  { auth: "cron" },
);
