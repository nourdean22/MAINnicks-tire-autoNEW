/**
 * GET /api/cron/autonomous-engine · 2026-06-02 · Nick autonomy resurrection
 *
 * Re-plugs the dormant proactive engine. `runAutonomousActions()`
 * (lib/brain/autonomous-engine.ts · ~20 rules: revenue-pace, urgent-
 * leads, drift, commitment enforcement, morning brief, expired-quote
 * follow-up, etc.) had ZERO callers after its original cron route was
 * pruned. This route is the single, flag-gated caller.
 *
 * ── SAFETY MODEL (read before touching) ────────────────────────────
 *
 * 1. FLAG GATE · the engine never runs unless `NICK_AUTONOMY` is on
 *    (env `NICK_AUTONOMY=true` on Railway). Flag off → `{skipped:
 *    "flag off"}` returns BEFORE any rule trigger, DB read, or side
 *    effect. Default (flag unset) is OFF.
 *
 * 2. APPROVAL GATE · the engine itself gates side effects on the
 *    AutomationPolicy registry (lib/brain/autonomous-engine.ts
 *    v10.0.157, ~line 1031): a rule only fires `rule.action(item)`
 *    when its policy `autonomous-action.<ruleName>` is absent/`auto`.
 *    When the policy `approvalClass="pending"` (or `rule.approval=
 *    "ask"`), the side effect is DEFERRED — the matched item is
 *    written to `AutonomousAction.payload.deferredItem` with
 *    `approval="pending"`, and only executes once the operator
 *    approves at /system/approvals (→ executeApprovedAction).
 *
 *    ⚠ FAIL-CLOSED since v10.0.157: a rule with NO seeded policy row
 *    DEFERS to approval (missing policy → pending — see the resolution
 *    in lib/brain/autonomous-engine.ts, "No policy (null) → pending";
 *    pre-fix, a missing policy meant immediate auto-fire, and prod
 *    behavior confirms the fix: 14d of unseeded rules produced only
 *    approval="pending" rows, zero auto-executions). The seed
 *    (scripts/seed-policies.ts) is still worth running against prod —
 *    it gives every rule its policy metadata (objective/rollback/
 *    successMetric) and an explicit approvalClass so /system/policies
 *    shows intent instead of implicit defaults. The pre-flight
 *    assertion below logs a loud warning when rule policies are
 *    missing or non-pending so drift stays visible in the cron log.
 *
 * Mirrors the anticipate/consolidate route pattern: cronHandler
 * (CRON_SECRET auth + kill-switch + CronJobLog), structured return,
 * best-effort — failures are data, the cron never throws on a single
 * rule break (runAutonomousActions swallows per-rule).
 *
 * Scheduling: folded into the EVENING mega fan-out (see jobs.ts). The
 * rules self-gate on hour/weekday in ET, so a single daily evening
 * pass is enough — time-of-day rules that don't match simply no-op,
 * and the 24h-per-(rule,target) cooldown + idempotency keys make
 * re-fires safe.
 */

import { cronHandler } from "@/lib/utils/http";
import { getFlag } from "@/lib/feature-flags";
import { runAutonomousActions } from "@/lib/brain/autonomous-engine";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("cron/autonomous-engine");

// Engine iterates ~20 rules, each doing a bridge/DB read; most no-op
// on the time-of-day gate. 90s gives headroom for the few that hit the
// nickstire bridge without starving sibling mega children.
export const maxDuration = 90;

export const GET = cronHandler(async () => {
  // ── 1. Flag gate — hard stop when autonomy is off. No reads, no
  //    side effects, no policy lookups. Default-off (flag unset).
  const flag = getFlag("NICK_AUTONOMY");
  if (!flag?.isOn) {
    return {
      ok: true,
      skipped: "flag off",
      flag: "NICK_AUTONOMY",
      rawValue: flag?.rawValue ?? "(unregistered)",
    };
  }

  // ── 2. Pre-flight safety assertion — verify every rule that emits an
  //    outward side effect has a `pending` policy so the engine's
  //    approval gate actually defers it. This does NOT block the run
  //    (the operator explicitly turned the flag on); it surfaces an
  //    un-gated rule LOUDLY in the cron log + return body so an
  //    accidental auto-send window is observable, not silent.
  const guard = await assertApprovalGated().catch((err) => {
    log.warn("approval_guard_check_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  });
  if (guard && guard.ungated.length > 0) {
    log.warn("autonomous_rules_NOT_approval_gated", {
      ungated: guard.ungated,
      hint: "seed autonomous-action.<rule> policies with approvalClass=pending",
    });
  }

  const t0 = Date.now();
  const result = await runAutonomousActions();
  const durationMs = Date.now() - t0;

  log.info("autonomous_engine_done", {
    executed: result.executed,
    errors: result.errors,
    durationMs,
    ungatedRuleCount: guard?.ungated.length ?? null,
  });

  return {
    ok: true,
    ...result,
    durationMs,
    // Surface the safety posture in the response so /system/crons and a
    // manual probe both show whether any rule is currently un-gated.
    approvalGate:
      guard == null
        ? "unknown (policy check failed)"
        : guard.ungated.length === 0
          ? "all outward rules pending-gated"
          : `UNGATED: ${guard.ungated.join(", ")}`,
  };
});

/**
 * Cross-check the engine's outward-side-effect rules against the
 * AutomationPolicy registry. A rule is "approval-gated" iff its policy
 * `autonomous-action.<rule>` exists with approvalClass="pending".
 *
 * The list below is the set of rules whose `action` reaches a real
 * external recipient OR pushes a Telegram/email/memory mutation we want
 * an operator to sign off on while autonomy is young. Keep it in sync
 * with lib/brain/autonomous-engine.ts RULES (every rule with an
 * outward effect). `auto_followup_expired_quote` is the only one that
 * emails a real CUSTOMER — it must always be pending.
 */
async function assertApprovalGated(): Promise<{ ungated: string[] }> {
  const OUTWARD_RULES = [
    "auto_followup_expired_quote", // EMAIL → real customer (highest risk)
    "auto_remind_pending_appointment",
    "decision_replay_due",
    "suggest_pricing_adjustment",
    "daily_score_reminder",
    "commitment_checkin",
    "workout_reminder",
    "midweek_target_check",
    "stale_leads_alert",
    "task_overload_alert",
    "friday_revenue_check",
    "drift_escalation",
    "morning_brief_push",
    "overdue_commitment_escalation",
    "adaptive_habit_upgrade",
    "commitment_escalation_day5",
    "memory_promotion",
    "revenue_overconfidence_gate",
    "decision_review_due",
    "quote_conversion_insight",
  ];

  const { prisma } = await import("@/lib/prisma");
  const ids = OUTWARD_RULES.map((r) => `autonomous-action.${r}`);
  const policies = await prisma.automationPolicy.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: { id: true, approvalClass: true },
  });
  const pendingSet = new Set(
    policies
      .filter((p) => p.approvalClass === "pending")
      .map((p) => p.id.replace(/^autonomous-action\./, "")),
  );
  const ungated = OUTWARD_RULES.filter((r) => !pendingSet.has(r));
  return { ungated };
}
