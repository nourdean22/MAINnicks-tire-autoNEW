import { describe, it, expect } from "vitest";
import {
  nonExperimentSmsOutcome,
  smsClaimConsumed,
  smsOutcome,
  smsRefusalIsPermanent,
  smsWillReachCustomer,
} from "./smsOutcome";

/**
 * Every `success: false` error string sendSms (server/sms.ts) can return, grepped 2026-10-22.
 * Permanent: sending again cannot work until a person changes something, so a reminder must not
 * retry it every run. Temporary: a later run may well go through.
 */
describe("smsRefusalIsPermanent", () => {
  it("permanent: invalid number, internal line, opted out, carrier block, no consent on file", () => {
    for (const error of [
      "Invalid phone number: 555",
      "Refused: destination is an internal shop/operator line and the send is not human-initiated",
      "Customer opted out of SMS",
      "Recipient has blocked this number (carrier notice)",
      "No SMS consent on file — marketing send refused (no recorded opt-in)",
    ]) expect(smsRefusalIsPermanent(error), error).toBe(true);
  });

  it("temporary: limits, unreadable state, takeover, provider and gateway errors", () => {
    for (const error of [
      "Daily SMS limit reached for this number",
      "Cannot verify opt-out status (db_unavailable) — send refused",
      "No SMS consent on file — marketing send refused (consent ledger unreadable (timeout))",
      "Global daily SMS cap reached (500/500)",
      "human_takeover_active",
      "sms_disabled",
      "Twilio not configured",
      "Time-sensitive text not queued (outside sending hours (8AM-8PM ET))",
      "Gateway returned 502: bad gateway",
      "fetch failed",
      undefined,
      null,
      "",
    ]) expect(smsRefusalIsPermanent(error), String(error)).toBe(false);
  });
});

/**
 * The one classification every SMS receipt must share (audit F-3): success:true
 * with queued:true is NOT delivered, and neither is uncertain:true.
 */
describe("smsOutcome", () => {
  it("delivered now", () => {
    const r = { success: true, sid: "SM1" };
    expect(smsOutcome(r)).toBe("sent");
    expect(smsWillReachCustomer(r)).toBe(true);
  });
  it("queued for the window is not sent, but will reach the customer", () => {
    const r = { success: true, queued: true };
    expect(smsOutcome(r)).toBe("queued");
    expect(smsWillReachCustomer(r)).toBe(true);
  });
  it("uncertain (gateway timeout) is neither sent nor guaranteed", () => {
    const r = { success: true, uncertain: true };
    expect(smsOutcome(r)).toBe("uncertain");
    expect(smsWillReachCustomer(r)).toBe(false);
  });
  it("holdout is terminal but never a contact", () => {
    const r = { success: true, heldOut: true };
    expect(smsOutcome(r)).toBe("heldout");
    expect(smsWillReachCustomer(r)).toBe(false);
    expect(smsClaimConsumed(r)).toBe(true);
    // Transactional/human-initiated paths are structurally ineligible for
    // holdout; a regression is fail-closed in their narrower type domain.
    expect(nonExperimentSmsOutcome(r)).toBe("failed");
  });
  it("failure, null and undefined are failed", () => {
    for (const r of [{ success: false }, null, undefined]) {
      expect(smsOutcome(r)).toBe("failed");
      expect(smsWillReachCustomer(r)).toBe(false);
    }
  });
});
