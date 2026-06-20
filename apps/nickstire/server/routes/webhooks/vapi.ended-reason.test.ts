/**
 * extractEndedReason · wave-137 · 2026-05-29
 *
 * The ONLY pure-logic helper in the VAPI webhook router. It decides which
 * payload field becomes vapi_call_logs.endedReason — the column the Voice
 * "ended-reason breakdown" reads when the live VAPI /call API times out
 * (>7d ranges) and the admin falls back to the local DB.
 *
 * The bug it fixes: the handler used to read ONLY the nested
 * message.call.endedReason. On VAPI's end-of-call-report webhook that field
 * is a call snapshot — usually unpopulated, or a transient SIP-layer status
 * mid-call. The CLEAN reason (customer-ended-call / assistant-forwarded-call)
 * lives at MESSAGE level (message.endedReason · a REQUIRED field on
 * ServerMessageEndOfCallReport). Reading the wrong layer stored null on
 * 274/283 historical rows + raw SIP codes on 9 — zero clean labels — so the
 * local-fallback breakdown was useless. Same wrong-layer class as the
 * wave-fix-2026-05-25 artifact.transcript bug.
 *
 * A regression here silently degrades the breakdown back to "unknown" with no
 * error anywhere. Cheap test, prevents it.
 */

import { describe, expect, it } from "vitest";
import { extractEndedReason } from "./vapi";

describe("extractEndedReason", () => {
  it("the fix · reads the CLEAN reason from message-level (message.endedReason)", () => {
    expect(extractEndedReason({ endedReason: "customer-ended-call" })).toBe("customer-ended-call");
    expect(extractEndedReason({ endedReason: "assistant-forwarded-call" })).toBe("assistant-forwarded-call");
  });

  it("message-level wins over the nested call snapshot when both are present", () => {
    const r = extractEndedReason({
      endedReason: "assistant-forwarded-call",
      call: { endedReason: "call.in-progress.sip-completed-call" },
    });
    expect(r).toBe("assistant-forwarded-call");
  });

  it("falls back to call-level only when it is a clean label (no message-level)", () => {
    expect(extractEndedReason({ call: { endedReason: "customer-ended-call" } })).toBe("customer-ended-call");
  });

  it("rejects the transient SIP-state string (the 9-row class) → null, never a misleading value", () => {
    expect(extractEndedReason({ call: { endedReason: "call.in-progress.sip-completed-call" } })).toBeNull();
    expect(extractEndedReason({ call: { endedReason: "call.ringing" } })).toBeNull();
  });

  it("keeps a TERMINAL warm-transfer / transfer-failed call-level reason (connect-rate ground truth)", () => {
    // These are real ended reasons (the hand-off failed) — the connect-rate
    // needs them to count a forward that did NOT reach a human.
    expect(extractEndedReason({ call: { endedReason: "call.in-progress.error-transfer-failed" } }))
      .toBe("call.in-progress.error-transfer-failed");
    expect(extractEndedReason({ call: { endedReason: "call.in-progress.error-warm-transfer-silence-timeout" } }))
      .toBe("call.in-progress.error-warm-transfer-silence-timeout");
    // ...but generic call.* SIP transients STILL drop (wave-137 guard intact):
    expect(extractEndedReason({ call: { endedReason: "call.in-progress.sip-completed-call" } })).toBeNull();
    expect(extractEndedReason({ call: { endedReason: "call.ringing" } })).toBeNull();
  });

  it("both absent (the 274-row class) → null", () => {
    expect(extractEndedReason({ call: { id: "abc" } })).toBeNull();
    expect(extractEndedReason({})).toBeNull();
  });

  it("whitespace-only message-level reason falls through to the fallback", () => {
    expect(extractEndedReason({ endedReason: "   ", call: { endedReason: "customer-ended-call" } })).toBe("customer-ended-call");
    expect(extractEndedReason({ endedReason: "  " })).toBeNull();
  });

  it("defensive · null / undefined / non-object event → null (never throws)", () => {
    expect(extractEndedReason(null)).toBeNull();
    expect(extractEndedReason(undefined)).toBeNull();
    expect(extractEndedReason("end-of-call-report")).toBeNull();
    expect(extractEndedReason({ endedReason: 42 })).toBeNull();
  });
});
