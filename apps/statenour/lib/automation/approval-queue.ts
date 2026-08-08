/**
 * Approval queue · v10.0.153 · May 03 · Slice B
 *
 * Operator-facing layer over AutonomousAction rows where
 * approval = "pending". Provides the read/write spine for the
 * /system/approvals surface — list, approve, reject — that the
 * v10.0.148 policy registry was meant to unblock.
 *
 * Per kaizen + JIT: the AutonomousAction table already carries every
 * field needed (approval, approvedBy, executedAt, payload). This
 * module is a thin governance layer on top — no new schema.
 *
 * Important caveat (intentional, documented):
 *   The autonomous-engine currently fires `rule.action(item)` for
 *   every triggered row regardless of `approval` value — pending is
 *   metadata, not a gate. So approving here is an audit/sign-off
 *   action, not an "execute now" action. A future slice will route
 *   pending rules through this queue BEFORE running the side effect;
 *   when that lands, an `approve` call will also re-execute the rule.
 *   For now: operator approval = "I reviewed this, it's intentional"
 *   and operator reject = "I reviewed this, mark for postmortem."
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ServiceError } from "@/lib/utils/service-error";
import { logger as rootLogger } from "@/lib/logger";
import { getPolicy, type ApprovalClass } from "@/lib/automation/policy";

const log = rootLogger.withSurface("automation/approval-queue");

export type ApprovalDecision = "approved" | "rejected";

export interface PendingActionRow {
  id: string;
  ruleName: string;
  trigger: string;
  actionType: string;
  targetType: string | null;
  targetId: string | null;
  payload: unknown;
  result: string | null;
  error: string | null;
  executedAt: Date | null;
  createdAt: Date;
  /**
   * Computed on read — when the rule has a registered AutomationPolicy,
   * the policy's `approvalClass` tells the operator whether this row
   * is here because it was DECLARED pending (`approvalClass="pending"`)
   * or because something legacy slipped through. Helps triage.
   */
  policyId: string | null;
  policyApprovalClass: ApprovalClass | null;
  policyObjective: string | null;
}

export interface QueueSummary {
  total: number;
  byRule: Array<{ ruleName: string; count: number }>;
  oldestAgeMin: number | null;
}

/** List every pending row, newest first, with policy hints folded in. */
export async function listPendingActions(): Promise<PendingActionRow[]> {
  const rows = await prisma.autonomousAction.findMany({
    where: { approval: "pending" },
    orderBy: { createdAt: "desc" },
  });
  if (rows.length === 0) return [];

  // One round-trip to fetch every distinct policy referenced.
  const ruleNames = [...new Set(rows.map((r) => r.ruleName))];
  const policyIds = ruleNames.map((n) => `autonomous-action.${n}`);
  const policies = await prisma.automationPolicy.findMany({
    where: { id: { in: policyIds }, deletedAt: null },
    select: { id: true, approvalClass: true, objective: true },
  });
  const policyMap = new Map(policies.map((p) => [p.id, p]));

  return rows.map((r) => {
    const pid = `autonomous-action.${r.ruleName}`;
    const p = policyMap.get(pid);
    return {
      id: r.id,
      ruleName: r.ruleName,
      trigger: r.trigger,
      actionType: r.actionType,
      targetType: r.targetType,
      targetId: r.targetId,
      payload: r.payload,
      result: r.result,
      error: r.error,
      executedAt: r.executedAt,
      createdAt: r.createdAt,
      policyId: p?.id ?? null,
      policyApprovalClass: (p?.approvalClass ?? null) as ApprovalClass | null,
      policyObjective: p?.objective ?? null,
    };
  });
}

/** Quick at-a-glance stats for the queue header. */
export async function summarizeQueue(): Promise<QueueSummary> {
  const rows = await prisma.autonomousAction.findMany({
    where: { approval: "pending" },
    select: { ruleName: true, createdAt: true },
  });
  if (rows.length === 0) {
    return { total: 0, byRule: [], oldestAgeMin: null };
  }
  const counts = new Map<string, number>();
  let oldestMs = Date.now();
  for (const r of rows) {
    counts.set(r.ruleName, (counts.get(r.ruleName) ?? 0) + 1);
    const t = r.createdAt.getTime();
    if (t < oldestMs) oldestMs = t;
  }
  const byRule = [...counts.entries()]
    .map(([ruleName, count]) => ({ ruleName, count }))
    .sort((a, b) => b.count - a.count);
  return {
    total: rows.length,
    byRule,
    oldestAgeMin: Math.round((Date.now() - oldestMs) / 60_000),
  };
}

/**
 * Decide one row. Bumps approval + approvedBy + records the verdict,
 * and (when approved) routes through the autonomous-engine to actually
 * execute the deferred side effect.
 *
 * v10.0.157 · side-effect gating now LIVE. Pre-fix the file-level
 * caveat said "approve = audit only, side effect already ran." With
 * v10.0.157's gating in lib/brain/autonomous-engine.ts, rules with
 * approval="ask" or AutomationPolicy.approvalClass="pending" defer
 * execution and store the matched item in payload.deferredItem. On
 * approve here, we call executeApprovedAction(id) which replays
 * rule.action(deferredItem) and merges the result into the row.
 *
 * Reject flow is unchanged — the row stays as evidence; no execution.
 */
export async function decidePendingAction(
  id: string,
  decision: ApprovalDecision,
  approver: string = "nour",
  notes?: string,
): Promise<PendingActionRow> {
  const existing = await prisma.autonomousAction.findUnique({ where: { id } });
  if (!existing) throw new ServiceError(`action "${id}" not found`, 404);
  if (existing.approval !== "pending") {
    throw new ServiceError(
      `action "${id}" is not pending (current: ${existing.approval})`,
      409,
    );
  }

  // v10.0.157 · execute the deferred side effect on approve. Done
  // BEFORE the row update so the executionResult merges into the
  // payload alongside the operator's approvalNote. If execution
  // fails, the row update still records the approval decision but
  // the row's `result` reflects the failure.
  let executionOutcome: { ok: boolean; result?: string; error?: string } | null = null;
  if (decision === "approved") {
    const { executeApprovedAction } = await import("@/lib/brain/autonomous-engine");
    executionOutcome = await executeApprovedAction(id).catch((err) => ({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }));
    if (executionOutcome && !executionOutcome.ok) {
      log.error("approved_execution_failed", {
        id,
        rule: existing.ruleName,
        error: executionOutcome.error,
      });
    }
  }

  // Re-read existing after the executeApprovedAction (which may have
  // updated payload + result + executedAt) so the operator's notes
  // merge with the post-execution state, not the pre-execution one.
  const refreshed = executionOutcome
    ? (await prisma.autonomousAction.findUnique({ where: { id } })) ?? existing
    : existing;

  // Coerce the JSON column. Prisma 6 distinguishes "DB NULL" from
  // "JSON null"; payload may be null already (pending row defaults)
  // and we want preserve-null semantics on no-op writes.
  const nextPayload: Prisma.InputJsonValue | typeof Prisma.DbNull = notes
    ? ({
        ...((refreshed.payload as Record<string, unknown> | null | undefined) ?? {}),
        approvalNote: notes,
      } as Prisma.InputJsonValue)
    : refreshed.payload == null
      ? Prisma.DbNull
      : (refreshed.payload as Prisma.InputJsonValue);

  const updated = await prisma.autonomousAction.update({
    where: { id },
    data: {
      approval: decision,
      approvedBy: approver,
      // executedAt = either the engine's executeApprovedAction stamp
      // (preserved by reading `refreshed`), the operator's confirm
      // stamp on approve when no side effect was scheduled, or the
      // pre-existing value on reject.
      executedAt:
        decision === "approved"
          ? refreshed.executedAt ?? new Date()
          : refreshed.executedAt,
      payload: nextPayload,
    },
  });

  log.warn("approval_decision", {
    id,
    rule: existing.ruleName,
    decision,
    approver,
    executionOk: executionOutcome?.ok ?? null,
    executionError: executionOutcome?.error ?? null,
  });

  // Best-effort policy fire-log update so /system/policies reflects the
  // operator's verdict. Maps decision → result string consistent with
  // the rest of the registry's lastResult vocabulary.
  const policyId = `autonomous-action.${existing.ruleName}`;
  void getPolicy(policyId).then(async (p) => {
    if (!p) return;
    const { logPolicyFire } = await import("@/lib/automation/policy");
    void logPolicyFire(
      policyId,
      decision === "approved" ? "success" : "rolled_back",
    );
  });

  return shapeRow(updated);
}

function shapeRow(r: {
  id: string;
  ruleName: string;
  trigger: string;
  actionType: string;
  targetType: string | null;
  targetId: string | null;
  payload: unknown;
  result: string | null;
  error: string | null;
  executedAt: Date | null;
  createdAt: Date;
}): PendingActionRow {
  return {
    id: r.id,
    ruleName: r.ruleName,
    trigger: r.trigger,
    actionType: r.actionType,
    targetType: r.targetType,
    targetId: r.targetId,
    payload: r.payload,
    result: r.result,
    error: r.error,
    executedAt: r.executedAt,
    createdAt: r.createdAt,
    policyId: null, // shapeRow doesn't reach into the policy table —
    policyApprovalClass: null, // listPendingActions does that join.
    policyObjective: null,
  };
}
