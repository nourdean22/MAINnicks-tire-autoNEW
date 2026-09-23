/**
 * Q-48 · Google Places content is read on demand, never stored — place_id is.
 *
 * Google Maps Platform Terms (cloud.google.com/maps-platform/terms, "No
 * Caching"): "Customer will not cache Google Maps Content except as expressly
 * permitted under the Maps Service Specific Terms." The Service Specific Terms
 * permit caching place_id ("Google ID Caching") and, for the Places API, only
 * latitude/longitude for 30 days (section 14.3). Rating, userRatingCount and
 * review text have no carve-out.
 *
 * Before this change three paths persisted Places content:
 *   - competitorMonitor.runCompetitorMonitorCycle -> competitor_snapshots
 *     (rating + review_count, source "google_places", one row per competitor/day)
 *   - google-reviews.getGoogleReviews -> shop_settings reviewCount/reviewRating
 *     (updatedBy "system_sync")
 *   - cron/jobs/reviewMonitor -> the same shop_settings copy
 *
 * Every DB write goes through a spy. The spy never answers a read with rows, so
 * every assertion is about what the changed code WRITES.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Write = { op: "insert" | "update"; table: unknown; values: Record<string, unknown> };
const writes: Write[] = [];

/** A drizzle-shaped chain: every builder method returns the chain; awaiting it yields []. */
function chain(): unknown {
  const target = {
    then: (resolve: (v: unknown[]) => unknown) => resolve([]),
  };
  return new Proxy(target, {
    get(t, prop) {
      if (prop === "then") return t.then;
      return () => chain();
    },
  });
}

const fakeDb = {
  select: () => chain(),
  insert: (table: unknown) => ({
    values: async (v: Record<string, unknown> | Record<string, unknown>[]) => {
      for (const row of Array.isArray(v) ? v : [v]) writes.push({ op: "insert", table, values: row });
      return [{ affectedRows: 1 }];
    },
  }),
  update: (table: unknown) => ({
    set: (v: Record<string, unknown>) => {
      writes.push({ op: "update", table, values: v });
      return chain();
    },
  }),
  execute: async () => [[], []],
};

vi.mock("./db", () => ({ getDb: async () => fakeDb }));
vi.mock("./services/eventBus", () => ({ dispatch: async () => undefined }));

const ENV_KEYS = ["GOOGLE_PLACES_API_KEY", "GOOGLE_MAPS_API_KEY", "GOOGLE_PLACE_ID"];
const saved: Record<string, string | undefined> = {};

const PLACES_CONTENT_KEYS = ["rating", "reviewCount", "rawPayload", "value"];

beforeEach(() => {
  writes.length = 0;
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.GOOGLE_PLACES_API_KEY = "test-key";
  process.env.GOOGLE_MAPS_API_KEY = "test-key";
  process.env.GOOGLE_PLACE_ID = "SELF";
  vi.resetModules();
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = String(input);
    if (url.includes("findplacefromtext")) {
      const q = new URL(url).searchParams.get("input") ?? "";
      return new Response(JSON.stringify({ status: "OK", candidates: [{ place_id: `place:${q}`, name: q }] }));
    }
    if (url.includes("/details/")) {
      return new Response(
        JSON.stringify({
          status: "OK",
          result: {
            name: "Some Shop",
            rating: 4.7,
            user_ratings_total: 1234,
            reviews: [{ author_name: "Pat Q", rating: 5, text: "Great tire work", time: 1790000000 }],
          },
        }),
      );
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

function placesContentIn(table: unknown): Write[] {
  return writes.filter(
    (w) => w.table === table && PLACES_CONTENT_KEYS.some((k) => w.values[k] !== undefined),
  );
}

describe("competitor monitor", () => {
  it("the daily cycle stores place_id only — no rating, no review count", async () => {
    const { competitorSnapshots } = await import("../drizzle/schema");
    const { runCompetitorMonitorCycle } = await import("./services/competitorMonitor");
    await runCompetitorMonitorCycle();

    const rows = writes.filter((w) => w.table === competitorSnapshots);
    expect(rows.length).toBeGreaterThan(10); // place_id is still stored
    expect(rows.every((r) => typeof r.values.placeId === "string" && r.values.placeId !== "")).toBe(true);
    expect(placesContentIn(competitorSnapshots)).toEqual([]);
  });

  it("an on-demand read returns live ratings and writes none of them", async () => {
    const { competitorSnapshots } = await import("../drizzle/schema");
    const { fetchCompetitorSnapshot } = await import("./services/competitorMonitor");
    const data = await fetchCompetitorSnapshot();

    expect(data.length).toBeGreaterThan(10);
    expect(data.every((d) => d.rating === 4.7 && d.reviewCount === 1234)).toBe(true);
    expect(placesContentIn(competitorSnapshots)).toEqual([]);
    // the place_ids it resolved are kept (allowed), so the next read skips the lookup
    expect(writes.filter((w) => w.table === competitorSnapshots).length).toBeGreaterThan(10);
  });
});

describe("public rating (google-reviews)", () => {
  it("returns live rating, count and reviews without copying them into shop_settings", async () => {
    const { shopSettings } = await import("../drizzle/schema");
    const { getGoogleReviews } = await import("./google-reviews");
    const data = await getGoogleReviews();
    await new Promise((r) => setTimeout(r, 100)); // let any fire-and-forget write land

    expect(data?.rating).toBe(4.7);
    expect(data?.reviews[0]?.text).toBe("Great tire work");
    expect(writes.filter((w) => w.table === shopSettings)).toEqual([]);
  });
});

describe("review monitor cron", () => {
  it("does not copy the Places rating or count into shop_settings", async () => {
    const { shopSettings } = await import("../drizzle/schema");
    const { processReviewMonitor } = await import("./cron/jobs/reviewMonitor");
    await processReviewMonitor();

    expect(writes.filter((w) => w.table === shopSettings)).toEqual([]);
  });
});
