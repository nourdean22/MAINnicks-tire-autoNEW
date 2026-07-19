/**
 * Autonomy control service — loads the active policy, evaluates actions
 * through the pure engine, and records every decision to the append-only
 * audit trail. Degrades gracefully until the operator applies drizzle/0086:
 * a missing table means the DEFAULT policy governs and audit events are
 * logged (WARN) instead of stored — enforcement never silently disappears.
 */
import { randomUUID } from "crypto";
import { z } from "zod";
import {
  DEFAULT_AUTONOMY_POLICY,
  evaluateAutonomyAction,
  resolveBoundaryOutcome,
  type AutonomyActionContext,
  type AutonomyPolicy,
  type BoundaryActor,
  type PolicyDecision,
} from "../../client/src/lib/autonomyPolicy";
import { createLogger } from "../lib/logger";

const log = createLogger("services:autonomy-control");

/**
 * STRICT server-side policy schema — the #815 review's P2: the shallow shape
 * check let incomplete policies through, silently dropping limits or approval
 * requirements. Every nested key is required, enums exact, numbers finite and
 * range-bound, unknown keys rejected.
 */
const permission = z.enum(["manual", "approval_required", "auto"]);
const bounded = (min: number, max: number) => z.number().finite().min(min).max(max);
export const autonomyPolicyStrictSchema = z.object({
  version: z.number().int().min(1),
  operatingMode: z.enum(["observe", "recommend", "draft", "produce", "schedule", "controlled_publish"]),
  formatPermissions: z.object({
    reel: permission,
    carousel: permission,
    photo: permission,
    story: permission,
    organicOffer: permission,
    paidAd: permission,
  }).strict(),
  minimumScores: z.object({
    opportunity: bounded(0, 100),
    concept: bounded(0, 60),
    factualConfidence: bounded(0, 1),
    briefQuality: bounded(0, 75),
    renderedCreative: bounded(0, 100),
  }).strict(),
  limits: z.object({
    maxFeedPostsPerDay: bounded(0, 20),
    maxStoriesPerDay: bounded(0, 40),
    minimumFeedSpacingHours: bounded(0, 48),
    maxCampaignsPerWeek: bounded(0, 50),
    maxGenerationCostPerDayUsd: bounded(0, 1000),
    maxGenerationCostPerCampaignUsd: bounded(0, 500),
    maxRepairAttemptsPerAsset: bounded(0, 10),
    maxModelCallsPerCampaign: bounded(0, 500),
  }).strict(),
  alwaysRequireApproval: z.object({
    prices: z.boolean(),
    discounts: z.boolean(),
    financing: z.boolean(),
    customerQuotes: z.boolean(),
    customerPhotos: z.boolean(),
    safetyClaims: z.boolean(),
    paidMedia: z.boolean(),
    newTerritory: z.boolean(),
    unresolvedEvidence: z.boolean(),
  }).strict(),
  emergencyControls: z.object({
    globalKillSwitch: z.boolean(),
    generationKillSwitch: z.boolean(),
    publishingKillSwitch: z.boolean(),
    platformKillSwitches: z.record(z.string(), z.boolean()),
  }).strict(),
}).strict();

/** Midnight in the shop's timezone (America/New_York) — the budget day must
 *  roll at Nick's midnight, not the server process's locale. */
export function clevelandDayStart(now: Date = new Date()): Date {
  const tz = "America/New_York";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  // parts = YYYY-MM-DD in shop-local time; find the UTC instant of that local midnight
  const localMidnightUtcGuess = new Date(`${parts}T00:00:00Z`);
  // Offset between the guess rendered in shop time and midnight tells us the zone offset
  const rendered = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hour12: false }).format(localMidnightUtcGuess);
  const offsetHours = Number(rendered) === 0 ? 0 : 24 - Number(rendered);
  return new Date(localMidnightUtcGuess.getTime() + offsetHours * 3600_000);
}

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
        const parsed = autonomyPolicyStrictSchema.safeParse(JSON.parse(rows[0].policyJson));
        if (parsed.success) {
          cachedPolicy = { policy: parsed.data, loadedAt: Date.now() };
          return parsed.data;
        }
        log.error("stored policy failed STRICT validation — falling back to DEFAULT", {
          version: rows[0].version,
          issue: parsed.error.issues[0]?.path.join("."),
        });
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
    // Same refusal as enforceAtBoundary's, so it carries the same type. Two
    // ways to say no that only one of them could be recognised from is how a
    // classifier ends up silently covering half its cases.
    throw new AutonomyDenial(decision.reasoningCodes, decision.policyVersion, "unspecified");
  }
  return decision;
}

// ─── Fresh emergency-control reads for external-action boundaries ──────────

let emergencyCache: { controls: AutonomyPolicy["emergencyControls"]; source: EmergencySource; loadedAt: number } | null = null;
const EMERGENCY_CACHE_MS = 2_000; // kill switches must bite fast across instances

export type EmergencySource = "storage" | "storage_empty" | "fallback_unreachable";

/** Kill-switch state read (near-)directly from storage — the #815 review's
 *  cache concern: a 30s process-local cache is fine for limits but too slow
 *  for an emergency stop. The SOURCE matters: "fallback_unreachable" means
 *  the true switch state is UNKNOWN (an operator's ON switch in storage would
 *  be invisible) — non-operator actors must fail closed on that state. */
export async function getEmergencyControlsFresh(): Promise<{ controls: AutonomyPolicy["emergencyControls"]; source: EmergencySource }> {
  if (emergencyCache && Date.now() - emergencyCache.loadedAt < EMERGENCY_CACHE_MS) {
    return { controls: emergencyCache.controls, source: emergencyCache.source };
  }
  try {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (d) {
      const { autonomyPolicyVersions } = await import("../../drizzle/schema");
      const { desc } = await import("drizzle-orm");
      const rows = await d
        .select({ policyJson: autonomyPolicyVersions.policyJson })
        .from(autonomyPolicyVersions)
        .orderBy(desc(autonomyPolicyVersions.version))
        .limit(1);
      if (rows.length) {
        const parsed = autonomyPolicyStrictSchema.safeParse(JSON.parse(rows[0].policyJson));
        if (parsed.success) {
          emergencyCache = { controls: parsed.data.emergencyControls, source: "storage", loadedAt: Date.now() };
          return { controls: parsed.data.emergencyControls, source: "storage" };
        }
      } else {
        // Storage reachable, no versions published yet — DEFAULT (all off)
        // genuinely IS the state, not a guess.
        const controls = DEFAULT_AUTONOMY_POLICY.emergencyControls;
        emergencyCache = { controls, source: "storage_empty", loadedAt: Date.now() };
        return { controls, source: "storage_empty" };
      }
    }
  } catch { /* storage unavailable — fall through */ }
  const fallback = (cachedPolicy?.policy ?? DEFAULT_AUTONOMY_POLICY).emergencyControls;
  emergencyCache = { controls: fallback, source: "fallback_unreachable", loadedAt: Date.now() };
  return { controls: fallback, source: "fallback_unreachable" };
}

export interface BoundaryActorContext {
  type: BoundaryActor;
  id: string;
}

/**
 * THE authoritative enforcement point for costly/external actions — lives in
 * shared services (reelPipeline.enqueueReelJob, socialPublish), never only in
 * routers (#815 review P1: cron paths bypassed the router-only check).
 *
 * Semantics:
 * - Kill switches are read FRESH (2s cache), overriding the cached policy.
 * - DENY throws for every actor.
 * - REQUIRE_APPROVAL: an operator's own tap proceeds and is audited as
 *   APPROVED_BY_OPERATOR with the actor id; cron/autonomous actors are
 *   BLOCKED — approval cannot be implied for an actor that cannot approve.
 * - Policy infrastructure failure: operator paths proceed LOUD (break-glass
 *   posture, warn-logged); cron/autonomous paths FAIL CLOSED.
 */
/**
 * The policy said NO. A refusal, not a breakage.
 *
 * That distinction is the entire point of the operator action log: "the system
 * keeps refusing because I hit the daily cap" and "the system keeps breaking"
 * demand completely different responses, and only one of them is a bug.
 *
 * It used to throw a plain Error, so the only way to recognise it was to regex
 * its message — and content.ts's regex (/preflight blocked|governor|budget|
 * spend|cap|cooldown/i) matched NONE of the words in "Blocked by autonomy policy
 * v3: kill_switch_all". Every kill-switch and operating-mode denial was
 * therefore recorded as a FAILURE, which is the exact defect #914 removed from
 * this codebase and which came back through a different door.
 *
 * A type cannot be matched by accident and cannot drift when a message is
 * reworded. Mirrors GovernorDenial in contentGovernor.ts, deliberately: two
 * refusal sources with one shape.
 */
export class AutonomyDenial extends Error {
  constructor(
    public readonly codes: string[],
    public readonly policyVersion: number,
    /** Absent when the caller did not identify an actor (assertAllowed). */
    public readonly actorType?: string,
  ) {
    // The message PREFIX is load-bearing: three existing call sites in
    // content.ts match on startsWith("Blocked by autonomy policy"). Keeping it
    // byte-identical means adding the type breaks nothing while it is adopted.
    super(
      `Blocked by autonomy policy v${policyVersion}: ${codes.join(", ")}`
      + (actorType ? ` (actor: ${actorType})` : ""),
    );
    this.name = "AutonomyDenial";
  }
}

export async function enforceAtBoundary(
  action: AutonomyActionContext,
  actor: BoundaryActorContext,
  campaignId?: string | null,
): Promise<void> {
  const policy = await getActivePolicy();
  const emergency = await getEmergencyControlsFresh();
  if (emergency.source === "fallback_unreachable" && actor.type !== "operator") {
    // The TRUE kill-switch state is unknowable right now (storage
    // unreachable) — an operator's emergency stop could be invisible.
    // Automated actors fail CLOSED; operators proceed loud below.
    throw new Error(`Autonomy policy storage unreachable — ${actor.type} actions fail closed (${action.type})`);
  }
  if (emergency.source === "fallback_unreachable") {
    log.warn("kill-switch state unverifiable (storage unreachable) — operator path proceeding under break-glass posture", {
      action: action.type,
    });
  }
  const effective: AutonomyPolicy = { ...policy, emergencyControls: emergency.controls };
  const decision = evaluateAutonomyAction(effective, action);
  const outcome = resolveBoundaryOutcome(decision, actor.type);
  await recordAuditEvent({
    actionType: action.type,
    decision: outcome === "proceed_operator_approved" ? "APPROVED_BY_OPERATOR" : decision.decision,
    reasoningCodes: [...decision.reasoningCodes, `actor:${actor.type}:${actor.id}`],
    policyVersion: decision.policyVersion,
    context: { format: action.format, platform: action.platform, estimatedCostUsd: action.estimatedCostUsd, today: action.today, flags: action.flags },
    campaignId,
  });
  if (outcome === "blocked") {
    throw new AutonomyDenial(decision.reasoningCodes, decision.policyVersion, actor.type);
  }
}

/** Publish a new policy version (append-only, STRICT-validated). Version
 *  allocation is guarded by the UNIQUE constraint on `version` — a concurrent
 *  publisher hits a duplicate-key error and we retry once against the fresh
 *  max instead of silently double-allocating. */
export async function publishPolicyVersion(policy: AutonomyPolicy, note: string, createdBy: string): Promise<{ version: number }> {
  const strict = autonomyPolicyStrictSchema.safeParse({ ...policy, version: Math.max(1, Math.floor(policy.version)) });
  if (!strict.success) {
    throw new Error(`policy failed strict validation: ${strict.error.issues[0]?.path.join(".")} ${strict.error.issues[0]?.message}`);
  }
  const { getDb } = await import("../db");
  const d = await getDb();
  if (!d) throw new Error("DB not available — cannot version policy");
  const { autonomyPolicyVersions } = await import("../../drizzle/schema");
  const { desc } = await import("drizzle-orm");

  for (let attempt = 0; attempt < 2; attempt++) {
    const latest = await d.select({ version: autonomyPolicyVersions.version }).from(autonomyPolicyVersions).orderBy(desc(autonomyPolicyVersions.version)).limit(1);
    const nextVersion = (latest[0]?.version ?? DEFAULT_AUTONOMY_POLICY.version) + 1;
    const stamped: AutonomyPolicy = { ...strict.data, version: nextVersion };
    try {
      await d.insert(autonomyPolicyVersions).values({
        version: nextVersion,
        policyJson: JSON.stringify(stamped),
        note: note.slice(0, 400),
        createdBy: createdBy.slice(0, 120),
      });
      clearPolicyCache();
      emergencyCache = null;
      log.info("autonomy policy version published", { version: nextVersion, note });
      return { version: nextVersion };
    } catch (err) {
      const dup = err instanceof Error && /duplicate/i.test(err.message);
      if (!dup || attempt === 1) throw err;
      log.warn("policy version collision — retrying against fresh max", { attempted: nextVersion });
    }
  }
  throw new Error("policy version allocation failed");
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
