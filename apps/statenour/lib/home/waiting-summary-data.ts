/**
 * lib/home/waiting-summary-data.ts · 2026-10-02 · full-circle Lane B
 *
 * The reads behind composeWaitingSummary (lib/home/waiting-summary.ts). Every
 * read runs behind its own guard and a failure becomes `null`, never `[]` or
 * `0`, so the composer can name it as failed instead of rendering an empty
 * queue. Read-only: nothing here writes. The Nick's Tire bridge is read through
 * the existing queryNickBatch with a bound, so a slow shop never holds Home.
 */

import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";
import { listPendingActions } from "@/lib/automation/approval-queue";
import { queryNickBatch } from "@/lib/nickstire/query";
import { today } from "@/lib/utils/datetime";
import {
  composeWaitingSummary,
  normalizeBridgeRead,
  type BridgeCallbackRow,
  type BridgeLeadRow,
  type WaitingInput,
  type WaitingSummary,
} from "@/lib/home/waiting-summary";

const log = rootLogger.withSurface("home/waiting-summary");

/** The shop gets this long to answer both questions; past it the bridge counts as failed, not empty. */
export const BRIDGE_TIMEOUT_MS = 6_000;
const ROW_CAP = 200;

async function guarded<T>(source: string, p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (error) {
    log.warn("waiting_summary_read_failed", {
      source,
      error: error instanceof Error ? error.message.slice(0, 200) : String(error),
    });
    return null;
  }
}

async function readBridge(): Promise<WaitingInput["bridge"]> {
  const timeout = new Promise<null>((resolve) => {
    const t = setTimeout(() => resolve(null), BRIDGE_TIMEOUT_MS);
    (t as { unref?: () => void }).unref?.();
  });
  const answers = await Promise.race([
    queryNickBatch([{ query: "callbacks_pending" }, { query: "leads_urgent" }]).catch(() => null),
    timeout,
  ]);
  if (!answers) return null;
  return {
    callbacks: normalizeBridgeRead<BridgeCallbackRow>(answers["callbacks_pending"], "pending"),
    urgentLeads: normalizeBridgeRead<BridgeLeadRow>(answers["leads_urgent"], "urgentLeads"),
  };
}

export async function buildWaitingSummary(now = new Date()): Promise<WaitingSummary> {
  const [tasks, approvalRequests, pendingActions, commitments, actionAttempts, bridge] = await Promise.all([
    guarded(
      "tasks",
      prisma.task.findMany({
        where: {
          deletedAt: null,
          status: { notIn: ["DONE", "ARCHIVED"] },
          waitingOn: { not: null },
        },
        select: { id: true, title: true, status: true, waitingOn: true, updatedAt: true, dueDate: true },
        orderBy: { updatedAt: "asc" },
        take: ROW_CAP,
      }),
    ),
    guarded(
      "approvals",
      prisma.approvalRequest.findMany({
        where: { status: "pending_approval", expiresAt: { gt: now } },
        select: { id: true, actionType: true, reason: true, createdAt: true, expiresAt: true },
        orderBy: { createdAt: "asc" },
        take: ROW_CAP,
      }),
    ),
    guarded("approvals", listPendingActions()),
    guarded(
      "commitments",
      prisma.commitment.findMany({
        where: { status: { in: ["proposed", "accepted", "active"] }, deletedAt: null },
        select: { id: true, description: true, toWhom: true, deadline: true, status: true, dateMade: true },
        orderBy: { deadline: "asc" },
        take: ROW_CAP,
      }),
    ),
    guarded(
      "action attempts",
      prisma.actionAttempt.findMany({
        where: { state: { in: ["WAITING_APPROVAL", "EXECUTING"] } },
        select: { id: true, tool: true, operationKey: true, state: true, reason: true, startedAt: true },
        orderBy: { startedAt: "asc" },
        take: ROW_CAP,
      }),
    ),
    readBridge(),
  ]);

  return composeWaitingSummary({
    now,
    todayYmd: today(),
    tasks,
    approvalRequests,
    pendingActions,
    commitments,
    actionAttempts,
    bridge,
  });
}
