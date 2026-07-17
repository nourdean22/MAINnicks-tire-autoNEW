/**
 * Media-registry integration verifier — runs the REAL service against a real
 * (in-memory) MySQL with the real 0088 schema. Proves the invariants the
 * unit tests can only assert in miniature:
 *
 *   1. registration computes checksum+size from actual bytes
 *   2. same logicalKey re-registration = version bump + current-flip (exactly
 *      one current version survives)
 *   3. duplicate checksums are discoverable before duplicate spend
 *   4. lifecycle graph refuses illegal jumps (available -> approved)
 *   5. `archived` is unreachable without a VERIFIED Drive copy
 *   6. byte-mismatched Drive upload records `failed`, never `synced`
 *   7. repair path registers a NEW version with lineage, never overwrites
 *   8. registerProducedAsset never throws when the table is missing
 *
 * Run from apps/nickstire:  pnpm run verify:media-registry
 */
import { startDevDb } from "./lib/dev-db.mjs";

const { url, stop } = await startDevDb();
process.env.DATABASE_URL = url;

const results: Array<{ name: string; pass: boolean; detail: string }> = [];
const check = (name: string, pass: boolean, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

try {
  const { getDb } = await import("../server/db");
  const registry = await import("../server/services/mediaRegistry");
  const db = await getDb();
  if (!db) throw new Error("dev db did not connect");

  const bufA = Buffer.from("fake-mp4-bytes-version-one");
  const bufB = Buffer.from("fake-mp4-bytes-version-two!");

  // 1+2: register v1 then v2 under one logicalKey
  const v1 = await registry.registerFromBuffer(db, bufA, {
    logicalKey: "reel:9001:master", assetType: "draft_render", format: "video",
    mimeType: "video/mp4", campaignId: "9001", provider: "ffmpeg-assembly",
  });
  check("v1 registered with computed checksum", /^[a-f0-9]{64}$/.test(v1.checksumSha256) && v1.byteSize === bufA.length && v1.version === 1 && v1.isCurrent === 1);

  const v2 = await registry.registerFromBuffer(db, bufB, {
    logicalKey: "reel:9001:master", assetType: "draft_render", format: "video", mimeType: "video/mp4",
  });
  const v1After = (await registry.findByChecksum(db, v1.checksumSha256))[0];
  check("v2 bumped version and flipped v1 current", v2.version === 2 && v2.isCurrent === 1 && v1After.isCurrent === 0);
  const current = await registry.getCurrent(db, "reel:9001:master");
  check("exactly one current version", current?.id === v2.id);

  // 3: duplicate checksum discoverable
  await registry.registerFromBuffer(db, bufA, {
    logicalKey: "reel:9002:master", assetType: "draft_render", format: "video", mimeType: "video/mp4",
  });
  const dupes = await registry.findByChecksum(db, v1.checksumSha256);
  check("duplicate checksum surfaced across logical keys", dupes.length === 2);

  // 4: illegal lifecycle jump refused
  let illegalRefused = false;
  try { await registry.transitionLifecycle(db, v2.id, "approved"); } catch { illegalRefused = true; }
  check("available -> approved refused (must pass approval_ready)", illegalRefused);

  // 5: archived unreachable without verified Drive copy
  let archiveRefused = false;
  try { await registry.transitionLifecycle(db, v2.id, "archived"); } catch (e) { archiveRefused = /Drive sync/.test(String(e)); }
  check("archived refused while gdriveSyncState != synced", archiveRefused);

  // 6: byte-mismatch records failed, correct size records synced
  const bad = await registry.markDriveSynced(db, v2.id, { fileId: "f1", folderId: "d1", verifiedByteSize: bufB.length + 5 });
  check("byte-mismatched upload -> ok:false + failed state", !bad.ok && bad.reason === "byte_mismatch");
  const good = await registry.markDriveSynced(db, v2.id, { fileId: "f1", folderId: "d1", viewUrl: "https://drive/x", verifiedByteSize: bufB.length });
  const archived = good.ok ? await registry.transitionLifecycle(db, v2.id, "archived") : null;
  check("verified upload -> synced -> archived reachable", good.ok && archived?.lifecycleState === "archived" && archived?.gdriveSyncState === "synced");

  // 7: repair registers a NEW lineage-carrying version
  const v3 = await registry.newVersionFrom(db, v2.id, Buffer.from("repaired-bytes"), { provider: "higgsfield", assetType: "repaired_render" });
  const v2After = (await registry.findByChecksum(db, v2.checksumSha256))[0];
  check("repair created v3 with lineage, v2 preserved not overwritten",
    v3.version === 3 && v3.parentAssetId === v2.id && JSON.parse(v3.derivedFromJson ?? "[]").includes(v2.id) && v2After.checksumSha256 === v2.checksumSha256 && v2After.isCurrent === 0);

  // 8: producer seam survives a missing table
  const { sql } = await import("drizzle-orm");
  await db.execute(sql.raw("RENAME TABLE media_assets TO media_assets_hidden"));
  const tolerant = await registry.registerProducedAsset(db, bufA, {
    logicalKey: "reel:9003:master", assetType: "draft_render", format: "video", mimeType: "video/mp4",
  });
  await db.execute(sql.raw("RENAME TABLE media_assets_hidden TO media_assets"));
  check("registerProducedAsset returns null (no throw) when table absent", tolerant === null);
} catch (err) {
  check("verifier ran to completion", false, String(err));
} finally {
  await stop().catch(() => {});
}

const failed = results.filter((r) => !r.pass);
console.log("\n" + "=".repeat(72));
console.log(failed.length === 0 ? `VERDICT: PASS (${results.length}/${results.length})` : `VERDICT: FAIL (${results.length - failed.length}/${results.length})`);
process.exit(failed.length === 0 ? 0 : 1);
