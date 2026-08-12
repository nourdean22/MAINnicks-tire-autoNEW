/**
 * Evidence-tier WP (2026-08-12) — parseTakeEpistemics is the one shared
 * reader of the epistemics a take carries (journal card via
 * insightsPreview's own parse, proposal card via listProposed's join).
 * Pin the vocabulary guards: only the scan's own tiers
 * (OBSERVED/INFERRED/SPECULATIVE) and confidences (HIGH/MED/LOW) pass;
 * everything else — legacy takes, malformed JSON, model drift — degrades
 * to nulls and never throws.
 */
import { describe, it, expect } from "vitest";
import { parseTakeEpistemics } from "@/lib/services/commitments";

describe("parseTakeEpistemics", () => {
  it("reads a stamped take", () => {
    const content = JSON.stringify({
      nextAction: { action: "x", domain: "business" },
      evidenceTier: "INFERRED",
      confidence: "MED",
    });
    expect(parseTakeEpistemics(content)).toEqual({
      evidenceTier: "INFERRED",
      confidence: "MED",
    });
  });

  it("degrades legacy takes (no fields) to nulls", () => {
    const content = JSON.stringify({ idea: "old take", nextAction: null });
    expect(parseTakeEpistemics(content)).toEqual({ evidenceTier: null, confidence: null });
  });

  it("rejects out-of-vocabulary values instead of passing them through", () => {
    const content = JSON.stringify({ evidenceTier: "GUESSED", confidence: "VERY_HIGH" });
    expect(parseTakeEpistemics(content)).toEqual({ evidenceTier: null, confidence: null });
  });

  it("never throws on malformed JSON or missing content", () => {
    expect(parseTakeEpistemics("{not json")).toEqual({ evidenceTier: null, confidence: null });
    expect(parseTakeEpistemics(null)).toEqual({ evidenceTier: null, confidence: null });
    expect(parseTakeEpistemics(undefined)).toEqual({ evidenceTier: null, confidence: null });
  });
});
