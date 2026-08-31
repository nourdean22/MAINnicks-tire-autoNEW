import { describe, expect, it } from "vitest";
import {
  decideReadyBuffer,
  normalizeProductionTargetHour,
  productionSlotForHour,
  queueStateForReelStatus,
  readyCandidateIsUsable,
} from "./reelQueue";

describe("reel queue state and slot semantics", () => {
  it("uses explicit ET morning, midday, and evening production slots", () => {
    expect(productionSlotForHour(9)).toBe("morning");
    expect(productionSlotForHour(14)).toBe("midday");
    expect(productionSlotForHour(19)).toBe("evening");
  });

  it("fails closed for an invalid hour instead of inventing a slot", () => {
    expect(() => productionSlotForHour(24)).toThrow(/invalid ET hour/);
    expect(() => productionSlotForHour(2)).toThrow(/no production slot/);
  });

  it("normalizes overnight analytics targets to the next morning production slot", () => {
    expect(normalizeProductionTargetHour(0)).toBe(6);
    expect(normalizeProductionTargetHour(5)).toBe(6);
    expect(normalizeProductionTargetHour(6)).toBe(6);
    expect(normalizeProductionTargetHour(23)).toBe(23);
    expect(() => normalizeProductionTargetHour(24)).toThrow(/invalid ET target hour/);
  });

  it("maps transport status to a durable per-episode queue state", () => {
    expect(queueStateForReelStatus("assets_ready")).toBe("qa_pending");
    expect(queueStateForReelStatus("assembled")).toBe("production_ready");
    expect(queueStateForReelStatus("publishing")).toBe("publishing");
    expect(queueStateForReelStatus("publish_ambiguous")).toBe("blocked");
  });

  it("refills only at the low watermark and stops above it", () => {
    expect(decideReadyBuffer(0, 3, 1)).toBe("refill");
    expect(decideReadyBuffer(1, 3, 1)).toBe("refill");
    expect(decideReadyBuffer(2, 3, 1)).toBe("hold_above_low_watermark");
    expect(decideReadyBuffer(3, 3, 1)).toBe("hold_at_target");
  });

  it("rejects an invalid buffer policy rather than silently producing", () => {
    expect(() => decideReadyBuffer(0, 1, 1)).toThrow(/lowWatermark/);
  });

  it("does not count unapproved, vetoed, or missing-asset rows as usable READY", () => {
    expect(readyCandidateIsUsable({ status: "assembled", hasAsset: true, hasBlockingError: false, hasLiveApproval: true })).toBe(true);
    expect(readyCandidateIsUsable({ status: "assembled", hasAsset: true, hasBlockingError: false, hasLiveApproval: false })).toBe(false);
    expect(readyCandidateIsUsable({ status: "assembled", hasAsset: true, hasBlockingError: true, hasLiveApproval: true })).toBe(false);
    expect(readyCandidateIsUsable({ status: "assets_ready", hasAsset: true, hasBlockingError: false, hasLiveApproval: false })).toBe(true);
    expect(readyCandidateIsUsable({ status: "assembled", hasAsset: false, hasBlockingError: false, hasLiveApproval: true })).toBe(false);
  });
});
