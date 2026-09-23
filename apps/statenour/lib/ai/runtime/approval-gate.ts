import "server-only";
import { prisma } from "@/lib/prisma";
import { evaluateToolAction } from "@/lib/tools/tool-policy";
import { pendingExecutions, guardianBypassStorage } from "@/lib/tools/guardian";
import { APPROVAL_DEDUPE_WINDOW_MS, APPROVAL_REPLAY_WINDOW_MS, samePayload } from "@/lib/tools/approval-match";
import { isApprovalRequestExpired } from "@/lib/automation/approval-freshness";

/**
 * Checks if a tool call or action block requires human-in-the-loop approval.
 *
 * The matching rule (one approval = one execution; an executed row is a
 * receipt, never a standing approval) lives in lib/tools/approval-match.ts.
 *
 * If it requires approval, this NEVER returns { approved: true } — execution
 * of an approved request happens once, in executeApprovedToolAsync:
 * - `opts.approvalId` names an executed request (same tool, same payload)
 *   that ran within APPROVAL_REPLAY_WINDOW_MS → { approved: false, replay }
 *   carrying the stored result. The caller returns it and does not execute.
 * - Otherwise the most recent same-tool request inside the 24h dedupe window
 *   is matched canonically: pending/approved (unexpired) → its approvalId;
 *   rejected/failed → throws; executed or expired → a NEW pending request.
 *
 * If allowed:
 * - Returns { approved: true }.
 */
export async function checkApprovalGate(
  toolId: string,
  payload: Record<string, any>,
  fn?: Function,
  args?: any[],
  opts: { approvalId?: string } = {}
): Promise<{ approved: boolean; approvalId?: string; replay?: { result: unknown } }> {
  // If we are bypassing the guardian, allow immediately
  const bypassPolicy = guardianBypassStorage.getStore() === true;
  if (bypassPolicy) {
    return { approved: true };
  }

  const decision = evaluateToolAction({
    toolId,
    actionType: "execute",
    destructive: payload?.destructive,
    containsExternalContent: payload?.containsExternalContent,
    memoryWriteRequested: payload?.memoryWriteRequested,
    basedOnInferredMemory: payload?.basedOnInferredMemory,
  });

  if (decision.decision === "deny") {
    throw new Error(`Action denied: ${decision.reason}`);
  }

  if (
    decision.decision === "require_approval" ||
    decision.decision === "require_owner" ||
    decision.decision === "require_screenshot_approval"
  ) {
    const now = new Date();

    // Same-request lookup: the caller names the request it is following up.
    let named = opts.approvalId
      ? await prisma.approvalRequest.findUnique({ where: { id: opts.approvalId } })
      : null;
    if (named && (named.toolId !== toolId || !samePayload(named.payload, payload))) {
      named = null;
    }

    const matched =
      named ??
      (await (async () => {
        const existing = await prisma.approvalRequest.findFirst({
          where: {
            toolId,
            status: {
              in: ["pending_approval", "approved", "rejected", "executed", "failed"]
            },
            createdAt: { gte: new Date(now.getTime() - APPROVAL_DEDUPE_WINDOW_MS) }
          },
          orderBy: { createdAt: "desc" }
        });
        return existing && samePayload(existing.payload, payload) ? existing : null;
      })());

    if (matched) {
      if (matched.status === "executed") {
        // A receipt, never a standing approval. Only the SAME request, named
        // by id, gets its result back — and only shortly after it ran.
        const executedAt = matched.executedAt;
        if (
          matched === named &&
          executedAt instanceof Date &&
          now.getTime() - executedAt.getTime() <= APPROVAL_REPLAY_WINDOW_MS
        ) {
          return { approved: false, approvalId: matched.id, replay: { result: matched.resultPayload } };
        }
        // Otherwise: a new intent — fall through to a new approval.
      } else if (matched.status === "rejected") {
        throw new Error("Action rejected by operator");
      } else if (matched.status === "failed") {
        throw new Error(`Action execution failed: ${JSON.stringify(matched.resultPayload)}`);
      } else if (
        (matched.status === "pending_approval" || matched.status === "approved") &&
        isApprovalRequestExpired(matched, now)
      ) {
        // An expired approval authorizes nothing — raise a fresh request.
      } else {
        if (matched.status === "pending_approval" || matched.status === "approved") {
          if (fn && args) {
            pendingExecutions.set(matched.id, { fn, args });
          }
        }
        return { approved: false, approvalId: matched.id };
      }
    }

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    const newRequest = await prisma.approvalRequest.create({
      data: {
        toolId,
        actionType: decision.decision,
        status: "pending_approval",
        riskClass: decision.riskClass,
        payload: payload as any,
        requestedBy: "agent",
        reason: decision.reason,
        expiresAt,
      }
    });

    if (fn && args) {
      pendingExecutions.set(newRequest.id, { fn, args });
    }

    return { approved: false, approvalId: newRequest.id };
  }

  return { approved: true };
}
