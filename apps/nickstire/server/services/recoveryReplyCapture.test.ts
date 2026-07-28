/**
 * Recovery reply capture · contract tests (SMS auto-classification wire).
 *
 * Pins the observer's safety properties without touching a DB:
 *   1. The attribution predicate only accepts declined_* variantKeys —
 *      a reply after a winback/review/any-other outbound can never be
 *      captured as a decline reason.
 *   2. Classification runs FIRST: a no-signal reply ("ok", questions)
 *      exits before any DB import — zero cost on the webhook path, and
 *      provably no write.
 *   3. STOP interplay: bare "stop" carries no decline signal here (the
 *      TCPA rails own it upstream).
 *
 * The DB-touching path (conversation lookup → last-outbound gate →
 * guarded UPDATE) is deliberately out of unit scope; its guards are
 * structural (WHERE stated_concern IS NULL, ORDER BY estimate_date DESC
 * LIMIT 1) and the whole function is fail-open by contract.
 */
import { describe, it, expect } from "vitest";
import { captureStatedConcernFromReply, isRecoveryVariant } from "./recoveryReplyCapture";

describe("isRecoveryVariant · attribution gate", () => {
  it("accepts every declined_* series key (legacy P1-P3 and new P0)", () => {
    for (const key of ["declined_3d_P1", "declined_7d_P0", "declined_14d_P2", "declined_30d_P3", "declined_45d_P0"]) {
      expect(isRecoveryVariant(key), key).toBe(true);
    }
  });

  it("rejects every non-recovery outbound", () => {
    for (const key of [null, undefined, "", "winback_45d", "review_request", "retention_d90", "declinedx", "redeclined_7d"]) {
      expect(isRecoveryVariant(key as string | null | undefined), String(key)).toBe(false);
    }
  });
});

describe("captureStatedConcernFromReply · classify-first short-circuit", () => {
  it("no-signal replies exit with no_signal and no capture", async () => {
    for (const body of ["ok", "thanks", "who is this?", "what are your hours", ""]) {
      const res = await captureStatedConcernFromReply("+12165550142", body);
      expect(res.captured, body).toBe(false);
      expect(res.reason, body).toBe("no_signal");
    }
  });

  it("bare STOP is not a decline signal (TCPA rails own opt-out upstream)", async () => {
    const res = await captureStatedConcernFromReply("+12165550142", "STOP");
    expect(res.captured).toBe(false);
    expect(res.reason).toBe("no_signal");
  });
});
