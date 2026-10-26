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
 * 3. targetKeywordRanks is the admin read of Search Console position per
 *    tracked keyword (contract localGrowth.targetKeywordRanks v1): admin only,
 *    the pipeline result unchanged.
 * 4. checklist / setChecklistItem are the Website & Local checklist marks (contract
 *    localGrowth.checklist v1): admin only, slug and note validated at the door, and the signed-in
 *    admin recorded as `by` (the house field: email, else name, else openId).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  reviews: null as unknown,
  snapshot: { ok: false, reason: "error", message: "unset" } as unknown,
  ranks: { ok: false, reason: "error", message: "unset" } as unknown,
  checklist: { ok: false, reason: "error", message: "unset" } as unknown,
  setCalls: [] as unknown[],
  // dbAdminProcedure's requireDatabase reads getDbTyped: a truthy handle by default, null for the
  // outage case. getDb stays null so the admin-role read takes its documented missing-row path.
  db: {} as unknown,
}));

vi.mock("../db", () => ({ getDb: async () => null, getDbTyped: async () => h.db }));
vi.mock("../google-reviews", () => ({ getGoogleReviews: async () => h.reviews }));
vi.mock("../services/competitorMonitor", () => ({ getCompetitorSnapshotCached: async () => h.snapshot }));
vi.mock("../pipelines/targetKeywordRanks", () => ({ getTargetKeywordRanks: async () => h.ranks }));
vi.mock("../services/localChecklist", () => ({
  getLocalChecklist: async () => h.checklist,
  setLocalChecklistItem: async (input: { slug: string; checked: boolean }) => {
    h.setCalls.push(input);
    return { ok: true, slug: input.slug, checkedAt: input.checked ? "2026-10-25T16:00:00.000Z" : null };
  },
}));

import { localGrowthRouter } from "./localGrowth";

function ctx(role: "admin" | "user", userOverride: Record<string, unknown> = {}) {
  return {
    user: {
      id: 1, openId: `${role}-user`, email: `${role}@nickstire.com`, name: role, loginMethod: "manus", ...userOverride,
      role, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} },
    res: { clearCookie: () => {} },
  } as never;
}
const caller = (role: "admin" | "user" = "admin", userOverride: Record<string, unknown> = {}) =>
  localGrowthRouter.createCaller(ctx(role, userOverride));

const ENV_KEYS = ["GOOGLE_MAPS_API_KEY", "GOOGLE_PLACES_API_KEY"];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  h.setCalls.length = 0;
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
    h.reviews = { placeId: "ChIJSWRRLdr_MIgRxdlMIMPcqww", totalReviews: 1715, googleTotalReviews: 1715, rating: 4.9, reviews: fiveReviews, lastUpdated: Date.now() };
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
    h.reviews = { placeId: "ChIJSWRRLdr_MIgRxdlMIMPcqww", totalReviews: 1715, googleTotalReviews: 1715, rating: 4.9, reviews: [], lastUpdated: Date.now() };
    const out = await caller().reviewsHealth();
    expect(out.status).toBe("live");
    expect(out.liveReviewCount).toBe(1715);
  });

  // 2026-10-26 audit: totalReviews is resolveReviewDisplay's number, where an admin-entered
  // shop_settings.reviewCount (set in prod since 2026-09-19) wins over Google, so "live reviews
  // reachable (N)" printed the hand-set N. The live count is Google's own user_ratings_total.
  it("live: reports Google's own total, never the admin-entered display number", async () => {
    h.reviews = { placeId: "ChIJSWRRLdr_MIgRxdlMIMPcqww", totalReviews: 1700, googleTotalReviews: 1734, rating: 4.9, reviews: fiveReviews, lastUpdated: Date.now() };
    const out = await caller().reviewsHealth();
    expect(out.liveReachable).toBe(true);
    expect(out.liveReviewCount).toBe(1734);
  });

  // A failed refresh keeps serving the last good read (google-reviews cachedData), placeId and all.
  it("a read older than the cache hour is not live: a failed refresh is serving the old one", async () => {
    h.reviews = { placeId: "ChIJSWRRLdr_MIgRxdlMIMPcqww", totalReviews: 1715, googleTotalReviews: 1715, rating: 4.9, reviews: fiveReviews, lastUpdated: Date.now() - 2 * 60 * 60 * 1000 };
    const out = await caller().reviewsHealth();
    expect(out.liveReachable).toBe(false);
    expect(out.liveReviewCount).toBeNull();
    expect(out.status).toBe("fallback");
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

describe("localGrowth.targetKeywordRanks", () => {
  it("returns the pipeline result unchanged", async () => {
    const result = {
      ok: true, latestDate: "2026-10-23", staleDays: 2,
      window: { current: { from: "2026-09-26", to: "2026-10-23" }, previous: { from: "2026-08-29", to: "2026-09-25" } },
      keywords: [{
        keyword: "used tires Cleveland", group: "tires", current: { impressions: 135, clicks: 0, position: 6.5 },
        previous: { impressions: 90, clicks: 1, position: 9.1 }, seenIn90Days: true, change: 2.6, action: "review_snippet",
      }],
      totals: { impressions28d: 57361, distinctQueries28d: 5897 },
    };
    h.ranks = result;
    expect(await caller().targetKeywordRanks()).toEqual(result);
  });

  it("an unmeasured table comes back as ok:false, not an empty list", async () => {
    h.ranks = { ok: false, reason: "unmeasured", message: "No Search Console rows stored yet." };
    expect(await caller().targetKeywordRanks()).toEqual(h.ranks);
  });

  it("is admin only", async () => {
    await expect(caller("user").targetKeywordRanks()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("localGrowth.checklist", () => {
  it("returns the service result unchanged", async () => {
    const result = {
      ok: true, skipped: 0,
      items: { "entity-yelp": { checkedAt: "2026-10-20T14:00:00.000Z", note: null, by: "nour" } },
    };
    h.checklist = result;
    expect(await caller().checklist()).toEqual(result);
  });

  it("a failed read comes back as ok:false, not an empty map", async () => {
    h.checklist = { ok: false, reason: "error", message: "Database unavailable" };
    expect(await caller().checklist()).toEqual(h.checklist);
  });

  it("is admin only", async () => {
    await expect(caller("user").checklist()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("a dead database handle is SERVICE_UNAVAILABLE at the router, never a result (dbAdminProcedure, ROS-083)", async () => {
    h.db = null;
    try {
      await expect(caller().checklist()).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
      await expect(caller().setChecklistItem({ slug: "entity-yelp", checked: true })).rejects.toMatchObject({
        code: "SERVICE_UNAVAILABLE",
      });
      expect(h.setCalls).toEqual([]);
    } finally {
      h.db = {};
    }
  });
});

describe("localGrowth.setChecklistItem", () => {
  it("passes slug, checked and note through and records the signed-in admin's email as by", async () => {
    const out = await caller().setChecklistItem({ slug: "entity-yelp", checked: true, note: "claimed" });
    expect(out).toEqual({ ok: true, slug: "entity-yelp", checkedAt: "2026-10-25T16:00:00.000Z" });
    expect(h.setCalls).toEqual([{ slug: "entity-yelp", checked: true, note: "claimed", by: "admin@nickstire.com" }]);
  });

  it("by falls back to the name, then the openId, when there is no email", async () => {
    await caller("admin", { email: null }).setChecklistItem({ slug: "a", checked: true });
    await caller("admin", { email: null, name: null }).setChecklistItem({ slug: "a", checked: true });
    expect(h.setCalls.map((c) => (c as { by: string }).by)).toEqual(["admin", "admin-user"]);
  });

  it("unchecking passes checked:false through", async () => {
    const out = await caller().setChecklistItem({ slug: "entity-yelp", checked: false });
    expect(out).toEqual({ ok: true, slug: "entity-yelp", checkedAt: null });
    expect(h.setCalls[0]).toMatchObject({ slug: "entity-yelp", checked: false });
  });

  it("slug length: 1 and 60 pass, 0 and 61 are rejected (cap-1, cap, cap+1)", async () => {
    await expect(caller().setChecklistItem({ slug: "a", checked: true })).resolves.toMatchObject({ ok: true });
    await expect(caller().setChecklistItem({ slug: "a".repeat(59), checked: true })).resolves.toMatchObject({ ok: true });
    await expect(caller().setChecklistItem({ slug: "a".repeat(60), checked: true })).resolves.toMatchObject({ ok: true });
    await expect(caller().setChecklistItem({ slug: "a".repeat(61), checked: true })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller().setChecklistItem({ slug: "", checked: true })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(h.setCalls).toHaveLength(3);
  });

  it.each([
    ["a space", "entity yelp"],
    ["an uppercase letter", "Entity-yelp"],
    ["a colon (would escape the namespace)", "entity:yelp"],
    ["an underscore", "entity_yelp"],
    ["a percent (LIKE wildcard)", "entity%"],
    ["a slash", "entity/yelp"],
    ["a trailing newline", "entity-yelp\n"],
    ["a bad char last at the cap", `${"a".repeat(59)} `],
    ["a non-ASCII letter", `entit${String.fromCharCode(233)}`],
  ])("rejects a slug with %s and writes nothing", async (_label, slug) => {
    await expect(caller().setChecklistItem({ slug, checked: true })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(h.setCalls).toHaveLength(0);
  });

  it("note length: 300 passes, 301 is rejected; null and omitted pass", async () => {
    await expect(caller().setChecklistItem({ slug: "a", checked: true, note: "n".repeat(300) })).resolves.toMatchObject({ ok: true });
    await expect(caller().setChecklistItem({ slug: "a", checked: true, note: null })).resolves.toMatchObject({ ok: true });
    await expect(caller().setChecklistItem({ slug: "a", checked: true, note: "n".repeat(301) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(h.setCalls).toHaveLength(2);
  });

  it("is admin only, and a refused caller writes nothing", async () => {
    await expect(caller("user").setChecklistItem({ slug: "entity-yelp", checked: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(h.setCalls).toHaveLength(0);
  });
});
