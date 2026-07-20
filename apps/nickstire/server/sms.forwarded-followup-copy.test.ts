/**
 * 2026-07-20 · Copy contract for `vapi_forwarded_call_followup`.
 *
 * ROOT CAUSE THIS PINS. That SMS type fires from the VAPI webhook on ended
 * reason "assistant-forwarded-call" — which is VAPI's reason for a SUCCESSFUL
 * hand-off to a human, not a missed call. The trigger has no duration floor
 * (the analytics module won't even *infer* a human answered below 45s —
 * warmTransferConnect.DEFAULT_PRE_TRANSFER_FLOOR_SEC). Two of the three copy
 * variants used to open "Sorry we missed your call" / "We missed your call",
 * so a customer who had just spent five minutes with the crew received an
 * apology for being ignored — on the shop's highest-intent calls.
 *
 * The existing tests (vapi.forwarded-callback.test.ts) pin the TRIGGER and all
 * passed while this defect was live: they never assert on the copy. This file
 * closes that blind spot. The invariant is deliberately about MEANING, not an
 * exact string, so rewording stays free but the apology cannot come back.
 */
import { describe, expect, it } from "vitest";
import { TEMPLATE_VARIANTS } from "./services/smsMessageCatalog";

/**
 * Phrases that assert we failed to answer. Any of these is a factual claim the
 * system cannot support at send time, because it does not know whether a human
 * picked up.
 */
const MISSED_CALL_CLAIMS = [
  "missed your call",
  "sorry we missed",
  "we missed you",
  "couldn't get to your call",
  "unable to take your call",
];

describe("vapi_forwarded_call_followup copy contract", () => {
  const variants = TEMPLATE_VARIANTS.vapi_forwarded_call_followup;

  it("exposes the variants (guards against a silent catalog rename)", () => {
    expect(Array.isArray(variants)).toBe(true);
    expect(variants.length).toBeGreaterThan(0);
  });

  // THE regression guard. This type fires on successful transfers, so no
  // variant may claim the call went unanswered.
  it.each(MISSED_CALL_CLAIMS)(
    "no variant claims %j — the call was most likely ANSWERED by a human",
    (claim) => {
      const offenders = variants.filter((v) => v.toLowerCase().includes(claim));
      expect(offenders).toEqual([]);
    },
  );

  it("every variant still identifies the shop, so the text is not anonymous", () => {
    for (const v of variants) {
      expect(v.toLowerCase()).toContain("nick");
    }
  });
});
