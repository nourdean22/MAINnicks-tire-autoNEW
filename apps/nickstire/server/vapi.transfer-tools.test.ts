/**
 * wave-140 · VAPI transfer / callback tool wiring (#78)
 *
 * Operator decision: transfer live IN-hours, log a callback AFTER-hours.
 * That requires the `escalate` callback tool — which wave-181.35 removed
 * from VAPI_TOOLS ("no callback path"), silently breaking the OUTBOUND
 * follow-up prompt's escalate() calls. This wave re-adds escalate (gated to
 * closed-hours in the inbound prompt's Rule 6) and drops the stray
 * transferCall from the outbound follow-up (a trust call we placed should
 * never forward itself to the shop).
 *
 * These are the exact contracts a future edit could silently regress:
 *  - escalate missing again → after-hours callers + follow-up complaints
 *    vanish with no error.
 *  - transferCall creeping back onto the outbound assistant → a follow-up
 *    call could weirdly transfer the customer to the shop.
 */

import { describe, expect, it } from "vitest";
import { VAPI_TOOLS, buildFollowUpAssistantConfig } from "./services/vapi";

type LooseTool = { type?: string; function?: { name?: string } };
const toolNames = (tools: unknown): string[] =>
  (tools as LooseTool[]).map((t) => (t.type === "transferCall" ? "transferCall" : t.function?.name ?? ""));

describe("wave-140 · VAPI transfer / callback tools", () => {
  it("escalate is exposed as an inbound VAPI tool (callback path restored)", () => {
    expect(toolNames(VAPI_TOOLS)).toContain("escalate");
  });

  it("inbound keeps transferCall (the in-hours live handoff)", () => {
    expect(toolNames(VAPI_TOOLS)).toContain("transferCall");
  });

  it("outbound follow-up = escalate + sendConfirmationSms, but NOT transferCall", () => {
    const cfg = buildFollowUpAssistantConfig() as { model?: { tools?: unknown } };
    const names = toolNames(cfg.model?.tools ?? []);
    expect(names).toContain("escalate");
    expect(names).toContain("sendConfirmationSms");
    expect(names).not.toContain("transferCall");
  });
});
