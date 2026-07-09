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
import { logger } from "@/lib/logger";

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
      .catch((err): Array<{ id: string; title: string }> => {
        // 2026-05-30 · was a silent `=> []` — a DB failure here returned
        // ok:{resurfaced:0} as if nothing was due. Breadcrumb so a real
        // failure is diagnosable (next run retries; the [] fallback stays).
        logger.warn("task_resurface_query_failed", {
          error: err instanceof Error ? err.message.slice(0, 160) : String(err),
        });
        return [];
      });

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

    // AG-18 · notify instead of silently flipping status — a snoozed
    // task waking up is a promise being kept; the operator never saw it.
    // One batched message per run, never per-task spam; best-effort.
    try {
      const { sendTelegram } = await import("@/lib/services/telegram");
      const titles = due.slice(0, 10).map((t) => `• ${t.title.slice(0, 60)}`);
      const extra = due.length > 10 ? `\n…and ${due.length - 10} more` : "";
      await sendTelegram(`⏰ <b>Back on deck</b>\n\n${titles.join("\n")}${extra}`);
    } catch (err) {
      logger.warn("task_resurface_notify_failed", {
        error: err instanceof Error ? err.message.slice(0, 160) : String(err),
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
