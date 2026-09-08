/**
 * lib/tools/sink-policy.ts · 2026-09-08 (program U4, review on #2198)
 *
 * The deterministic half of "content from email/web/MCP can never trigger an
 * external side effect without a human". The fence taints the TURN when it
 * wraps external_web / external_doc content (tool-result-fencing.ts); the
 * policy engine escalates guardian-wrapped tools in a tainted turn to
 * require_owner (tool-policy.ts rule 8b). This gate is the boundary the
 * review found unguarded: `nourTools` (lib/ai/tools.ts), which every catalog
 * tool executes through, guardian-wrapped or not. An external side effect in
 * a tainted turn becomes a pending ApprovalRequest instead of a call; the
 * model gets a refusal it cannot talk its way past.
 */
import { currentTurn } from "@/lib/agent/turn-context";
import { logger as rootLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { sideEffectingTools } from "@/lib/ai/tools/catalog";
import { getToolCapability } from "@/lib/tools/tool-registry";

const log = rootLogger.withSurface("tools/sink-policy");

export const SINK_POLICY_REASON =
  "Untrusted external content is in this turn; an external side effect needs a human (sink policy).";
const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

export type SinkPolicyRefusal = {
  error: "approval_required";
  requestId: string | null;
  reason: string;
  reflection: { tool: string; guidance: string };
};

let sideEffecting: Set<string> | null = null;

/** Catalog `sideEffecting` OR registry `externalMutation` -- either flag makes it a sink. */
export function isExternalSideEffectTool(name: string): boolean {
  sideEffecting ??= new Set(sideEffectingTools());
  if (sideEffecting.has(name)) return true;
  return getToolCapability(name)?.externalMutation === true;
}

export function turnIsTainted(): boolean {
  return currentTurn()?.untrustedInput === true;
}

/**
 * null = proceed. A refusal object = do NOT execute; return it as the tool
 * result. The ApprovalRequest is best-effort: a DB failure still refuses.
 */
export async function sinkPolicyGate(toolName: string, args: unknown): Promise<SinkPolicyRefusal | null> {
  if (!turnIsTainted()) return null;
  if (!isExternalSideEffectTool(toolName)) return null;
  let requestId: string | null = null;
  try {
    const row = await prisma.approvalRequest.create({
      data: {
        toolId: toolName,
        actionType: "require_owner",
        status: "pending_approval",
        riskClass: "high",
        payload: (args && typeof args === "object" ? args : { args }) as any,
        requestedBy: "agent",
        reason: SINK_POLICY_REASON,
        expiresAt: new Date(Date.now() + APPROVAL_TTL_MS),
      },
      select: { id: true },
    });
    requestId = row.id;
  } catch (err) {
    log.warn("sink policy: approval row not written; the call is still refused", {
      tool: toolName,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  log.info("sink policy: external side effect refused in a tainted turn", { tool: toolName, requestId });
  return {
    error: "approval_required",
    requestId,
    reason: SINK_POLICY_REASON,
    reflection: {
      tool: toolName,
      guidance:
        "This turn contains content fetched from the web or a document, so this external action was NOT performed and is waiting for the operator in the approvals queue (System > Actions). Say so plainly; do not retry it in this turn and never claim it happened.",
    },
  };
}
