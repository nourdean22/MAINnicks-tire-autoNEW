/**
 * Media registry — fast invariant units. The full lifecycle/versioning
 * behavior runs against a real MySQL in scripts/verify-media-registry.mts
 * (pnpm run verify:media-registry); these tests pin the refusals that fire
 * BEFORE any database work plus the archive gate's Drive-verification demand.
 */
import { describe, expect, it } from "vitest";
import { registerAsset, transitionLifecycle, markDriveSynced } from "./services/mediaRegistry";
import type { DB } from "./db";

const NEVER_DB = new Proxy({}, {
  get() { throw new Error("db must not be touched for pre-validation refusals"); },
}) as DB;

function dbWithAsset(row: Record<string, unknown>) {
  return {
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([row]) }) }) }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  } as unknown as DB;
}

describe("media registry invariants", () => {
  it("refuses a non-sha256 checksum before touching the db", async () => {
    await expect(registerAsset(NEVER_DB, {
      logicalKey: "x", assetType: "draft_render", format: "video", mimeType: "video/mp4",
      byteSize: 10, checksumSha256: "not-a-hash",
    })).rejects.toThrow(/64-hex/);
  });

  it("refuses a non-positive byte size before touching the db", async () => {
    await expect(registerAsset(NEVER_DB, {
      logicalKey: "x", assetType: "draft_render", format: "video", mimeType: "video/mp4",
      byteSize: 0, checksumSha256: "a".repeat(64),
    })).rejects.toThrow(/positive/);
  });

  it("archived is unreachable without a VERIFIED Drive copy", async () => {
    const db = dbWithAsset({ id: "ma_1", lifecycleState: "approved", gdriveSyncState: "pending", byteSize: 10 });
    await expect(transitionLifecycle(db, "ma_1", "archived")).rejects.toThrow(/cannot be represented as archived/);
  });

  it("illegal lifecycle jumps are refused by the graph", async () => {
    const db = dbWithAsset({ id: "ma_1", lifecycleState: "available", gdriveSyncState: "synced", byteSize: 10 });
    await expect(transitionLifecycle(db, "ma_1", "published")).rejects.toThrow(/illegal transition/);
  });

  it("a byte-mismatched Drive upload records failed, never synced", async () => {
    let written: Record<string, unknown> | null = null;
    const db = {
      select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([{ id: "ma_1", byteSize: 100 }]) }) }) }),
      update: () => ({ set: (v: Record<string, unknown>) => ({ where: () => { written = v; return Promise.resolve(); } }) }),
    } as unknown as DB;
    const res = await markDriveSynced(db, "ma_1", { fileId: "f", folderId: "d", verifiedByteSize: 99 });
    expect(res).toEqual({ ok: false, reason: "byte_mismatch" });
    expect(written?.gdriveSyncState).toBe("failed");
  });
});

describe("media registry: durationMs reaches the row (2026-10-09)", () => {
  // The column existed and nothing wrote it, so a registered real_shop clip
  // could never bind to a Reel beat (realShotBinding refuses a row without a
  // duration). A capturing db proves the probed value lands, rounded, and that
  // junk never becomes a fake duration.
  function capturingDb(captured: Record<string, unknown>[]) {
    const tx = {
      select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: () => Promise.resolve([]) }), limit: () => Promise.resolve([captured[captured.length - 1]]) }) }) }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      insert: () => ({ values: (v: Record<string, unknown>) => { captured.push(v); return Promise.resolve(); } }),
    };
    return { transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) } as unknown as DB;
  }
  const base = { logicalKey: "real_shop:clip:p1", assetType: "real_shop_clip", format: "video" as const, mimeType: "video/mp4", byteSize: 10, checksumSha256: "b".repeat(64) };

  it("writes the probed duration, rounded to whole milliseconds", async () => {
    const rows: Record<string, unknown>[] = [];
    await registerAsset(capturingDb(rows), { ...base, durationMs: 6420.6 });
    expect(rows[0].durationMs).toBe(6421);
  });

  it("stores null for an absent, zero, negative or non-finite duration", async () => {
    for (const durationMs of [undefined, null, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const rows: Record<string, unknown>[] = [];
      await registerAsset(capturingDb(rows), { ...base, durationMs });
      expect(rows[0].durationMs, `durationMs=${String(durationMs)}`).toBeNull();
    }
  });
});
