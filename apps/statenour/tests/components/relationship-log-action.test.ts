import { describe, expect, it } from "vitest";
import { rankCandidates } from "@/lib/services/people/rank-person-candidates";

describe("rankCandidates", () => {
  it("keeps a nickname that has one live owner", () => {
    const ranked = rankCandidates("mom", [
      { id: "y", name: "Yummah", role: "family", nicknames: ["mom"] },
    ]);

    expect(ranked.map(({ id, score }) => ({ id, score }))).toEqual([{ id: "y", score: 1 }]);
  });

  it("does not let a nickname take a term that is another person's formal name", () => {
    const ranked = rankCandidates("Sam", [
      { id: "y", name: "Yummah", role: "family", nicknames: ["Sam"] },
      { id: "s", name: "Sam", role: "friend", nicknames: [] },
    ]);

    expect(ranked.map(({ id, score }) => ({ id, score }))).toEqual([{ id: "s", score: 1 }]);
  });
});
