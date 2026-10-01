/**
 * syncFacebookPostInsights — FB cross-post insights land in ig_metric_snapshots
 * under the `fb:` prefix (no schema change in this wave; see the function's
 * header for why that table and which columns are UNOBSERVED).
 *
 * Positive controls: a row is written only when reactions are reported (a
 * NOT NULL `likes` must never store a fabricated 0); an insights failure is
 * counted, not swallowed; no candidates → no Graph call at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { insertValues, selectQueue, database, fetchFacebookPostInsights } = vi.hoisted(() => {
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
  return { insertValues, selectQueue, database, fetchFacebookPostInsights: vi.fn() };
});

vi.mock("./lib/db-helper", () => ({
  db: async () => database,
  dbTyped: async () => database,
  requireDb: async () => database,
}));
vi.mock("./services/metaSocial", () => ({ fetchFacebookPostInsights }));

import { FB_SNAPSHOT_PREFIX, syncFacebookPostInsights } from "./pipelines/instagram-data";

describe("syncFacebookPostInsights", () => {
  beforeEach(() => {
    insertValues.mockClear();
    fetchFacebookPostInsights.mockReset();
    selectQueue.length = 0;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("writes one fb:-prefixed snapshot per cross-post with native-unit columns and nulls for unobserved metrics", async () => {
    selectQueue.push([{ fbPostId: "777_1", createdAt: new Date() }, { fbPostId: "777_1", createdAt: new Date() }, { fbPostId: "777_2", createdAt: new Date() }]);
    fetchFacebookPostInsights.mockImplementation(async (id: string) =>
      id === "777_1"
        ? { ok: true, rung: 1, reach: 300, reactions: 12, clicks: 9, videoViews: 250 }
        : { ok: true, rung: 2, reach: 80, reactions: 2 },
    );
    const r = await syncFacebookPostInsights(database as never);
    expect(r).toEqual({ written: 2, errors: 0, candidates: 2 });
    expect(fetchFacebookPostInsights).toHaveBeenCalledTimes(2); // de-duplicated ids
    expect(insertValues.mock.calls[0]![0]).toEqual({
      postId: `${FB_SNAPSHOT_PREFIX}777_1`,
      likes: 12, comments: 0, reach: 300, saved: null, views: 250, shares: null,
      avgWatchTimeMs: null, skipRate: null, followerSnapshot: null,
    });
    expect(insertValues.mock.calls[1]![0]).toMatchObject({ postId: "fb:777_2", likes: 2, views: null });
  });

  it("skips the write when reactions are not reported (NOT NULL likes must not store a fabricated 0) and counts failures", async () => {
    selectQueue.push([{ fbPostId: "a", createdAt: new Date() }, { fbPostId: "b", createdAt: new Date() }]);
    fetchFacebookPostInsights.mockImplementation(async (id: string) =>
      id === "a" ? { ok: true, rung: 4, impressions: 10, clicks: 1 } : { ok: false, error: "boom" },
    );
    const r = await syncFacebookPostInsights(database as never);
    expect(r).toEqual({ written: 0, errors: 2, candidates: 2 });
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("makes no Graph call when there are no cross-posts in the window", async () => {
    const r = await syncFacebookPostInsights(database as never);
    expect(r).toEqual({ written: 0, errors: 0, candidates: 0 });
    expect(fetchFacebookPostInsights).not.toHaveBeenCalled();
  });
});
