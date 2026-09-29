import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * syncInstagramPosts source-selection regression tests (audit WS1).
 *
 * The pipeline read ONLY instagram-cache.json — a file with no writer — so it
 * processed zero rows forever while reporting success. These tests pin the
 * fix: live Graph first, cache fallback, and a LOUD explicit `source` so a
 * starved pipeline can never look healthy again.
 *
 * Boundaries mocked: db-helper (insert/update capture), the cache module
 * (../instagram), the LLM (throws — scoring must degrade, not block), and
 * global fetch (Graph). metaSocial is REAL — its request/mapping code is
 * under test too.
 */
const { insertValues, updateSet, selectQueue, cachePosts, cacheAccount, writeInstagramCache, database } = vi.hoisted(() => {
  const insertValues = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn((_values: Record<string, unknown>) => ({ where: () => Promise.resolve([{ affectedRows: 1 }, []]) }));
  const selectQueue: unknown[][] = [];
  function makeSelectChain(): Record<string, unknown> {
    const chain: Record<string, unknown> = {};
    for (const m of ["from", "where", "orderBy", "groupBy"]) chain[m] = () => chain;
    chain.limit = () => Promise.resolve(selectQueue.shift() ?? []);
    chain.then = (resolve: (v: unknown) => void) => resolve(selectQueue.shift() ?? []);
    return chain;
  }
  const database = {
    insert: () => ({ values: insertValues }),
    select: () => makeSelectChain(),
    update: () => ({ set: updateSet }),
  };
  return {
    insertValues,
    updateSet,
    selectQueue,
    database,
    cachePosts: vi.fn<() => unknown[]>(() => []),
    cacheAccount: vi.fn<() => unknown>(() => null),
    writeInstagramCache: vi.fn().mockResolvedValue(true),
  };
});

vi.mock("./lib/db-helper", () => ({
  db: async () => database,
  dbTyped: async () => database,
  requireDb: async () => database,
}));

vi.mock("./instagram", () => ({
  getInstagramPosts: async (limit: number) => cachePosts().slice(0, limit),
  getInstagramAccount: async () => cacheAccount(),
  writeInstagramCache,
}));

// Scoring must DEGRADE without a provider (score 5), never block the insert.
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn(async () => {
    throw new Error("no LLM provider in tests");
  }),
}));

import { syncInstagramPosts } from "./pipelines/instagram-data";

// Old timestamp → the per-post insights refresh (14-day window) is skipped,
// keeping these tests off the insights endpoint entirely.
const OLD_TS = "2026-01-01T12:00:00+0000";

const GRAPH_MEDIA = {
  data: [
    {
      id: "graph_post_1",
      media_type: "IMAGE",
      caption: "Pothole season is here Cleveland",
      permalink: "https://instagram.com/p/abc",
      like_count: 12,
      comments_count: 3,
      timestamp: OLD_TS,
      media_url: "https://cdn.example.com/1.jpg",
    },
    {
      id: "graph_post_2",
      media_type: "CAROUSEL_ALBUM",
      caption: "Five signs your brakes are done",
      permalink: "https://instagram.com/p/def",
      like_count: 40,
      comments_count: 10,
      timestamp: OLD_TS,
    },
  ],
};
const GRAPH_ACCOUNT = { username: "nickstire", name: "Nick's Tire", followers_count: 500, media_count: 90 };

function stubGraph(opts: { mediaStatus?: number; accountStatus?: number } = {}) {
  const mock = vi.fn(async (url: string) => {
    const isMediaList = url.includes("/media?fields=");
    const status = isMediaList ? (opts.mediaStatus ?? 200) : (opts.accountStatus ?? 200);
    const body = status !== 200
      ? { error: { message: "Error validating access token" } }
      : isMediaList
        ? GRAPH_MEDIA
        : GRAPH_ACCOUNT;
    return { ok: status === 200, status, json: async () => body };
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

beforeEach(() => {
  insertValues.mockClear();
  updateSet.mockClear();
  writeInstagramCache.mockClear();
  selectQueue.length = 0;
  cachePosts.mockReturnValue([]);
  cacheAccount.mockReturnValue(null);
  vi.stubEnv("META_PAGE_ACCESS_TOKEN", "test-token");
  vi.stubEnv("META_IG_USER_ID", "1789");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("syncInstagramPosts source selection", () => {
  it("prefers the live Graph: inserts real media rows and reports source=graph", async () => {
    stubGraph();
    selectQueue.push([], []); // existing-row lookups for both posts → none
    const res = await syncInstagramPosts();

    expect(res.source).toBe("graph");
    expect(res.processed).toBe(2);
    expect(res.newPosts).toBe(2);
    expect(res.errors).toBe(0);

    // Since 0106 the sync writes TWO lanes per post: the analytics row and an
    // append-only metric snapshot. engagementRate exists only on analytics
    // rows, so it is the discriminator.
    const rows = insertValues.mock.calls.map(([v]: [Record<string, unknown>]) => v);
    const analyticsRows = rows.filter((r) => "engagementRate" in r);
    const snapshotRows = rows.filter((r) => !("engagementRate" in r));
    expect(analyticsRows.map((r) => r.postId)).toEqual(["graph_post_1", "graph_post_2"]);
    expect(analyticsRows[0].likes).toBe(12);
    expect(analyticsRows[0].postType).toBe("IMAGE");
    // followers from the live profile drive the rate: (12+3)/500*10000 = 300
    expect(analyticsRows[0].engagementRate).toBe(300);
    // LLM was down → degraded default score, not a dropped row
    expect(analyticsRows[0].contentScore).toBe(5);
    // The snapshot lane wrote one history row per post and the result says so —
    // a non-empty sync with snapshotsWritten=0 is the silent-IDLE class.
    expect(snapshotRows.map((r) => r.postId)).toEqual(["graph_post_1", "graph_post_2"]);
    expect(res.snapshotsWritten).toBe(2);
    expect(res.snapshotErrors).toBe(0);
  });

  it("heals the JSON cache after a Graph fetch so cache readers serve real data", async () => {
    stubGraph();
    selectQueue.push([], []);
    await syncInstagramPosts();

    expect(writeInstagramCache).toHaveBeenCalledTimes(1);
    const [posts, account] = writeInstagramCache.mock.calls[0];
    expect(posts).toHaveLength(2);
    expect(account?.followers).toBe(500);
  });

  // F10 (2026-09-29): the non-Graph source is a copy (file cache) or not an
  // observation at all (the DB stand-in fallback on a fresh container). It is
  // reported, never written: no analytics insert, no update, no snapshot.
  it("reports source=cache but writes NOTHING when the Graph rejects the token", async () => {
    stubGraph({ mediaStatus: 401 });
    cachePosts.mockReturnValue([
      { id: "cache_post", type: "IMAGE", caption: "old cached post", link: "", likes: 5, comments: 1, posted: OLD_TS },
    ]);
    cacheAccount.mockReturnValue({ followers: 100 });
    selectQueue.push([]);

    const res = await syncInstagramPosts();
    expect(res.source).toBe("cache");
    expect(res.processed).toBe(0);
    expect(res.newPosts).toBe(0);
    expect(res.snapshotsWritten).toBe(0);
    expect(insertValues).not.toHaveBeenCalled();
    expect(updateSet).not.toHaveBeenCalled();
    expect(writeInstagramCache).not.toHaveBeenCalled();
  });

  it("Graph down + no cache file: DB-fallback stand-in posts insert no analytics row and no snapshot", async () => {
    stubGraph({ mediaStatus: 500 });
    // What getInstagramPostsFromDb returns on a fresh container: one row keyed by
    // a social_content_inventory id (no igPostId) with defaulted 0 metrics, and
    // one real media id whose metrics are copies of the stored row.
    cachePosts.mockReturnValue([
      { id: "inv_42", type: "VIDEO", caption: "stand-in reel", link: "", likes: 0, comments: 0, posted: OLD_TS, mediaProductType: "REELS" },
      { id: "graph_post_1", type: "IMAGE", caption: "stored post", link: "", likes: 12, comments: 3, posted: OLD_TS, mediaProductType: "FEED" },
    ]);
    cacheAccount.mockReturnValue(null); // no cache file -> no account
    selectQueue.push([], []);

    const res = await syncInstagramPosts();
    expect(res.source).not.toBe("graph");
    expect(res.processed).toBe(0);
    expect(insertValues).not.toHaveBeenCalled(); // neither instagram_analytics nor ig_metric_snapshots
    expect(updateSet).not.toHaveBeenCalled();
  });

  it("Graph down: an already-tracked row keeps its engagementRate/followerSnapshot (no zero overwrite)", async () => {
    stubGraph({ mediaStatus: 500 });
    cachePosts.mockReturnValue([
      { id: "graph_post_1", type: "IMAGE", caption: "stored post", link: "", likes: 12, comments: 3, posted: OLD_TS },
    ]);
    cacheAccount.mockReturnValue(null);
    selectQueue.push([{ id: 7 }]); // already tracked

    await syncInstagramPosts();
    expect(updateSet).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("Graph media up but follower count unknown: update omits engagementRate/followerSnapshot, new post is deferred", async () => {
    stubGraph({ accountStatus: 500 });
    cacheAccount.mockReturnValue(null);
    selectQueue.push([{ id: 7 }], []); // post 1 tracked, post 2 new

    const res = await syncInstagramPosts();
    expect(res.source).toBe("graph");
    expect(updateSet).toHaveBeenCalledTimes(1);
    const set = updateSet.mock.calls[0][0];
    expect(set.likes).toBe(12);
    expect(set).not.toHaveProperty("engagementRate");
    expect(set).not.toHaveProperty("followerSnapshot");
    const rows = insertValues.mock.calls.map(([v]: [Record<string, unknown>]) => v);
    // No analytics row with a fabricated 0 rate; the snapshot for the tracked
    // post still lands, with followerSnapshot null (unknown), never 0.
    expect(rows.filter((r) => "engagementRate" in r)).toEqual([]);
    expect(rows.map((r) => r.postId)).toEqual(["graph_post_1"]);
    expect(rows[0].followerSnapshot).toBeNull();
    expect(res.newPosts).toBe(0);
  });

  it("positive control: Graph up refreshes a tracked row with live rate + follower count and snapshots it", async () => {
    stubGraph();
    selectQueue.push([{ id: 7 }], [{ id: 8 }]);

    const res = await syncInstagramPosts();
    expect(res.source).toBe("graph");
    expect(res.processed).toBe(2);
    expect(updateSet).toHaveBeenCalledTimes(2);
    expect(updateSet.mock.calls[0][0]).toMatchObject({ likes: 12, comments: 3, engagementRate: 300, followerSnapshot: 500 });
    expect(res.snapshotsWritten).toBe(2);
  });

  it("reports source=none (not success) when Graph is down and the cache is empty", async () => {
    stubGraph({ mediaStatus: 401 });
    const res = await syncInstagramPosts();

    expect(res.source).toBe("none");
    expect(res.processed).toBe(0);
    expect(res.newPosts).toBe(0);
    expect(insertValues).not.toHaveBeenCalled();
  });
});
