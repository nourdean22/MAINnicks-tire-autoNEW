/**
 * Canaries for typed landing destinations.
 *
 * THE MISTAKE THIS PREVENTS IS ON THE RECORD. While recommending destinations
 * for two packs, the author of the free-text version of this field recommended
 * `/tire-sidewall`. That page does not exist. nickstire.org answers HTTP 200 for
 * ANY path - it serves the app shell - so the mistake survived a status-code
 * check and was only caught by comparing page <title>. Free text is not more
 * flexible than a type here; it is unvalidated, and what it permits is a
 * customer tapping a link into a dead end.
 *
 * The measured stakes: every post this account has published linked to the bare
 * homepage while 175 topic pages sat deployed. 13,871 views produced 74 profile
 * visits and ONE website tap.
 */
import { describe, it, expect } from "vitest";
import {
  DEPLOYED_DESTINATIONS,
  normalizeDestination,
  isHomepagePath,
  isDeployedDestination,
  destinationProblem,
  suggestDestinations,
} from "@shared/reelDestinations";
import { ALL_ROUTES, PRERENDER_ROUTES } from "@shared/routes";

describe("the destination set is DERIVED, never hand-listed", () => {
  it("is exactly the prerendered route paths", () => {
    expect(DEPLOYED_DESTINATIONS).toEqual(PRERENDER_ROUTES.map((r) => r.path));
    expect(DEPLOYED_DESTINATIONS.length).toBeGreaterThan(100);
  });

  // The deployed/declared distinction is the whole point: a route that is
  // declared but not prerendered is not a page a customer can load.
  it("EXCLUDES declared-but-not-prerendered routes", () => {
    const notPrerendered = ALL_ROUTES.filter((r) => !r.prerender);
    expect(notPrerendered.length).toBeGreaterThan(0); // the distinction is real
    for (const r of notPrerendered) {
      expect(isDeployedDestination(r.path), `${r.path} is not prerendered and must not be usable`).toBe(false);
    }
  });
});

describe("normalizeDestination", () => {
  it("strips query, hash and trailing slash, and accepts absolute URLs", () => {
    expect(normalizeDestination("/brakes/")).toBe("/brakes");
    expect(normalizeDestination("/brakes?utm_source=ig")).toBe("/brakes");
    expect(normalizeDestination("/brakes#book")).toBe("/brakes");
    expect(normalizeDestination("https://nickstire.org/brakes?x=1")).toBe("/brakes");
    expect(normalizeDestination("  ")).toBeNull();
  });
});

describe("the homepage is rejected, in every spelling", () => {
  for (const d of ["/", "https://nickstire.org", "https://nickstire.org/", "/?utm_source=ig", "/#book"]) {
    it(`rejects ${d}`, () => {
      expect(isHomepagePath(d)).toBe(true);
      expect(destinationProblem(d)).toMatch(/homepage is not a landing destination/);
    });
  }

  it("says WHY in a sentence a human can act on", () => {
    const why = destinationProblem("/")!;
    expect(why).toMatch(/74 profile visits|ONE website tap/);
    expect(why).toMatch(/page about that problem/);
  });
});

describe("undeployed paths are rejected — the /tire-sidewall case", () => {
  it("rejects the exact path that was almost shipped", () => {
    expect(isDeployedDestination("/tire-sidewall")).toBe(false);
    const why = destinationProblem("/tire-sidewall")!;
    expect(why).toMatch(/not a deployed page/);
    // The reason must name the trap, or the next person repeats the check that failed.
    expect(why).toMatch(/HTTP 200|app shell/);
  });

  it("rejects the other two shell-serving paths found live", () => {
    for (const p of ["/tire-pressure", "/uneven-tire-wear"]) {
      expect(isDeployedDestination(p), p).toBe(false);
      expect(destinationProblem(p), p).toMatch(/not a deployed page/);
    }
  });

  it("rejects an undeclared path even when it looks plausible", () => {
    expect(destinationProblem("/definitely-not-real")).toMatch(/not a deployed page/);
  });
});

// POSITIVE CONTROLS. A validator that rejected everything would pass every test
// above and block the entire backlog, which is the failure mode of a gate that
// gets switched off a week later.
describe("real deployed pages PASS", () => {
  for (const d of ["/brakes", "/alignment", "/tires", "/booking", "/contact", "/car-pulling-to-one-side"]) {
    it(`permits ${d}`, () => {
      expect(isDeployedDestination(d), `${d} should be deployed`).toBe(true);
      expect(destinationProblem(d)).toBeNull();
    });
  }

  it("permits a deployed page carrying tracking parameters", () => {
    expect(destinationProblem("https://nickstire.org/brakes?utm_source=instagram")).toBeNull();
  });
});

describe("suggestDestinations helps a human choose, and does not choose", () => {
  it("finds candidates by term", () => {
    const hits = suggestDestinations(["brake"]);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => `${h.path} ${h.title}`.toLowerCase().includes("brake"))).toBe(true);
  });

  it("returns nothing rather than guessing when no term matches", () => {
    expect(suggestDestinations(["zzzznotarealterm"])).toEqual([]);
    expect(suggestDestinations([])).toEqual([]);
  });
});
