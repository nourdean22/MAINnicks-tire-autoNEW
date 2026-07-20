/**
 * 2026-07-20 · Tool→state classification, which is what drives the voice
 * conversion signal.
 *
 * classifyToolToState() maps a tool call to a call state; `tool_called` (and
 * `confirmed`) make trailReachedTool() true, which sets
 * vapi_call_logs.convertedToLead = 1. So membership of WRITE_TOOLS is not a
 * cosmetic taxonomy — it decides what the operator sees as a conversion.
 *
 * THE DEFECT THIS PINS. checkTireStock used to write a leads row and was
 * therefore a write tool. It now hands the caller to a person and captures
 * NOTHING, but it stayed in WRITE_TOOLS — so every caller who merely asked "do
 * you have my size?" was counted as a converted lead with no lead behind it,
 * silently inflating the conversion number. There was no test on this mapping
 * at all; the only reference in the suite was a stub returning null.
 *
 * The invariant: a tool counts as a conversion ONLY if a row survives the call.
 */
import { describe, expect, it } from "vitest";
import { classifyToolToState } from "./voice-call-state";
import { trailReachedTool } from "./vapiConversionSignals";

/** Tools that durably persist something a human can act on later. */
const PERSISTING_TOOLS = ["bookSlot", "tireInquiry", "scheduleCallback", "escalate"];

/** Tools that answer or hand off without persisting anything. */
const NON_PERSISTING_TOOLS = [
  "shopInfo",
  "capacityCheck",
  "getCurrentWaitTime",
  "quoteRange",
  "tireSizeFromVehicle",
  "lookupCustomer",
  "getDeclinedEstimate",
  "checkTireStock",
];

describe("classifyToolToState", () => {
  it.each(PERSISTING_TOOLS)("%s persists a row → tool_called (counts as conversion)", (tool) => {
    expect(classifyToolToState(tool)).toBe("tool_called");
  });

  it.each(NON_PERSISTING_TOOLS)("%s persists nothing → intent_captured (NOT a conversion)", (tool) => {
    expect(classifyToolToState(tool)).toBe("intent_captured");
  });

  it("sendConfirmationSms is the confirm tool", () => {
    expect(classifyToolToState("sendConfirmationSms")).toBe("confirmed");
  });

  it("returns null for an unknown tool, so a new tool never silently counts", () => {
    expect(classifyToolToState("someToolAddedLater")).toBeNull();
  });
});

describe("conversion signal end-to-end", () => {
  // The exact regression: a rack-check-only call must not read as converted.
  it("a call whose only tool was checkTireStock is NOT a conversion", () => {
    const state = classifyToolToState("checkTireStock");
    expect(trailReachedTool([{ state: state as string }])).toBe(false);
  });

  it("a call that booked a slot IS a conversion", () => {
    const state = classifyToolToState("bookSlot");
    expect(trailReachedTool([{ state: state as string }])).toBe(true);
  });

  it("a wait-time question alone is NOT a conversion", () => {
    const state = classifyToolToState("getCurrentWaitTime");
    expect(trailReachedTool([{ state: state as string }])).toBe(false);
  });
});
