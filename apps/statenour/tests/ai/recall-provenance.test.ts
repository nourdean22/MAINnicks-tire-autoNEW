/**
 * RECALL PROVENANCE tests -- 2026-09-10.
 *
 * Audit finding #2: "REMEMBERED -- WHAT NICK BELIEVES (0) / No semantic
 * memory hits retrieved" appeared on a turn synthesising weeks of
 * context. Four distinct paths rendered that identical "(0)":
 *
 *   1. embedUserMessage() fail-softs to [] on a 12s timeout, and the
 *      hybrid lane is hard-gated on `userEmbedding.length > 0` -- so the
 *      lane never ran at all;
 *   2. the lane's own 3s withTimeout budget expired;
 *   3. recallMemoriesForQuery threw and was caught into `hits: []`;
 *   4. the search really ran and matched nothing.
 *
 * Only (4) is a fact about Nick's memory. (1)-(3) are facts about a
 * broken instrument, and rendering them as "Nick believes nothing"
 * is the single most trust-destroying thing this system can do -- it
 * is the operator's whole basis for judging whether a callback is real
 * memory or a confident guess.
 *
 * Worth stating plainly: this lane has NO min-score, and its durable
 * sub-lane returns up to 10 rows unconditionally. Against a populated
 * corpus a true zero is close to impossible. A "(0)" in production is
 * therefore far more likely to be case (1)-(3) than case (4).
 */
import { describe, it, expect } from "vitest";
import { describeRecallState } from "@/lib/brain/memory-recall";

describe("a failed read never renders as an empty memory", () => {
  it("ERROR says the state is unknown, and never claims zero", () => {
    const v = describeRecallState(0, "ERROR", "query embedding unavailable");
    expect(v.countIsMeaningful).toBe(false);
    expect(v.headline).toMatch(/failed/i);
    expect(v.headline).toMatch(/not empty/i);
    expect(v.headline).not.toMatch(/\b0\b/);
    expect(v.unlock).toBe("query embedding unavailable");
  });

  it("UNMEASURED says the read never ran", () => {
    const v = describeRecallState(0, "UNMEASURED", "query under 10 chars");
    expect(v.countIsMeaningful).toBe(false);
    expect(v.headline).toMatch(/not queried/i);
  });

  // CONTROL. Without this, a describer that returned "failed" for
  // everything would pass every assertion above.
  it("CONTROL - a measured zero IS reported as a real zero, with its denominator", () => {
    const v = describeRecallState(0, "ZERO");
    expect(v.countIsMeaningful).toBe(true);
    expect(v.headline).toMatch(/nothing matched/i);
    expect(v.unlock).toMatch(/found no match/i);
  });

  it("CONTROL - a successful recall reports the count plainly", () => {
    expect(describeRecallState(5, "OK").headline).toBe("5 memories retrieved");
    expect(describeRecallState(1, "OK").headline).toBe("1 memory retrieved");
    expect(describeRecallState(5, "OK").countIsMeaningful).toBe(true);
    expect(describeRecallState(5, "OK").unlock).toBeNull();
  });
});

describe("every non-OK state offers a way out", () => {
  // An empty state that does not say what would change it is a dead
  // end -- the operator cannot tell a bug from a fact.
  for (const p of ["ZERO", "ERROR", "UNMEASURED"] as const) {
    it(`${p} carries an unlock string`, () => {
      const v = describeRecallState(0, p);
      expect(v.unlock).toBeTruthy();
      expect((v.unlock ?? "").length).toBeGreaterThan(20);
    });
  }
});
