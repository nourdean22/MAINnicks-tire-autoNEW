/**
 * Derive an AutomationPolicy baseline for EVERY rule the autonomous engine
 * dispatches, from the RULES registry rather than from a hand-kept list.
 *
 * WHY THIS EXISTS
 * `scripts/seed-policies.ts` carried 4 hand-curated `autonomous-action` ids while
 * the engine registered 20. The engine is fail-closed — `policyApproval === null`
 * defers — so each uncovered rule parked every match as "pending" forever. No gate
 * saw it, and the reason is worth stating precisely because the obvious answer is only
 * half of it: `check-policy-coverage` did enumerate only `cron.*`, but it was also
 * WIRED INTO NOTHING. Widening it is not what made it see the gap; putting it in
 * `verify:hard` is. A hand-kept list cannot be complete by construction; a registry
 * derivation can.
 *
 * WHY THIS IS A MODULE AND NOT A FUNCTION INSIDE THE SEED SCRIPT
 * `seed-policies.ts` calls `main()` at module load. Importing it from a test to
 * assert completeness would RUN THE SEEDER against whatever DATABASE_URL is in the
 * environment — a production write as a side effect of a unit test. The derivation
 * is logic, not a script, so it lives here where it can be imported safely.
 *
 * APPROVAL IS DELIBERATELY "pending", NEVER `rule.approval`
 * ALL 20 rules declare `approval: "auto"` — not one declares "ask". Deriving
 * `approvalClass` from `rule.approval` would arm 17 lanes to fire unattended as a
 * side effect of closing a coverage gap. Measured: 18 send_telegram, 1 send_email,
 * 1 promote_memory.
 *
 * WHICH LANE IS PROTECTED BY WHAT — the important half, and easy to get backwards.
 * The 17 at risk from a bad derivation are ALL send_telegram (operator-facing spam).
 * `auto_followup_expired_quote`, the one lane that emails a LEAD, is NOT protected by
 * this file at all: its curated entry is spread LAST in seed-policies.ts and wins over
 * any derivation, so it stays "pending" even if this baseline said "auto". Same for
 * `memory_promotion`. CURATION protects the customer-facing lane; the DERIVATION
 * protects the telegram ones. Do not delete the curated `auto_followup_expired_quote`
 * entry as "redundant with the pending baseline" — that moves the email lane's only
 * protection into DERIVED_BASELINE_APPROVAL, one word away from arming it, and every
 * test in this file would still pass.
 *
 * Creating a policy records that a lane EXISTS. Arming it is a separate decision the
 * operator makes by curating an entry or flipping the class in the UI.
 *
 * RUNTIME DELTA — narrow, but not zero. `shouldDefer` treats `null` and `"pending"`
 * identically, so no lane changes whether it fires. But the deferred path also calls
 * `logPolicyFire(policyId, ...)`: with no row that matched nothing and returned; with
 * a "pending" row it increments fireCount, stamps lastFiredAt, and writes an
 * AutomationPolicyFire row per deferred match — for 17 lanes that previously wrote
 * none. That is the intended gain (those fires were invisible), but it is a write that
 * did not happen before, so it is stated rather than claimed away.
 */
import { listRuleNames } from "@/lib/brain/autonomous-engine";
import type { ApprovalClass, PolicyUpsertInput } from "@/lib/automation/policy";

/** The class every derived baseline gets. Asserted by a canary — see the test. */
export const DERIVED_BASELINE_APPROVAL: ApprovalClass = "pending";

export function derivedRulePolicies(): PolicyUpsertInput[] {
  return listRuleNames().map((r) => ({
    id: `autonomous-action.${r.name}`,
    surface: "autonomous-action" as const,
    name: r.name,
    objective:
      `Autonomous rule \`${r.name}\` (${r.actionType} -> ${r.targetType}). ` +
      "Baseline derived from the RULES registry so the lane is visible and auditable. " +
      "No hand-written objective yet — curate an entry in CURATED_NON_CRON to replace " +
      "this text and to make an arming decision.",
    trigger: `lib/brain/autonomous-engine.ts · RULES["${r.name}"].trigger()`,
    approvalClass: DERIVED_BASELINE_APPROVAL,
    rollback: r.actionType.startsWith("send_")
      ? "manual-only · the message has already been sent"
      : "unspecified · curate this entry before relying on rollback",
    successMetric:
      "UNSPECIFIED — this baseline closes the fail-closed bootstrap gap. It does not " +
      "assert the rule is working; curate the entry to state a real metric.",
    tags: ["derived-baseline", "needs-curation", r.actionType, `target:${r.targetType}`],
  }));
}

/**
 * Later entries win, so curated policies OVERRIDE derived baselines. That keeps
 * hand-written objectives and deliberate `auto` arming decisions authoritative
 * while the registry guarantees completeness.
 */
export function mergeById(inputs: PolicyUpsertInput[]): PolicyUpsertInput[] {
  const byId = new Map<string, PolicyUpsertInput>();
  for (const p of inputs) byId.set(p.id, p);
  return [...byId.values()];
}
