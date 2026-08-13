/**
 * evaluateOriginalityQc — one canonical readout instead of scattered logs.
 * Load-bearing property: two criteria have no per-job signal at all
 * ("no copied footage", "no copyrighted audio") and must report "structural"
 * rather than "pass", and "no misleading before/after" must report "unknown"
 * rather than being faked green.
 */
import { describe, it, expect } from "vitest";
import { evaluateOriginalityQc, type OriginalityQcInput } from "../../../shared/originalityQcChecklist";

function base(over: Partial<OriginalityQcInput> = {}): OriginalityQcInput {
  return {
    claimEntailments: ["supported"],
    captionQaBlocking: false,
    voiceoverQaBlocking: false,
    disclosureMode: "visibly_animated",
    clevelandAngle: "Cleveland winters crack rubber faster than warm-climate cities",
    caption: "Send this to someone whose tires are bald.",
    totalDurationSeconds: 18,
    ...over,
  };
}

describe("evaluateOriginalityQc", () => {
  it("a fully-clean brief passes every checkable criterion", () => {
    const r = evaluateOriginalityQc(base());
    const byId = Object.fromEntries(r.checks.map((c) => [c.id, c.status]));
    expect(byId.claim_verified).toBe("pass");
    expect(byId.no_fake_humans_or_events).toBe("pass");
    expect(byId.verified_local_fact).toBe("pass");
    expect(byId.local_trust_marker).toBe("pass");
    expect(byId.save_share_reason).toBe("pass");
    expect(byId.caption_claim_safety).toBe("pass");
    expect(byId.voiceover_claim_safety).toBe("pass");
    expect(byId.format_length).toBe("pass");
    expect(r.failCount).toBe(0);
  });

  it("reports structural, not pass, for footage/audio provenance — no per-job signal exists", () => {
    const r = evaluateOriginalityQc(base());
    const byId = Object.fromEntries(r.checks.map((c) => [c.id, c.status]));
    expect(byId.no_copied_footage).toBe("structural");
    expect(byId.no_copyrighted_audio).toBe("structural");
  });

  it("reports unknown, never a faked pass, for before/after honesty", () => {
    const r = evaluateOriginalityQc(base());
    expect(r.checks.find((c) => c.id === "no_misleading_before_after")!.status).toBe("unknown");
  });

  it("a CONTRADICTED entailment fails the claim check even if another claim is supported", () => {
    const r = evaluateOriginalityQc(base({ claimEntailments: ["supported", "contradicted"] }));
    expect(r.checks.find((c) => c.id === "claim_verified")!.status).toBe("fail");
  });

  it("no supported claim at all is unknown, not fail — absence isn't contradiction", () => {
    const r = evaluateOriginalityQc(base({ claimEntailments: ["not_evaluated"] }));
    expect(r.checks.find((c) => c.id === "claim_verified")!.status).toBe("unknown");
  });

  it("an empty clevelandAngle fails BOTH the local-fact and trust-marker checks — same field, disclosed", () => {
    const r = evaluateOriginalityQc(base({ clevelandAngle: "" }));
    expect(r.checks.find((c) => c.id === "verified_local_fact")!.status).toBe("fail");
    expect(r.checks.find((c) => c.id === "local_trust_marker")!.status).toBe("fail");
  });

  it("a caption with no send/share language is unknown, not fail — the prompt asks but nothing enforces it", () => {
    const r = evaluateOriginalityQc(base({ caption: "Bald tires can't swim in the rain." }));
    expect(r.checks.find((c) => c.id === "save_share_reason")!.status).toBe("unknown");
  });

  it("null captionQaBlocking/voiceoverQaBlocking (check did not run) reports unknown, never a silent pass", () => {
    const r = evaluateOriginalityQc(base({ captionQaBlocking: null, voiceoverQaBlocking: null }));
    expect(r.checks.find((c) => c.id === "caption_claim_safety")!.status).toBe("unknown");
    expect(r.checks.find((c) => c.id === "voiceover_claim_safety")!.status).toBe("unknown");
  });

  it("a blocking VO finding fails independently of a clean caption", () => {
    const r = evaluateOriginalityQc(base({ voiceoverQaBlocking: true, captionQaBlocking: false }));
    expect(r.checks.find((c) => c.id === "voiceover_claim_safety")!.status).toBe("fail");
    expect(r.checks.find((c) => c.id === "caption_claim_safety")!.status).toBe("pass");
  });

  it("duration outside the 15-22s target fails; missing duration is unknown, not zero", () => {
    expect(evaluateOriginalityQc(base({ totalDurationSeconds: 45 })).checks.find((c) => c.id === "format_length")!.status).toBe("fail");
    expect(evaluateOriginalityQc(base({ totalDurationSeconds: null })).checks.find((c) => c.id === "format_length")!.status).toBe("unknown");
    expect(evaluateOriginalityQc(base({ totalDurationSeconds: 15 })).checks.find((c) => c.id === "format_length")!.status).toBe("pass");
    expect(evaluateOriginalityQc(base({ totalDurationSeconds: 22 })).checks.find((c) => c.id === "format_length")!.status).toBe("pass");
  });

  it("a non-animated disclosureMode reports unknown for the fake-humans check, not a false pass", () => {
    const r = evaluateOriginalityQc(base({ disclosureMode: "real_footage" }));
    expect(r.checks.find((c) => c.id === "no_fake_humans_or_events")!.status).toBe("unknown");
  });
});
