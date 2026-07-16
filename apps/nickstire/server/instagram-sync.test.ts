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
const { insertValues, selectQueue, cachePosts, cacheAccount, writeInstagramCache, database } = vi.hoisted(() => {
  const insertValues = vi.fn().mockResolvedValue(undefined);
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
    update: () => ({ set: () => ({ where: () => Promise.resolve([{ affectedRows: 1 }, []]) }) }),
  };
  return {
    insertValues,
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

    const rows = insertValues.mock.calls.map(([v]: [Record<string, unknown>]) => v);
    expect(rows.map((r) => r.postId)).toEqual(["graph_post_1", "graph_post_2"]);
    expect(rows[0].likes).toBe(12);
    expect(rows[0].postType).toBe("IMAGE");
    // followers from the live profile drive the rate: (12+3)/500*10000 = 300
    expect(rows[0].engagementRate).toBe(300);
    // LLM was down → degraded default score, not a dropped row
    expect(rows[0].contentScore).toBe(5);
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

  it("falls back to the cache when the Graph rejects the token (source=cache)", async () => {
    stubGraph({ mediaStatus: 401 });
    cachePosts.mockReturnValue([
      { id: "cache_post", type: "IMAGE", caption: "old cached post", link: "", likes: 5, comments: 1, posted: OLD_TS },
    ]);
    cacheAccount.mockReturnValue({ followers: 100 });
    selectQueue.push([]);

    const res = await syncInstagramPosts();
    expect(res.source).toBe("cache");
    expect(res.processed).toBe(1);
    expect(insertValues.mock.calls[0][0].postId).toBe("cache_post");
    expect(writeInstagramCache).not.toHaveBeenCalled();
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
