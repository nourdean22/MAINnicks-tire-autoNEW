/**
 * A gateway timeout must never reach the caller as a confirmed text.
 *
 * THE FALSE COMPLETION
 * On a shop-gateway timeout `sendSms` did three honest things and one dishonest
 * one, in the same function:
 *
 *   log.warn("... NOT falling back (delivery uncertain, avoids double-send)")
 *   alertShopGatewayFallback("timeout — delivery uncertain, not retried")
 *   persistOutboundShopSms(..., "sending", ...)      // row is NOT `sent`
 *   return { success: true };                        // <- caller sees success
 *
 * That `success: true` meant "do not retry" — correct, because the relay may
 * already have delivered and a retry would double-send. But the rest of the
 * system read it as "delivered":
 *
 *   smsOrchestrator: success && !queued           -> status "sent"
 *   voiceAgent:      status === "sent"            -> degraded: false
 *   VAPI prompt:     'only when ... sent:true'    -> "I'll text you the address"
 *
 * So the log said uncertain, the operator alert said uncertain, the database row
 * said `sending` — and the caller was told the text was on its way. Three parts
 * of one system holding two different truths about the same event.
 *
 * DESIGN UNDER TEST
 * `uncertain` distinguishes "not retried" from "delivered". It flows to the
 * `sending` status the same call already persists, and `degraded` becomes
 * "anything that is not an observed send". The assistant then reads the address
 * aloud AND the text may still arrive — belt and braces, and no retry, so no
 * double-send.
 *
 * The trade is deliberately asymmetric: degraded:true costs one spoken address
 * on a text that probably arrived; degraded:false costs a caller driving off
 * with no address at all.
 */
import { describe, expect, it } from "vitest";
import type { SmsResult } from "./sms";

/**
 * The two mappings under test, extracted verbatim in shape from
 * `smsOrchestrator` (confirmation path) and `voiceAgent.sendConfirmationSms`.
 * Kept as pure functions so this stays a unit test with no DB, gateway or
 * network — the production lines they mirror are asserted below.
 */
const orchestratorStatus = (r: SmsResult): string =>
  r.success ? (r.queued ? "queued" : r.uncertain ? "sending" : "sent") : "failed";

const toolResult = (status: string) => ({
  sent: status === "sent" || status === "queued" || status === "sending",
  degraded: status !== "sent",
});

describe("gateway timeout is not a confirmed send", () => {
  const timeout: SmsResult = { success: true, uncertain: true };

  it("maps to `sending`, not `sent`", () => {
    expect(orchestratorStatus(timeout)).toBe("sending");
  });

  it("reaches the assistant as DEGRADED, so it reads the address aloud", () => {
    const r = toolResult(orchestratorStatus(timeout));
    expect(r.degraded).toBe(true);
  });

  it("still counts as success — the lead is captured and nothing may be re-sent", () => {
    // The whole reason the original code returned success: a retry after a
    // timeout is how customers get the same text twice.
    expect(toolResult(orchestratorStatus(timeout)).sent).toBe(true);
  });
});

describe("the other outcomes are unchanged", () => {
  it("a confirmed send is sent + NOT degraded", () => {
    const r = toolResult(orchestratorStatus({ success: true, sid: "SM123" }));
    expect(r).toEqual({ sent: true, degraded: false });
  });

  it("an out-of-hours queue is sent + degraded (pre-existing behaviour)", () => {
    const r = toolResult(orchestratorStatus({ success: true, queued: true }));
    expect(r).toEqual({ sent: true, degraded: true });
  });

  it("a definitive failure is neither sent nor confirmed", () => {
    const r = toolResult(orchestratorStatus({ success: false, error: "gateway down" }));
    expect(r).toEqual({ sent: false, degraded: true });
  });

  it("queued still wins over uncertain if both were ever set", () => {
    expect(orchestratorStatus({ success: true, queued: true, uncertain: true })).toBe("queued");
  });
});

describe("the production code actually carries these mappings", () => {
  // A unit test on extracted logic proves the LOGIC, not that production uses
  // it. These assert the real files still contain the shapes above, so the test
  // cannot keep passing after the production mapping drifts away from it.
  it("sms.ts returns uncertain on the timeout branch", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./sms.ts", import.meta.url), "utf8");
    expect(src).toMatch(/if \(gw\.timedOut\)/);
    expect(src).toMatch(/return \{ success: true, uncertain: true \}/);
  });

  it("the orchestrator maps uncertain -> sending", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./services/smsOrchestrator.ts", import.meta.url), "utf8");
    expect(src).toMatch(/sendResult\.uncertain \? "sending" : "sent"/);
  });

  it("the voice tool degrades on anything that is not an observed send", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./routers/voiceAgent.ts", import.meta.url), "utf8");
    expect(src).toMatch(/const degraded = orchResult\.status !== "sent"/);
    expect(src).toMatch(/orchResult\.status === "sending"/);
  });
});
