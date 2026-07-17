/**
 * Autonomy control service — loads the active policy, evaluates actions
 * through the pure engine, and records every decision to the append-only
 * audit trail. Degrades gracefully until the operator applies drizzle/0086:
 * a missing table means the DEFAULT policy governs and audit events are
 * logged (WARN) instead of stored — enforcement never silently disappears.
 */
import { randomUUID } from "crypto";
import {
  DEFAULT_AUTONOMY_POLICY,
  evaluateAutonomyAction,
  validateAutonomyPolicyShape,
  type AutonomyActionContext,
  type AutonomyPolicy,
  type PolicyDecision,
} from "../../client/src/lib/autonomyPolicy";
import { createLogger } from "../lib/logger";

const log = createLogger("services:autonomy-control");

/** Provider media spend per reel render (6 seedance clips ≈ 72 credits).
 *  ESTIMATE for budget accounting — Higgsfield does not expose a per-call USD
 *  price through the CLI; revisit when provider usage tracking lands. */
export const ESTIMATED_REEL_RENDER_COST_USD = 1.5;

let cachedPolicy: { policy: AutonomyPolicy; loadedAt: number } | null = null;
const POLICY_CACHE_MS = 30_000; // fresh enough for kill switches, cheap enough for hot paths

export function clearPolicyCache(): void {
  cachedPolicy = null;
}

export async function getActivePolicy(): Promise<AutonomyPolicy> {
  if (cachedPolicy && Date.now() - cachedPolicy.loadedAt < POLICY_CACHE_MS) return cachedPolicy.policy;
  try {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (d) {
      const { autonomyPolicyVersions } = await import("../../drizzle/schema");
      const { desc } = await import("drizzle-orm");
      const rows = await d.select().from(autonomyPolicyVersions).orderBy(desc(autonomyPolicyVersions.version)).limit(1);
      if (rows.length) {
        const parsed: unknown = JSON.parse(rows[0].policyJson);
        if (validateAutonomyPolicyShape(parsed)) {
          cachedPolicy = { policy: parsed, loadedAt: Date.now() };
          return parsed;
        }
        log.error("stored policy failed shape validation — falling back to DEFAULT", { version: rows[0].version });
      }
    }
  } catch (err) {
    log.warn("policy storage unavailable — DEFAULT policy governs", {
      err: err instanceof Error ? err.message.slice(0, 160) : String(err),
    });
  }
  cachedPolicy = { policy: DEFAULT_AUTONOMY_POLICY, loadedAt: Date.now() };
  return DEFAULT_AUTONOMY_POLICY;
}

export async function recordAuditEvent(input: {
  actionType: string;
  decision: string;
  reasoningCodes: string[];
  policyVersion: number;
  context?: unknown;
  campaignId?: string | null;
}): Promise<void> {
  try {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) throw new Error("no db");
    const { autonomyAuditEvents } = await import("../../drizzle/schema");
    await d.insert(autonomyAuditEvents).values({
      id: `aud_${randomUUID()}`,
      actionType: input.actionType.slice(0, 48),
      decision: input.decision.slice(0, 24),
      reasoningCodes: input.reasoningCodes.join(",").slice(0, 1024),
      policyVersion: input.policyVersion,
      contextJson: input.context ? JSON.stringify(input.context).slice(0, 60_000) : null,
      campaignId: input.campaignId ?? null,
    });
  } catch (err) {
    // The audit trail is evidence, not a gate — losing a row must not block
    // the action, but it must be LOUD in logs.
    log.warn("audit event not persisted (0086 pending?)", {
      actionType: input.actionType,
      decision: input.decision,
      codes: input.reasoningCodes.join(","),
      err: err instanceof Error ? err.message.slice(0, 120) : String(err),
    });
  }
}

/** Evaluate + audit. Callers branch on the returned decision. */
export async function authorize(action: AutonomyActionContext, campaignId?: string | null): Promise<PolicyDecision> {
  const policy = await getActivePolicy();
  const decision = evaluateAutonomyAction(policy, action);
  await recordAuditEvent({
    actionType: action.type,
    decision: decision.decision,
    reasoningCodes: decision.reasoningCodes,
    policyVersion: decision.policyVersion,
    context: { format: action.format, platform: action.platform, estimatedCostUsd: action.estimatedCostUsd, scores: action.scores, flags: action.flags, today: action.today },
    campaignId,
  });
  if (decision.decision === "DENY") {
    log.warn("action DENIED by autonomy policy", { action: action.type, codes: decision.reasoningCodes.join(",") });
  }
  return decision;
}

/** Throwing variant for endpoints: DENY becomes an error naming the codes.
 *  REQUIRE_APPROVAL passes — on today's surfaces the operator's own tap IS
 *  the approval (every action here is operator-initiated in the admin UI). */
export async function assertAllowed(action: AutonomyActionContext, campaignId?: string | null): Promise<PolicyDecision> {
  const decision = await authorize(action, campaignId);
  if (decision.decision === "DENY") {
    throw new Error(`Blocked by autonomy policy v${decision.policyVersion}: ${decision.reasoningCodes.join(", ")}`);
  }
  return decision;
}

/** Publish a new policy version (append-only). */
export async function publishPolicyVersion(policy: AutonomyPolicy, note: string, createdBy: string): Promise<{ version: number }> {
  if (!validateAutonomyPolicyShape(policy)) throw new Error("policy failed shape validation");
  const { getDb } = await import("../db");
  const d = await getDb();
  if (!d) throw new Error("DB not available — cannot version policy");
  const { autonomyPolicyVersions } = await import("../../drizzle/schema");
  const { desc } = await import("drizzle-orm");
  const latest = await d.select({ version: autonomyPolicyVersions.version }).from(autonomyPolicyVersions).orderBy(desc(autonomyPolicyVersions.version)).limit(1);
  const nextVersion = (latest[0]?.version ?? DEFAULT_AUTONOMY_POLICY.version) + 1;
  const stamped: AutonomyPolicy = { ...policy, version: nextVersion };
  await d.insert(autonomyPolicyVersions).values({
    version: nextVersion,
    policyJson: JSON.stringify(stamped),
    note: note.slice(0, 400),
    createdBy: createdBy.slice(0, 120),
  });
  clearPolicyCache();
  log.info("autonomy policy version published", { version: nextVersion, note });
  return { version: nextVersion };
}

/** One-tap emergency control: flips a kill switch by publishing a new version. */
export async function setKillSwitch(scope: "global" | "generation" | "publishing", on: boolean, createdBy: string): Promise<{ version: number }> {
  const current = await getActivePolicy();
  const next: AutonomyPolicy = {
    ...current,
    emergencyControls: {
      ...current.emergencyControls,
      globalKillSwitch: scope === "global" ? on : current.emergencyControls.globalKillSwitch,
      generationKillSwitch: scope === "generation" ? on : current.emergencyControls.generationKillSwitch,
      publishingKillSwitch: scope === "publishing" ? on : current.emergencyControls.publishingKillSwitch,
    },
  };
  return publishPolicyVersion(next, `${scope} kill switch ${on ? "ON" : "OFF"}`, createdBy);
}
