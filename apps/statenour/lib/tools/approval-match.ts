/**
 * Approval matching rule · shared by lib/tools/guardian.ts (withGuardian) and
 * lib/ai/runtime/approval-gate.ts (checkApprovalGate).
 *
 * THE RULE · one approval authorizes exactly ONE execution.
 *   · An `executed` ApprovalRequest is a RECEIPT, never a standing approval.
 *     A later call may get that receipt back (replay: the stored
 *     resultPayload, no new execution) but can never run the action again
 *     on the strength of it.
 *   · When a replay is allowed:
 *       - checkApprovalGate · only when the caller names the SAME request
 *         (its approvalId) and the row executed within
 *         APPROVAL_REPLAY_WINDOW_MS. A payload that merely looks the same is a
 *         new intent and needs a NEW approval.
 *       - withGuardian · AI-SDK tool calls carry no request id, so an
 *         identical payload inside APPROVAL_DEDUPE_WINDOW_MS stands in for "the
 *         same request" (AG-42). It still only returns the stored result;
 *         it never re-executes.
 *   · `rejected` / `failed` matches throw; `pending_approval` / `approved`
 *     matches return the existing request id instead of opening a duplicate —
 *     unless the row is past `expiresAt`, in which case it is ignored and a
 *     fresh request is raised (an expired approval authorizes nothing).
 *   · Payloads are compared canonically (object keys sorted at every depth),
 *     so {a,b} and {b,a} are the same request. Array order stays significant.
 */

/** Dedupe window for payload matching (AG-42, 2026-07-09). */
export const APPROVAL_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** How long after execution a same-request (same approvalId) replay returns the receipt. */
export const APPROVAL_REPLAY_WINDOW_MS = 60 * 60 * 1000;

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/**
 * Key-order-independent JSON. Round-trips through JSON first so the input is
 * normalized the way a Prisma Json column stores it (undefined keys dropped,
 * Dates as ISO strings) before keys are sorted.
 */
export function canonicalJson(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined) return "null";
  return JSON.stringify(sortKeysDeep(JSON.parse(json)));
}

export function samePayload(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}
