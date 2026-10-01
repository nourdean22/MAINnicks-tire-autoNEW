/**
 * lib/tools/two-key.ts · 2026-09-30 (Q-19, estate architecture §10.1 S4)
 *
 * An irreversible customer-facing send needs two keys, even in a turn the
 * owner wrote. The sink policy (sink-policy.ts) only fires when the turn is
 * tainted by external content: in a clean owner turn the owner's message is
 * the authorization, so a model that misread "post something" as "post it
 * live now" had nothing between it and a public post. Key one is the turn;
 * key two is the owner approving the exact call in the approvals queue
 * (System > Actions).
 *
 * WHAT IS GATED, and why this list is short. The SMS tools already take two
 * keys by construction: sendOpportunitySms and stageCustomerAlert only stage
 * a PENDING receipt, and the send happens on the owner's Telegram Approve tap.
 * statenour has no outbound-call tool. The one catalog tool that reached a
 * customer-visible, unrecallable effect in one call was a LIVE Instagram
 * autopost run. A dry run is side-effect-free and stays one key.
 *
 * HOW THE SECOND KEY EXECUTES. The refusal writes an ApprovalRequest whose
 * toolId is the nourTools key. Approving it runs executeApprovedToolAsync
 * (guardian.ts): a compare-and-swap claim on the row, then
 * nourTools[toolId].execute(payload) under guardianBypassStorage. That bypass
 * is how this gate knows the call IS the approved second key.
 */
import { currentTurn } from "@/lib/agent/turn-context";
import { logger as rootLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { guardianBypassStorage } from "@/lib/tools/guardian";
import { APPROVAL_DEDUPE_WINDOW_MS, samePayload } from "@/lib/tools/approval-match";

const log = rootLogger.withSurface("tools/two-key");

export const TWO_KEY_REASON =
  "An irreversible customer-facing send needs a second key: the owner approves this exact call (two-key rule).";
const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Tool name → "is THIS call an irreversible customer-facing send?".
 * Fail closed on the argument: anything but an explicit dryRun === true is live.
 */
const IRREVERSIBLE_CUSTOMER_SENDS: Record<string, (args: unknown) => boolean> = {
  triggerInstagramAutopost: (args) => (args as { dryRun?: unknown } | null)?.dryRun !== true,
};

export function isIrreversibleCustomerSend(toolName: string, args: unknown): boolean {
  const check = IRREVERSIBLE_CUSTOMER_SENDS[toolName];
  return check ? check(args) : false;
}

export type TwoKeyRefusal = {
  error: "approval_required";
  requestId: string | null;
  reason: string;
  reflection: { tool: string; guidance: string };
};

async function findOpenRequest(toolName: string, payload: unknown): Promise<string | null> {
  const now = new Date();
  const rows = await prisma.approvalRequest.findMany({
    where: {
      toolId: toolName,
      status: "pending_approval",
      reason: TWO_KEY_REASON,
      createdAt: { gte: new Date(now.getTime() - APPROVAL_DEDUPE_WINDOW_MS) },
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, payload: true },
  });
  return rows.find((r) => samePayload(r.payload, payload))?.id ?? null;
}

/**
 * null = proceed. A refusal object = do NOT execute; return it as the tool
 * result. The ApprovalRequest is best-effort: a DB failure still refuses.
 */
export async function twoKeyGate(toolName: string, args: unknown): Promise<TwoKeyRefusal | null> {
  if (!isIrreversibleCustomerSend(toolName, args)) return null;
  // The approved re-execution (executeApprovedToolAsync) is the second key.
  if (guardianBypassStorage.getStore() === true) return null;

  const payload = (args && typeof args === "object" ? args : { args }) as Record<string, unknown>;
  let requestId: string | null = null;
  try {
    // A retry inside the same turn must not queue a second approval.
    requestId = await findOpenRequest(toolName, payload);
    if (!requestId) {
      const row = await prisma.approvalRequest.create({
        data: {
          toolId: toolName,
          actionType: "require_owner",
          status: "pending_approval",
          riskClass: "high",
          payload: payload as any,
          requestedBy: currentTurn() ? "agent" : "system",
          reason: TWO_KEY_REASON,
          expiresAt: new Date(Date.now() + APPROVAL_TTL_MS),
        },
        select: { id: true },
      });
      requestId = row.id;
    }
  } catch (err) {
    log.warn("two-key: approval row not written; the call is still refused", {
      tool: toolName,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  log.info("two-key: irreversible customer-facing send held for the owner", { tool: toolName, requestId });
  return {
    error: "approval_required",
    requestId,
    reason: TWO_KEY_REASON,
    reflection: {
      tool: toolName,
      guidance:
        "This would publish or send to customers and cannot be undone, so it was NOT performed. It is waiting for Nour's approval in the approvals queue (System > Actions); approving it there runs it once. Say so plainly; do not retry it in this turn and never claim it happened. A dry run needs no approval.",
    },
  };
}
