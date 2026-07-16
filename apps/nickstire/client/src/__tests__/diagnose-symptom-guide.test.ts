/**
 * /diagnose symptom guide — content integrity pins.
 *
 * The guide exists to be the crawlable half of /diagnose and to feed the
 * dedicated problem pages. Two ways that silently rots:
 *   1. A link points at a route that doesn't exist → we ship 404s to Google
 *      from the page we built to earn traffic.
 *   2. The guide's "don't wait on this one" lines drift away from the server's
 *      red-flag rules → a customer reading the page and a customer running the
 *      tool get different answers about whether they can drive the car.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { SYMPTOM_GUIDE_LINKS } from "@/components/diagnose/SymptomGuide";
import { detectRedFlags } from "../../../server/diagnose-safety";

const APP_TSX = path.resolve(__dirname, "../App.tsx");

/** Every route literal registered in App.tsx. */
function appRoutes(): Set<string> {
  const src = fs.readFileSync(APP_TSX, "utf8");
  return new Set((src.match(/"\/[a-z0-9/-]*"/g) ?? []).map((m) => m.replace(/"/g, "")));
}

describe("symptom guide · links", () => {
  it("only links to routes that actually exist", () => {
    const routes = appRoutes();
    const broken = SYMPTOM_GUIDE_LINKS.filter((href) => !routes.has(href));
    expect(broken).toEqual([]);
  });

  it("links somewhere useful for every entry", () => {
    expect(SYMPTOM_GUIDE_LINKS.length).toBeGreaterThanOrEqual(8);
  });

  it("has no duplicate-only linking — spreads across distinct problem pages", () => {
    expect(new Set(SYMPTOM_GUIDE_LINKS).size).toBeGreaterThanOrEqual(8);
  });
});

describe("symptom guide · agrees with the server's safety rules", () => {
  // The guide tells people a flashing light / no brakes / overheating / fuel
  // smell means stop. The tool must reach the same verdict from the same words,
  // or the page contradicts itself.
  const mustFlag: [string, string][] = [
    ["the check engine light is flashing", "flashing-mil"],
    ["brake pedal goes to the floor", "brake-failure"],
    ["the engine is overheating", "overheating"],
    ["it smells like gas", "fuel-leak"],
    ["there is smoke coming from under the hood", "fire-smoke"],
  ];

  it.each(mustFlag)("tool red-flags %j like the guide says it should", (text, id) => {
    expect(detectRedFlags(text).map((f) => f.id)).toContain(id);
  });

  it("agrees that a steady check engine light is NOT a stop-driving event", () => {
    // The guide's whole point on this one is steady-vs-flashing.
    expect(detectRedFlags("my check engine light is on steady")).toEqual([]);
  });
});
