/**
 * Every curated destination must be a real, deployed page.
 *
 * This is the test that would have stopped "/tire-sidewall" — a path its own
 * author recommended, which does not exist and answers HTTP 200 with the app
 * shell. A map of topic -> path is exactly the kind of hand-maintained list that
 * rots, so it is validated against the derived deployed set rather than trusted.
 */
import { describe, it, expect } from "vitest";
import { PACK_DESTINATIONS, DELIBERATELY_UNASSIGNED } from "@shared/reelDestinationMap";
import { DEPLOYED_DESTINATIONS, destinationProblem, isHomepagePath } from "@shared/reelDestinations";

const entries = Object.entries(PACK_DESTINATIONS);

describe("every mapped destination is deployed and usable", () => {
  it("has entries at all", () => {
    expect(entries.length).toBeGreaterThan(50);
  });

  it("every path is in the derived deployed set", () => {
    const deployed = new Set(DEPLOYED_DESTINATIONS);
    const bad = entries.filter(([, p]) => !deployed.has(p));
    expect(bad, `not deployed: ${JSON.stringify(bad)}`).toEqual([]);
  });

  it("every path passes the destination gate outright", () => {
    const problems = entries
      .map(([k, p]) => [k, p, destinationProblem(p)] as const)
      .filter(([, , why]) => why !== null);
    expect(problems, `blocked: ${JSON.stringify(problems)}`).toEqual([]);
  });

  // The defect this whole wave exists to repair.
  it("NEVER maps a topic to the homepage", () => {
    const home = entries.filter(([, p]) => isHomepagePath(p));
    expect(home, `mapped to homepage: ${JSON.stringify(home)}`).toEqual([]);
  });

  it("the specific mistake is pinned: sidewall goes to /tires, not /tire-sidewall", () => {
    expect(PACK_DESTINATIONS["tire-sidewall-numbers"]).toBe("/tires");
    expect(Object.values(PACK_DESTINATIONS)).not.toContain("/tire-sidewall");
  });

  it("why-car-pulls goes to its exact page", () => {
    expect(PACK_DESTINATIONS["why-car-pulls"]).toBe("/car-pulling-to-one-side");
  });
});

describe("deliberate non-assignment is recorded, not silent", () => {
  it("every unassigned topic carries a stated reason", () => {
    const entriesU = Object.entries(DELIBERATELY_UNASSIGNED);
    expect(entriesU.length).toBeGreaterThan(10);
    for (const [topic, why] of entriesU) {
      expect(why.length, `${topic} needs a reason`).toBeGreaterThan(20);
    }
  });

  // A topic cannot be both assigned and declared unassignable - that would mean
  // the record disagrees with itself and a reader could not tell which is current.
  it("no topic appears in both maps", () => {
    const overlap = Object.keys(DELIBERATELY_UNASSIGNED).filter((k) => k in PACK_DESTINATIONS);
    expect(overlap, `in both maps: ${JSON.stringify(overlap)}`).toEqual([]);
  });
});
