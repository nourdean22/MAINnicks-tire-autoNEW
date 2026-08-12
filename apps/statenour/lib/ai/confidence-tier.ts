/**
 * confidence-tier · v-truth · 2026-06-03.
 *
 * The autonomy "auto-tier" gate. Today (fail-closed) EVERY autonomous
 * action waits for /qa approval — see `lib/brain/autonomous-engine.ts`
 * `shouldDefer` (a missing/pending policy ⇒ defer, never auto-fire).
 *
 * This module adds ONE narrow exception: a provably-safe, reversible,
 * NON-MESSAGING, NON-MONEY action type — on a HARDCODED allowlist —
 * with a high operator-acceptance track record MAY skip the approval
 * queue and execute unattended. Everything else still defers.
 *
 * ── SAFETY CONTRACT (read before touching) ─────────────────────────
 * This decides what runs WITHOUT a human in the loop. It is written
 * fail-CLOSED and belt-and-suspenders:
 *
 *   1. Gated on `NICK_CONFIDENCE_TIER`. Flag OFF (the default) ⇒ this
 *      function ALWAYS returns false ⇒ today's behaviour exactly.
 *   2. The allowlist is a HARDCODED const of internal, reversible,
 *      non-messaging, non-money action types ONLY. A type that is not
 *      a literal member can NEVER pass — even if the flag is on and the
 *      acceptance rate is 1.0. Messaging/money/person types
 *      (`send_sms_outreach`, `confirm_spend`, anything that could touch
 *      a real person or move money) are DELIBERATELY ABSENT, and an
 *      explicit DENY set re-rejects them as a second wall.
 *   3. Requires a high acceptance rate (>= AUTO_THRESHOLD) AND enough
 *      decided samples. Undefined / low / under-sampled ⇒ false.
 *
 * If ANY check is unsure, the answer is false. The cost of a false
 * "no" is a one-tap approval; the cost of a false "yes" is an
 * unattended side effect. We pay the cheap one every time.
 *
 * Per kaizen + karpathy · the smallest provably-safe carve-out. No new
 * tables. Reuses the acceptance signal already shipped in
 * `lib/ai/propose-actions-history.ts`.
 */

import { getFlag } from "@/lib/feature-flags";

/**
 * The ONLY action types that may ever auto-execute without approval.
 * Exported as a const for auditability (a test asserts no
 * messaging/money type is ever a member).
 *
 * Membership criteria — a type qualifies ONLY if ALL hold:
 *   · INTERNAL    — mutates the OS's own task/mission/brain rows; makes
 *                   no outbound network/SMS/Telegram/email/push call.
 *   · NON-MONEY   — never authorizes, records, or moves a charge.
 *   · NON-PERSON  — never targets or contacts a real human.
 *   · REVERSIBLE  — a soft status flip or additive write the operator
 *                   can undo from the normal UI; no destructive delete.
 *
 * Verified against `lib/ai/execute-actions.ts` (2026-06-03):
 *   · archive_mission — Mission ACTIVE→COMPLETE. Soft, internal,
 *     operator can flip back via /missions. Reversible. SAFE.
 *   · nudge_task      — Task DOING→READY + additive brain note.
 *     Internal, reversible status flip. SAFE.
 *   · reassign_task   — Task INBOX→WAITING + 7d snooze (auto-resurfaces).
 *     Internal, reversible. SAFE.
 *   · commit_journal  — Runs the journal-ingest pipeline on an existing
 *     BrainDump (extracts tasks/insights). Internal, non-messaging,
 *     idempotency-guarded (skips if already committed). Derived rows
 *     are operator-editable. SAFE.
 *
 * DELIBERATELY EXCLUDED (NEVER add — see DENY below):
 *   · send_sms_outreach — targets a real PERSON. Even though v1 only
 *     drafts, the v1 boundary can change; messaging is never auto.
 *   · confirm_spend     — MONEY-class acknowledgement. Never auto.
 */
export const SAFE_AUTO_ALLOWLIST = [
  "archive_mission",
  "nudge_task",
  "reassign_task",
  "commit_journal",
] as const;

export type SafeAutoActionType = (typeof SAFE_AUTO_ALLOWLIST)[number];

/**
 * Explicit DENY wall — messaging / money / person action types that
 * must NEVER auto-execute. This is redundant with "not in the
 * allowlist" by design: if a future edit ever mistakenly adds one of
 * these to the allowlist, this set still rejects it. Defense in depth.
 */
const NEVER_AUTO_DENYLIST: ReadonlySet<string> = new Set([
  "send_sms_outreach",
  "confirm_spend",
  "sendTelegram",
  "sendEmail",
  "sendSms",
  "send_email",
  "send_telegram",
  "send_push",
]);

/** Minimum operator-acceptance rate (approved / decided) to auto-run. */
const AUTO_THRESHOLD = 0.8;

/**
 * Minimum decided samples behind the acceptance rate. Mirrors the
 * proposer's MIN_SAMPLES floor — a type with little history must NOT
 * earn auto-execute on a thin record. Kept local (no import) so this
 * gate's safety can't be loosened by an edit elsewhere.
 */
const MIN_SAMPLES_FOR_AUTO = 8;

const ALLOWLIST_SET: ReadonlySet<string> = new Set(SAFE_AUTO_ALLOWLIST);

/**
 * The gate. Returns true ONLY when ALL hold:
 *   · NICK_CONFIDENCE_TIER is on,
 *   · actionType is a literal member of SAFE_AUTO_ALLOWLIST,
 *   · actionType is NOT in the deny wall,
 *   · acceptanceRate is a finite number >= AUTO_THRESHOLD,
 *   · sampleSize >= MIN_SAMPLES_FOR_AUTO.
 *
 * Any missing/odd input ⇒ false. Never throws.
 *
 * @param actionType     the AutonomousAction.actionType being judged.
 * @param acceptanceRate operator approved/(approved+rejected) in [0,1].
 * @param sampleSize     number of DECIDED rows behind that rate.
 */
export function canAutoExecute(
  actionType: string,
  acceptanceRate?: number,
  sampleSize?: number,
): boolean {
  // 1. Flag gate — OFF (default) ⇒ fail-closed, today's behaviour.
  if (!getFlag("NICK_CONFIDENCE_TIER")?.isOn) return false;

  return meetsAutoBar(actionType, acceptanceRate, sampleSize);
}

/**
 * The flag-independent half of the gate (BDN-102 scoreboard split,
 * 2026-08-12): everything canAutoExecute checks EXCEPT the flag. The
 * trust-ladder scoreboard needs "would this type graduate if the flag
 * were on?" without the flag hiding the answer. The safety contract is
 * unchanged: the EXECUTION path still goes through canAutoExecute, the
 * flag still gates it, and every constant stays module-private.
 */
export function meetsAutoBar(
  actionType: string,
  acceptanceRate?: number,
  sampleSize?: number,
): boolean {
  // Deny wall — messaging/money/person types can never pass, even
  // if a future edit wrongly lists one. Checked BEFORE the allow.
  if (NEVER_AUTO_DENYLIST.has(actionType)) return false;

  // Hardcoded allowlist — must be a known-safe internal type.
  if (!ALLOWLIST_SET.has(actionType)) return false;

  // Acceptance rate — must be a real, high number.
  if (typeof acceptanceRate !== "number" || !Number.isFinite(acceptanceRate)) {
    return false;
  }
  if (acceptanceRate < AUTO_THRESHOLD) return false;

  // Sample floor — a thin record never earns auto-execute.
  if (typeof sampleSize !== "number" || sampleSize < MIN_SAMPLES_FOR_AUTO) {
    return false;
  }

  return true;
}
