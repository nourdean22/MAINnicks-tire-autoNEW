/**
 * A competitor query that resolves to OUR OWN Google listing is never stored
 * as a competitor.
 *
 * Measured in production 2026-09-23 (read-only probe of competitor_snapshots):
 * "Midas (Euclid Ave)" had resolved to Nick's own place_id for 45 snapshots,
 * so Nick's 1,715 reviews sat in the table under a competitor's name — and any
 * "most reviewed nearby" reading of that table (docs/recruiting/
 * workload-evidence.sql query 5) would have shown a competitor tied with Nick's.
 *
 * Drives the real fetchCompetitorSnapshot with the Places HTTP API stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ getDb: async () => null }));

const ENV_KEYS = ["GOOGLE_PLACES_API_KEY", "GOOGLE_MAPS_API_KEY", "GOOGLE_PLACE_ID"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.GOOGLE_PLACES_API_KEY = "test-key";
  process.env.GOOGLE_PLACE_ID = "SELF";
  vi.resetModules();
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = String(input);
    if (url.includes("findplacefromtext")) {
      const q = new URL(url).searchParams.get("input") ?? "";
      // Midas resolves to us, as measured; every other query to its own place.
      const place_id = /midas/i.test(q) ? "SELF" : `place:${q}`;
      return new Response(JSON.stringify({ status: "OK", candidates: [{ place_id, name: q }] }));
    }
    if (url.includes("/details/")) {
      return new Response(JSON.stringify({ status: "OK", result: { name: "x", rating: 4.5, user_ratings_total: 100 } }));
    }
    return new Response("{}", { status: 404 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("competitor snapshot never files us as a competitor", () => {
  it("a query that resolves to our own place is dropped; ours appears once, as ours", async () => {
    const { fetchCompetitorSnapshot } = await import("./services/competitorMonitor");
    const rows = await fetchCompetitorSnapshot();
    expect(rows.filter((r) => r.placeId === "SELF").map((r) => r.name)).toEqual(["Nick's Tire & Auto (You)"]);
    expect(rows.some((r) => r.name.startsWith("Midas"))).toBe(false);
    // control: every other competitor still resolves and is kept
    expect(rows.length).toBeGreaterThan(10);
  });
});
