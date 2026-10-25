/**
 * getCompetitorSnapshotCached: the admin Competitors tab's one read of live
 * Google ratings (2026-10-25, contract localGrowth.competitorSnapshot v1).
 *
 * Google Maps Platform terms allow storing place_id, not ratings, counts or
 * reviews, and forbid pre-fetching. So the read happens on demand, lives only
 * in process memory for 60 minutes, and a failed read is ok:false, never an
 * ok:true with empty arrays. Drives the real service with the Places HTTP API
 * stubbed (harness from competitorMonitorSelfMatch.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  inserts: [] as Record<string, unknown>[],
  logs: [] as string[],
  throwOnInfo: false,
}));

vi.mock("./db", () => ({
  getDb: async () => ({
    select: () => ({ from: () => ({ where: () => ({ orderBy: async () => [] }) }) }),
    insert: () => ({
      values: async (v: Record<string, unknown>[]) => {
        h.inserts.push(...v);
      },
    }),
  }),
}));

vi.mock("./lib/logger", () => ({
  createLogger: () => {
    const rec = (msg: unknown, ...args: unknown[]) => {
      h.logs.push(JSON.stringify([msg, ...args]));
    };
    return {
      debug: rec,
      warn: rec,
      error: rec,
      info: (msg: unknown, ...args: unknown[]) => {
        if (h.throwOnInfo) throw new Error("boom in snapshot");
        rec(msg, ...args);
      },
    };
  },
}));

const ENV_KEYS = ["GOOGLE_PLACES_API_KEY", "GOOGLE_MAPS_API_KEY", "GOOGLE_PLACE_ID"];
const saved: Record<string, string | undefined> = {};
const SHARED_PLACE_ID = "ChIJSWRRLdr_MIgRxdlMIMPcqww";
// Two review times, deliberately oldest first: newest/oldest must come from the values.
const T_OLD = 1792595012;
const T_NEW = 1792773427;

let mode: "ok" | "denied" | "down" = "ok";
const urls: string[] = [];

function stubPlaces(selfId: string) {
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = String(input);
    urls.push(url);
    if (mode === "down") return new Response("{}", { status: 500 });
    if (mode === "denied") return new Response(JSON.stringify({ status: "REQUEST_DENIED", error_message: "key rejected" }));
    if (url.includes("findplacefromtext")) {
      const q = new URL(url).searchParams.get("input") ?? "";
      const place_id = /midas/i.test(q) ? selfId : `place:${q}`;
      return new Response(JSON.stringify({ status: "OK", candidates: [{ place_id, name: q }] }));
    }
    if (url.includes("/details/")) {
      const id = new URL(url).searchParams.get("place_id") ?? "";
      const self = id === selfId;
      return new Response(
        JSON.stringify({
          status: "OK",
          result: {
            name: "x",
            rating: self ? 4.9 : 4.3,
            user_ratings_total: self ? 1715 : 321,
            reviews: [
              { author_name: "Pat Q", text: "Great tire work", rating: 5, time: T_OLD },
              { author_name: "Lee R", text: "Fast", rating: 4, time: T_NEW },
            ],
          },
        }),
      );
    }
    return new Response("{}", { status: 404 });
  });
}

beforeEach(() => {
  h.inserts.length = 0;
  h.logs.length = 0;
  h.throwOnInfo = false;
  urls.length = 0;
  mode = "ok";
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.GOOGLE_PLACES_API_KEY = "test-key";
  delete process.env.GOOGLE_MAPS_API_KEY;
  process.env.GOOGLE_PLACE_ID = "SELF";
  vi.resetModules();
  stubPlaces("SELF");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

async function load() {
  return import("./services/competitorMonitor");
}

describe("getCompetitorSnapshotCached: the contract", () => {
  it("returns Nick's separately, every competitor with its group and recent-review window", async () => {
    const { getCompetitorSnapshotCached } = await load();
    const out = await getCompetitorSnapshotCached();
    if (!out.ok) throw new Error(`expected ok, got ${out.reason}: ${out.message}`);

    expect(Number.isNaN(Date.parse(out.fetchedAt))).toBe(false);
    expect(out.cacheAgeSeconds).toBe(0);
    expect(out.nicks).toEqual({
      name: "Nick's Tire & Auto (You)",
      placeId: "SELF",
      rating: 4.9,
      reviewCount: 1715,
      recent: { count: 2, newestAt: new Date(T_NEW * 1000).toISOString(), oldestAt: new Date(T_OLD * 1000).toISOString() },
    });
    // Midas resolves to our own listing (measured 2026-09-23) and is dropped, not filed as a competitor.
    expect(out.unresolved).toBe(1);
    expect(out.competitors).toHaveLength(14);
    expect(out.competitors.some((c) => c.placeId === "SELF")).toBe(false);
    for (const c of out.competitors) {
      expect(Object.keys(c).sort()).toEqual(["group", "name", "placeId", "rating", "recent", "reviewCount"]);
      expect(c.recent.count).toBe(2);
    }
    const group = (prefix: string) => out.competitors.find((c) => c.name.startsWith(prefix))?.group;
    expect(group("Moe's Tire Center")).toBe("local");
    expect(group("St.Clair Tire")).toBe("local");
    expect(group("Bro's Tires")).toBe("local");
    expect(group("EJ'S Tire")).toBe("local");
    expect(group("Confident Tire")).toBe("local");
    expect(group("Euclid Tire")).toBe("local");
    expect(group("Pep Boys")).toBe("chain");
    expect(group("NTB")).toBe("chain");
    expect(out.competitors.filter((c) => c.group === "local")).toHaveLength(6);
    // Nick's 4.9 / 1715 beats every competitor's 4.3 / 321.
    expect(out.rank).toEqual({ byRating: 1, byVolume: 1, of: 15 });
  });

  it("asks Places for the newest reviews (the consumer of recent is the request itself)", async () => {
    const { getCompetitorSnapshotCached } = await load();
    await getCompetitorSnapshotCached();
    const details = urls.filter((u) => u.includes("/details/"));
    expect(details.length).toBeGreaterThan(0);
    for (const u of details) {
      const p = new URL(u).searchParams;
      expect(p.get("fields")?.split(",")).toContain("reviews");
      expect(p.get("reviews_sort")).toBe("newest");
    }
  });

  it("carries no review text or author names, and stores and logs no rating, count or review time", async () => {
    const { getCompetitorSnapshotCached } = await load();
    const out = await getCompetitorSnapshotCached();
    const body = JSON.stringify(out);
    expect(body).not.toContain("Pat Q");
    expect(body).not.toContain("Great tire work");
    // place_ids may be stored (allowed); nothing else.
    expect(h.inserts.length).toBeGreaterThan(0);
    for (const row of h.inserts) expect(Object.keys(row).sort()).toEqual(["capturedAt", "competitorName", "placeId", "source"]);
    const logs = h.logs.join("\n");
    for (const v of ["4.9", "4.3", "1715", "321", String(T_NEW), String(T_OLD)]) expect(logs).not.toContain(v);
  });

  it("falls back to the shared Google place id when GOOGLE_PLACE_ID is unset", async () => {
    delete process.env.GOOGLE_PLACE_ID;
    stubPlaces(SHARED_PLACE_ID);
    const { getCompetitorSnapshotCached } = await load();
    const out = await getCompetitorSnapshotCached();
    if (!out.ok) throw new Error(`expected ok, got ${out.reason}`);
    expect(out.nicks?.placeId).toBe(SHARED_PLACE_ID);
    // the self-match guard fires on the shared id too
    expect(out.competitors.some((c) => c.placeId === SHARED_PLACE_ID)).toBe(false);
    expect(out.rank).not.toBeNull();
  });
});

describe("getCompetitorSnapshotCached: the 60-minute memory cache", () => {
  it("a second read inside 60 minutes does not call Google; after 60 minutes it does", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-25T12:00:00Z"));
    const { getCompetitorSnapshotCached } = await load();
    const first = await getCompetitorSnapshotCached();
    const callsAfterFirst = urls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    vi.setSystemTime(new Date("2026-10-25T12:59:00Z"));
    const second = await getCompetitorSnapshotCached();
    expect(urls.length).toBe(callsAfterFirst);
    if (!first.ok || !second.ok) throw new Error("expected ok");
    expect(second.fetchedAt).toBe(first.fetchedAt);
    expect(second.cacheAgeSeconds).toBe(59 * 60);

    vi.setSystemTime(new Date("2026-10-25T13:00:01Z"));
    const third = await getCompetitorSnapshotCached();
    expect(urls.length).toBeGreaterThan(callsAfterFirst);
    if (!third.ok) throw new Error("expected ok");
    expect(third.cacheAgeSeconds).toBe(0);
  });

  it("a failed read is not cached: the next read tries Google again", async () => {
    mode = "denied";
    const { getCompetitorSnapshotCached } = await load();
    expect((await getCompetitorSnapshotCached()).ok).toBe(false);
    mode = "ok";
    expect((await getCompetitorSnapshotCached()).ok).toBe(true);
  });
});

describe("getCompetitorSnapshotCached: honest failures", () => {
  it("no API key: unconfigured", async () => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    const { getCompetitorSnapshotCached } = await load();
    const out = await getCompetitorSnapshotCached();
    expect(out).toMatchObject({ ok: false, reason: "unconfigured" });
    expect(urls).toEqual([]);
  });

  it("Places REQUEST_DENIED inside a 200 body: denied with the status, never ok:true with empty arrays", async () => {
    mode = "denied";
    const { getCompetitorSnapshotCached } = await load();
    const out = await getCompetitorSnapshotCached();
    expect(out).toMatchObject({ ok: false, reason: "denied" });
    if (out.ok) throw new Error("unreachable");
    expect(out.message).toContain("REQUEST_DENIED");
    expect(out.message).not.toContain("test-key");
  });

  it("our own row read, then the key is rejected for every competitor: denied, not ok:true with no competitors", async () => {
    let first = true;
    vi.stubGlobal("fetch", async (input: string | URL) => {
      urls.push(String(input));
      if (first) {
        first = false;
        return new Response(JSON.stringify({ status: "OK", result: { name: "x", rating: 4.9, user_ratings_total: 1715 } }));
      }
      return new Response(JSON.stringify({ status: "OVER_QUERY_LIMIT" }));
    });
    const { getCompetitorSnapshotCached } = await load();
    const out = await getCompetitorSnapshotCached();
    expect(out).toMatchObject({ ok: false, reason: "denied" });
    if (out.ok) throw new Error("unreachable");
    expect(out.message).toContain("OVER_QUERY_LIMIT");
  });

  it("Places unreachable (HTTP 500, no status): error, never ok:true with empty arrays", async () => {
    mode = "down";
    const { getCompetitorSnapshotCached } = await load();
    const out = await getCompetitorSnapshotCached();
    expect(out).toMatchObject({ ok: false, reason: "error" });
  });

  it("a thrown error: error with its message", async () => {
    h.throwOnInfo = true;
    const { getCompetitorSnapshotCached } = await load();
    const out = await getCompetitorSnapshotCached();
    expect(out).toEqual({ ok: false, reason: "error", message: "boom in snapshot" });
  });
});
