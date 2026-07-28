import { describe, it, expect } from "vitest";
import {
  evaluateMemoryCandidate,
  evidenceClassForSource,
} from "@/lib/brain/memory-commit-gateway";

const cand = (over: Partial<Parameters<typeof evaluateMemoryCandidate>[0]> = {}) => ({
  category: "insight",
  key: "k1",
  content: "Nour prefers evening workouts",
  source: "pattern-detector",
  categoryKnown: true,
  ...over,
});

describe("evaluateMemoryCandidate — the write-authority rules the legacy path lacks", () => {
  it("no existing claim → add", () => {
    expect(evaluateMemoryCandidate(cand(), null).decision).toBe("add");
  });

  it("SAME source repeating the SAME claim → noop (repetition ≠ corroboration)", () => {
    const v = evaluateMemoryCandidate(cand(), {
      content: "Nour prefers evening workouts",
      source: "pattern-detector",
      seenCount: 2,
      confidence: 0.6,
    });
    expect(v.decision).toBe("noop");
  });

  it("INDEPENDENT source repeating the claim → reinforce (real corroboration)", () => {
    const v = evaluateMemoryCandidate(cand({ source: "journal-analysis" }), {
      content: "nour prefers evening workouts",
      source: "pattern-detector",
      seenCount: 1,
      confidence: 0.5,
    });
    expect(v.decision).toBe("reinforce");
  });

  it("changed claim at equal strength → update, never a confidence-boosting reinforce", () => {
    const v = evaluateMemoryCandidate(cand({ content: "Nour prefers morning workouts", source: "insight-engine" }), {
      content: "Nour prefers evening workouts",
      source: "pattern-detector",
      seenCount: 3,
      confidence: 0.8,
    });
    expect(v.decision).toBe("update");
  });

  it("stronger evidence changing a weaker claim → supersede", () => {
    const v = evaluateMemoryCandidate(cand({ content: "Nour now trains at 6am", source: "user" }), {
      content: "Nour prefers evening workouts",
      source: "pattern-detector",
      seenCount: 3,
      confidence: 0.8,
    });
    expect(v.decision).toBe("supersede");
  });

  it("weaker evidence contradicting a stronger claim → review_required, not silent overwrite", () => {
    const v = evaluateMemoryCandidate(cand({ content: "Nour hates working out", source: "generated-summary" }), {
      content: "Nour trains daily",
      source: "user",
      seenCount: 5,
      confidence: 1,
    });
    expect(v.decision).toBe("review_required");
  });

  it("unknown category → review_required before minting taxonomy", () => {
    const v = evaluateMemoryCandidate(cand({ categoryKnown: false }), null);
    expect(v.decision).toBe("review_required");
  });
});

describe("evidenceClassForSource — deterministic provenance mapping", () => {
  it("operator-vouched sources are operator_stated", () => {
    expect(evidenceClassForSource("user")).toBe("operator_stated");
    expect(evidenceClassForSource("manual")).toBe("operator_stated");
    expect(evidenceClassForSource("skill_ingestion")).toBe("operator_stated");
  });
  it("receipts outrank summaries; unknown defaults to weak_inference", () => {
    expect(evidenceClassForSource("tool-exec-receipt")).toBe("system_receipt");
    expect(evidenceClassForSource("daily-brief-summary")).toBe("generated_summary");
    expect(evidenceClassForSource("mystery-writer")).toBe("weak_inference");
  });
});
