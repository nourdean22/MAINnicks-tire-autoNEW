/**
 * GET /api/cron/bus-exhaustion-watch · v10.0.89 · 2026-05-02.
 *
 * Watchdog over brain_bus_events backlog. Fires Telegram alert when:
 *   · pendingCount > 1000 (backlog runaway)
 *   · deadCount > 50 (lots of permanent failures)
 *   · stuckProcessing for >5 minutes (consumer crashed)
 *
 * Idempotent per-day per-condition so we don't spam.
 *
 * Cadence: every 30 minutes — fast enough to catch a runaway,
 * slow enough to not be noisy.
 */

import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { sendTelegram } from "@/lib/services/telegram";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("cron/bus-exhaustion-watch");
const MARKER_CATEGORY = "bus_exhaustion_pushed";

const PENDING_THRESHOLD = 1000;
const DEAD_THRESHOLD = 50;
const STUCK_PROCESSING_MS = 5 * 60_000;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export const maxDuration = 60;

export const GET = cronHandler(async () => {
  const fiveMinAgo = new Date(Date.now() - STUCK_PROCESSING_MS);

  const [pendingCount, deadCount, stuckCount, oldestPending] = await Promise.all([
    prisma.brainBusEvent.count({ where: { status: "pending" } }),
    prisma.brainBusEvent.count({ where: { status: "dead" } }),
    prisma.brainBusEvent.count({
      where: { status: "processing", lockedAt: { lt: fiveMinAgo } },
    }),
    prisma.brainBusEvent.findFirst({
      where: { status: "pending" },
      orderBy: { availableAt: "asc" },
      select: { availableAt: true, topic: true },
    }),
  ]);

  const conditions: Array<{ key: string; severity: "warning" | "critical"; line: string }> = [];
  if (pendingCount > PENDING_THRESHOLD) {
    conditions.push({
      key: "pending_runaway",
      severity: "critical",
      line: `<b>🌊 Bus pending runaway · ${pendingCount} events queued</b>\nthreshold ${PENDING_THRESHOLD}`,
    });
  }
  if (deadCount > DEAD_THRESHOLD) {
    conditions.push({
      key: "dead_pile",
      severity: "warning",
      line: `<b>🪦 Bus dead-letter pile · ${deadCount} events</b>\nthreshold ${DEAD_THRESHOLD} · review at /system/brain-bus/dead`,
    });
  }
  if (stuckCount > 0) {
    conditions.push({
      key: "stuck_processing",
      severity: "critical",
      line: `<b>🔒 Bus consumer stuck · ${stuckCount} events processing >5min</b>\nLikely crashed worker; reclaim cron clears these`,
    });
  }

  // Surface a non-alerting "info" for the oldest pending item so it
  // shows up in cron-runs even when nothing's wrong
  const oldestPendingAgeMin = oldestPending?.availableAt
    ? Math.round((Date.now() - oldestPending.availableAt.getTime()) / 60_000)
    : null;

  if (conditions.length === 0) {
    return {
      ok: true,
      pending: pendingCount,
      dead: deadCount,
      stuck: stuckCount,
      oldestPendingAgeMin,
      pushed: 0,
      note: "all clear",
    };
  }

  // Idempotent push per (condition, day)
  const dayKey = new Date().toISOString().slice(0, 10);
  let pushed = 0;
  let alreadyPushed = 0;
  for (const c of conditions) {
    const mkey = `${c.key}__${dayKey}`;
    try {
      await prisma.brainMemory.create({
        data: {
          category: MARKER_CATEGORY,
          key: mkey,
          content: `${c.severity} · ${c.line.replace(/<[^>]+>/g, "")}`,
          confidence: 1.0,
          source: "cron:bus-exhaustion-watch",
        },
      });
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === "P2002") {
        alreadyPushed++;
        continue;
      }
      log.warn("marker_failed", { err: err instanceof Error ? err.message : String(err) });
      continue;
    }
    const ok = await sendTelegram(c.line, undefined, "HTML");
    if (ok) pushed++;
  }

  return {
    ok: true,
    pending: pendingCount,
    dead: deadCount,
    stuck: stuckCount,
    oldestPendingAgeMin,
    conditions: conditions.map((c) => c.key),
    pushed,
    alreadyPushed,
  };
});
