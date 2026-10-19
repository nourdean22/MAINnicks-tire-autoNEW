/**
 * registerAsset can register a row NOT reusable (reuse_allowed=0), so an
 * imported shop photo is never public-reusable before review. Every existing
 * caller passes no reuseAllowed and must emit the same insert as before (the
 * column keeps its DB default of 1): the key is attached only when given.
 */
import { describe, expect, it } from "vitest";
import type { DB } from "../db";
import { registerAsset } from "./mediaRegistry";

function fakeDb() {
  const inserts: Array<Record<string, unknown>> = [];
  const tx = {
    select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [] }), limit: async () => [inserts[inserts.length - 1]] }) }) }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    insert: () => ({ values: async (v: Record<string, unknown>) => { inserts.push(v); } }),
  };
  return { db: { transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } as unknown as DB, inserts };
}

const base = { logicalKey: "shop_media:abc", assetType: "shop_photo", format: "image" as const, mimeType: "image/jpeg", byteSize: 10, checksumSha256: "a".repeat(64) };

describe("registerAsset reuseAllowed", () => {
  it("reuseAllowed:false writes reuse_allowed 0", async () => {
    const { db, inserts } = fakeDb();
    await registerAsset(db, { ...base, reuseAllowed: false });
    expect(inserts[0].reuseAllowed).toBe(0);
  });

  it("an existing caller (no reuseAllowed) leaves the column to its default", async () => {
    const { db, inserts } = fakeDb();
    await registerAsset(db, base);
    expect("reuseAllowed" in inserts[0]).toBe(false);
  });
});
