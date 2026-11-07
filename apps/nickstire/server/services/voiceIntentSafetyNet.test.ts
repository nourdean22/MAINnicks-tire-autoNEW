/**
 * Close-on-intent safety net, the pure half (2026-11-07 audit section 3: 90 inbound
 * calls with intent and no next step in 30 days).
 */
import { describe, expect, it } from "vitest";
import { decideIntentHeadsUp } from "./voiceIntentSafetyNet";
import { intentNoToolEvent, intentWithBookSlotEvent } from "../../tests/fixtures/endOfCallIntent";

const decideFor = (e: ReturnType<typeof intentNoToolEvent>, over: Partial<Parameters<typeof decideIntentHeadsUp>[0]> = {}) =>
  decideIntentHeadsUp({
    event: e,
    trail: [],
    leadId: null,
    callbackId: null,
    open: true,
    ...over,
  });

describe("decideIntentHeadsUp", () => {
  it("tire intent with no closing tool sends the heads-up", () => {
    const d = decideFor(intentNoToolEvent());
    expect(d).toMatchObject({ send: true, outcome: "tire_availability_intent" });
  });

  it("the same call with bookSlot in the messages sends nothing", () => {
    expect(decideFor(intentWithBookSlotEvent())).toMatchObject({ send: false, reason: "closing_tool_called" });
  });

  it("sendConfirmationSms on the state trail also counts as a close", () => {
    expect(decideFor(intentNoToolEvent(), { trail: [{ metadata: { tool: "sendConfirmationSms" } }] }))
      .toMatchObject({ send: false, reason: "closing_tool_called" });
  });

  it("a non-closing tool (tireInquiry) on the trail does not count as a close", () => {
    expect(decideFor(intentNoToolEvent(), { trail: [{ metadata: { tool: "tireInquiry" } }] })).toMatchObject({ send: true });
  });

  it("outbound calls and closed hours send nothing", () => {
    const out = intentNoToolEvent();
    out.call.type = "outboundPhoneCall";
    expect(decideFor(out)).toMatchObject({ send: false, reason: "outbound" });
    expect(decideFor(intentNoToolEvent(), { open: false })).toMatchObject({ send: false, reason: "shop_closed" });
  });

  it("no messages and no trail: tools are UNKNOWN, never read as 'no tool called'", () => {
    const blind = intentNoToolEvent() as unknown as { artifact: { messages?: unknown } };
    delete blind.artifact.messages;
    const e = blind as unknown as ReturnType<typeof intentNoToolEvent>;
    expect(decideFor(e)).toMatchObject({ send: false });
    expect(decideFor(e)).not.toMatchObject({ reason: "closing_tool_called" });
    // the trail alone is readable: bookSlot there is a close
    expect(decideFor(e, { trail: [{ metadata: { tool: "bookSlot" } }] })).toMatchObject({ send: false });
  });

  it("a captured lead is a hard conversion, not an intent miss", () => {
    expect(decideFor(intentNoToolEvent(), { leadId: 42 })).toMatchObject({ send: false, outcome: "hard_conversion" });
  });

  it("a transferred call is a human handoff, not an intent miss", () => {
    expect(decideFor({ ...intentNoToolEvent(), endedReason: "assistant-forwarded-call" })).toMatchObject({ send: false, outcome: "human_handoff" });
  });
});
