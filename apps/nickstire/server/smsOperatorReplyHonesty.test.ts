/**
 * The operator's own reply must be recorded as what happened (audit F-7 / F-8).
 *
 * Before 2026-09-01 the send site wrote `status: result.success ? "sent" :
 * "failed"` — and sendSms returns success:true for a reply PARKED until 8 AM,
 * so an after-hours answer showed "sent" to the operator. It also let sendSms
 * persist its own sms_messages row while writing a second, conversation-linked
 * one — every reply stored twice. And it carried no messageClass, so a human
 * answering a customer's question was treated as marketing by the pause logic.
 *
 * Source canary (same shape as mfaRbacIndependence.test.ts): the classification
 * itself is behaviour-tested in lib/smsOutcome.test.ts; this pins the wiring.
 */
import { describe, it, expect } from "vitest";
import { readCode } from "./testUtils/sourceAssertions";

const send = readCode("server/routers/smsConversations.ts");

describe("smsConversations.send · honest receipt", () => {
  it("classifies the operator reply as a 1:1 follow-up, not marketing", () => {
    expect(send).toMatch(/messageClass: "customer_followup"/);
  });
  it("writes ONE row: sendSms persistence is skipped, the conversation row is the record", () => {
    expect(send).toMatch(/skipPersist: true/);
  });
  it("derives the row status from the outcome, and writes NO router row for a queued reply (the durable queue row is the record)", () => {
    expect(send).toMatch(/const outcome = smsOutcome\(result\)/);
    expect(send).toMatch(/if \(outcome !== "queued"\) \{\s*await addSmsMessage\(/);
    expect(send).toMatch(/status: outcome === "sent" \? "sent" : "failed"/);
    expect(send).not.toMatch(/status: result\.success \? "sent" : "failed"/);
  });
  it("tells the client when the reply was queued so it can say so", () => {
    expect(send).toMatch(/queued: outcome === "queued"/);
  });
});
