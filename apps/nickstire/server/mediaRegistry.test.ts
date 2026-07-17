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
