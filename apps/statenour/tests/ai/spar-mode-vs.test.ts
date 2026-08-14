/**
 * BDN-308 · Verbalized Sampling SPAR variant.
 *
 * The property under test is CONTAINMENT: the experiment must change
 * exactly one step. If the VS variant quietly rewrites attack, tension
 * or converge, an A/B on it measures four changes at once and the
 * result is uninterpretable — the same confound the persona-lane census
 * refuses to hide.
 */

import { afterEach, describe, expect, it } from "vitest";
import { SPAR_MODE, SPAR_MODE_VS, getSparMode } from "@/lib/ai/prompt/policy/spar-mode";

const ORIGINAL = process.env.NICK_SPAR_VS;

afterEach(() => {
  // Serial vitest shares ONE process across files on Windows — restore
  // or delete, never leave the env dirty for the next suite.
  if (ORIGINAL === undefined) delete process.env.NICK_SPAR_VS;
  else process.env.NICK_SPAR_VS = ORIGINAL;
});

/** Steps 2-4, sliced off by their numbered headings. */
function tailSteps(scaffold: string): string {
  return scaffold.slice(scaffold.indexOf("2. ATTACK"));
}

describe("spar-mode · flag selection", () => {
  it("defaults to the incumbent scaffold when the flag is unset", () => {
    delete process.env.NICK_SPAR_VS;
    expect(getSparMode()).toBe(SPAR_MODE);
  });

  it("selects the VS variant only on the exact opt-in value", () => {
    process.env.NICK_SPAR_VS = "true";
    expect(getSparMode()).toBe(SPAR_MODE_VS);
  });

  it("does not treat other truthy-looking values as on", () => {
    // A half-on flag is worse than off: it makes an A/B silently
    // sample a mixture of both arms.
    for (const v of ["1", "yes", "TRUE", "on", ""]) {
      process.env.NICK_SPAR_VS = v;
      expect(getSparMode()).toBe(SPAR_MODE);
    }
  });
});

describe("spar-mode · containment (load-bearing)", () => {
  it("changes ONLY the diverge step — steps 2-4 are byte-identical", () => {
    expect(tailSteps(SPAR_MODE_VS)).toBe(tailSteps(SPAR_MODE));
  });

  it("keeps the four-step spine and the same title", () => {
    for (const scaffold of [SPAR_MODE, SPAR_MODE_VS]) {
      expect(scaffold).toContain("# SPAR MODE — diverge → attack → converge");
      expect(scaffold).toContain("1. DIVERGE");
      expect(scaffold).toContain("2. ATTACK");
      expect(scaffold).toContain("3. TENSION");
      expect(scaffold).toContain("4. CONVERGE");
    }
  });

  it("preserves the operator's standing constraint that the choice stays his", () => {
    expect(SPAR_MODE_VS).toContain("the choice stays his");
    expect(SPAR_MODE_VS).toContain("Do NOT resolve it unless Nour asks");
  });
});

describe("spar-mode · the VS mechanism is actually present", () => {
  it("asks for verbalized probabilities, not just 'distinct' options", () => {
    // The incumbent states the GOAL; the variant must state the MECHANISM.
    expect(SPAR_MODE_VS.toLowerCase()).toContain("probability");
    expect(SPAR_MODE_VS).toMatch(/p=0\.NN/);
  });

  it("instructs tail sampling with the paper's threshold", () => {
    expect(SPAR_MODE_VS.toLowerCase()).toContain("tail");
    expect(SPAR_MODE_VS).toContain("0.10");
  });

  it("still demands distinct bets grounded in real data", () => {
    expect(SPAR_MODE_VS).toContain("different BET");
    expect(SPAR_MODE_VS.toLowerCase()).toContain("numbers, names, dates");
  });

  it("generates more candidates than it keeps", () => {
    // 5 generated, 3 kept — the discard is where the diversity gain is
    // realized. Keeping all 5 would just make replies longer.
    expect(SPAR_MODE_VS).toContain("5 candidate directions");
    expect(SPAR_MODE_VS).toContain("keep the 3 strongest");
  });
});
