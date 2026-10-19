/**
 * shopMediaLibrary — the review gate between Nour's imported camera roll and
 * anything public.
 *
 * What is pinned:
 *  - review is a compare-and-swap: the UPDATE's WHERE names every field the
 *    decision read (id, lifecycle_state, provider, reuse_allowed), and a row
 *    another reviewer changed in between is SKIPPED with its real state,
 *    never overwritten (skill claim-before-act);
 *  - "approved" means available AND reuse_allowed=1 AND a shop-media provider;
 *  - list pages exactly even when the people/tag filters drop rows in JS;
 *  - a failed read throws, it is never an empty list (skill empty-vs-error).
 */
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { DB } from "../db";
import { listShopMedia, reviewShopMedia, shopMediaStats } from "./shopMediaLibrary";

const dialect = new MySqlDialect();
const render = (w: unknown) => dialect.sqlToQuery(w as SQL);

type Row = Record<string, unknown>;
const params = (gp: Record<string, unknown>) => JSON.stringify(gp);
const listRow = (id: string, people: string, tags: string[], over: Row = {}): Row => ({
  id, runtimeUrl: `https://cdn.test/${id}.jpg`, format: "image", width: 1080, height: 1350, durationMs: null,
  rightsStatus: "real_shop", lifecycleState: "quarantined", reuseAllowed: 0,
  generationParamsJson: params({ capturedAt: "2024-05-11T14:02:00.000Z", faces: 1, triage: { subject: "rotor", tags, quality: 4, moe: false, people, plate: false } }),
  ...over,
});

/** A list DB: records the WHERE and serves `rows` as if SQL had filtered them, honouring limit/offset. */
function listDb(rows: Row[], opts: { fail?: Error } = {}) {
  const calls: { where?: unknown; limits: number[]; offsets: number[] } = { limits: [], offsets: [] };
  const db = {
    select: () => ({
      from: () => ({
        where: (w: unknown) => {
          calls.where = w;
          return {
            orderBy: () => ({
              limit: (n: number) => {
                calls.limits.push(n);
                return {
                  offset: async (o: number) => {
                    calls.offsets.push(o);
                    if (opts.fail) throw opts.fail;
                    return rows.slice(o, o + n);
                  },
                };
              },
            }),
          };
        },
      }),
    }),
  } as unknown as DB;
  return { db, calls };
}

describe("listShopMedia", () => {
  it("approved = available AND reuse_allowed=1 AND a shop-media provider, current rows only", async () => {
    const { db, calls } = listDb([]);
    await listShopMedia(db, { state: "approved" });
    const q = render(calls.where);
    expect(q.sql).toMatch(/`lifecycle_state` = \?/);
    expect(q.sql).toMatch(/`reuse_allowed` = \?/);
    expect(q.sql).toMatch(/`provider` in \(\?, \?\)/);
    expect(q.sql).toMatch(/`is_current` = \?/);
    expect(q.params).toEqual(expect.arrayContaining(["available", 1, "operator_capture", "operator_ai_edit"]));
  });

  it("kind + orientation narrow in SQL", async () => {
    const { db, calls } = listDb([]);
    await listShopMedia(db, { state: "quarantined", kind: "video", orientation: "vertical" });
    const q = render(calls.where);
    expect(q.params).toEqual(expect.arrayContaining(["quarantined", "video"]));
    expect(q.sql).toMatch(/`height` > `media_assets`\.`width`|`height` > `width`/);
  });

  it("maps triage fields from generation params", async () => {
    const { db } = listDb([listRow("a", "staff", ["brakes"])]);
    const out = await listShopMedia(db, { state: "quarantined" });
    expect(out.items[0]).toMatchObject({
      assetId: "a", url: "https://cdn.test/a.jpg", kind: "photo", width: 1080, height: 1350, durationMs: null,
      capturedAt: "2024-05-11T14:02:00.000Z", subject: "rotor", tags: ["brakes"], faces: 1, moe: false, people: "staff",
      plate: false, quality: 4, rightsStatus: "real_shop", lifecycleState: "quarantined", reuseAllowed: false,
    });
    expect(out.nextCursor).toBeNull();
  });

  it("pages exactly when the people filter drops rows: the cursor is the raw offset after the last row consumed", async () => {
    const rows = [listRow("a", "staff", []), listRow("b", "none", []), listRow("c", "staff", []), listRow("d", "none", []), listRow("e", "staff", [])];
    const p1 = await listShopMedia(listDb(rows).db, { state: "quarantined", people: "staff", limit: 2 });
    expect(p1.items.map((i) => i.assetId)).toEqual(["a", "c"]);
    expect(p1.nextCursor).toBe(3);
    const p2 = await listShopMedia(listDb(rows).db, { state: "quarantined", people: "staff", limit: 2, cursor: p1.nextCursor! });
    expect(p2.items.map((i) => i.assetId)).toEqual(["e"]);
    expect(p2.nextCursor).toBeNull();
  });

  it("tag filter matches a tag exactly", async () => {
    const rows = [listRow("a", "none", ["brakes"]), listRow("b", "none", ["brake-pads"])];
    const out = await listShopMedia(listDb(rows).db, { state: "quarantined", tag: "brakes" });
    expect(out.items.map((i) => i.assetId)).toEqual(["a"]);
  });

  it("EMPTY-VS-ERROR: a failed read throws, never an empty page", async () => {
    await expect(listShopMedia(listDb([], { fail: new Error("ETIMEDOUT") }).db, { state: "approved" })).rejects.toThrow("ETIMEDOUT");
  });
});

/** A review DB: serves the read, records each UPDATE, answers affectedRows from `affected`. */
function reviewDb(rows: Row[], affected: (n: number) => number = () => 1, reread: Row[] = rows, fail?: Error) {
  const updates: Array<{ set: Row; where: unknown }> = [];
  let reads = 0;
  const db = {
    select: () => ({
      from: () => ({
        where: async () => {
          if (fail) throw fail;
          reads += 1;
          return reads === 1 ? rows : reread;
        },
      }),
    }),
    update: () => ({
      set: (set: Row) => ({
        where: async (where: unknown) => {
          updates.push({ set, where });
          return [{ affectedRows: affected(updates.length) }];
        },
      }),
    }),
  } as unknown as DB;
  return { db, updates };
}
const reviewRow = (id: string, lifecycleState: string, provider: string, reuseAllowed = 0): Row => ({ id, lifecycleState, provider, reuseAllowed, isCurrent: 1 });

describe("reviewShopMedia", () => {
  it("approve swaps ONLY on the exact state read; ineligible and unknown rows are skipped with a reason", async () => {
    const { db, updates } = reviewDb([
      reviewRow("q1", "quarantined", "operator_capture"),
      reviewRow("a1", "available", "operator_capture", 1),
      reviewRow("x1", "quarantined", "higgsfield"),
    ]);
    const out = await reviewShopMedia(db, ["q1", "a1", "x1", "gone", "q1"], "approve");
    expect(out.changed).toEqual(["q1"]);
    expect(out.skipped).toEqual(expect.arrayContaining([
      { assetId: "a1", reason: "not_quarantined:available" },
      { assetId: "x1", reason: "not_shop_media:higgsfield" },
      { assetId: "gone", reason: "not_found" },
    ]));
    expect(updates).toHaveLength(1);
    expect(updates[0].set).toEqual({ lifecycleState: "available", reuseAllowed: 1 });
    const q = render(updates[0].where);
    for (const col of ["id", "lifecycle_state", "provider", "reuse_allowed", "is_current"]) expect(q.sql).toContain(`\`${col}\` = ?`);
    expect(q.params).toEqual(["q1", "quarantined", "operator_capture", 0, 1]);
  });

  it("CAS race: a row changed by another reviewer is skipped with its NEW state, never overwritten", async () => {
    const { db, updates } = reviewDb(
      [reviewRow("q1", "quarantined", "operator_capture"), reviewRow("q2", "quarantined", "operator_ai_edit")],
      (n) => (n === 1 ? 0 : 1),
      [reviewRow("q1", "rejected", "operator_capture"), reviewRow("q2", "quarantined", "operator_ai_edit")],
    );
    const out = await reviewShopMedia(db, ["q1", "q2"], "approve");
    expect(out.changed).toEqual(["q2"]);
    expect(out.skipped).toEqual([{ assetId: "q1", reason: "changed_concurrently:rejected" }]);
    expect(updates).toHaveLength(2);
  });

  it("reject moves quarantined or approved shop media to rejected and withdraws reuse", async () => {
    const { db, updates } = reviewDb([reviewRow("q1", "quarantined", "operator_capture"), reviewRow("a1", "available", "operator_ai_edit", 1), reviewRow("r1", "rejected", "operator_capture")]);
    const out = await reviewShopMedia(db, ["q1", "a1", "r1"], "reject");
    expect(out.changed).toEqual(["q1", "a1"]);
    expect(out.skipped).toEqual([{ assetId: "r1", reason: "not_reviewable:rejected" }]);
    expect(updates.map((u) => u.set)).toEqual([{ lifecycleState: "rejected", reuseAllowed: 0 }, { lifecycleState: "rejected", reuseAllowed: 0 }]);
    expect(render(updates[1].where).params).toEqual(["a1", "available", "operator_ai_edit", 1, 1]);
  });

  it("a failed read throws; nothing is written", async () => {
    const { db, updates } = reviewDb([], undefined, [], new Error("ECONNRESET"));
    await expect(reviewShopMedia(db, ["q1"], "approve")).rejects.toThrow("ECONNRESET");
    expect(updates).toHaveLength(0);
  });
});

describe("shopMediaStats", () => {
  it("buckets counts by state x kind", async () => {
    const db = {
      select: () => ({ from: () => ({ where: () => ({ groupBy: async () => [
        { lifecycleState: "quarantined", reuseAllowed: 0, format: "image", n: 5 },
        { lifecycleState: "quarantined", reuseAllowed: 0, format: "video", n: 2 },
        { lifecycleState: "available", reuseAllowed: 1, format: "video", n: "3" },
        { lifecycleState: "available", reuseAllowed: 0, format: "image", n: 1 },
        { lifecycleState: "rejected", reuseAllowed: 0, format: "image", n: 4 },
      ] }) }) }),
    } as unknown as DB;
    expect(await shopMediaStats(db)).toEqual({
      quarantined: { photo: 5, video: 2 },
      approved: { photo: 0, video: 3 },
      rejected: { photo: 4, video: 0 },
      other: { photo: 1, video: 0 },
    });
  });

  it("a failed read throws", async () => {
    const db = { select: () => ({ from: () => ({ where: () => ({ groupBy: async () => { throw new Error("boom"); } }) }) }) } as unknown as DB;
    await expect(shopMediaStats(db)).rejects.toThrow("boom");
  });
});
