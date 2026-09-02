import { describe, it, expect } from "vitest";
import { smsOutcome, smsWillReachCustomer } from "./smsOutcome";

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
  it("failure, null and undefined are failed", () => {
    for (const r of [{ success: false }, null, undefined]) {
      expect(smsOutcome(r)).toBe("failed");
      expect(smsWillReachCustomer(r)).toBe(false);
    }
  });
});
