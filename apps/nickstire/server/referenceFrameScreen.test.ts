/**
 * Pre-generation Visual Bible (Creative Compiler 2.0 Milestone 7) — screen the
 * ACTUAL candidate anchor image before it conditions every beat. A defective
 * anchor (garbled text / fake logo / hands) must never be selected (audit #11).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { referenceFrameVerdict, type ReferenceFrameObservation } from "./services/referenceFrameScreen";

const CLEAN: ReferenceFrameObservation = {
  observedSubject: "a matte-black alloy wheel on wet asphalt",
  hasGeneratedText: false,
  hasFakeLogo: false,
  hasHumanOrHands: false,
  automotivePlausible: true,
  compositionOk: true,
  conditioningSuitable: true,
  defects: [],
  confidence: 0.9,
};

describe("referenceFrameVerdict (the pure anchor gate)", () => {
  it("accepts a clean, wordless, unbranded, faceless frame", () => {
    expect(referenceFrameVerdict(CLEAN)).toEqual({ accept: true, reasons: [] });
  });

  it("REJECTS generated text in the anchor", () => {
    const v = referenceFrameVerdict({ ...CLEAN, hasGeneratedText: true });
    expect(v.accept).toBe(false);
    expect(v.reasons.join(" ")).toContain("generated text");
  });

  it("REJECTS a fake/mis-spelled logo (the Nixs class)", () => {
    expect(referenceFrameVerdict({ ...CLEAN, hasFakeLogo: true }).accept).toBe(false);
  });

  it("REJECTS a human/hands in the anchor", () => {
    expect(referenceFrameVerdict({ ...CLEAN, hasHumanOrHands: true }).accept).toBe(false);
  });

  it("REJECTS an implausible or unsuitable frame", () => {
    expect(referenceFrameVerdict({ ...CLEAN, automotivePlausible: false }).accept).toBe(false);
    expect(referenceFrameVerdict({ ...CLEAN, conditioningSuitable: false }).accept).toBe(false);
  });

  it("REJECTS bad composition and low screen confidence (an anchor needs a positive clearance)", () => {
    expect(referenceFrameVerdict({ ...CLEAN, compositionOk: false }).accept).toBe(false);
    expect(referenceFrameVerdict({ ...CLEAN, confidence: 0.2 }).accept).toBe(false);
  });

  it("collects every reason, not just the first", () => {
    const v = referenceFrameVerdict({ ...CLEAN, hasGeneratedText: true, hasHumanOrHands: true });
    expect(v.reasons.length).toBe(2);
  });

  it("a NULL screen is conservative: reject when the frame will be an anchor, accept when advisory", () => {
    expect(referenceFrameVerdict(null, { requireScreen: true }).accept).toBe(false);
    expect(referenceFrameVerdict(null, { requireScreen: false }).accept).toBe(true);
  });
});

describe("screenReferenceFrame (mocked vision)", () => {
  afterEach(() => {
    vi.doUnmock("./_core/llm");
    vi.resetModules();
  });

  it("parses a defective vision verdict", async () => {
    const obs = { ...CLEAN, hasGeneratedText: true, conditioningSuitable: false, defects: ["garbled letters on the battery case"] };
    vi.doMock("./_core/llm", () => ({ invokeLLM: vi.fn().mockResolvedValue({ choices: [{ message: { content: JSON.stringify(obs) } }] }) }));
    vi.resetModules();
    const { screenReferenceFrame } = await import("./services/referenceFrameScreen");
    const out = await screenReferenceFrame("data:image/jpeg;base64,AAAA");
    expect(out?.hasGeneratedText).toBe(true);
    expect(out?.conditioningSuitable).toBe(false);
  });

  it("FAILS CLOSED on a partial/empty vision response (missing safety fields are not defaulted safe)", async () => {
    // An empty JSON object from the model must NOT parse into a clean anchor —
    // the positive-safety booleans require an explicit true (audit fail-open P2).
    vi.doMock("./_core/llm", () => ({ invokeLLM: vi.fn().mockResolvedValue({ choices: [{ message: { content: "{}" } }] }) }));
    vi.resetModules();
    const { screenReferenceFrame, referenceFrameVerdict: verdict } = await import("./services/referenceFrameScreen");
    const out = await screenReferenceFrame("data:image/jpeg;base64,AAAA");
    expect(out?.automotivePlausible).toBe(false);
    expect(out?.conditioningSuitable).toBe(false);
    expect(out?.compositionOk).toBe(false);
    expect(verdict(out).accept).toBe(false);
  });

  it("returns null (never a fabricated pass) when the model fails", async () => {
    vi.doMock("./_core/llm", () => ({ invokeLLM: vi.fn().mockRejectedValue(new Error("vision down")) }));
    vi.resetModules();
    const { screenReferenceFrame, referenceFrameVerdict: verdict } = await import("./services/referenceFrameScreen");
    const out = await screenReferenceFrame("data:image/jpeg;base64,AAAA");
    expect(out).toBeNull();
    // and the gate refuses to anchor on an unscreened frame
    expect(verdict(out, { requireScreen: true }).accept).toBe(false);
  });
});
