/*
 * Autonomy Policy — the control plane's contract (Wave A, slice 1).
 *
 * One versioned, deterministic policy that decides BEFORE every costly or
 * externally visible action. Until now the rules lived scattered across env
 * vars (REEL_PUBLISH_ENABLED), feature flags, prompt text, cron conditions,
 * and per-endpoint thresholds — hard to audit, easy to contradict.
 *
 * Design rules:
 * - Pure module: the decision engine is deterministic code. No model output
 *   can override it; models never see or edit this policy.
 * - Decisions carry structured reasoning CODES (not prose) for the audit log.
 * - The DEFAULT policy encodes today's real operating truth: the system
 *   drafts and renders on operator taps, and NOTHING publishes without a
 *   human. Loosening any of it requires publishing a new policy version.
 */

export type PublishPermission = "manual" | "approval_required" | "auto";

export type OperatingMode =
  | "observe"
  | "recommend"
  | "draft"
  | "produce"
  | "schedule"
  | "controlled_publish";

/** Ordered — later modes include the authority of earlier ones. */
export const OPERATING_MODE_ORDER: OperatingMode[] = [
  "observe",
  "recommend",
  "draft",
  "produce",
  "schedule",
  "controlled_publish",
];

export interface AutonomyPolicy {
  version: number;
  operatingMode: OperatingMode;

  formatPermissions: {
    reel: PublishPermission;
    carousel: PublishPermission;
    photo: PublishPermission;
    story: PublishPermission;
    organicOffer: PublishPermission;
    paidAd: PublishPermission;
  };

  minimumScores: {
    /** 0-100 campaign-opportunity bar (opportunity engine arrives in Wave C) */
    opportunity: number;
    /** 0-60 concept bar (matches scoreConcept / scoreReelConcept scale) */
    concept: number;
    /** 0-1 evidence confidence bar */
    factualConfidence: number;
    /** 0-75 brief bar (matches the reel 70/75 + carousel boost gates) */
    briefQuality: number;
    /** 0-100 rendered-creative bar (critic arrives in Wave F) */
    renderedCreative: number;
  };

  limits: {
    maxFeedPostsPerDay: number;
    maxStoriesPerDay: number;
    minimumFeedSpacingHours: number;
    maxCampaignsPerWeek: number;
    maxGenerationCostPerDayUsd: number;
    maxGenerationCostPerCampaignUsd: number;
    maxRepairAttemptsPerAsset: number;
    maxModelCallsPerCampaign: number;
  };

  alwaysRequireApproval: {
    prices: boolean;
    discounts: boolean;
    financing: boolean;
    customerQuotes: boolean;
    customerPhotos: boolean;
    safetyClaims: boolean;
    paidMedia: boolean;
    newTerritory: boolean;
    unresolvedEvidence: boolean;
  };

  /**
   * Spend the budget that is already set, without asking first.
   *
   * "auto" lets a needs_paid_repair verdict queue its own beat regeneration.
   * It is NOT unbounded: the repair goes through requestBeatRepair, which
   * prices the beat at the active provider and enforces
   * limits.maxGenerationCostPerDayUsd and limits.maxRepairAttemptsPerAsset.
   * Optional so policy rows written before 2026-09-09 keep validating; absent
   * reads as approval_required.
   */
  autonomousRepair?: {
    paidBeatRegeneration: PublishPermission;
  };

  emergencyControls: {
    globalKillSwitch: boolean;
    generationKillSwitch: boolean;
    publishingKillSwitch: boolean;
    platformKillSwitches: Record<string, boolean>;
  };
}

/** Every key of `limits`, for the endpoint that changes one limit at a time. */
export const AUTONOMY_LIMIT_KEYS = [
  "maxFeedPostsPerDay",
  "maxStoriesPerDay",
  "minimumFeedSpacingHours",
  "maxCampaignsPerWeek",
  "maxGenerationCostPerDayUsd",
  "maxGenerationCostPerCampaignUsd",
  "maxRepairAttemptsPerAsset",
  "maxModelCallsPerCampaign",
] as const satisfies ReadonlyArray<keyof AutonomyPolicy["limits"]>;
export type AutonomyLimitKey = (typeof AUTONOMY_LIMIT_KEYS)[number];

/**
 * Limits that count whole things. The governor compares a whole count with >=,
 * so a fraction would act as the next whole number (1.5 posts a day allows two).
 * Spacing and money keep decimals.
 */
export const AUTONOMY_COUNT_LIMIT_KEYS = [
  "maxFeedPostsPerDay",
  "maxStoriesPerDay",
  "maxCampaignsPerWeek",
  "maxRepairAttemptsPerAsset",
  "maxModelCallsPerCampaign",
] as const satisfies ReadonlyArray<AutonomyLimitKey>;

/** Today's real operating posture, written down and versioned. */
export const DEFAULT_AUTONOMY_POLICY: AutonomyPolicy = {
  version: 1,
  operatingMode: "produce",

  formatPermissions: {
    reel: "approval_required",
    carousel: "approval_required",
    photo: "approval_required",
    story: "manual",
    organicOffer: "manual",
    paidAd: "manual",
  },

  minimumScores: {
    opportunity: 60,
    concept: 57,
    factualConfidence: 0.7,
    briefQuality: 70,
    renderedCreative: 70,
  },

  limits: {
    maxFeedPostsPerDay: 2,
    maxStoriesPerDay: 3,
    minimumFeedSpacingHours: 3,
    maxCampaignsPerWeek: 5,
    maxGenerationCostPerDayUsd: 10,
    maxGenerationCostPerCampaignUsd: 5,
    maxRepairAttemptsPerAsset: 2,
    maxModelCallsPerCampaign: 40,
  },

  alwaysRequireApproval: {
    prices: true,
    discounts: true,
    financing: true,
    customerQuotes: true,
    customerPhotos: true,
    safetyClaims: true,
    paidMedia: true,
    newTerritory: true,
    unresolvedEvidence: true,
  },

  autonomousRepair: { paidBeatRegeneration: "approval_required" },

  emergencyControls: {
    globalKillSwitch: false,
    generationKillSwitch: false,
    publishingKillSwitch: false,
    platformKillSwitches: {},
  },
};

// ─── Actions the engine decides on ─────────────────────────────────

export type AutonomyActionType =
  | "generate_campaign" // tournament / genome / director drafts (model spend)
  | "enqueue_render" // provider media spend (reel clips, image plates)
  | "schedule_post"
  | "publish";

export interface AutonomyActionContext {
  type: AutonomyActionType;
  format?: keyof AutonomyPolicy["formatPermissions"];
  platform?: string;
  estimatedCostUsd?: number;
  /** scores already measured for the thing being advanced */
  scores?: Partial<Record<keyof AutonomyPolicy["minimumScores"], number>>;
  /** content-risk flags — set true when the content involves the category */
  flags?: Partial<{
    prices: boolean;
    discounts: boolean;
    financing: boolean;
    customerQuotes: boolean;
    customerPhotos: boolean;
    safetyClaims: boolean;
    paidMedia: boolean;
    newTerritory: boolean;
    unresolvedEvidence: boolean;
  }>;
  /** live counters the caller measured (DB-backed where available) */
  today?: Partial<{
    feedPostsPublished: number;
    storiesPublished: number;
    generationCostUsd: number;
    campaignsThisWeek: number;
    hoursSinceLastFeedPost: number;
    campaignCostUsd: number;
    repairAttemptsForAsset: number;
    modelCallsThisCampaign: number;
  }>;
}

export type AutonomyDecision = "ALLOW" | "REQUIRE_APPROVAL" | "DENY";

export interface PolicyDecision {
  decision: AutonomyDecision;
  reasoningCodes: string[];
  policyVersion: number;
}

/** Minimum operating mode required per action type. */
const MODE_REQUIRED: Record<AutonomyActionType, OperatingMode> = {
  generate_campaign: "draft",
  enqueue_render: "produce",
  schedule_post: "schedule",
  publish: "controlled_publish",
};

function modeAtLeast(current: OperatingMode, required: OperatingMode): boolean {
  return OPERATING_MODE_ORDER.indexOf(current) >= OPERATING_MODE_ORDER.indexOf(required);
}

/**
 * The deterministic decision. Evaluation order is fixed and total:
 * kill switches → operating mode → hard limits → minimum scores →
 * approval matrix → format permission. DENY short-circuits; approval
 * reasons accumulate so the operator sees EVERY reason at once.
 */
export function evaluateAutonomyAction(policy: AutonomyPolicy, action: AutonomyActionContext): PolicyDecision {
  const codes: string[] = [];
  const deny = (code: string): PolicyDecision => ({ decision: "DENY", reasoningCodes: [...codes, code], policyVersion: policy.version });

  // 1. Emergency controls — absolute.
  if (policy.emergencyControls.globalKillSwitch) return deny("GLOBAL_KILL_SWITCH");
  if (policy.emergencyControls.generationKillSwitch && (action.type === "generate_campaign" || action.type === "enqueue_render")) {
    return deny("GENERATION_KILL_SWITCH");
  }
  if (policy.emergencyControls.publishingKillSwitch && (action.type === "schedule_post" || action.type === "publish")) {
    return deny("PUBLISHING_KILL_SWITCH");
  }
  if (action.platform && policy.emergencyControls.platformKillSwitches[action.platform]) {
    return deny(`PLATFORM_KILL_SWITCH:${action.platform}`);
  }

  // 2. Operating mode.
  if (!modeAtLeast(policy.operatingMode, MODE_REQUIRED[action.type])) {
    return deny(`MODE_FORBIDS:${action.type}:${policy.operatingMode}`);
  }

  // 3. Hard limits (only the counters the caller measured are enforced —
  //    an unmeasured counter is never silently assumed zero-risk for spend,
  //    so cost checks treat missing estimates as 0 but log nothing).
  const t = action.today ?? {};
  const cost = action.estimatedCostUsd ?? 0;
  if (t.generationCostUsd !== undefined && t.generationCostUsd + cost > policy.limits.maxGenerationCostPerDayUsd) {
    return deny("BUDGET_DAILY_EXCEEDED");
  }
  if (t.campaignCostUsd !== undefined && t.campaignCostUsd + cost > policy.limits.maxGenerationCostPerCampaignUsd) {
    return deny("BUDGET_CAMPAIGN_EXCEEDED");
  }
  if (action.type === "publish" || action.type === "schedule_post") {
    const isStory = action.format === "story";
    if (!isStory && t.feedPostsPublished !== undefined && t.feedPostsPublished >= policy.limits.maxFeedPostsPerDay) {
      return deny("CADENCE_FEED_CAP");
    }
    if (isStory && t.storiesPublished !== undefined && t.storiesPublished >= policy.limits.maxStoriesPerDay) {
      return deny("CADENCE_STORY_CAP");
    }
    if (!isStory && t.hoursSinceLastFeedPost !== undefined && t.hoursSinceLastFeedPost < policy.limits.minimumFeedSpacingHours) {
      return deny("CADENCE_SPACING");
    }
  }
  if (t.campaignsThisWeek !== undefined && action.type === "generate_campaign" && t.campaignsThisWeek >= policy.limits.maxCampaignsPerWeek) {
    return deny("CAMPAIGN_WEEKLY_CAP");
  }
  if (t.repairAttemptsForAsset !== undefined && t.repairAttemptsForAsset >= policy.limits.maxRepairAttemptsPerAsset) {
    return deny("REPAIR_CAP");
  }
  if (t.modelCallsThisCampaign !== undefined && t.modelCallsThisCampaign >= policy.limits.maxModelCallsPerCampaign) {
    return deny("MODEL_CALL_CAP");
  }

  // 4. Minimum scores — a measured score below its bar denies; unmeasured
  //    scores are the CALLER's honesty burden (publish paths must measure).
  for (const [key, min] of Object.entries(policy.minimumScores) as Array<[keyof AutonomyPolicy["minimumScores"], number]>) {
    const measured = action.scores?.[key];
    if (measured !== undefined && measured < min) {
      return deny(`SCORE_BELOW_MIN:${key}:${measured}<${min}`);
    }
  }

  // 5. Approval matrix — accumulates (operator sees every reason).
  for (const [flag, required] of Object.entries(policy.alwaysRequireApproval) as Array<[keyof AutonomyPolicy["alwaysRequireApproval"], boolean]>) {
    if (required && action.flags?.[flag]) codes.push(`APPROVAL:${flag}`);
  }

  // 6. Format publish permission.
  if ((action.type === "publish" || action.type === "schedule_post") && action.format) {
    const perm = policy.formatPermissions[action.format];
    if (perm === "manual") return deny(`FORMAT_PERMISSION_MANUAL:${action.format}`);
    if (perm === "approval_required") codes.push(`APPROVAL:format:${action.format}`);
  }

  if (codes.length > 0) {
    return { decision: "REQUIRE_APPROVAL", reasoningCodes: codes, policyVersion: policy.version };
  }
  return { decision: "ALLOW", reasoningCodes: ["WITHIN_POLICY"], policyVersion: policy.version };
}

// ─── Boundary actor semantics ──────────────────────────────────────

export type BoundaryActor = "operator" | "cron" | "autonomous_system";

export type BoundaryOutcome = "proceed" | "proceed_operator_approved" | "blocked";

/**
 * What a REQUIRE_APPROVAL means depends on WHO is acting. An operator's own
 * tap on an admin surface IS the approval (recorded as such in the audit
 * trail); cron and autonomous actors must STOP — approval cannot be implied
 * for an actor that cannot approve.
 */
export function resolveBoundaryOutcome(decision: PolicyDecision, actor: BoundaryActor): BoundaryOutcome {
  if (decision.decision === "DENY") return "blocked";
  if (decision.decision === "REQUIRE_APPROVAL") {
    return actor === "operator" ? "proceed_operator_approved" : "blocked";
  }
  return "proceed";
}

/** Structural validation for operator-submitted policy JSON (no zod here —
 *  this module stays dependency-free like the other pure studio libs).
 *  The SERVER validates with the strict zod schema in autonomyControl —
 *  this shape check is a client-side convenience only. */
export function validateAutonomyPolicyShape(p: unknown): p is AutonomyPolicy {
  if (typeof p !== "object" || p === null) return false;
  const pol = p as AutonomyPolicy;
  return (
    typeof pol.version === "number" &&
    OPERATING_MODE_ORDER.includes(pol.operatingMode) &&
    typeof pol.formatPermissions === "object" && pol.formatPermissions !== null &&
    (["reel", "carousel", "photo", "story", "organicOffer", "paidAd"] as const).every(
      (k) => ["manual", "approval_required", "auto"].includes(pol.formatPermissions[k]),
    ) &&
    typeof pol.minimumScores === "object" && pol.minimumScores !== null &&
    typeof pol.limits === "object" && pol.limits !== null &&
    typeof pol.alwaysRequireApproval === "object" && pol.alwaysRequireApproval !== null &&
    typeof pol.emergencyControls === "object" && pol.emergencyControls !== null &&
    typeof pol.emergencyControls.globalKillSwitch === "boolean"
  );
}
