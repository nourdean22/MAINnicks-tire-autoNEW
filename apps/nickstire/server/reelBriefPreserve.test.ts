/**
 * Creative Compiler 2.0 Milestone 9 (issue 3.3) — the critic/rewriter re-emits
 * the WHOLE brief, so it can silently swap the winner, the mechanic fact, or the
 * evidence. applyCriticPreservingTruth restores the protected campaign truth from
 * the pre-critic generation while keeping the critic's copy/flow improvements.
 */
import { describe, it, expect } from "vitest";
import { applyCriticPreservingTruth, PROTECTED_BRIEF_FIELDS } from "./services/reelBriefGen";

const initial = {
  mechanicTruth: "Heat degrades the battery in summer; the first cold snap reveals it",
  winningConceptId: "c-battery-1",
  concepts: [{ id: "c-battery-1", hook: "your battery has been dying since July" }],
  sourceNotes: [{ label: "grounded review r1", kind: "proof" }],
  usefulAbsurdity: "the battery as a slowly draining hourglass",
  selectedCaption: "initial caption",
  clevelandAngle: "Euclid Ave winters",
};

const critic = {
  mechanicTruth: "A DIFFERENT invented fact the critic hallucinated",
  winningConceptId: "c-HIJACKED",
  concepts: [{ id: "c-HIJACKED", hook: "a replaced concept" }],
  sourceNotes: [],
  usefulAbsurdity: "a totally different metaphor",
  selectedCaption: "critic improved caption",
  clevelandAngle: "Euclid Ave winters, fact-checked",
};

describe("applyCriticPreservingTruth", () => {
  it("REJECTS the whole critic rewrite when it hijacked a protected truth field (falls back to the coherent initial brief)", () => {
    const { effective, preserved, rejectedCritic } = applyCriticPreservingTruth(initial, critic);
    expect(rejectedCritic).toBe(true);
    expect(effective.mechanicTruth).toBe(initial.mechanicTruth);
    expect(effective.winningConceptId).toBe("c-battery-1");
    expect(effective.concepts).toEqual(initial.concepts);
    expect(effective.sourceNotes).toEqual(initial.sourceNotes);
    expect(effective.usefulAbsurdity).toBe(initial.usefulAbsurdity);
    expect([...preserved].sort()).toEqual([...PROTECTED_BRIEF_FIELDS].sort());
  });

  it("DROPS the critic's non-protected copy too when it changed a protected truth field (coherence over polish)", () => {
    // the critic's caption/angle were composed around a hijacked truth; a
    // field-level restore would leave incoherent execution, so reject wholesale.
    const { effective } = applyCriticPreservingTruth(initial, critic);
    expect(effective.selectedCaption).toBe("initial caption");
    expect(effective.clevelandAngle).toBe("Euclid Ave winters");
  });

  it("keeps the critic's non-protected improvements when it left the truth intact", () => {
    const honest = {
      ...critic,
      mechanicTruth: initial.mechanicTruth,
      winningConceptId: initial.winningConceptId,
      concepts: initial.concepts,
      sourceNotes: initial.sourceNotes,
      usefulAbsurdity: initial.usefulAbsurdity,
    };
    const { effective, preserved, rejectedCritic } = applyCriticPreservingTruth(initial, honest);
    expect(rejectedCritic).toBe(false);
    expect(preserved).toEqual([]);
    expect(effective.selectedCaption).toBe("critic improved caption");
    expect(effective.clevelandAngle).toBe("Euclid Ave winters, fact-checked");
  });

  it("fills a gap from the critic when the initial left a protected field EMPTY and the critic honored the rest (no rejection)", () => {
    const honestExceptGap = {
      ...critic,
      mechanicTruth: initial.mechanicTruth,
      concepts: initial.concepts,
      sourceNotes: initial.sourceNotes,
      usefulAbsurdity: initial.usefulAbsurdity,
      // winningConceptId stays "c-HIJACKED", but initial's is empty → gap-fill, not an edit
    };
    const { effective, preserved, rejectedCritic } = applyCriticPreservingTruth({ ...initial, winningConceptId: "" }, honestExceptGap);
    expect(rejectedCritic).toBe(false);
    expect(effective.winningConceptId).toBe("c-HIJACKED");
    expect(preserved).not.toContain("winningConceptId");
    expect(effective.selectedCaption).toBe("critic improved caption");
  });
});
