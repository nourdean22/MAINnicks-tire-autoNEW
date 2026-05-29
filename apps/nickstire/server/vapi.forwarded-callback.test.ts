/**
 * wave-144 · isForwardedEndedReason — the forwarded-call callback trigger.
 *
 * When the AI receptionist hands a caller to a human (transferCall), the
 * call ends with reason "assistant-forwarded-call". On that — and ONLY that
 * — we drop a safety-net row into the front-desk callback queue so a forward
 * that doesn't connect (tech mid-bay) never loses the caller.
 *
 * The risk this test pins: a too-broad match would drop a callback row on
 * EVERY finished call, flooding the operator's queue with handled calls.
 * So the contract is narrow — forwarded reasons true, everything else false.
 */
import { describe, expect, it } from "vitest";
import { isForwardedEndedReason } from "./routes/webhooks/vapi";

describe("wave-144 · isForwardedEndedReason", () => {
  it("matches VAPI's assistant-forwarded-call (the real forward reason)", () => {
    expect(isForwardedEndedReason("assistant-forwarded-call")).toBe(true);
  });

  it("matches case-insensitively + bare 'forwarded' variants", () => {
    expect(isForwardedEndedReason("Assistant-Forwarded-Call")).toBe(true);
    expect(isForwardedEndedReason("call-forwarded")).toBe(true);
  });

  // The flood-guard: normal end reasons must NOT queue a callback.
  it("does NOT match customer-ended-call", () => {
    expect(isForwardedEndedReason("customer-ended-call")).toBe(false);
  });

  it("does NOT match assistant-ended-call", () => {
    expect(isForwardedEndedReason("assistant-ended-call")).toBe(false);
  });

  it("does NOT match silence-timed-out", () => {
    expect(isForwardedEndedReason("silence-timed-out")).toBe(false);
  });

  it("does NOT match voicemail / customer-did-not-answer", () => {
    expect(isForwardedEndedReason("voicemail")).toBe(false);
    expect(isForwardedEndedReason("customer-did-not-answer")).toBe(false);
  });

  it("handles null / undefined / empty reason as false (no row)", () => {
    expect(isForwardedEndedReason(null)).toBe(false);
    expect(isForwardedEndedReason(undefined)).toBe(false);
    expect(isForwardedEndedReason("")).toBe(false);
  });
});
