import { describe, it, expect } from "vitest";
import {
  isOperatorSource,
  evaluateMemoryCandidate,
  evidenceClassForSource,
  contradictionSignal,
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

// Wave-4 (2026-07-29): deterministic near-duplicate scoring — the
// no-LLM, no-embedding stand-in for semantic pre-dedup, shadow-only.
import { nearDuplicateScore } from "@/lib/brain/memory-commit-gateway";

describe("nearDuplicateScore", () => {
  it("identical claims score 1 regardless of whitespace/case", () => {
    expect(nearDuplicateScore("Nour owns the tire shop", "  nour OWNS the  tire shop ")).toBe(1);
  });

  it("rephrased same-claim scores above the 0.8 suspect threshold", () => {
    const a = "customer prefers morning appointments for tire rotation service";
    const b = "customer prefers morning appointments for tire rotation";
    expect(nearDuplicateScore(a, b)).toBeGreaterThanOrEqual(0.8);
  });

  it("unrelated claims score low", () => {
    expect(
      nearDuplicateScore("weekly revenue crossed the threshold", "journal streak reached nine days"),
    ).toBeLessThan(0.2);
  });

  it("empty or stopword-only content scores 0, never NaN", () => {
    expect(nearDuplicateScore("", "anything at all here")).toBe(0);
    expect(nearDuplicateScore("a an it", "of to in")).toBe(0);
  });
});

describe("isOperatorSource / evidenceClassForSource — the operator's own writers (2026-09-08)", () => {
  it("explicit save, pins and the outreach/media writers are operator_stated", () => {
    for (const s of ["user", "manual", "skill_ingestion", "user_save", "operator", "owner", "pin:chat", "pin:manual", "PIN:Manual"]) {
      expect(isOperatorSource(s), s).toBe(true);
      expect(evidenceClassForSource(s), s).toBe("operator_stated");
    }
  });
  it("machine-made pins and crons are not", () => {
    for (const s of ["auto_pin:blindspot", "wisdom_sync_cron", "output_critic", "lib:semantic-link", "weekly_digest"]) {
      expect(isOperatorSource(s), s).toBe(false);
      expect(evidenceClassForSource(s), s).not.toBe("operator_stated");
    }
    expect(evidenceClassForSource("weekly_digest")).toBe("generated_summary");
    expect(evidenceClassForSource("lib:semantic-link")).toBe("weak_inference");
  });
});


describe("Q-31 contradictionSignal — conservative shadow-only detector", () => {
  it("flags a same-topic negation flip", () => {
    expect(
      contradictionSignal(
        "Nour no longer prefers morning appointments for tire rotations",
        "Nour prefers morning appointments for tire rotations",
      ),
    ).toBe("negation");
  });

  it("flags explicit antonym reversals", () => {
    expect(
      contradictionSignal(
        "Keep the second shop location closed and sell the equipment",
        "Keep the second shop location open and buy the equipment",
      ),
    ).toBe("antonym");
  });

  it("does not invent a contradiction from ordinary paraphrase", () => {
    expect(
      contradictionSignal(
        "Nour prefers evening boxing sessions",
        "Nour likes boxing training in the evening",
      ),
    ).toBeNull();
  });

  it("does not classify unrelated text as contradiction", () => {
    expect(
      contradictionSignal(
        "The shop needs more alignment leads",
        "Nour wants to train boxing tonight",
      ),
    ).toBeNull();
  });
});
