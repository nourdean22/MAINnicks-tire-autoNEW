import { describe, it, expect } from "vitest";
import {
  trailReachedTool,
  scoreBand,
  isConvertedScore,
} from "../services/vapiConversionSignals";

describe("trailReachedTool", () => {
  it("is true when a write/capture tool fired (tool_called)", () => {
    expect(trailReachedTool([{ state: "greeted" }, { state: "tool_called" }])).toBe(true);
  });
  it("is true when sendConfirmationSms fired (confirmed)", () => {
    expect(trailReachedTool([{ state: "greeted" }, { state: "confirmed" }])).toBe(true);
  });
  it("is false for read-only / no-capture trails", () => {
    expect(trailReachedTool([{ state: "greeted" }, { state: "intent_captured" }, { state: "ended" }])).toBe(false);
  });
  it("is false for an empty trail", () => {
    expect(trailReachedTool([])).toBe(false);
  });
});

describe("scoreBand", () => {
  it("maps the documented bands at their boundaries", () => {
    expect(scoreBand(0)).toBe("wasted");
    expect(scoreBand(49)).toBe("wasted");
    expect(scoreBand(50)).toBe("info");
    expect(scoreBand(69)).toBe("info");
    expect(scoreBand(70)).toBe("converted");
    expect(scoreBand(84)).toBe("converted");
    expect(scoreBand(85)).toBe("exemplary");
    expect(scoreBand(100)).toBe("exemplary");
  });
});

describe("isConvertedScore", () => {
  it("counts 70+ (converted + exemplary) as converted", () => {
    expect(isConvertedScore(69)).toBe(false);
    expect(isConvertedScore(70)).toBe(true);
    expect(isConvertedScore(95)).toBe(true);
  });

  // Regression guard for the nightly-digest bug: counting by SCORE band must
  // not be confused with the outcome CATEGORY. A 'hard_conversion' category
  // string is NOT a score band and must never be treated as one.
  it("operates on numeric scores, independent of outcome category strings", () => {
    const scored = [
      { score: 95, outcome: "hard_conversion" },
      { score: 80, outcome: "walk_in_directed" },
      { score: 60, outcome: "resolved_info" },
      { score: 40, outcome: "lost_opportunity" },
    ];
    expect(scored.filter((c) => isConvertedScore(c.score)).length).toBe(2);
    expect(scored.filter((c) => scoreBand(c.score) === "wasted").length).toBe(1);
  });
});
