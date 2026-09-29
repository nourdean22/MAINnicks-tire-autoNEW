import { describe, expect, it } from "vitest";
import {
  evaluateLaneEligibility,
  isCostClassAllowed,
  selectEligibleLanes,
  type CapabilityLane,
} from "./routing";

function lane(overrides: Partial<CapabilityLane> = {}): CapabilityLane {
  return {
    id: "lane",
    provider: "test",
    capabilities: ["coder"],
    kind: "api_inference",
    authClass: "api_metered",
    costClass: "METERED_PAID",
    privacyClass: "external_provider",
    health: "ready",
    quota: "available",
    priority: 10,
    ...overrides,
  };
}

describe("NOUR cost policy", () => {
  it("never allows metered spend in FREE mode", () => {
    expect(isCostClassAllowed("FREE", "METERED_PAID", true)).toBe(false);
  });
  it("requires explicit metered consent in AUTO mode", () => {
    expect(isCostClassAllowed("AUTO", "METERED_PAID")).toBe(false);
    expect(isCostClassAllowed("AUTO", "METERED_PAID", true)).toBe(true);
  });

  it("treats MAX as explicit permission for metered lanes", () => {
    expect(isCostClassAllowed("MAX", "METERED_PAID")).toBe(true);
  });

  it("keeps non-metered classes available in every mode", () => {
    for (const costClass of [
      "LOCAL_FREE",
      "SUBSCRIPTION_INCLUDED",
      "FREE_TIER",
      "EXISTING_INFRA",
    ] as const) {
      expect(isCostClassAllowed("FREE", costClass)).toBe(true);
    }
  });
});

describe("lane eligibility", () => {
  it("surfaces independent denial reasons instead of silently dropping a lane", () => {
    const result = evaluateLaneEligibility(
      lane({
        health: "unavailable",
        quota: "exhausted",
        privacyClass: "external_provider",
      }),
      {
        capability: "coder",
        mode: "AUTO",
        maxPrivacyClass: "local_only",
      },
    );

    expect(result.allowed).toBe(false);
    expect(result.reasons).toEqual([
      "health_unavailable",
      "quota_exhausted",
      "privacy_denied",
      "metered_requires_consent",
    ]);
  });

  it("orders only eligible lanes by explicit priority, then cost", () => {
    const lanes = [
      lane({ id: "paid", priority: 20 }),
      lane({
        id: "local",
        priority: 20,
        kind: "local_inference",
        authClass: "local",
        costClass: "LOCAL_FREE",
        privacyClass: "local_only",
      }),
      lane({
        id: "subscription",
        priority: 5,
        kind: "subscription_agent",
        authClass: "subscription",
        costClass: "SUBSCRIPTION_INCLUDED",
        privacyClass: "private_service",
      }),
    ];
    expect(
      selectEligibleLanes(lanes, {
        capability: "coder",
        mode: "AUTO",
      }).map((item) => item.id),
    ).toEqual(["subscription", "local"]);

    expect(
      selectEligibleLanes(lanes, {
        capability: "coder",
        mode: "MAX",
      }).map((item) => item.id),
    ).toEqual(["subscription", "local", "paid"]);
  });
});
