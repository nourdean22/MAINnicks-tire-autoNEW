/**
 * reelClipCost.test.ts · 2026-08-03
 *
 * The reel cost sites multiplied by COST_ESTIMATES_USD.seedance_clip regardless
 * of which provider rendered the clip, and there was no veo entry at all.
 *
 * reelPipeline had already been fixed once for this exact bug — the comment above
 * its reservation records job 1200003 logging provider="veo" while the ledger held
 * zero veo rows — but that fix corrected the `provider` and `model` columns and
 * left the dollar amount behind. The columns said Veo; the money said Higgsfield.
 *
 * That figure is what reserve() compares against maxGenerationCostPerDayUsd, so
 * the undercount made the daily spend ceiling proportionally too permissive, and
 * made a Fast -> Lite switch record identical cost before and after.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  COST_ESTIMATES_USD,
  VEO_DEFAULT_CLIP_SECONDS,
  reelClipCostUsd,
} from "./services/generationLedger";

/**
 * Every case passes an explicit env object rather than mutating process.env.
 * Serial vitest shares ONE process across files, so a leaked REEL_VEO_* value
 * would resurface as a pricing failure in an unrelated suite.
 */
const EMPTY_ENV = {} as NodeJS.ProcessEnv;

afterEach(() => {
  // Nothing is mutated, but assert that stays true: a future case that reaches
  // for process.env would otherwise leak silently into the next file.
  expect(process.env.REEL_VEO_USD_PER_SECOND).toBeUndefined();
});

describe("reelClipCostUsd · the provider decides the price", () => {
  it("prices a Veo clip per second, not at the Higgsfield per-clip rate", () => {
    const cost = reelClipCostUsd("veo", EMPTY_ENV);

    expect(cost).toBeCloseTo(VEO_DEFAULT_CLIP_SECONDS * COST_ESTIMATES_USD.veo_second_720p, 10);
  });

  it("keeps the Seedance per-clip estimate for higgsfield", () => {
    expect(reelClipCostUsd("higgsfield", EMPTY_ENV)).toBe(COST_ESTIMATES_USD.seedance_clip);
  });

  /**
   * The regression this file exists for. Both providers previously returned the
   * same number, so any test asserting only one of them would have passed against
   * the broken code. Assert they DIFFER.
   */
  it("does not charge Veo and Higgsfield the same amount", () => {
    expect(reelClipCostUsd("veo", EMPTY_ENV)).not.toBe(reelClipCostUsd("higgsfield", EMPTY_ENV));
  });

  it("makes a rate change visible, so a provider switch is measurable", () => {
    const fast = reelClipCostUsd("veo", { REEL_VEO_USD_PER_SECOND: "0.10" } as NodeJS.ProcessEnv);
    const lite = reelClipCostUsd("veo", { REEL_VEO_USD_PER_SECOND: "0.05" } as NodeJS.ProcessEnv);

    expect(lite).toBeCloseTo(fast / 2, 10);
  });

  it("honours an explicit clip duration", () => {
    const cost = reelClipCostUsd("veo", { REEL_VEO_DURATION: "4" } as NodeJS.ProcessEnv);

    expect(cost).toBeCloseTo(4 * COST_ESTIMATES_USD.veo_second_720p, 10);
  });
});

describe("reelClipCostUsd · a malformed override never books a zero", () => {
  const junk: Array<[string, string]> = [
    ["empty string", ""],
    ["non-numeric", "abc"],
  ];

  for (const [label, value] of junk) {
    it(`falls back to the default rate on a ${label} REEL_VEO_USD_PER_SECOND`, () => {
      const cost = reelClipCostUsd("veo", { REEL_VEO_USD_PER_SECOND: value } as NodeJS.ProcessEnv);

      // A zero here would be worse than a wrong number: it would report every
      // reel as free and disable the daily ceiling entirely.
      expect(cost).toBeGreaterThan(0);
      expect(cost).toBeCloseTo(VEO_DEFAULT_CLIP_SECONDS * COST_ESTIMATES_USD.veo_second_720p, 10);
    });

    it(`falls back to the default duration on a ${label} REEL_VEO_DURATION`, () => {
      const cost = reelClipCostUsd("veo", { REEL_VEO_DURATION: value } as NodeJS.ProcessEnv);

      expect(cost).toBeGreaterThan(0);
      expect(cost).toBeCloseTo(VEO_DEFAULT_CLIP_SECONDS * COST_ESTIMATES_USD.veo_second_720p, 10);
    });
  }
});
