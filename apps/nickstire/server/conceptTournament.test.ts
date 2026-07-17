import { describe, expect, it } from "vitest";
import {
  CREATIVE_ROLES,
  HARD_REJECT_RULES,
  JUDGE_RUBRIC,
  anonymizeConcepts,
  resolveWinner,
  type JudgeScore,
  type TournamentConcept,
} from "./services/conceptTournament";

const c = (n: number): Omit<TournamentConcept, "id"> => ({
  title: `Concept ${n}`,
  hook: `Hook ${n}`,
  coreIdea: `Core idea number ${n} that teaches one mechanic truth.`,
  visualIdea: `Visual idea ${n}`,
  whyItWorks: `Why it works ${n}`,
});

describe("tournament structure", () => {
  it("uses four deliberately different creative roles", () => {
    expect(CREATIVE_ROLES.map((r) => r.key)).toEqual([
      "automotive_insight",
      "visual_metaphor",
      "cleveland_culture",
      "direct_response",
    ]);
  });
  it("rubric weights sum to exactly 100", () => {
    expect(JUDGE_RUBRIC.reduce((a, r) => a + r.weight, 0)).toBe(100);
  });
  it("hard-reject rules include the doc's structural bans", () => {
    const joined = HARD_REJECT_RULES.join(" ");
    expect(joined).toContain("any shop could run unchanged");
    expect(joined).toContain("AI-generated lettering");
  });
});

describe("anonymizeConcepts", () => {
  it("round-robins across roles and strips role attribution", () => {
    const field = anonymizeConcepts([
      { role: "a", concepts: [c(1), c(2)] },
      { role: "b", concepts: [c(3)] },
      { role: "c", concepts: [c(4), c(5)] },
    ]);
    expect(field.map((x) => x.title)).toEqual(["Concept 1", "Concept 3", "Concept 4", "Concept 2", "Concept 5"]);
    expect(field.map((x) => x.id)).toEqual(["entry_01", "entry_02", "entry_03", "entry_04", "entry_05"]);
    expect(JSON.stringify(field)).not.toContain('"role"');
  });
});

describe("resolveWinner", () => {
  const field = anonymizeConcepts([{ role: "a", concepts: [c(1), c(2), c(3)] }]);
  const score = (id: string, total: number, rejected = false): JudgeScore => ({
    id, total, rejected, rejectionReason: rejected ? "generic" : "", note: "",
  });

  it("honors the judge's winnerId when it survived", () => {
    const w = resolveWinner(field, [score("entry_01", 70), score("entry_02", 90), score("entry_03", 60)], "entry_02");
    expect(w.title).toBe("Concept 2");
  });
  it("falls back to the highest-scoring survivor when winnerId was rejected or missing", () => {
    const w = resolveWinner(
      field,
      [score("entry_01", 70), score("entry_02", 90, true), score("entry_03", 82)],
      "entry_02",
    );
    expect(w.title).toBe("Concept 3");
  });
  it("throws when the judge rejects the entire field", () => {
    expect(() =>
      resolveWinner(field, [score("entry_01", 70, true), score("entry_02", 60, true), score("entry_03", 50, true)], "entry_01"),
    ).toThrow(/rejected the entire field/);
  });
  it("throws when the winning id does not exist in the field", () => {
    expect(() => resolveWinner(field, [score("entry_99", 99)], "entry_99")).toThrow(/does not exist/);
  });
});
