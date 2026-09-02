/**
 * smsClaimConsumed — the rule that stops re-sends (self-review on PR #2063).
 *
 * sendSms returns `success:true, uncertain:true` on a shop-gateway timeout and
 * documents it as "do not retry — the relay may well have delivered". The first
 * cut of the audit wave consumed send claims only on sent|queued, which left an
 * uncertain reminder / estimate follow-up / campaign retry eligible again on
 * the next tick: a re-text until a send completed cleanly. The claim must be
 * consumed for every outcome except a definite failure; only the COUNTERS keep
 * uncertain apart from sent.
 */
import { describe, it, expect } from "vitest";
import { smsClaimConsumed, smsWillReachCustomer, smsOutcome } from "./smsOutcome";

describe("smsClaimConsumed vs smsWillReachCustomer", () => {
  const sent = { success: true, sid: "SM1" };
  const queued = { success: true, queued: true };
  const uncertain = { success: true, uncertain: true };
  const failed = { success: false, error: "gateway 502" };

  it("classifies the four shapes (positive control for the helpers below)", () => {
    expect(smsOutcome(sent)).toBe("sent");
    expect(smsOutcome(queued)).toBe("queued");
    expect(smsOutcome(uncertain)).toBe("uncertain");
    expect(smsOutcome(failed)).toBe("failed");
    expect(smsOutcome(null)).toBe("failed");
  });

  it("a claim is consumed for sent, queued AND uncertain — only a definite failure leaves it open", () => {
    expect(smsClaimConsumed(sent)).toBe(true);
    expect(smsClaimConsumed(queued)).toBe(true);
    expect(smsClaimConsumed(uncertain)).toBe(true);
    expect(smsClaimConsumed(failed)).toBe(false);
    expect(smsClaimConsumed(undefined)).toBe(false);
  });

  it("'will reach the customer' is narrower: uncertain is NOT a notification", () => {
    expect(smsWillReachCustomer(sent)).toBe(true);
    expect(smsWillReachCustomer(queued)).toBe(true);
    expect(smsWillReachCustomer(uncertain)).toBe(false);
    expect(smsWillReachCustomer(failed)).toBe(false);
  });

  it("CANARY — the two helpers disagree exactly on uncertain, nowhere else", () => {
    for (const r of [sent, queued, failed, null, undefined]) {
      expect(smsClaimConsumed(r)).toBe(smsWillReachCustomer(r));
    }
    expect(smsClaimConsumed(uncertain)).not.toBe(smsWillReachCustomer(uncertain));
  });
});
