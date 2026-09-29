export const CAPABILITY_ALIASES = [
  "supervisor",
  "deep_reasoner",
  "coder",
  "large_context",
  "multimodal",
  "cheap_local",
  "embed",
  "rerank",
  "ocr",
  "voice",
] as const;

export type CapabilityAlias = (typeof CAPABILITY_ALIASES)[number];

export const COST_CLASSES = [
  "LOCAL_FREE",
  "SUBSCRIPTION_INCLUDED",
  "FREE_TIER",
  "EXISTING_INFRA",
  "METERED_PAID",
] as const;

export type CostClass = (typeof COST_CLASSES)[number];

export const ROUTING_MODES = ["FREE", "AUTO", "MAX"] as const;
export type RoutingMode = (typeof ROUTING_MODES)[number];
export type LaneKind =
  | "deterministic"
  | "local_inference"
  | "api_inference"
  | "subscription_agent";

export type AuthClass =
  | "none"
  | "local"
  | "subscription"
  | "free_tier"
  | "existing_infra"
  | "api_metered";

export type PrivacyClass =
  | "local_only"
  | "private_service"
  | "external_provider";

export type HealthState = "ready" | "degraded" | "unavailable" | "unknown";
export type QuotaState = "available" | "limited" | "exhausted" | "unknown";

export interface CapabilityLane {
  id: string;
  provider: string;
  model?: string;
  capabilities: readonly CapabilityAlias[];
  kind: LaneKind;
  authClass: AuthClass;
  costClass: CostClass;
  privacyClass: PrivacyClass;
  health: HealthState;
  quota: QuotaState;
  priority: number;
}

export interface RoutingRequest {
  capability: CapabilityAlias;
  mode: RoutingMode;
  maxPrivacyClass?: PrivacyClass;
  explicitMeteredConsent?: boolean;
}

export type LaneDenialReason =
  | "capability_mismatch"
  | "health_unavailable"
  | "quota_exhausted"
  | "privacy_denied"
  | "metered_denied_in_free"
  | "metered_requires_consent";

export interface LaneEligibility {
  allowed: boolean;
  reasons: LaneDenialReason[];
}

const PRIVACY_RANK: Record<PrivacyClass, number> = {
  local_only: 0,
  private_service: 1,
  external_provider: 2,
};
export const COST_CLASS_RANK: Record<CostClass, number> = {
  LOCAL_FREE: 0,
  SUBSCRIPTION_INCLUDED: 1,
  FREE_TIER: 2,
  EXISTING_INFRA: 3,
  METERED_PAID: 4,
};

export function isCostClassAllowed(
  mode: RoutingMode,
  costClass: CostClass,
  explicitMeteredConsent = false,
): boolean {
  if (costClass !== "METERED_PAID") return true;
  if (mode === "MAX") return true;
  if (mode === "AUTO") return explicitMeteredConsent;
  return false;
}

export function evaluateLaneEligibility(
  lane: CapabilityLane,
  request: RoutingRequest,
): LaneEligibility {
  const reasons: LaneDenialReason[] = [];

  if (!lane.capabilities.includes(request.capability)) {
    reasons.push("capability_mismatch");
  }
  if (lane.health === "unavailable") reasons.push("health_unavailable");
  if (lane.quota === "exhausted") reasons.push("quota_exhausted");

  const maxPrivacy = request.maxPrivacyClass ?? "external_provider";
  if (PRIVACY_RANK[lane.privacyClass] > PRIVACY_RANK[maxPrivacy]) {
    reasons.push("privacy_denied");
  }

  if (lane.costClass === "METERED_PAID") {
    if (request.mode === "FREE") {
      reasons.push("metered_denied_in_free");
    } else if (
      request.mode === "AUTO" &&
      !request.explicitMeteredConsent
    ) {
      reasons.push("metered_requires_consent");
    }
  }

  return { allowed: reasons.length === 0, reasons };
}

export function selectEligibleLanes(
  lanes: readonly CapabilityLane[],
  request: RoutingRequest,
): CapabilityLane[] {
  return lanes
    .filter((lane) => evaluateLaneEligibility(lane, request).allowed)
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        COST_CLASS_RANK[a.costClass] - COST_CLASS_RANK[b.costClass] ||
        a.id.localeCompare(b.id),
    );
}
