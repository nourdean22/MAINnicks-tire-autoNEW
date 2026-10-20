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
 *
 * 2026-10-10 (audit 07-SN-03). Two more calls take two keys: turning the
 * Instagram autoposter ON (every later scheduled post goes out live with no
 * one looking) and a device command that unlocks, disarms or sends raw codes
 * (the Tuya agent executes `unlock` and passes `raw` through verbatim). And
 * criticalRiskGate below holds a tool getToolRiskClass rates "critical" when
 * it also writes and has no two-key rule of its own: the policy engine's
 * critical -> owner rule (tool-policy.ts rule 8) never reached a chat tool,
 * because no chat tool goes through evaluateToolAction.
 */
import { currentTurn } from "@/lib/agent/turn-context";
import { logger as rootLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getToolMeta, getToolRiskClass } from "@/lib/ai/tools/catalog";
import { WRITE_CATEGORIES } from "@/lib/ai/capability-registry";
import { guardianBypassStorage } from "@/lib/tools/guardian";
import { APPROVAL_DEDUPE_WINDOW_MS, samePayload } from "@/lib/tools/approval-match";

const log = rootLogger.withSurface("tools/two-key");

export const DEVICE_TWO_KEY_REASON =
  "A device command that unlocks, disarms or sends raw codes needs a second key: the owner approves this exact call (two-key rule).";
export const CRITICAL_RISK_REASON =
  "A critical-risk tool needs a second key: the owner approves this exact call before it runs (critical-risk rule).";
const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

const DEVICE_GUIDANCE =
  "This device command unlocks, disarms or sends raw codes to a physical device, so it was NOT sent. It is waiting for Nour's approval in the approvals queue (System > Actions); approving it there sends it once. Say so plainly; do not retry it in this turn and never claim it happened.";
const CRITICAL_GUIDANCE =
  "This tool is rated critical-risk and changes state, so it was NOT run. It is waiting for Nour's approval in the approvals queue (System > Actions); approving it there runs it once. Say so plainly; do not retry it in this turn and never claim it happened.";

/** Device verbs that take two keys. The local agents match these exact strings. */
const SECOND_KEY_DEVICE_COMMANDS = new Set(["unlock", "disarm", "raw"]);

type SecondKeyRule = { held: (args: unknown) => boolean; reason: string; guidance: string };

/**
 * Tool name -> "does THIS call need the owner's second key?". Every check
 * fails closed on the argument: only an explicit, known-safe value skips it.
 */
const SECOND_KEY_CALLS: Record<string, SecondKeyRule> = {
  // Case and padding never matter; a command that is not a string cannot be
  // shown to be one of the everyday verbs, so it is held too.
  runDeviceCommand: {
    held: (args) => {
      const command = (args as { command?: unknown } | null)?.command;
      if (typeof command !== "string") return true;
      return SECOND_KEY_DEVICE_COMMANDS.has(command.trim().toLowerCase());
    },
    reason: DEVICE_TWO_KEY_REASON,
    guidance: DEVICE_GUIDANCE,
  },
};

/**
 * True when this call needs the owner's second key. The name is historical
 * (the list began with customer sends); it now also covers the security
 * device commands above.
 */
export function isIrreversibleCustomerSend(toolName: string, args: unknown): boolean {
  const rule = SECOND_KEY_CALLS[toolName];
  return rule ? rule.held(args) : false;
}

export type TwoKeyRefusal = {
  error: "approval_required";
  requestId: string | null;
  reason: string;
  reflection: { tool: string; guidance: string };
};

/** The id of a live pending approval for this exact call, if any. Shared with sink-policy.ts. */
export async function findOpenRequest(toolName: string, payload: unknown, reason: string): Promise<string | null> {
  const now = new Date();
  const rows = await prisma.approvalRequest.findMany({
    where: {
      toolId: toolName,
      status: "pending_approval",
      reason,
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
  const rule = SECOND_KEY_CALLS[toolName];
  if (!rule || !rule.held(args)) return null;
  // The approved re-execution (executeApprovedToolAsync) is the second key.
  if (guardianBypassStorage.getStore() === true) return null;
  // The row records how risky the TOOL is, whichever rule held the call.
  const riskClass = getToolRiskClass(toolName) === "critical" ? "critical" : "high";
  return holdForOwner(toolName, args, rule.reason, riskClass, rule.guidance);
}

/**
 * Same contract as twoKeyGate, for a tool getToolRiskClass rates "critical"
 * that also WRITES (catalog sideEffecting, or a write category). null =
 * proceed. Two carve-outs (operator ruling, 2026-10-10):
 *   - a tool with a two-key rule is governed by that finer per-argument rule
 *     instead (runDeviceCommand: unlock/disarm/raw wait, a lights command runs);
 *   - pure-compute critical tools (runCode, runPython) run, so in-chat
 *     calculation keeps working.
 */
export async function criticalRiskGate(toolName: string, args: unknown): Promise<TwoKeyRefusal | null> {
  if (SECOND_KEY_CALLS[toolName]) return null;
  if (getToolRiskClass(toolName) !== "critical") return null;
  const meta = getToolMeta(toolName);
  if (!meta || !(meta.sideEffecting === true || WRITE_CATEGORIES.has(meta.category))) return null;
  if (guardianBypassStorage.getStore() === true) return null;
  return holdForOwner(toolName, args, CRITICAL_RISK_REASON, "critical", CRITICAL_GUIDANCE);
}

async function holdForOwner(
  toolName: string,
  args: unknown,
  reason: string,
  riskClass: "high" | "critical",
  guidance: string,
): Promise<TwoKeyRefusal> {
  const payload = (args && typeof args === "object" ? args : { args }) as Record<string, unknown>;
  let requestId: string | null = null;
  try {
    // A retry inside the same turn must not queue a second approval.
    requestId = await findOpenRequest(toolName, payload, reason);
    if (!requestId) {
      const row = await prisma.approvalRequest.create({
        data: {
          toolId: toolName,
          actionType: "require_owner",
          status: "pending_approval",
          riskClass,
          payload: payload as any,
          requestedBy: currentTurn() ? "agent" : "system",
          reason,
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
  log.info("two-key: call held for the owner", { tool: toolName, requestId, riskClass });
  return {
    error: "approval_required",
    requestId,
    reason,
    reflection: { tool: toolName, guidance },
  };
}
