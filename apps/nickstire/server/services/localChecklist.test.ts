/**
 * Website & Local checklist marks (2026-10-25), contract localGrowth.checklist v1.
 *
 * The page said "nothing is marked fixed until you verify it on the platform" and had no control
 * to mark anything. A mark is one shop_settings row, `local_checklist:<slug>`, value JSON
 * { checkedAt, note, by }. These tests drive the REAL drizzle MySQL builder over a fake mysql2
 * client that records the SQL and params it is sent (targetKeywordRanks.test.ts precedent), so the
 * upsert shape, the delete and the LIKE read are asserted on rendered SQL, not on a stub.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.unmock("drizzle-orm/mysql2");
vi.unmock("drizzle-orm");
vi.unmock("../../drizzle/schema");

import { drizzle } from "drizzle-orm/mysql2";

const h = vi.hoisted(() => ({
  sent: [] as { sql: string; params: unknown[] }[],
  /** [key, value] rows the SELECT returns, positional (rowsAsArray) in field order. */
  rows: [] as [string, string][],
  fail: null as Error | null,
  noDb: false,
}));

const fakeClient = {
  query: async (q: { sql: string } | string, params: unknown[] = []) => {
    const text = typeof q === "string" ? q : q.sql;
    h.sent.push({ sql: text, params });
    if (h.fail) throw h.fail;
    if (/^\s*select/i.test(text)) return [h.rows, []];
    return [{ affectedRows: 1 }, undefined];
  },
};
const realDrizzle = drizzle(fakeClient as never);

vi.mock("../lib/db-helper", () => ({
  dbTyped: async () => (h.noDb ? null : realDrizzle),
}));

import { getLocalChecklist, setLocalChecklistItem } from "./localChecklist";

const mark = (checkedAt: string, note: string | null, by: string) => JSON.stringify({ checkedAt, note, by });

beforeEach(() => {
  h.sent.length = 0;
  h.rows = [];
  h.fail = null;
  h.noDb = false;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("getLocalChecklist", () => {
  it("reads every namespaced row in one SELECT and keys the result by slug", async () => {
    h.rows = [
      ["local_checklist:entity-yelp", mark("2026-10-20T14:00:00.000Z", "claimed, phone matches", "nour@example.com")],
      ["local_checklist:gbp-qa-tire-rotation", mark("2026-10-22T09:30:00.000Z", null, "mash")],
    ];
    const out = await getLocalChecklist();
    expect(out).toEqual({
      ok: true,
      skipped: 0,
      items: {
        "entity-yelp": { checkedAt: "2026-10-20T14:00:00.000Z", note: "claimed, phone matches", by: "nour@example.com" },
        "gbp-qa-tire-rotation": { checkedAt: "2026-10-22T09:30:00.000Z", note: null, by: "mash" },
      },
    });
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].sql).toMatch(/from `shop_settings`/i);
    expect(h.sent[0].sql).toMatch(/like \?/i);
    expect(h.sent[0].sql).toMatch(/limit \?/i);
    expect(h.sent[0].params).toContain("local_checklist:%");
    expect(h.sent[0].params).toContain(200);
  });

  it("skips and counts a row whose value does not parse, and still returns the good ones", async () => {
    h.rows = [
      ["local_checklist:entity-yelp", mark("2026-10-20T14:00:00.000Z", null, "nour")],
      ["local_checklist:entity-bbb", "not json {"],
    ];
    const out = await getLocalChecklist();
    expect(out).toEqual({
      ok: true,
      skipped: 1,
      items: { "entity-yelp": { checkedAt: "2026-10-20T14:00:00.000Z", note: null, by: "nour" } },
    });
  });

  it("skips values that parse but are not a mark (null literal, array, no date, bad date, non-string note)", async () => {
    h.rows = [
      ["local_checklist:a-null", "null"],
      ["local_checklist:b-array", "[]"],
      ["local_checklist:c-nodate", JSON.stringify({ note: null, by: "x" })],
      ["local_checklist:d-baddate", JSON.stringify({ checkedAt: "yesterday", note: null, by: "x" })],
      ["local_checklist:e-badnote", JSON.stringify({ checkedAt: "2026-10-20T14:00:00.000Z", note: 5, by: "x" })],
      ["local_checklist:f-good", mark("2026-10-20T14:00:00.000Z", null, "x")],
    ];
    const out = await getLocalChecklist();
    expect(out).toMatchObject({ ok: true, skipped: 5 });
    expect(out.ok && Object.keys(out.items)).toEqual(["f-good"]);
  });

  it("ignores a row that only matches LIKE's underscore wildcard (positive control for the prefix filter)", async () => {
    h.rows = [
      ["localXchecklist:entity-yelp", mark("2026-10-20T14:00:00.000Z", null, "x")],
      ["local_checklist:entity-bbb", mark("2026-10-21T14:00:00.000Z", null, "x")],
    ];
    const out = await getLocalChecklist();
    expect(out.ok && Object.keys(out.items)).toEqual(["entity-bbb"]);
  });

  it("an empty table is ok with no items (control: empty is empty, not an error)", async () => {
    expect(await getLocalChecklist()).toEqual({ ok: true, items: {}, skipped: 0 });
  });

  it("a failed read is ok:false, never an empty map", async () => {
    h.fail = new Error("connect ETIMEDOUT");
    const out = await getLocalChecklist();
    expect(out).toMatchObject({ ok: false, reason: "error" });
    expect(out).not.toHaveProperty("items");
  });

  it("no database handle is ok:false, never an empty map", async () => {
    h.noDb = true;
    const out = await getLocalChecklist();
    expect(out).toMatchObject({ ok: false, reason: "error" });
    expect(out).not.toHaveProperty("items");
  });
});

describe("setLocalChecklistItem", () => {
  it("checked:true upserts one namespaced row with a JSON mark dated now", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-25T16:00:00.000Z"));
    const out = await setLocalChecklistItem({ slug: "entity-yelp", checked: true, note: "claimed, phone matches", by: "nour@example.com" });
    expect(out).toEqual({ ok: true, slug: "entity-yelp", checkedAt: "2026-10-25T16:00:00.000Z" });
    expect(h.sent).toHaveLength(1);
    const { sql, params } = h.sent[0];
    expect(sql).toMatch(/^insert into `shop_settings`/i);
    expect(sql).toMatch(/on duplicate key update/i);
    expect(params).toContain("local_checklist:entity-yelp");
    expect(params).toContain("Local checklist: entity-yelp");
    expect(params).toContain("general");
    expect(params).toContain("nour@example.com");
    const json = params.find((p) => typeof p === "string" && p.startsWith("{")) as string;
    expect(JSON.parse(json)).toEqual({ checkedAt: "2026-10-25T16:00:00.000Z", note: "claimed, phone matches", by: "nour@example.com" });
    // The update half rewrites the value too, so a second tap on a marked item re-dates it.
    expect(params.filter((p) => p === json)).toHaveLength(2);
  });

  it("stores a trimmed note, and a blank or missing note as null", async () => {
    for (const note of ["   ", "", undefined, null]) {
      h.sent.length = 0;
      await setLocalChecklistItem({ slug: "entity-bbb", checked: true, note, by: "mash" });
      const json = h.sent[0].params.find((p) => typeof p === "string" && p.startsWith("{")) as string;
      expect(JSON.parse(json).note).toBeNull();
    }
    h.sent.length = 0;
    await setLocalChecklistItem({ slug: "entity-bbb", checked: true, note: "  posted  ", by: "mash" });
    const json = h.sent[0].params.find((p) => typeof p === "string" && p.startsWith("{")) as string;
    expect(JSON.parse(json).note).toBe("posted");
  });

  it("cuts `by` to the updatedBy column width (varchar 100) so strict mode cannot reject the row", async () => {
    const long = `${"a".repeat(120)}@example.com`;
    await setLocalChecklistItem({ slug: "entity-yelp", checked: true, by: long });
    const { params } = h.sent[0];
    const json = JSON.parse(params.find((p) => typeof p === "string" && p.startsWith("{")) as string);
    expect(json.by).toHaveLength(100);
    expect(params).toContain(long.slice(0, 100));
    expect(params).not.toContain(long);
  });

  it("checked:false DELETES the row: an unchecked item has no mark and no stale date", async () => {
    const out = await setLocalChecklistItem({ slug: "entity-yelp", checked: false, note: "ignored", by: "nour" });
    expect(out).toEqual({ ok: true, slug: "entity-yelp", checkedAt: null });
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].sql).toMatch(/^delete from `shop_settings` where/i);
    expect(h.sent[0].params).toEqual(["local_checklist:entity-yelp"]);
  });

  it("a failed write is ok:false with the message, never a throw", async () => {
    h.fail = new Error("Data too long for column 'value'");
    const out = await setLocalChecklistItem({ slug: "entity-yelp", checked: true, by: "nour" });
    expect(out).toMatchObject({ ok: false, reason: "error" });
    expect(out).not.toHaveProperty("checkedAt");
  });

  it("a failed delete is ok:false, never a claim that the mark was removed", async () => {
    h.fail = new Error("connect ETIMEDOUT");
    const out = await setLocalChecklistItem({ slug: "entity-yelp", checked: false, by: "nour" });
    expect(out).toMatchObject({ ok: false, reason: "error" });
  });

  it("no database handle is ok:false", async () => {
    h.noDb = true;
    expect(await setLocalChecklistItem({ slug: "entity-yelp", checked: true, by: "nour" })).toMatchObject({ ok: false, reason: "error" });
    expect(await setLocalChecklistItem({ slug: "entity-yelp", checked: false, by: "nour" })).toMatchObject({ ok: false, reason: "error" });
  });
});
