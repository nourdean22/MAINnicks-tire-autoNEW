/**
 * A text that did not go out leaves one log line with its reason (2026-09-23).
 * The forwarded-call follow-up for a live test call was skipped and the Railway
 * log showed nothing; the reason lived only in sms_orchestrations.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { notSentLogFields } from "../lib/smsNotSentLog";

const fwd = { type: "vapi_forwarded_call_followup", phone: "+12165550142" };

describe("notSentLogFields", () => {
  it("POSITIVE CONTROL: a skipped text yields its type, status, reason and last 4 digits", () => {
    expect(notSentLogFields(fwd, { status: "skipped", reason: "cooldown_active" })).toEqual({
      type: "vapi_forwarded_call_followup",
      status: "skipped",
      reason: "cooldown_active",
      phoneSuffix: "0142",
    });
  });

  it.each(["blocked", "skipped", "failed", "drafted", "cancelled", "expired"])("%s is logged", (status) => {
    expect(notSentLogFields(fwd, { status, reason: "x" })).not.toBeNull();
  });

  it.each(["sent", "queued", "sending", "delivered", "replied"])("%s went out: no line", (status) => {
    expect(notSentLogFields(fwd, { status, reason: "sent_successfully" })).toBeNull();
  });

  it("never carries more than the last 4 digits of the number", () => {
    const f = notSentLogFields(fwd, { status: "skipped", reason: "cooldown_active" });
    expect(JSON.stringify(f)).not.toContain("5550142");
    expect(notSentLogFields({ type: "t", phone: "12" }, { status: "skipped" })?.phoneSuffix).toBe("????");
    expect(notSentLogFields({ type: "t" }, { status: "blocked", reason: "" })?.reason).toBe("unspecified");
  });

  // 2026-09-23: a recap held by the preflight guard logged reason
  // "system_triggered", the orchestrator's default. The code lives in
  // noSendReason / statusReason on those paths.
  it("reports the recorded cause, not the 'system_triggered' default", () => {
    const vapi = { type: "vapi_confirmation", phone: "+12165550142" };
    expect(
      notSentLogFields(vapi, { status: "drafted", reason: "system_triggered", statusReason: "hallucinated_url", noSendReason: "hallucinated_url" })?.reason,
    ).toBe("hallucinated_url");
    expect(
      notSentLogFields(vapi, { status: "drafted", reason: "system_triggered", statusReason: "draft_only_rollout_mode", noSendReason: "draft_only_mode" })?.reason,
    ).toBe("draft_only_mode");
    // No noSendReason: a specific `reason` wins over a generic statusReason …
    expect(
      notSentLogFields(vapi, { status: "drafted", reason: "complex_intent:pricing", statusReason: "requires_operator_review" })?.reason,
    ).toBe("complex_intent:pricing");
    // … but the default does not.
    expect(notSentLogFields(vapi, { status: "failed", reason: "system_triggered", statusReason: "internal_error" })?.reason).toBe("internal_error");
    expect(notSentLogFields(vapi, { status: "failed", reason: "system_triggered" })?.reason).toBe("system_triggered");
  });

  it("orchestrateSms runs every result through it and logs 'SMS not sent'", () => {
    const src = readFileSync(resolve(__dirname, "../services/smsOrchestrator.ts"), "utf8");
    expect(src).toMatch(/const result = await orchestrateSmsDecide\(event\);\s*const notSent = notSentLogFields\(event, result\);\s*if \(notSent\) log\.info\("SMS not sent"/);
  });
});
