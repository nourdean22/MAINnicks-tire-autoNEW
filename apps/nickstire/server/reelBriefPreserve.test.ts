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
  it("restores every protected field from the initial generation", () => {
    const { effective, preserved } = applyCriticPreservingTruth(initial, critic);
    expect(effective.mechanicTruth).toBe(initial.mechanicTruth);
    expect(effective.winningConceptId).toBe("c-battery-1");
    expect(effective.concepts).toEqual(initial.concepts);
    expect(effective.sourceNotes).toEqual(initial.sourceNotes);
    expect(effective.usefulAbsurdity).toBe(initial.usefulAbsurdity);
    expect([...preserved].sort()).toEqual([...PROTECTED_BRIEF_FIELDS].sort());
  });

  it("keeps the critic's improvements to NON-protected fields", () => {
    const { effective } = applyCriticPreservingTruth(initial, critic);
    expect(effective.selectedCaption).toBe("critic improved caption");
    expect(effective.clevelandAngle).toBe("Euclid Ave winters, fact-checked");
  });

  it("reports no preservation when the critic left the truth alone", () => {
    const honest = {
      ...critic,
      mechanicTruth: initial.mechanicTruth,
      winningConceptId: initial.winningConceptId,
      concepts: initial.concepts,
      sourceNotes: initial.sourceNotes,
      usefulAbsurdity: initial.usefulAbsurdity,
    };
    expect(applyCriticPreservingTruth(initial, honest).preserved).toEqual([]);
  });

  it("falls back to the critic's value when the initial gen left a field EMPTY (gap-fill, not edit)", () => {
    const { effective, preserved } = applyCriticPreservingTruth({ ...initial, winningConceptId: "" }, critic);
    expect(effective.winningConceptId).toBe("c-HIJACKED"); // initial empty → critic's value used
    expect(preserved).not.toContain("winningConceptId");
  });
});
