/**
 * The nightly Facebook REEL numbers lane, driven through the REAL nightly entry (`syncInstagramPosts`).
 * Reel numbers land in ig_metric_snapshots under the `fb:` prefix, keyed by the reel's VIDEO id (a reel's
 * post_id cannot be read back: Meta #12). Candidates come from the publish ledger
 * (`findPublishedFacebookReelVideoIds`), the one place the three publish doors store the video id.
 *
 * Going through the nightly entry is the consumer check: a lane that is built and tested but never called
 * by the nightly sync does nothing, so every case here also proves the entry reaches it.
 *
 * Positive controls: a row is written only when reactions AND comments were read (both NOT NULL: never a
 * fabricated 0) while a MEASURED zero is written as zero; a failed candidate read is one counted error and
 * makes no Graph call.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { insertValues, selectQueue, database, fetchFacebookReelInsights, fetchFacebookPostInsights, findPublishedFacebookReelVideoIds } = vi.hoisted(() => {
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
    fetchFacebookReelInsights: vi.fn(),
    fetchFacebookPostInsights: vi.fn(),
    findPublishedFacebookReelVideoIds: vi.fn(),
  };
});

vi.mock("./lib/db-helper", () => ({
  db: async () => database,
  dbTyped: async () => database,
  requireDb: async () => database,
}));
vi.mock("./services/metaSocial", () => ({
  fetchFacebookReelInsights,
  fetchFacebookPostInsights,
  fetchInstagramMedia: async () => ({ ok: true, posts: [] }),
  fetchInstagramAccountProfile: async () => ({ ok: true, account: { followers: 100 } }),
  getMediaInsights: async () => ({ ok: false }),
}));
vi.mock("./services/publishAttemptLedger", () => ({ findPublishedFacebookReelVideoIds }));
vi.mock("./instagram", () => ({
  getInstagramPosts: async () => [],
  getInstagramAccount: async () => null,
  writeInstagramCache: async () => undefined,
}));

import { FB_SNAPSHOT_PREFIX, syncInstagramPosts } from "./pipelines/instagram-data";

describe("nightly Facebook reel numbers (syncInstagramPosts)", () => {
  beforeEach(() => {
    insertValues.mockReset();
    insertValues.mockResolvedValue(undefined);
    fetchFacebookReelInsights.mockReset();
    fetchFacebookPostInsights.mockReset();
    findPublishedFacebookReelVideoIds.mockReset();
    selectQueue.length = 0;
  });

  it("writes one fb:-prefixed snapshot per reel, native units, null for what Facebook did not report, and a measured zero as zero", async () => {
    findPublishedFacebookReelVideoIds.mockResolvedValue(["vid_1", "vid_2"]);
    fetchFacebookReelInsights.mockImplementation(async (id: string) =>
      id === "vid_1"
        ? { ok: true, plays: 3, avgWatchMs: 4838.4, reactions: 2, comments: 1 }
        : { ok: true, reactions: 0, comments: 0 },
    );
    const r = await syncInstagramPosts();
    expect(r).toMatchObject({ source: "graph", processed: 0, fbSnapshotsWritten: 2, fbErrors: 0 });
    expect(findPublishedFacebookReelVideoIds).toHaveBeenCalledWith(14);
    expect(fetchFacebookReelInsights.mock.calls.map((c) => c[0])).toEqual(["vid_1", "vid_2"]);
    expect(insertValues.mock.calls[0]![0]).toEqual({
      postId: `${FB_SNAPSHOT_PREFIX}vid_1`,
      likes: 2, comments: 1, reach: null, saved: null, views: 3, shares: null,
      avgWatchTimeMs: 4838, skipRate: null, followerSnapshot: null,
    });
    // no plays and no watch time reported: NULL (unknown), while the measured 0 reactions and comments stay 0
    expect(insertValues.mock.calls[1]![0]).toEqual({
      postId: "fb:vid_2",
      likes: 0, comments: 0, reach: null, saved: null, views: null, shares: null,
      avgWatchTimeMs: null, skipRate: null, followerSnapshot: null,
    });
    expect(fetchFacebookPostInsights).not.toHaveBeenCalled(); // the image cross-post lane had no candidates
  });

  it("skips the write and counts an error when reactions or comments were not read (NOT NULL columns must not store a fabricated 0), or the fetch failed", async () => {
    findPublishedFacebookReelVideoIds.mockResolvedValue(["no_reactions", "no_comments", "failed"]);
    fetchFacebookReelInsights.mockImplementation(async (id: string) => {
      if (id === "no_reactions") return { ok: true, plays: 5, avgWatchMs: 100, comments: 1 };
      if (id === "no_comments") return { ok: true, plays: 5, reactions: 1 };
      return { ok: false, error: "boom" };
    });
    const r = await syncInstagramPosts();
    expect(r).toMatchObject({ fbSnapshotsWritten: 0, fbErrors: 3 });
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("counts one failed snapshot insert and still tries the next reel", async () => {
    findPublishedFacebookReelVideoIds.mockResolvedValue(["vid_1", "vid_2"]);
    fetchFacebookReelInsights.mockResolvedValue({ ok: true, plays: 1, reactions: 1, comments: 0 });
    insertValues.mockRejectedValueOnce(new Error("insert failed"));
    const r = await syncInstagramPosts();
    expect(r).toMatchObject({ fbSnapshotsWritten: 1, fbErrors: 1 });
    expect(insertValues).toHaveBeenCalledTimes(2);
  });

  it("counts an unreadable ledger as ONE error and makes no Graph call (unknown is not 'no reels')", async () => {
    findPublishedFacebookReelVideoIds.mockRejectedValue(new Error("db read down"));
    const r = await syncInstagramPosts();
    expect(r).toMatchObject({ fbSnapshotsWritten: 0, fbErrors: 1 });
    expect(fetchFacebookReelInsights).not.toHaveBeenCalled();
  });

  it("makes no Graph call and counts nothing when no reel went live in the window", async () => {
    findPublishedFacebookReelVideoIds.mockResolvedValue([]);
    const r = await syncInstagramPosts();
    expect(r).toMatchObject({ fbSnapshotsWritten: 0, fbErrors: 0 });
    expect(fetchFacebookReelInsights).not.toHaveBeenCalled();
  });
});
