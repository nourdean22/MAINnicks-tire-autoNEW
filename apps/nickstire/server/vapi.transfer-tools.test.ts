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

/**
 * 2026-07-27 · the pre-transfer message the CALLER hears.
 *
 * MEASURED ON 100 REAL INBOUND CALLS: 22% contained stacked filler, every
 * instance on the transfer path — "Give me a moment Hold on, I'll get you over
 * to the manager." The model was behaving correctly (one short line while the
 * tool fires); the SECOND wait came from this hardcoded message. The prompt
 * kill-list has banned chaining two waits since 0720a97d and never could fix
 * it, because it instructs the model and the model was not the source.
 *
 * Pinned as a contract, not a snapshot: any wait-cue opener regresses 22% of
 * calls back to sounding like a recording, and naming a person re-breaks
 * Critical Rule #2 (this forwards to the counter line, not to a known human).
 */
describe("pre-transfer message · no stacked wait, no named person", () => {
  const transferMessage = (): string => {
    const t = (VAPI_TOOLS as Array<{ type?: string; destinations?: Array<{ message?: string }> }>)
      .find((x) => x.type === "transferCall");
    return t?.destinations?.[0]?.message ?? "";
  };

  it("is present and non-empty", () => {
    expect(transferMessage().length).toBeGreaterThan(0);
  });

  it("does NOT open with a wait cue (the model already said one)", () => {
    expect(transferMessage()).not.toMatch(
      /^\s*(?:hold on|one moment|just a (?:sec|second|moment)|give me a (?:sec|second|moment)|hang on|bear with me)\b/i,
    );
  });

  it("contains no second wait cue anywhere", () => {
    const waits = transferMessage().match(
      /\b(?:hold on|one moment|just a (?:sec|second|moment)|give me a (?:sec|second|moment)|hang on)\b/gi,
    );
    expect(waits ?? []).toHaveLength(0);
  });

  it("does not promise a specific person (Critical Rule #2)", () => {
    expect(transferMessage()).not.toMatch(/\b(?:the\s+)?(?:manager|owner|nick|tech|mechanic)\b/i);
  });
});
