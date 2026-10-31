/**
 * Approval queue · v10.0.153 · May 03 · Slice B
 *
 * Operator-facing layer over AutonomousAction rows where
 * approval = "pending". Provides the read/write spine for the
 * /system/actions surface — list, approve, reject — that the
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
import { actionExpiresAt, expiredApprovalMessage, isActionExpired } from "@/lib/automation/approval-freshness";
import { beginAttempt, settleAttempt } from "@/lib/services/action-attempts";

const log = rootLogger.withSurface("automation/approval-queue");

/** The executor's window (lib/ai/nick-action-window.ts), shared with the 09:00Z cron backstop. */
import { TWO_DAYS_MS as NICK_ACTION_RUN_WINDOW_MS } from "@/lib/ai/nick-action-window";
export { NICK_ACTION_RUN_WINDOW_MS };

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
  /** 2026-09-07 (D12) · when the authorization window closes — derived from the action type. */
  expiresAt: Date;
  /** Past its window: still listed, cannot be approved, can be rejected. Never a fabricated decline. */
  expired: boolean;
}

export interface QueueSummary {
  total: number;
  /** Still executable if approved now. */
  live: number;
  /** Authorization window passed — need a re-request or a dismissal, not an approve. */
  expired: number;
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
      expiresAt: actionExpiresAt(r.actionType, r.createdAt),
      expired: isActionExpired(r),
    };
  });
}

/** Quick at-a-glance stats for the queue header. */
export async function summarizeQueue(): Promise<QueueSummary> {
  const rows = await prisma.autonomousAction.findMany({
    where: { approval: "pending" },
    select: { ruleName: true, actionType: true, createdAt: true },
  });
  if (rows.length === 0) {
    return { total: 0, live: 0, expired: 0, byRule: [], oldestAgeMin: null };
  }
  const counts = new Map<string, number>();
  let oldestMs = Date.now();
  let expired = 0;
  for (const r of rows) {
    counts.set(r.ruleName, (counts.get(r.ruleName) ?? 0) + 1);
    const t = r.createdAt.getTime();
    if (t < oldestMs) oldestMs = t;
    if (isActionExpired(r)) expired += 1;
  }
  const byRule = [...counts.entries()]
    .map(([ruleName, count]) => ({ ruleName, count }))
    .sort((a, b) => b.count - a.count);
  return {
    total: rows.length,
    live: rows.length - expired,
    expired,
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

  // 2026-09-07 (D12) · expire authorization, not obligations. An approval
  // past its freshness window is refused BEFORE any execution or row write:
  // the payload was raised against state that no longer holds. The row
  // stays pending and listed as expired; reject remains a human option.
  if (decision === "approved" && isActionExpired(existing)) {
    throw new ServiceError(
      expiredApprovalMessage("action", actionExpiresAt(existing.actionType, existing.createdAt)),
      409,
    );
  }

  // 2026-10-30 · a Nick action approved here only runs if the Nick executor will pick it up:
  // both its paths skip when NICK_AUTONOMY is off, and the 09:00Z cron backstop reads only the
  // last 2 days (nick-action-batch.ts TWO_DAYS_MS). Refuse rather than report a dead approval.
  const isNickAction = existing.ruleName.startsWith("nick_action_");
  if (decision === "approved" && isNickAction) {
    const { getFlag } = await import("@/lib/feature-flags");
    if (!(getFlag("NICK_AUTONOMY")?.isOn ?? false)) {
      throw new ServiceError("Nick autonomy is off, so this action would never run. Turn NICK_AUTONOMY on or reject it.", 409);
    }
    if (Date.now() - existing.createdAt.getTime() > NICK_ACTION_RUN_WINDOW_MS) {
      throw new ServiceError("This Nick action is older than 2 days, past the window the executor runs. Reject it.", 409);
    }
    // A killed nick-action-approved run drops its event (cron-lifecycle KILLABLE_EVENT_FUNCTIONS),
    // so an approval now would report ok and run nothing until the next 09:00Z backstop, if ever.
    const { isCronKilled } = await import("@/lib/inngest/cron-lifecycle");
    if (await isCronKilled("nick-action-approved")) {
      throw new ServiceError(
        "The nick-action-approved runner is switched off in System > Crons, so this action would not run now. Turn it on or reject the action.",
        409,
      );
    }
  }

  // 2026-10-10 (SN-04) - CLAIM before acting. The check above is a read; two
  // approve clicks both passed it and both replayed the side effect (the lane
  // includes auto_followup_expired_quote, which emails a lead), and a reject
  // racing an approve overwrote an executed row. The swap pins every mutable
  // field the decision read (`approval`; expiry derives from the immutable
  // actionType + createdAt). count===1 wins; the loser re-reads and reports
  // the real state. A crash after the claim leaves "processing" -- fail closed,
  // never a second execution; the approval sweeper recovers it
  // (recoverStuckDecisions below) from the stamp written here.
  const claim = await prisma.autonomousAction.updateMany({
    where: { id, approval: "pending" },
    data: { approval: "processing", approvedBy: claimStamp(decision, approver, new Date()) },
  });
  if (claim.count !== 1) {
    const winner = await prisma.autonomousAction.findUnique({ where: { id }, select: { approval: true } });
    throw new ServiceError(
      `action "${id}" is not pending (current: ${winner?.approval ?? "unknown"})`,
      409,
    );
  }

  // v10.0.157 · execute the deferred side effect on approve. Done
  // BEFORE the row update so the executionResult merges into the
  // payload alongside the operator's approvalNote. If execution
  // fails, the row goes to needs_review with result "failed" (see below).
  // 2026-10-30 · Nick Action Queue rows (nick_action_*) are not autonomous-engine RULES:
  // executeApprovedAction failed every one ("not found in RULES registry"). They take the
  // Telegram /qa route instead: approved with executedAt null, then the batch core runs them.
  let executionOutcome: { ok: boolean; result?: string; error?: string } | null = null;
  if (decision === "approved" && !isNickAction) {
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

  // A failed run may still have happened (a provider can accept the send and lose the response),
  // so it is never written as approved and never returned to pending, which would re-send it.
  const executionFailed = executionOutcome !== null && !executionOutcome.ok;

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
    data: executionFailed
      ? {
          // Terminal and never re-run: the outcome is unknown, so the row is needs_review
          // (the same state the sweeper gives an unknown run). Nothing is recorded as executed.
          approval: "needs_review",
          approvedBy: approver,
          executedAt: null,
          result: "failed",
          error: executionOutcome?.error ?? "execution failed",
          payload: nextPayload,
        }
      : {
          approval: decision,
          approvedBy: approver,
          // Clears the error a failed earlier run left behind.
          error: null,
      // executedAt = either the engine's executeApprovedAction stamp
      // (preserved by reading `refreshed`), the operator's confirm
      // stamp on approve when no side effect was scheduled, or the
      // pre-existing value on reject. A Nick action stays null: the
      // batch core claims rows by flipping executedAt from null.
      executedAt:
        decision === "approved"
          ? isNickAction ? null : refreshed.executedAt ?? new Date()
          : refreshed.executedAt,
      payload: nextPayload,
    },
  });

  // Same event Telegram /qa sends. If it cannot be sent, run the row here through the same batch
  // core: the 09:00Z backstop reads only rows under 2 days old, so a 1.9-day row would never run.
  // The core claims by executedAt null, so a late event cannot run it twice.
  let returned = updated;
  if (decision === "approved" && isNickAction) {
    try {
      const { getInngest } = await import("@/lib/inngest/client");
      await getInngest().send({ name: "nick-action/approved", data: { actionIds: [id], approvedBy: approver } });
    } catch (err) {
      log.warn("nick_action_event_failed", { id, error: err instanceof Error ? err.message : String(err) });
      try {
        const { runNickActionBatch } = await import("@/lib/ai/nick-action-batch");
        await runNickActionBatch({ ids: [id], source: "approval-queue-fallback" });
        // Answer with the row as the run left it (executedAt set once it ran), not the pre-run copy.
        returned = (await prisma.autonomousAction.findUnique({ where: { id } })) ?? updated;
      } catch (runErr) {
        log.error("nick_action_inline_run_failed", { id, rule: existing.ruleName, error: runErr instanceof Error ? runErr.message : String(runErr) });
        // Still unclaimed (the core threw before its swap): nothing ran, and nothing will before
        // the 2-day window closes on an old row. Put it back in the queue, by swap, and say so.
        // Claimed already: it ran or is running, so it stays as it is.
        const back = await prisma.autonomousAction.updateMany({
          where: { id, approval: "approved", executedAt: null },
          data: { approval: "pending", approvedBy: null },
        });
        if (back.count === 1) {
          throw new ServiceError("Couldn't start this action just now, so it is back in the queue. Approve it again in a minute.", 503);
        }
      }
    }
  }

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
    // A failed run is logged as a failure, never a success or a rollback, so the policy does not keep
    // showing an older success as its latest run.
    const fireResult = executionFailed ? "failure" : decision === "approved" ? "success" : "rolled_back";
    void logPolicyFire(policyId, fireResult);
  });

  return shapeRow(returned);
}

/** A decision claim older than this is not in flight any more (rule.action is bounded by its fetch timeouts). */
export const DECISION_CLAIM_STALE_MS = 15 * 60_000;

/**
 * Who claimed what, and when, kept in approvedBy while the row is `processing`
 * (AutonomousAction has no updatedAt; no schema change). The final update
 * overwrites it with the approver.
 */
function claimStamp(decision: ApprovalDecision, by: string, at: Date): string {
  return JSON.stringify({ claim: decision, by, at: at.toISOString() });
}

function readClaimStamp(value: string | null): { claim: ApprovalDecision; by: string; at: Date } | null {
  try {
    const s = JSON.parse(value ?? "") as { claim?: unknown; by?: unknown; at?: unknown };
    const at = new Date(String(s.at));
    if ((s.claim !== "approved" && s.claim !== "rejected") || typeof s.by !== "string" || !Number.isFinite(at.getTime())) return null;
    return { claim: s.claim, by: s.by, at };
  } catch {
    return null;
  }
}

/**
 * The approval sweeper's recovery for a decision claim that never finished (a
 * write after the claim threw, or the process died). Never back to `pending`:
 * an approve may already have run its side effect, and nothing is re-run.
 *   - a stamped reject ran nothing: finish it `rejected`;
 *   - a stamped approve whose replay wrote executedAt after the claim finished: `approved`;
 *   - anything else may or may not have run: `needs_review`, recorded UNKNOWN in
 *     action_attempts so the Owner Panel lists it. An unstamped claim predates the stamp.
 */
export async function recoverStuckDecisions(now: Date = new Date()): Promise<{ finished: number; needsReview: number }> {
  const rows = await prisma.autonomousAction.findMany({
    where: { approval: "processing" },
    select: { id: true, ruleName: true, actionType: true, approvedBy: true, executedAt: true },
    take: 50,
  });
  let finished = 0;
  let needsReview = 0;
  for (const r of rows) {
    const stamp = readClaimStamp(r.approvedBy);
    if (stamp && now.getTime() - stamp.at.getTime() < DECISION_CLAIM_STALE_MS) continue; // still in flight
    const done =
      stamp?.claim === "rejected" || (stamp?.claim === "approved" && r.executedAt != null && r.executedAt.getTime() >= stamp.at.getTime());
    const reason = `${stamp ? `${stamp.claim} by ${stamp.by} at ${stamp.at.toISOString()}` : "a decision"} did not finish; ${r.actionType} may or may not have run. Check before acting; not re-run.`;
    // Swap on every field the verdict read: a replay that lands meanwhile writes its own.
    const res = await prisma.autonomousAction.updateMany({
      where: { id: r.id, approval: "processing", approvedBy: r.approvedBy, executedAt: r.executedAt },
      data: done
        ? { approval: stamp!.claim, approvedBy: stamp!.by }
        : { approval: "needs_review", approvedBy: stamp?.by ?? null, error: reason },
    });
    if (res.count !== 1) continue;
    if (done) {
      finished++;
      continue;
    }
    needsReview++;
    try {
      const begun = await beginAttempt({
        operationKey: `autonomous-action:${r.id}`,
        tool: `autonomous.${r.ruleName}`,
        effectClass: "write",
        argumentsHash: r.id,
        windowMs: DECISION_CLAIM_STALE_MS,
      });
      if (begun.kind === "claimed") await settleAttempt(begun.attemptId, { disposition: "unknown", reason });
    } catch (err) {
      log.error("stuck_decision_ledger_failed", { id: r.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  if (finished + needsReview > 0) log.warn("stuck_decisions_recovered", { finished, needsReview });
  return { finished, needsReview };
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
    expiresAt: actionExpiresAt(r.actionType, r.createdAt),
    expired: isActionExpired(r),
  };
}
