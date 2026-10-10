/**
 * Canonical media asset registry (0088) — one identity, checksum, lineage,
 * lifecycle, and archive state per produced/ingested media artifact.
 *
 * Invariants enforced HERE, not by convention (baseline evidence for why:
 * the only permanent copies of the first published reel are 19 files
 * accidentally committed to git — docs/execution/creative-quality/):
 *  - every asset has a sha256 checksum + byte size at registration
 *  - one current version per logicalKey; versions are immutable — a repair
 *    registers a NEW version, never overwrites
 *  - `archived` lifecycle requires a VERIFIED Drive copy (gdriveSyncState
 *    "synced", which markDriveSynced only writes after byte-size match)
 *  - `published` requires `approved`; rejected/quarantined assets cannot
 *    advance toward publish
 *  - duplicate checksums are surfaced (findByChecksum) before duplicate spend
 *
 * DB rows are canonical metadata; Google Drive is the durable archive;
 * storagePut output is runtime delivery. A provider URL is never permanence.
 */
import { createHash, randomUUID } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { mediaAssets, type MediaAsset } from "../../drizzle/schema";
import type { DB } from "../db";
import { createLogger } from "../lib/logger";
import { isMissingTableError } from "../lib/dbErrors";

const log = createLogger("services:media-registry");

export type AssetLifecycle =
  | "requested" | "generating" | "ingesting" | "available"
  | "quarantined" | "rejected" | "repair_queued" | "repairing"
  | "quality_review" | "approval_ready" | "approved" | "published"
  | "archived" | "missing";

/** Directed lifecycle graph. Anything may be marked missing (truth beats tidiness). */
const VALID_TRANSITIONS: Record<AssetLifecycle, AssetLifecycle[]> = {
  requested: ["generating", "rejected", "missing"],
  generating: ["ingesting", "available", "rejected", "missing"],
  ingesting: ["available", "rejected", "missing"],
  available: ["quality_review", "approval_ready", "quarantined", "rejected", "repair_queued", "archived", "missing"],
  quality_review: ["approval_ready", "repair_queued", "rejected", "available", "missing"],
  approval_ready: ["approved", "repair_queued", "rejected", "missing"],
  approved: ["published", "archived", "repair_queued", "missing"],
  published: ["archived", "missing"],
  repair_queued: ["repairing", "available", "rejected", "missing"],
  repairing: ["available", "rejected", "missing"],
  quarantined: ["available", "rejected", "missing"],
  rejected: ["missing"],
  archived: ["missing"],
  missing: ["available"],
};

export interface RegisterAssetInput {
  logicalKey: string;
  assetType: string;
  format: "image" | "video" | "audio" | "text" | "json" | "document";
  mimeType: string;
  byteSize: number;
  checksumSha256: string;
  lifecycleState?: AssetLifecycle;
  campaignId?: string | null;
  genomeId?: string | null;
  visualWorldId?: string | null;
  parentAssetId?: string | null;
  derivedFrom?: string[];
  provider?: string | null;
  providerModel?: string | null;
  providerRequestId?: string | null;
  originalProviderUrl?: string | null;
  runtimeUrl?: string | null;
  gdriveSyncState?: "not_required" | "pending";
  generationParams?: Record<string, unknown>;
  rightsStatus?: string;
  /** Pixel dimensions when the producer can read them cheaply (sharp metadata on uploads). */
  width?: number | null;
  height?: number | null;
  /**
   * Probed duration for video/audio (2026-10-09). The column existed; nothing
   * wrote it, so a registered real_shop clip could never bind to a Reel beat
   * (realShotBinding refuses a row without a duration — it cannot know how long
   * the beat may run). Producers that probe the file pass it; stills leave it null.
   */
  durationMs?: number | null;
}

/**
 * Register an asset. If the logicalKey already has versions, this becomes the
 * next version and the previous current row is flipped isCurrent=0 inside a
 * transaction — exactly one current version per logicalKey survives.
 */
export async function registerAsset(database: DB, input: RegisterAssetInput): Promise<MediaAsset> {
  if (!/^[a-f0-9]{64}$/.test(input.checksumSha256)) {
    throw new Error(`media registry: checksumSha256 must be 64-hex (got "${input.checksumSha256.slice(0, 20)}...")`);
  }
  if (!Number.isFinite(input.byteSize) || input.byteSize <= 0) {
    throw new Error(`media registry: byteSize must be a positive number (got ${input.byteSize})`);
  }
  const state = input.lifecycleState ?? "available";
  if (!(state in VALID_TRANSITIONS)) throw new Error(`media registry: unknown lifecycle state "${state}"`);

  const id = `ma_${randomUUID()}`;
  return await database.transaction(async (tx) => {
    const prior = await tx
      .select({ id: mediaAssets.id, version: mediaAssets.version })
      .from(mediaAssets)
      .where(eq(mediaAssets.logicalKey, input.logicalKey))
      .orderBy(desc(mediaAssets.version))
      .limit(1);
    const version = prior.length ? prior[0].version + 1 : 1;
    if (prior.length) {
      await tx.update(mediaAssets).set({ isCurrent: 0 }).where(eq(mediaAssets.logicalKey, input.logicalKey));
    }
    await tx.insert(mediaAssets).values({
      id,
      logicalKey: input.logicalKey,
      version,
      isCurrent: 1,
      campaignId: input.campaignId ?? null,
      genomeId: input.genomeId ?? null,
      visualWorldId: input.visualWorldId ?? null,
      parentAssetId: input.parentAssetId ?? null,
      derivedFromJson: input.derivedFrom?.length ? JSON.stringify(input.derivedFrom) : null,
      assetType: input.assetType,
      format: input.format,
      lifecycleState: state,
      provider: input.provider ?? null,
      providerModel: input.providerModel ?? null,
      providerRequestId: input.providerRequestId ?? null,
      originalProviderUrl: input.originalProviderUrl ?? null,
      runtimeUrl: input.runtimeUrl ?? null,
      gdriveSyncState: input.gdriveSyncState ?? "pending",
      mimeType: input.mimeType,
      byteSize: Math.round(input.byteSize),
      width: input.width ?? null,
      height: input.height ?? null,
      durationMs: Number.isFinite(input.durationMs as number) && (input.durationMs as number) > 0 ? Math.round(input.durationMs as number) : null,
      checksumSha256: input.checksumSha256,
      generationParamsJson: input.generationParams ? JSON.stringify(input.generationParams) : null,
      rightsStatus: input.rightsStatus ?? "ai_generated",
    });
    const [row] = await tx.select().from(mediaAssets).where(eq(mediaAssets.id, id)).limit(1);
    log.info("asset registered", { id, logicalKey: input.logicalKey, version, bytes: input.byteSize });
    return row;
  });
}

/** Register from actual bytes — checksum and size computed, never trusted. */
export async function registerFromBuffer(
  database: DB,
  buffer: Buffer,
  input: Omit<RegisterAssetInput, "checksumSha256" | "byteSize">,
): Promise<MediaAsset> {
  return registerAsset(database, {
    ...input,
    checksumSha256: createHash("sha256").update(buffer).digest("hex"),
    byteSize: buffer.length,
  });
}

/** Repair path: a new immutable version derived from a parent. */
export async function newVersionFrom(
  database: DB,
  parentAssetId: string,
  buffer: Buffer,
  changes: Partial<Pick<RegisterAssetInput, "runtimeUrl" | "originalProviderUrl" | "provider" | "providerModel" | "providerRequestId" | "generationParams" | "assetType">>,
): Promise<MediaAsset> {
  const [parent] = await database.select().from(mediaAssets).where(eq(mediaAssets.id, parentAssetId)).limit(1);
  if (!parent) throw new Error(`media registry: parent asset ${parentAssetId} not found`);
  const derived: string[] = parent.derivedFromJson ? JSON.parse(parent.derivedFromJson) : [];
  return registerFromBuffer(database, buffer, {
    logicalKey: parent.logicalKey,
    assetType: changes.assetType ?? parent.assetType,
    format: parent.format as RegisterAssetInput["format"],
    mimeType: parent.mimeType,
    campaignId: parent.campaignId,
    genomeId: parent.genomeId,
    visualWorldId: parent.visualWorldId,
    parentAssetId: parent.id,
    derivedFrom: [...derived, parent.id],
    provider: changes.provider ?? parent.provider,
    providerModel: changes.providerModel ?? parent.providerModel,
    providerRequestId: changes.providerRequestId ?? null,
    originalProviderUrl: changes.originalProviderUrl ?? null,
    runtimeUrl: changes.runtimeUrl ?? null,
    generationParams: changes.generationParams,
    rightsStatus: parent.rightsStatus,
  });
}

/** Graph-validated lifecycle transition with archive/publish gates. */
export async function transitionLifecycle(database: DB, assetId: string, to: AssetLifecycle): Promise<MediaAsset> {
  const [asset] = await database.select().from(mediaAssets).where(eq(mediaAssets.id, assetId)).limit(1);
  if (!asset) throw new Error(`media registry: asset ${assetId} not found`);
  const from = asset.lifecycleState as AssetLifecycle;
  if (!(VALID_TRANSITIONS[from] ?? []).includes(to)) {
    throw new Error(`media registry: illegal transition ${from} -> ${to} for ${assetId}`);
  }
  if (to === "archived" && asset.gdriveSyncState !== "synced") {
    throw new Error(
      `media registry: refusing to mark ${assetId} archived — Drive sync state is "${asset.gdriveSyncState}", not "synced". A missing Drive copy cannot be represented as archived.`,
    );
  }
  await database.update(mediaAssets).set({ lifecycleState: to }).where(eq(mediaAssets.id, assetId));
  const [row] = await database.select().from(mediaAssets).where(eq(mediaAssets.id, assetId)).limit(1);
  return row;
}

/**
 * Record a verified Drive copy. "synced" is only written when the uploaded
 * byte size matches the registered byte size — anything else records
 * "failed" loudly and returns ok:false so callers cannot claim archival.
 */
export async function markDriveSynced(
  database: DB,
  assetId: string,
  drive: { fileId: string; folderId: string; viewUrl?: string; verifiedByteSize: number },
): Promise<{ ok: boolean; reason?: string }> {
  const [asset] = await database.select().from(mediaAssets).where(eq(mediaAssets.id, assetId)).limit(1);
  if (!asset) return { ok: false, reason: "asset_not_found" };
  if (drive.verifiedByteSize !== asset.byteSize) {
    await database
      .update(mediaAssets)
      .set({ gdriveSyncState: "failed", gdriveFileId: drive.fileId, gdriveFolderId: drive.folderId })
      .where(eq(mediaAssets.id, assetId));
    log.error("drive sync byte mismatch — recorded failed, NOT synced", {
      assetId, expected: asset.byteSize, uploaded: drive.verifiedByteSize,
    });
    return { ok: false, reason: "byte_mismatch" };
  }
  await database
    .update(mediaAssets)
    .set({
      gdriveSyncState: "synced",
      gdriveFileId: drive.fileId,
      gdriveFolderId: drive.folderId,
      gdriveViewUrl: drive.viewUrl ?? null,
    })
    .where(eq(mediaAssets.id, assetId));
  return { ok: true };
}

export async function getCurrent(database: DB, logicalKey: string): Promise<MediaAsset | null> {
  const rows = await database
    .select()
    .from(mediaAssets)
    .where(and(eq(mediaAssets.logicalKey, logicalKey), eq(mediaAssets.isCurrent, 1)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findByChecksum(database: DB, checksumSha256: string): Promise<MediaAsset[]> {
  return database.select().from(mediaAssets).where(eq(mediaAssets.checksumSha256, checksumSha256)).limit(20);
}

/**
 * Tolerant producer seam: register a produced asset without ever breaking the
 * producing pipeline. Pre-0088 environments (table absent) and transient DB
 * errors log loudly and return null — production of media must not fail
 * because its bookkeeping did. Callers that REQUIRE registration (archive
 * gate, acceptance harness) use registerAsset directly instead.
 */
export async function registerProducedAsset(
  database: DB,
  buffer: Buffer,
  input: Omit<RegisterAssetInput, "checksumSha256" | "byteSize">,
): Promise<MediaAsset | null> {
  try {
    return await registerFromBuffer(database, buffer, input);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isMissingTableError(err)) {
      log.warn("media registry table absent (0088 not applied here) — asset NOT registered", {
        logicalKey: input.logicalKey,
      });
    } else {
      log.error("media registry registration failed — asset produced but NOT registered", {
        logicalKey: input.logicalKey, error: msg,
      });
    }
    return null;
  }
}
