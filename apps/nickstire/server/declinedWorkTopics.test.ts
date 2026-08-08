/**
 * Declined-work topics — the content source derived from refused estimates.
 *
 * The load-bearing property is NOT that it produces topics. It is that the
 * COUNTS AND DOLLARS NEVER REACH THE GENERATOR. "29 drivers walked away from a
 * $1,055 control arm" is true and sourced, and `detectFabricatedStats` blocks
 * that shape anyway — it refuses first-person shop experience quantified as an
 * absolute, because a linter cannot distinguish a sourced number from an
 * invented one, and the invented ones shipped first (reel 1200004, "we see zero
 * salt-related brake seizures"). So the numbers rank and explain; they never
 * appear in copy.
 *
 * Fixtures are the REAL top declines measured from prod on 2026-08-08.
 */
import { describe, expect, it } from "vitest";
import {
  angleFor,
  briefFor,
  mineDeclinedWorkTopics,
  normalizePartName,
  scoreDeclinedTopic,
  type DeclinedWorkRow,
} from "../shared/declinedWorkTopics";

/** Verbatim from prod: the top declined repairs and their real averages. */
const PROD: DeclinedWorkRow[] = [
  { serviceDescription: "REMOVE & REPLACE LOWER CONTROL ARM", count: 29, avgAmountCents: 105_500 },
  { serviceDescription: "REMOVE & REPLACE FRONT HUB OR BEARING(ONE)", count: 17, avgAmountCents: 74_100 },
  { serviceDescription: "TUNE UP (MAJOR) INCLUDING ADJUSTMENTS", count: 14, avgAmountCents: 129_600 },
  { serviceDescription: "REMOVE & REPLACE CATALYTIC CONVERTER", count: 14, avgAmountCents: 111_400 },
  { serviceDescription: "REMOVE & REPLACE ALTERNATOR", count: 12, avgAmountCents: 85_300 },
  { serviceDescription: "REMOVE & REPLACE RADIATOR", count: 11, avgAmountCents: 69_500 },
  { serviceDescription: "REMOVE & REPLACE FRONT STRUT ASSEMBLIES (BOTH)", count: 9, avgAmountCents: 181_100 },
  { serviceDescription: "REMOVE & REPLACE FRONT STRUT ASSEMBLY (ONE)", count: 9, avgAmountCents: 84_400 },
  { serviceDescription: "REMOVE & REPLACE WATER PUMP", count: 7, avgAmountCents: 59_800 },
];

describe("normalizePartName — ALG writes labor-guide phrasing, not English", () => {
  it.each([
    ["REMOVE & REPLACE LOWER CONTROL ARM", "lower control arm"],
    ["REMOVE & REPLACE FRONT HUB OR BEARING(ONE)", "front hub or bearing"],
    // Singularised on purpose: ALG lists this repair as both ASSEMBLY (ONE)
    // and ASSEMBLIES (BOTH), and they must collapse to one queue slot.
    ["REMOVE & REPLACE FRONT STRUT ASSEMBLIES (BOTH)", "front strut assembly"],
    ["TUNE UP (MAJOR) INCLUDING ADJUSTMENTS", "tune up major"],
    ["R & R WATER PUMP", "water pump"],
  ])("%s → %s", (raw, expected) => {
    expect(normalizePartName(raw)).toBe(expected);
  });

  it("never leaks the operation verb into a generator brief", () => {
    for (const row of PROD) {
      expect(normalizePartName(row.serviceDescription)).not.toMatch(/remove|replace/i);
    }
  });
});

describe("angleFor — the refusal reason drives the treatment", () => {
  it("safety parts get the one angle we do not soften, even at a low ticket", () => {
    expect(angleFor("lower control arm", 20_000)).toBe("safety_line");
    expect(angleFor("front brake pads", 15_000)).toBe("safety_line");
    // Safety must outrank the four-figure "second opinion" framing: a control
    // arm is not a budgeting decision.
    expect(angleFor("lower control arm", 181_100)).toBe("safety_line");
  });

  it("cascade parts get cost-of-waiting", () => {
    expect(angleFor("water pump", 59_800)).toBe("cost_of_waiting");
    expect(angleFor("radiator", 69_500)).toBe("cost_of_waiting");
  });

  it("a four-figure non-safety ticket gets second-opinion, not a scare", () => {
    expect(angleFor("tune up major", 129_600)).toBe("second_opinion");
  });

  it("is DETERMINISTIC — a re-run must not reshuffle the operator's queue", () => {
    expect(angleFor("lower control arm", 105_500)).toBe(angleFor("lower control arm", 105_500));
  });
});

describe("mineDeclinedWorkTopics", () => {
  it("★ NEVER puts a count or a dollar figure in the generator-facing topic", () => {
    for (const c of mineDeclinedWorkTopics(PROD)) {
      expect(c.topic, `topic leaked a number: ${c.topic}`).not.toMatch(/\d/);
      expect(c.topic).not.toMatch(/\$/);
    }
  });

  it("keeps the numbers in reasons, where the operator queue reads them", () => {
    const top = mineDeclinedWorkTopics(PROD)[0];
    expect(top.reasons.join(" ")).toMatch(/\d+ open estimates declined/);
    expect(top.reasons.join(" ")).toMatch(/\$/);
  });

  it("collapses the same part listed at different quantities", () => {
    // ALG lists strut assemblies as (BOTH) and (ONE); both normalise to the
    // same part and must not occupy two queue slots.
    const parts = mineDeclinedWorkTopics(PROD).map((c) => c.part);
    expect(new Set(parts).size).toBe(parts.length);
    expect(parts.filter((p) => p.includes("strut")).length).toBeLessThanOrEqual(1);
  });

  it("ranks by volume AND ticket, with the ticket DAMPED", () => {
    const out = mineDeclinedWorkTopics(PROD);
    // 29 declines at $1,055 must outrank 9 declines at $1,811 — otherwise one
    // expensive job becomes the whole feed, which is the hero-category framing
    // this shop's positioning rejects.
    const controlArm = out.findIndex((c) => c.part.includes("control arm"));
    const struts = out.findIndex((c) => c.part.includes("strut"));
    expect(controlArm).toBeGreaterThanOrEqual(0);
    expect(controlArm).toBeLessThan(struts);
  });

  it("drops one-off refusals — a single decline is not a pattern", () => {
    const out = mineDeclinedWorkTopics([{ serviceDescription: "REMOVE & REPLACE WIPER BLADE", count: 1, avgAmountCents: 4_000 }]);
    expect(out).toHaveLength(0);
  });

  it("survives junk rows rather than throwing — the feed degrades, it does not die", () => {
    const out = mineDeclinedWorkTopics([
      { serviceDescription: "", count: 9, avgAmountCents: 1000 },
      { serviceDescription: "   ", count: 9, avgAmountCents: 1000 },
      { serviceDescription: "REMOVE & REPLACE", count: 9, avgAmountCents: 1000 },
      ...PROD.slice(0, 2),
    ]);
    expect(out.length).toBeGreaterThan(0);
    for (const c of out) expect(c.part.length).toBeGreaterThan(2);
  });

  it("every brief reads as a content direction, not an invoice line", () => {
    for (const c of mineDeclinedWorkTopics(PROD)) {
      expect(c.topic.length).toBeGreaterThan(30);
      expect(c.topic).not.toMatch(/^(remove|replace)/i);
    }
  });

  it("scoring is monotonic in volume at a fixed ticket", () => {
    const lo = scoreDeclinedTopic({ serviceDescription: "x", count: 3, avgAmountCents: 50_000 });
    const hi = scoreDeclinedTopic({ serviceDescription: "x", count: 20, avgAmountCents: 50_000 });
    expect(hi).toBeGreaterThan(lo);
  });

  it("briefFor covers every angle without falling through to a stub", () => {
    for (const angle of ["safety_line", "cost_of_waiting", "second_opinion", "what_it_actually_is", "symptom_decode"] as const) {
      const brief = briefFor("lower control arm", angle);
      expect(brief).toContain("lower control arm");
      expect(brief.length).toBeGreaterThan(30);
    }
  });
});
