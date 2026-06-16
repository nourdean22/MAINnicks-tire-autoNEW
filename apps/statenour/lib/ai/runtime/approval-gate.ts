import "server-only";
import { prisma } from "@/lib/prisma";
import { evaluateToolAction } from "@/lib/tools/tool-policy";
import { GuardianApprovalPendingError, pendingExecutions, guardianBypassStorage } from "@/lib/tools/guardian";

/**
 * Checks if a tool call or action block requires human-in-the-loop approval.
 * 
 * If it requires approval:
 * - Checks for an existing matching ApprovalRequest.
 * - If none exists, creates a new pending ApprovalRequest.
 * - Returns { approved: false, approvalId }.
 * 
 * If allowed:
 * - Returns { approved: true }.
 */
export async function checkApprovalGate(
  toolId: string,
  payload: Record<string, any>,
  fn?: Function,
  args?: any[]
): Promise<{ approved: boolean; approvalId?: string }> {
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
  });

  if (decision.decision === "deny") {
    throw new Error(`Action denied: ${decision.reason}`);
  }

  if (
    decision.decision === "require_approval" ||
    decision.decision === "require_owner" ||
    decision.decision === "require_screenshot_approval"
  ) {
    const existing = await prisma.approvalRequest.findFirst({
      where: {
        toolId,
        status: {
          in: ["pending_approval", "approved", "rejected", "executed", "failed"]
        }
      },
      orderBy: { createdAt: "desc" }
    });

    let matched = existing;
    if (existing) {
      const existingStr = JSON.stringify(existing.payload);
      const currentStr = JSON.stringify(payload);
      if (existingStr !== currentStr) {
        matched = null;
      }
    }

    if (matched) {
      if (matched.status === "executed") {
        return { approved: true };
      }
      if (matched.status === "rejected") {
        throw new Error("Action rejected by operator");
      }
      if (matched.status === "failed") {
        throw new Error(`Action execution failed: ${JSON.stringify(matched.resultPayload)}`);
      }

      if (matched.status === "pending_approval" || matched.status === "approved") {
        if (fn && args) {
          pendingExecutions.set(matched.id, { fn, args });
        }
      }

      return { approved: false, approvalId: matched.id };
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
