/**
 * lib/system/owner-panel-data.ts · 2026-09-23 · Q-24
 *
 * The reads behind composeOwnerPanel (lib/system/owner-panel.ts). Every read
 * runs behind its own guard and a failure becomes `null`, never `[]` or `0`,
 * so the composer can name it as unreadable instead of rendering a clear.
 * Read-only: nothing here writes.
 */

import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";
import { listPendingActions } from "@/lib/automation/approval-queue";
import { listLaneStatus } from "@/lib/ai/budget";
import { getOutboxHealth } from "@/lib/services/chat/post-turn-outbox";
import { today } from "@/lib/utils/datetime";
import { buildCostPerOutcomeAttribution } from "@/lib/intelligence/value-attribution";
import {
  composeOwnerPanel,
  COST_WINDOW_DAYS,
  DEPLOY_ALERT_TOOL,
  EXCEPTION_WINDOW_MS,
  type OwnerPanel,
} from "@/lib/system/owner-panel";

const log = rootLogger.withSurface("system/owner-panel");

/** Bounds the 24h cron read; ~60 jobs × a few runs/hour sits far below it. */
const CRON_ROW_CAP = 5_000;

async function guarded<T>(source: string, p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (error) {
    log.warn("owner_panel_read_failed", { source, error: error instanceof Error ? error.message.slice(0, 200) : String(error) });
    return null;
  }
}

export async function buildOwnerPanel(now = new Date()): Promise<OwnerPanel> {
  const since = new Date(now.getTime() - EXCEPTION_WINDOW_MS);
  const costSince = new Date(now.getTime() - COST_WINDOW_DAYS * 86_400_000);

  const [
    cronRows,
    deployPages,
    pendingActions,
    approvalRequests,
    expiredRequests,
    commitments,
    lanes,
    outboxHealth,
    actionAttempts,
    spendAgg,
    unpriced,
    tasksDone,
    valueAttribution,
  ] = await Promise.all([
      guarded(
        "cron runs",
        prisma.cronJobLog.findMany({
          where: { createdAt: { gte: since } },
          select: { id: true, jobName: true, status: true, error: true, skipReason: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: CRON_ROW_CAP,
        }),
      ),
      guarded(
        "deploy pages",
        prisma.actionAttempt.findMany({
          where: { tool: DEPLOY_ALERT_TOOL, startedAt: { gte: since } },
          select: { id: true, operationKey: true, state: true, reason: true, startedAt: true },
          orderBy: { startedAt: "desc" },
          take: 50,
        }),
      ),
      guarded("approvals", listPendingActions()),
      // Live and expired requests are read separately: expired rows stay pending_approval
      // forever, so one capped oldest-first list could hold only expired rows and hide
      // every live decision (Codex review on #2645).
      guarded(
        "approvals",
        prisma.approvalRequest.findMany({
          where: { status: "pending_approval", expiresAt: { gt: now } },
          select: { id: true, actionType: true, reason: true, createdAt: true, expiresAt: true },
          orderBy: { createdAt: "asc" },
          take: 200,
        }),
      ),
      guarded(
        "approvals",
        prisma.approvalRequest
          .aggregate({
            where: { status: "pending_approval", expiresAt: { lte: now } },
            _count: { _all: true },
            _min: { createdAt: true },
          })
          .then((a) => ({ count: a._count._all, oldest: a._min.createdAt })),
      ),
      guarded(
        "commitments",
        prisma.commitment.findMany({
          where: { status: { in: ["active", "accepted"] }, deadline: { not: null }, deletedAt: null },
          select: { id: true, description: true, deadline: true, toWhom: true },
          // YYYY-MM-DD sorts as a date, so the most overdue survive the cap.
          orderBy: { deadline: "asc" },
          take: 200,
        }),
      ),
      guarded("lane budgets", listLaneStatus().then((r) => r.lanes)),
      guarded("chat outbox", getOutboxHealth()),
      guarded(
        "action attempts",
        prisma.actionAttempt.findMany({
          where: {
            tool: { not: DEPLOY_ALERT_TOOL },
            OR: [
              { state: { in: ["UNKNOWN", "WAITING_APPROVAL", "EXECUTING"] } },
              { state: "FAILED", startedAt: { gte: since } },
            ],
          },
          select: {
            id: true,
            operationKey: true,
            tool: true,
            effectClass: true,
            state: true,
            reason: true,
            startedAt: true,
            settledAt: true,
            updatedAt: true,
          },
          // Oldest unresolved work survives the cap; recent FAILED rows are
          // already bounded to the exception window above.
          orderBy: { startedAt: "asc" },
          take: 200,
        }),
      ),
      guarded(
        "AI spend",
        prisma.aiGeneration.aggregate({
          where: { createdAt: { gte: costSince } },
          _sum: { costCents: true },
          _count: { _all: true },
        }),
      ),
      guarded("AI spend", prisma.aiGeneration.count({ where: { createdAt: { gte: costSince }, costCents: null } })),
      guarded(
        "completed tasks",
        prisma.task.count({ where: { status: "DONE", deletedAt: null, updatedAt: { gte: costSince } } }),
      ),
      guarded(
        "value attribution",
        buildCostPerOutcomeAttribution(COST_WINDOW_DAYS),
      ),
    ]);

  const spend =
    spendAgg === null || unpriced === null
      ? null
      : { costCents: spendAgg._sum.costCents ?? 0, calls: spendAgg._count._all, unpricedCalls: unpriced };

  return composeOwnerPanel({
    now,
    todayYmd: today(),
    cronRows,
    deployPages,
    pendingActions,
    approvalRequests,
    expiredRequests,
    commitments,
    lanes,
    outboxHealth,
    actionAttempts,
    spend,
    tasksDone,
    valueAttribution,
  });
}
