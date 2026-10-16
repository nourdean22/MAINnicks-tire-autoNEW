import { describe, it, expect } from "vitest";
import { providerFundsHold, CLIP_CREDITS_PER_BEAT, DEFAULT_REEL_BEATS } from "./reelProviderFunds";

/**
 * Production, 2026-10-16: Higgsfield held 29.5 credits, job 2100001 rendered 2
 * clips and failed on the third with not_enough_credits, and the next pulse was
 * about to burn another approved pack the same way. The daily cron now asks this
 * helper BEFORE it builds a brief, reserves, or moves the rotation cursor.
 */
describe("providerFundsHold", () => {
  it("holds when the balance cannot cover one 5-beat seedance_2_5 reel (the 2026-10-16 state)", () => {
    expect(providerFundsHold({ provider: "higgsfield", model: "seedance_2_5", balanceCredits: 29.5 }))
      .toEqual({ needed: 130, balance: 29.5, model: "seedance_2_5" });
  });

  it("does not hold at exactly the needed balance", () => {
    expect(providerFundsHold({ provider: "higgsfield", model: "seedance_2_5", balanceCredits: 130 })).toBeNull();
  });

  it("prices seedance1_5 at 12 credits a beat", () => {
    expect(providerFundsHold({ provider: "higgsfield", model: "seedance1_5", balanceCredits: 59 }))
      .toEqual({ needed: 60, balance: 59, model: "seedance1_5" });
  });

  it("an unpriced model is not a hold (unknown price is not evidence of no funds)", () => {
    expect(providerFundsHold({ provider: "higgsfield", model: "kling3_0", balanceCredits: 1 })).toBeNull();
  });

  it("another provider is not a hold (the keepalive balance is Higgsfield's)", () => {
    expect(providerFundsHold({ provider: "veo", model: "seedance_2_5", balanceCredits: 0 })).toBeNull();
  });

  it.each([null, Number.NaN, Number.POSITIVE_INFINITY])(
    "an unreadable balance (%s) is UNKNOWN, never a hold",
    (balanceCredits) => {
      expect(providerFundsHold({ provider: "higgsfield", model: "seedance_2_5", balanceCredits })).toBeNull();
    },
  );

  it("respects an explicit beat count", () => {
    expect(providerFundsHold({ provider: "higgsfield", model: "seedance1_5", balanceCredits: 30, beats: 3 }))
      .toEqual({ needed: 36, balance: 30, model: "seedance1_5" });
  });

  it("keeps the measured prices and the standard storyboard length", () => {
    expect(CLIP_CREDITS_PER_BEAT).toEqual({ seedance1_5: 12, seedance_2_5: 26 });
    expect(DEFAULT_REEL_BEATS).toBe(5);
  });
});
