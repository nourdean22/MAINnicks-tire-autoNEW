/**
 * Predicate tests only. `computeWarmTransferConnectRate` (the 45s duration-
 * floor "connected" inference) was REFUTED and removed 2026-08-05: live call
 * artifacts show the VAPI leg ends at the hand-off (endedAt == transferCall
 * tool-result time), so total duration never contained the human leg. The
 * replacement evidence model is tested in transferOutcomeEvidence.test.ts.
 */
import { describe, expect, it } from "vitest";
import { isForwardCompleted, isTransferAttempt, isTransferFailure } from "../lib/warmTransferConnect";

describe("isForwardCompleted / isTransferFailure", () => {
  it("a completed forward is a forward, never a failure", () => {
    expect(isForwardCompleted("assistant-forwarded-call")).toBe(true);
    expect(isTransferFailure("assistant-forwarded-call")).toBe(false);
  });

  it("a transfer error is a failure, never a completed forward (disjoint)", () => {
    for (const r of [
      "error-warm-transfer-silence-timeout",
      "error-warm-transfer-max-duration",
      "call.in-progress.error-transfer-failed",
      "customer-ended-call-after-warm-transfer-attempt",
    ]) {
      expect(isTransferFailure(r)).toBe(true);
      expect(isForwardCompleted(r)).toBe(false);
    }
  });

  it("a plain end reason is neither", () => {
    expect(isForwardCompleted("customer-ended-call")).toBe(false);
    expect(isTransferFailure("customer-ended-call")).toBe(false);
    expect(isForwardCompleted(null)).toBe(false);
    expect(isTransferFailure(undefined)).toBe(false);
  });
});

describe("isTransferAttempt · the population every transfer instrument is measured on", () => {
  it("a completed forward and a failed hand-off are both ATTEMPTS", () => {
    expect(isTransferAttempt("assistant-forwarded-call")).toBe(true);
    expect(isTransferAttempt("call.in-progress.error-transfer-failed")).toBe(true);
    expect(isTransferAttempt("customer-ended-call-before-warm-transfer")).toBe(true);
    expect(isTransferAttempt("call.in-progress.error-warm-transfer-silence-timeout")).toBe(true);
  });

  it("a call that never tried to hand off is NOT an attempt — and neither is nothing", () => {
    expect(isTransferAttempt("customer-ended-call")).toBe(false);
    expect(isTransferAttempt("assistant-ended-call")).toBe(false);
    expect(isTransferAttempt("silence-timed-out")).toBe(false);
    expect(isTransferAttempt(null)).toBe(false);
    expect(isTransferAttempt(undefined)).toBe(false);
    expect(isTransferAttempt("")).toBe(false);
  });

  it("is exactly the union of the two outcome predicates (no third spelling)", () => {
    for (const r of ["assistant-forwarded-call", "call.in-progress.error-transfer-failed", "customer-ended-call", "x"]) {
      expect(isTransferAttempt(r)).toBe(isForwardCompleted(r) || isTransferFailure(r));
    }
  });
});
