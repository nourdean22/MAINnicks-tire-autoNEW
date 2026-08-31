import { describe, expect, it } from "vitest";
import { decideReadyBuffer, productionSlotForHour, queueStateForReelStatus } from "./reelQueue";

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
});
