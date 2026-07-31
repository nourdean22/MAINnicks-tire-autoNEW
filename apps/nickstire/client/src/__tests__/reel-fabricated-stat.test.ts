/**
 * `no-fabricated-stat` — the reel claim bank checked guarantees, prices and
 * fearmongering, but never whether an assertion was TRUE.
 *
 * Live capture (reel job 1200004, 2026-07-31): the caption generator emitted
 *   "In Cleveland, we see zero salt-related brake seizures, so wear is often
 *    the cause."
 * That statistic is invented, and it is backwards — road salt seizing a caliper
 * is a common Cleveland failure. It passed every existing gate and would have
 * published in the shop's own voice, about the shop's own market.
 *
 * We cannot fact-check inside a linter. We CAN refuse the SHAPE fabrications
 * take: this shop's own experience quantified as an absolute.
 *
 * The false-positive half of this file matters more than the true-positive
 * half. These reels are made of impersonal technical numbers — tread depths,
 * PSI-per-degree, spare-tire ratings. A rule that blocks those blocks every
 * reel, which is worse than the defect it fixes.
 */
import { describe, it, expect } from "vitest";
import { detectFabricatedStats } from "../lib/facelessReelStudio";

describe("detectFabricatedStats — blocks invented shop statistics", () => {
  it("blocks the exact caption that shipped past every other gate (reel 1200004)", () => {
    const f = detectFabricatedStats(
      "In Cleveland, we see zero salt-related brake seizures, so wear is often the cause.",
      "caption",
    );
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe("block");
    expect(f[0].rule).toBe("no-fabricated-stat");
    expect(f[0].where).toBe("caption");
  });

  it.each([
    "We see 90% of these fail before 40,000 miles.",
    "Our techs find zero issues with that brand.",
    "We have had none of those come back, ever.",
    "Our customers always get 100% of the tread life.",
  ])("blocks quantified first-person claim: %s", (text) => {
    expect(detectFabricatedStats(text)).toHaveLength(1);
  });
});

describe("detectFabricatedStats — must NOT block real technical content", () => {
  // Every string below is lifted from the actual 20-reel slate
  // (docs/REEL-SLATE-2026-07-31.md). If the rule blocks these it blocks the
  // product, so these are the load-bearing assertions in this file.
  it.each([
    "Every 10 degrees the temperature drops takes about 1 PSI out of every tire.",
    "Most are rated around 50 miles and under 50 mph.",
    "If you can see the top of the head, you are below 2/32 inch — legally worn.",
    "Below 4/32 inch you lose meaningful grip in snow.",
    "Every 5,000 to 7,500 miles is the usual window.",
    "Most batteries last three to five years.",
    "All-season is a compromise, and it stops working around 45 degrees.",
    "There is a four digit date code on the sidewall.",
  ])("passes impersonal technical fact: %s", (text) => {
    expect(detectFabricatedStats(text)).toEqual([]);
  });

  it.each([
    "We can check that for you while you wait.",
    "We always torque to spec.",
    "Come see us on Euclid Ave.",
  ])("passes ordinary first-person copy carrying no statistic: %s", (text) => {
    expect(detectFabricatedStats(text)).toEqual([]);
  });
});
