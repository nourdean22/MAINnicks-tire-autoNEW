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
  type AutonomyLimitKey,
  type AutonomyPolicy,
  type BoundaryActor,
  type PolicyDecision,
} from "../../client/src/lib/autonomyPolicy";
import { isDuplicateKeyError } from "../lib/dbErrors";
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
  /**
   * SPEND THE BUDGET THAT IS ALREADY SET, WITHOUT ASKING FIRST.
   *
   * Added 2026-09-09. A rendered-QA verdict of needs_paid_repair is a real
   * defect with a known fix whose only obstacle is that the fix costs credits.
   * Before this, every one parked until an operator authorized that specific
   * spend - measured: 30 consecutive daily-reel-post pulses held on job 1890002,
   * with the whole channel dark behind it for a day.
   *
   * "auto" does NOT mean unbounded. The repair is queued through the same
   * requestBeatRepair the operator button uses, which prices the beat at the
   * ACTIVE provider and calls enforceAtBoundary with today's real spend - so
   * limits.maxGenerationCostPerDayUsd and limits.maxRepairAttemptsPerAsset are
   * still the ceilings, and a repair that would breach either is refused and
   * the reel simply stays held, exactly as before.
   *
   * OPTIONAL WITH A DEFAULT on purpose: the schema is .strict(), and every
   * policy row written before this field existed must keep validating. Missing
   * key reads as approval_required, which is the pre-2026-09-09 behaviour, so
   * this cannot silently turn spending on for anyone who has not chosen it.
   */
  autonomousRepair: z.object({
    /** manual | approval_required | auto - "auto" spends within the limits above. */
    paidBeatRegeneration: permission,
  }).strict().default({ paidBeatRegeneration: "approval_required" }),
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

/** A policy (or one edit to it) the strict schema refuses: the caller's input, not a breakage. */
export class PolicyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyValidationError";
  }
}

function strictFailure(error: z.ZodError): string {
  return `${error.issues[0]?.path.join(".")} ${error.issues[0]?.message}`;
}

/** Publish a new policy version (append-only, STRICT-validated). Version
 *  allocation is guarded by the UNIQUE constraint on `version` — a concurrent
 *  publisher hits a duplicate-key error and we retry once against the fresh
 *  max instead of silently double-allocating. This publishes a WHOLE policy;
 *  to change one setting use editPolicy's callers below, which cannot lose a
 *  concurrent edit. */
export async function publishPolicyVersion(policy: AutonomyPolicy, note: string, createdBy: string): Promise<{ version: number }> {
  const strict = autonomyPolicyStrictSchema.safeParse({ ...policy, version: Math.max(1, Math.floor(policy.version)) });
  if (!strict.success) {
    throw new PolicyValidationError(`policy failed strict validation: ${strictFailure(strict.error)}`);
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
      // drizzle wraps the driver error: the message is the SQL and its params,
      // and ER_DUP_ENTRY sits on `.cause`. The old /duplicate/i test on the
      // message never matched a real collision, so this retry never ran.
      if (!isDuplicateKeyError(err) || attempt === 1) throw err;
      log.warn("policy version collision — retrying against fresh max", { attempted: nextVersion });
    }
  }
  throw new Error("policy version allocation failed");
}

const EDIT_ATTEMPTS = 3;

/**
 * Change ONE setting in the governing policy and publish the result as the
 * next version. Every operator control on Autonomy control goes through here.
 *
 * Why not publish a policy the phone built: the phone's copy is partial or
 * stale. The command center sends version, mode, kill switches and limits
 * only, so publishing it as the whole policy failed shape validation — every
 * limit edit, the Generation budget included, was refused until 2026-10-08 —
 * and a stale whole copy would undo a kill switch armed from another device.
 *
 * An edit starts from the policy that GOVERNS, read fresh (never the 30 s
 * cache): the latest stored version when it validates, the code default when
 * storage is empty or that version fails validation (the same fallback
 * getActivePolicy applies, so an emergency switch can always be armed). An
 * unreachable store is an error, never "edit the default": that would publish
 * the default over every setting the operator chose.
 *
 * Exactly the next version number is written, and the UNIQUE index on
 * `version` (uq_autonomy_policy_version, drizzle/0086) is the compare-and-swap:
 * when another edit took the number first, this one re-reads and re-applies
 * its change on top, so neither edit is lost. publishPolicyVersion's retry
 * cannot do that — it re-publishes its own copy.
 */
async function editPolicy(
  change: (current: AutonomyPolicy) => AutonomyPolicy,
  note: (current: AutonomyPolicy) => string,
  createdBy: string,
): Promise<{ version: number }> {
  const { getDb } = await import("../db");
  const d = await getDb();
  if (!d) throw new Error("DB not available — cannot edit the autonomy policy");
  const { autonomyPolicyVersions } = await import("../../drizzle/schema");
  const { desc } = await import("drizzle-orm");

  for (let attempt = 0; attempt < EDIT_ATTEMPTS; attempt++) {
    const rows = await d
      .select({ version: autonomyPolicyVersions.version, policyJson: autonomyPolicyVersions.policyJson })
      .from(autonomyPolicyVersions)
      .orderBy(desc(autonomyPolicyVersions.version))
      .limit(1);
    let current: AutonomyPolicy = DEFAULT_AUTONOMY_POLICY;
    if (rows.length) {
      let stored: unknown = null;
      try { stored = JSON.parse(rows[0].policyJson); } catch { /* unparseable reads as invalid below */ }
      const parsed = autonomyPolicyStrictSchema.safeParse(stored);
      if (parsed.success) current = parsed.data;
      else log.error("stored policy failed STRICT validation — editing on top of the DEFAULT that governs", { version: rows[0].version });
    }
    const nextVersion = (rows[0]?.version ?? DEFAULT_AUTONOMY_POLICY.version) + 1;
    const strict = autonomyPolicyStrictSchema.safeParse({ ...change(current), version: nextVersion });
    if (!strict.success) {
      throw new PolicyValidationError(`policy edit failed strict validation: ${strictFailure(strict.error)}`);
    }
    const text = note(current);
    try {
      await d.insert(autonomyPolicyVersions).values({
        version: nextVersion,
        policyJson: JSON.stringify(strict.data),
        note: text.slice(0, 400),
        createdBy: createdBy.slice(0, 120),
      });
      clearPolicyCache();
      emergencyCache = null;
      log.info("autonomy policy edited", { version: nextVersion, note: text });
      return { version: nextVersion };
    } catch (err) {
      if (!isDuplicateKeyError(err) || attempt === EDIT_ATTEMPTS - 1) throw err;
      log.warn("policy edit lost the version race — re-reading and re-applying", { attempted: nextVersion });
    }
  }
  throw new Error("policy edit failed");
}

/** One-tap emergency control: flips a kill switch by publishing a new version. */
export async function setKillSwitch(scope: "global" | "generation" | "publishing", on: boolean, createdBy: string): Promise<{ version: number }> {
  const field = scope === "global" ? "globalKillSwitch" : scope === "generation" ? "generationKillSwitch" : "publishingKillSwitch";
  return editPolicy(
    (current) => ({ ...current, emergencyControls: { ...current.emergencyControls, [field]: on } }),
    () => `${scope} kill switch ${on ? "ON" : "OFF"}`,
    createdBy,
  );
}

/** One limit (budget, caps, spacing). Bounds are the strict schema's; out of range is a PolicyValidationError. */
export async function setPolicyLimit(key: AutonomyLimitKey, value: number, createdBy: string): Promise<{ version: number }> {
  return editPolicy(
    (current) => ({ ...current, limits: { ...current.limits, [key]: value } }),
    (current) => `${key} ${current.limits[key]} -> ${value}`,
    createdBy,
  );
}

/**
 * Whether a paid beat repair runs on its own ("auto": within the generation
 * budget and the repairs-per-asset limit) or waits for the operator. The one
 * reader is cron/jobs/dailyReelPost.ts, which spends only on "auto".
 */
export async function setPaidRepairPermission(permission: "auto" | "approval_required", createdBy: string): Promise<{ version: number }> {
  return editPolicy(
    (current) => ({ ...current, autonomousRepair: { paidBeatRegeneration: permission } }),
    (current) => `paid beat repair ${current.autonomousRepair?.paidBeatRegeneration ?? "approval_required"} -> ${permission}`,
    createdBy,
  );
}
