/**
 * Real-shot binding (2026-10-09). A beat declared `source: "real"` names the
 * registry row that holds its footage (`StoryboardBeat.realAssetId`). Before
 * the generator loop this resolves that row, verifies it is operator-captured
 * shop footage the lane may reuse, and binds the EXACT bytes (runtime URL +
 * registry sha256 + probed duration) to the beat. A URL on its own never
 * self-asserts "real": the registry row's rights_status does.
 *
 * The verifier is pure so the refusal shapes are unit-tested; the DB read is
 * a thin wrapper that never throws (a failed read is a named refusal, not a
 * silent "no asset").
 */
import type { DB } from "../db";
import { createLogger } from "../lib/logger";
import type { ShotLineage } from "../../shared/reelSourceProfile";

const log = createLogger("services:real-shot-binding");

/** Lifecycle states a bound clip may be in. A rejected, quarantined or missing row is never bound. */
const BINDABLE_LIFECYCLES = new Set(["available", "quality_review", "approval_ready", "approved", "published"]);

export interface RealShopRowLike {
  id: string;
  rightsStatus: string;
  reuseAllowed: number;
  lifecycleState: string;
  format: string;
  mimeType: string;
  runtimeUrl: string | null;
  checksumSha256: string;
  durationMs: number | null;
  isCurrent: number;
}

export type RealShotRefusal =
  | "asset_not_found"
  | "not_real_shop"
  | "reuse_not_allowed"
  | "not_current_version"
  | "lifecycle_not_bindable"
  | "not_a_video"
  | "no_runtime_url"
  | "no_checksum"
  | "no_duration"
  | "registry_read_failed";

export interface RealShotBinding {
  beatNumber: number;
  assetId: string;
  url: string;
  sha256: string;
  rightsStatus: string;
  sourceDurationSec: number;
}

export type RealShotVerdict =
  | { ok: true; binding: RealShotBinding }
  | { ok: false; beatNumber: number; assetId: string; refusal: RealShotRefusal; detail: string };

/** Pure: is this registry row footage the lane may bind to a real beat? */
export function verifyRealShopVideoRow(beatNumber: number, assetId: string, row: RealShopRowLike | null | undefined): RealShotVerdict {
  const refuse = (refusal: RealShotRefusal, detail: string): RealShotVerdict => ({ ok: false, beatNumber, assetId, refusal, detail });
  if (!row) return refuse("asset_not_found", `media_assets has no row ${assetId}`);
  if (row.rightsStatus !== "real_shop") return refuse("not_real_shop", `rights_status is ${row.rightsStatus}, not real_shop`);
  if (Number(row.reuseAllowed) !== 1) return refuse("reuse_not_allowed", "reuse_allowed is 0");
  if (Number(row.isCurrent) !== 1) return refuse("not_current_version", "a newer version of this asset exists");
  if (!BINDABLE_LIFECYCLES.has(row.lifecycleState)) return refuse("lifecycle_not_bindable", `lifecycle_state is ${row.lifecycleState}`);
  if (row.format !== "video" || !/^video\//.test(row.mimeType)) return refuse("not_a_video", `${row.format}/${row.mimeType} — the real pool's stills are not footage`);
  if (!row.runtimeUrl || !/^https?:\/\//.test(row.runtimeUrl)) return refuse("no_runtime_url", "no http runtime_url to download");
  if (!/^[a-f0-9]{64}$/.test(row.checksumSha256 ?? "")) return refuse("no_checksum", "checksum_sha256 is not 64-hex");
  const durationSec = Number(row.durationMs) / 1000;
  if (!Number.isFinite(durationSec) || durationSec <= 0) return refuse("no_duration", "duration_ms is missing — probe and re-register the asset");
  return {
    ok: true,
    binding: { beatNumber, assetId: row.id, url: row.runtimeUrl, sha256: row.checksumSha256, rightsStatus: row.rightsStatus, sourceDurationSec: Number(durationSec.toFixed(3)) },
  };
}

export type HeroStillRefusal = Exclude<RealShotRefusal, "not_a_video" | "no_duration"> | "not_an_image";

export type HeroStillVerdict =
  | { ok: true; assetId: string; url: string; sha256: string }
  | { ok: false; assetId: string; refusal: HeroStillRefusal; detail: string };

/**
 * Pure: may this registry row anchor every generated clip as the hero frame
 * (2026-10-10)? Same rights/version/lifecycle rules as footage; the format
 * check inverts (a still, not a video) and no duration is needed.
 */
export function verifyRealShopStillRow(assetId: string, row: Omit<RealShopRowLike, "durationMs"> | null | undefined): HeroStillVerdict {
  const refuse = (refusal: HeroStillRefusal, detail: string): HeroStillVerdict => ({ ok: false, assetId, refusal, detail });
  if (!row) return refuse("asset_not_found", `media_assets has no row ${assetId}`);
  if (row.rightsStatus !== "real_shop") return refuse("not_real_shop", `rights_status is ${row.rightsStatus}, not real_shop`);
  if (Number(row.reuseAllowed) !== 1) return refuse("reuse_not_allowed", "reuse_allowed is 0");
  if (Number(row.isCurrent) !== 1) return refuse("not_current_version", "a newer version of this asset exists");
  if (!BINDABLE_LIFECYCLES.has(row.lifecycleState)) return refuse("lifecycle_not_bindable", `lifecycle_state is ${row.lifecycleState}`);
  if (row.format !== "image" || !/^image\/(jpe?g|png|webp)$/.test(row.mimeType)) return refuse("not_an_image", `${row.format}/${row.mimeType} — the hero frame must be a JPEG/PNG/WebP still (footage binds to a beat, not to the frame)`);
  if (!row.runtimeUrl || !/^https?:\/\//.test(row.runtimeUrl)) return refuse("no_runtime_url", "no http runtime_url to download");
  if (!/\.(jpe?g|png|webp)([?#]|$)/i.test(row.runtimeUrl)) return refuse("no_runtime_url", "runtime_url does not end in an image extension — the CLI's --start-image gate (higgsfieldStudio.buildSeedanceArgs) would silently drop it");
  if (!/^[a-f0-9]{64}$/.test(row.checksumSha256 ?? "")) return refuse("no_checksum", "checksum_sha256 is not 64-hex");
  return { ok: true, assetId: row.id, url: row.runtimeUrl, sha256: row.checksumSha256 };
}

/** DB wrapper for the hero still; a failed read is a named refusal. */
export async function resolveHeroStill(database: DB, assetId: string): Promise<HeroStillVerdict> {
  try {
    const { mediaAssets } = await import("../../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const [row] = await database.select().from(mediaAssets).where(eq(mediaAssets.id, assetId)).limit(1);
    return verifyRealShopStillRow(assetId, row as unknown as RealShopRowLike | undefined);
  } catch (err) {
    log.error("hero still registry read failed", { assetId, err: err instanceof Error ? err.message : String(err) });
    return { ok: false, assetId, refusal: "registry_read_failed", detail: err instanceof Error ? err.message.slice(0, 160) : String(err) };
  }
}

/**
 * The continuity block for a brief anchored on a REAL photo. The generated
 * visual world quotes the frame's generation prompt; a photograph has none, so
 * this names the place instead and tells the generator the frame is real.
 */
export function realStillInvariants(assetId: string, hint?: string): string {
  return [
    `VISUAL WORLD (a real photograph of Nick's Tire & Auto, Cleveland — the opening frame of every shot IS this photo):`,
    `Keep the photographed bay exactly as it is: the same floor, walls, lift, light fixtures, clutter and daylight direction in every shot; the camera may move, the place may not change.`,
    `Match the photo's exposure and colour exactly — real tungsten and daylight mix, no added glow, no colour grade the photo does not already have.`,
    hint ? `Operator note on the photo: ${hint}` : `Reference asset: ${assetId}.`,
    `Never introduce a different shop, a different vehicle, a cleaner floor or a studio background.`,
  ].join("\n");
}

/** The refusal line, one per beat, for the job's error column. */
export function realShotRefusalReason(refusals: ReadonlyArray<Extract<RealShotVerdict, { ok: false }>>): string {
  const parts = refusals.map((r) => `beat ${r.beatNumber} (asset ${r.assetId}): ${r.refusal} — ${r.detail}`);
  return `REAL_ASSET_NOT_BINDABLE (blocked at generation, before spend): ${parts.join("; ")}. Nothing was generated.`;
}

/** Lineage row for a verified binding. */
export function lineageForBinding(b: RealShotBinding, onScreenSec: number, now: () => string = () => new Date().toISOString()): ShotLineage {
  return {
    beatNumber: b.beatNumber,
    source: "real",
    origin: "registry_real_shop",
    assetId: b.assetId,
    sha256: b.sha256,
    url: b.url,
    rightsStatus: b.rightsStatus,
    sourceDurationSec: b.sourceDurationSec,
    trimInSec: 0,
    trimOutSec: Number(Math.min(onScreenSec, b.sourceDurationSec).toFixed(2)),
    onScreenSec: Number(onScreenSec.toFixed(2)),
    boundAt: now(),
  };
}

/**
 * Resolve every beat that names a realAssetId. Beats declared real WITHOUT an
 * id are not this function's business (the generator holds them as
 * needs_real_footage). Returns bindings and refusals separately; a registry
 * read failure refuses every requested beat with registry_read_failed.
 */
export async function resolveRealBeatAssets(
  database: DB,
  beats: ReadonlyArray<{ beatNumber: number; realAssetId?: string | null }>,
): Promise<{ bindings: RealShotBinding[]; refusals: Array<Extract<RealShotVerdict, { ok: false }>> }> {
  const wanted = beats.filter((b) => typeof b.realAssetId === "string" && b.realAssetId.trim());
  const bindings: RealShotBinding[] = [];
  const refusals: Array<Extract<RealShotVerdict, { ok: false }>> = [];
  if (!wanted.length) return { bindings, refusals };
  let rows: RealShopRowLike[];
  try {
    const { inArray } = await import("drizzle-orm");
    const { mediaAssets } = await import("../../drizzle/schema");
    rows = (await database
      .select({
        id: mediaAssets.id, rightsStatus: mediaAssets.rightsStatus, reuseAllowed: mediaAssets.reuseAllowed,
        lifecycleState: mediaAssets.lifecycleState, format: mediaAssets.format, mimeType: mediaAssets.mimeType,
        runtimeUrl: mediaAssets.runtimeUrl, checksumSha256: mediaAssets.checksumSha256, durationMs: mediaAssets.durationMs,
        isCurrent: mediaAssets.isCurrent,
      })
      .from(mediaAssets)
      .where(inArray(mediaAssets.id, wanted.map((b) => String(b.realAssetId).trim())))) as RealShopRowLike[];
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    log.warn("media registry read failed — refusing every real beat, not binding blindly", { error: detail });
    for (const b of wanted) refusals.push({ ok: false, beatNumber: b.beatNumber, assetId: String(b.realAssetId), refusal: "registry_read_failed", detail });
    return { bindings, refusals };
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const b of wanted) {
    const id = String(b.realAssetId).trim();
    const verdict = verifyRealShopVideoRow(b.beatNumber, id, byId.get(id));
    if (verdict.ok) bindings.push(verdict.binding);
    else refusals.push(verdict);
  }
  return { bindings, refusals };
}
