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
import { destinationProblem, isDeployedDestination, isHomepagePath } from "@shared/reelDestinations";

const entries = Object.entries(PACK_DESTINATIONS);

describe("every mapped destination is deployed and usable", () => {
  it("has entries at all", () => {
    expect(entries.length).toBeGreaterThan(50);
  });

  // 2026-09-16 · was a raw Set membership check against DEPLOYED_DESTINATIONS
  // (bare paths only), which rejected a section anchor on a real deployed page
  // (e.g. "/tires#tire-repair") even though reelDestinations.ts's own
  // normalizeDestination() explicitly strips "?" and "#" before comparing —
  // documented, deliberate support for anchors. isDeployedDestination() is
  // that same module's normalization-aware helper for exactly this check;
  // using the raw Set here was a gap in this test's coverage of its target
  // module's actual contract, not a real restriction.
  it("every path is in the derived deployed set", () => {
    const bad = entries.filter(([, p]) => !isDeployedDestination(p));
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

/* -- review findings from PR #1998, each locked ---------------------------- */

import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeDestination, ALLOWED_ORIGIN_HOSTS } from "@shared/reelDestinations";

const franchises = new Set(
  readdirSync(resolve(process.cwd(), "docs/reel-packs"), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name.replace(/^\d{4}-\d{2}-\d{2}-/, "")),
);

describe("map keys must match real pack franchises (review #1998)", () => {
  // "wd-transfer-case-bind-tight-turns" was a dead key - the real franchise is
  // "4wd-...". The value-only test could not see it, so the entry was never read
  // and the pack silently fell through to "no curated match yet".
  it("every PACK_DESTINATIONS key is an existing pack franchise", () => {
    const orphans = Object.keys(PACK_DESTINATIONS).filter((k) => !franchises.has(k));
    expect(orphans, `keys matching no pack: ${JSON.stringify(orphans)}`).toEqual([]);
  });

  it("every DELIBERATELY_UNASSIGNED key is an existing pack franchise", () => {
    const orphans = Object.keys(DELIBERATELY_UNASSIGNED).filter((k) => !franchises.has(k));
    expect(orphans, `keys matching no pack: ${JSON.stringify(orphans)}`).toEqual([]);
  });

  it("the specific dead key is fixed", () => {
    expect(PACK_DESTINATIONS["4wd-transfer-case-bind-tight-turns"]).toBe("/transmission");
    expect(PACK_DESTINATIONS["wd-transfer-case-bind-tight-turns"]).toBeUndefined();
  });

  // POSITIVE CONTROL: the fixture itself must be real, or the two tests above
  // pass vacuously against an empty set.
  it("the franchise set is non-trivial", () => {
    expect(franchises.size).toBeGreaterThan(100);
  });
});

describe("absolute URLs must point at Nick's (review #1998)", () => {
  it("REJECTS a foreign origin reusing a valid pathname", () => {
    expect(normalizeDestination("https://example.com/brakes")).toBeNull();
    expect(destinationProblem("https://example.com/brakes")).toMatch(/no landing destination is declared/);
  });

  // POSITIVE CONTROL: the real origins still work, or every campaign URL breaks.
  it("PERMITS the configured Nick's origins", () => {
    for (const host of ALLOWED_ORIGIN_HOSTS) {
      expect(normalizeDestination(`https://${host}/brakes`)).toBe("/brakes");
      expect(destinationProblem(`https://${host}/brakes`)).toBeNull();
    }
    expect(normalizeDestination("/brakes")).toBe("/brakes");
  });
});
