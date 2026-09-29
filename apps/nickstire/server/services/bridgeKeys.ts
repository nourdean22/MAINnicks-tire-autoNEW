/**
 * Bridge idempotency keys — the sender half of ADR-0019 §4
 * (docs/adr/0019-idempotent-bridge-writes.md).
 *
 * A key names the business FACT a nickstire -> statenour write describes, so a
 * repeat of the same fact carries the same key and StateNour's
 * `bridge_receipts` (lib/services/bridge-receipts.ts) records it once.
 *
 * Format: `v1:<eventType>:<part>[:<part>...]`. Rules the builder enforces:
 *   · deterministic — built from business identity only, never a send time,
 *     a random value or a retry count;
 *   · no PII — a part holding a run of 10+ digits (phone-shaped) is refused,
 *     and the caller sends without a key, which is today's behaviour;
 *   · parts are `[A-Za-z0-9_.-]`, so ":" only ever separates parts;
 *   · an opaque value (a content hash, a set of ids) goes in as `{ opaque }`
 *     and is re-encoded as 16 letters, so a hex digest can never trip the
 *     phone guard by chance;
 *   · over 190 chars (the receiver's cap) it becomes `v1:h:<sha256 hex>`.
 */
import { createHash } from "node:crypto";

export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";

/** StateNour's `readIdempotencyKey` refuses anything longer (400). */
const KEY_MAX = 190;
const EVENT_TYPE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;
const PART = /^[A-Za-z0-9_.-]+$/;
const PHONE_RUN = /\d{10,}/;

type KeyPart =string | number | { opaque: string };

/** sha256 -> 16 chars over a-p (one letter per nibble): no digits, ever. */
function letters(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 16);
  return hex.replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
}

/**
 * The key for one fact, or null when a part breaks a rule. Null is not an
 * error for the caller: it sends unkeyed (the legacy, un-deduplicated write)
 * rather than drop the fact.
 */
export function bridgeKey(eventType: string, ...parts: KeyPart[]): string | null {
  if (!EVENT_TYPE.test(eventType) || parts.length === 0) return null;
  const encoded: string[] = [];
  for (const part of parts) {
    if (typeof part === "object") {
      if (!part.opaque) return null;
      encoded.push(letters(part.opaque));
      continue;
    }
    const s = String(part);
    if (!PART.test(s) || PHONE_RUN.test(s)) return null;
    encoded.push(s);
  }
  const key = `v1:${eventType}:${encoded.join(":")}`;
  return key.length <= KEY_MAX ? key : `v1:h:${createHash("sha256").update(key).digest("hex")}`;
}

/**
 * The subject of an `attribution_weak_matches` obligation: the SET of unruled
 * call ids, order-free. Not the run id — the reconciliation re-runs every 2 h,
 * and keying by run reopened a StateNour task per run for the same set.
 */
export function attributionObligationSubject(callIds: readonly number[]): { opaque: string } {
  return { opaque: [...new Set(callIds)].sort((a, b) => a - b).join(",") };
}

/**
 * One fact per (experiment, contract, status[, winning arm]). A daily re-post
 * of an unchanged verdict dedupes; a new status, a re-registered contract or a
 * winner that flips arms is a new fact and gets a new key.
 */
export function experimentVerdictKey(
  experimentId: string,
  contractHash: string,
  verdict: { status: string; armId?: string },
): string | null {
  const arm = verdict.status === "winner" && verdict.armId ? [verdict.armId] : [];
  return bridgeKey("experiment.verdict", experimentId, { opaque: contractHash }, verdict.status, ...arm);
}
