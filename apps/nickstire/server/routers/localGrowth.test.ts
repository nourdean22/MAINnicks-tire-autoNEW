/**
 * localGrowth router (2026-10-25).
 *
 * 1. reviewsHealth reported "5 reviews" since 2026-06-10: it counted
 *    res.reviews.length, and Places Details returns at most 5 reviews. The shop
 *    had 1,715 Google reviews when this was found (live reviews.google read
 *    2026-10-25). The live total is res.totalReviews; "live" means the live path
 *    answered (a real placeId), which the curated fallback never has.
 * 2. competitorSnapshot is the admin read of live competitor ratings: admin
 *    only, and it returns the service result unchanged (the client codes
 *    against that contract).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  reviews: null as unknown,
  snapshot: { ok: false, reason: "error", message: "unset" } as unknown,
}));

vi.mock("../db", () => ({ getDb: async () => null }));
vi.mock("../google-reviews", () => ({ getGoogleReviews: async () => h.reviews }));
vi.mock("../services/competitorMonitor", () => ({ getCompetitorSnapshotCached: async () => h.snapshot }));

import { localGrowthRouter } from "./localGrowth";

function ctx(role: "admin" | "user") {
  return {
    user: {
      id: 1, openId: `${role}-user`, email: `${role}@nickstire.com`, name: role, loginMethod: "manus",
      role, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} },
    res: { clearCookie: () => {} },
  } as never;
}
const caller = (role: "admin" | "user" = "admin") => localGrowthRouter.createCaller(ctx(role));

const ENV_KEYS = ["GOOGLE_MAPS_API_KEY", "GOOGLE_PLACES_API_KEY"];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.GOOGLE_MAPS_API_KEY = "test-key";
  delete process.env.GOOGLE_PLACES_API_KEY;
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const fiveReviews = Array.from({ length: 5 }, (_, i) => ({
  authorName: `a${i}`, rating: 5, text: "t", relativeTime: "1 day ago", time: 1792773427 - i * 86400,
}));

describe("localGrowth.reviewsHealth", () => {
  it("live: reports the real Google total and rating, not the 5 reviews Places returns", async () => {
    h.reviews = { placeId: "ChIJSWRRLdr_MIgRxdlMIMPcqww", totalReviews: 1715, rating: 4.9, reviews: fiveReviews };
    const out = await caller().reviewsHealth();
    expect(out.status).toBe("live");
    expect(out.liveReachable).toBe(true);
    expect(out.liveReviewCount).toBe(1715);
    expect(out.rating).toBe(4.9);
    expect(out.fallbackNote).toBeNull();
  });

  it("fallback (placeId empty): not live, and no fallback number is labelled live", async () => {
    h.reviews = { placeId: "", totalReviews: 1710, rating: 4.9, reviews: [] };
    const out = await caller().reviewsHealth();
    expect(out.status).toBe("fallback");
    expect(out.liveReachable).toBe(false);
    expect(out.liveReviewCount).toBeNull();
    expect(out.rating).toBeNull();
    expect(out.fallbackNote).toMatch(/NOT reachable/);
  });

  it("live with zero returned reviews is still live (control: liveness is the placeId, not the array)", async () => {
    h.reviews = { placeId: "ChIJSWRRLdr_MIgRxdlMIMPcqww", totalReviews: 1715, rating: 4.9, reviews: [] };
    const out = await caller().reviewsHealth();
    expect(out.status).toBe("live");
    expect(out.liveReviewCount).toBe(1715);
  });

  it("no key: unconfigured, no count", async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    h.reviews = { placeId: "ChIJx", totalReviews: 1715, rating: 4.9, reviews: fiveReviews };
    const out = await caller().reviewsHealth();
    expect(out.status).toBe("unconfigured");
    expect(out.liveReviewCount).toBeNull();
    expect(out.rating).toBeNull();
  });
});

describe("localGrowth.competitorSnapshot", () => {
  it("returns the service result unchanged", async () => {
    const result = {
      ok: true, fetchedAt: "2026-10-25T12:00:00.000Z", cacheAgeSeconds: 0,
      nicks: { name: "Nick's Tire & Auto (You)", placeId: "SELF", rating: 4.9, reviewCount: 1715, recent: { count: 0, newestAt: null, oldestAt: null } },
      competitors: [], unresolved: 0, rank: { byRating: 1, byVolume: 1, of: 1 },
    };
    h.snapshot = result;
    expect(await caller().competitorSnapshot()).toEqual(result);
  });

  it("a failed read comes back as ok:false, not an empty list", async () => {
    h.snapshot = { ok: false, reason: "denied", message: "Places API REQUEST_DENIED" };
    expect(await caller().competitorSnapshot()).toEqual(h.snapshot);
  });

  it("is admin only", async () => {
    // The code, not just a throw: "No procedure found" also throws (it passed on the unfixed router).
    await expect(caller("user").competitorSnapshot()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
