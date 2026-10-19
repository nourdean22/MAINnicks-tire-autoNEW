/**
 * Shop media library (2026-10-18): the review gate between Nour's imported
 * camera roll (scripts/import-shop-media.mts) and anything public. Storage URLs
 * are world-readable, so the importer registers every item quarantined with
 * reuse_allowed=0 and only an approval here makes it reusable.
 *
 * "approved" = lifecycle available AND reuse_allowed=1 AND a shop-media
 * provider. Every read throws on failure: an error is never an empty library.
 */
import { and, desc, eq, gt, gte, inArray, sql, type SQL } from "drizzle-orm";
import { mediaAssets } from "../../drizzle/schema";
import {
  SHOP_MEDIA_PROVIDERS,
  type ShopMediaItem,
  type ShopMediaKind,
  type ShopMediaOrientation,
  type ShopMediaPage,
  type ShopMediaReviewResult,
  type ShopMediaState,
  type ShopMediaStats,
} from "../../shared/shopMedia";
import type { DB } from "../db";
import { createLogger } from "../lib/logger";

const log = createLogger("services:shop-media-library");

/** The review gate's approve write. Exported so the binding test judges the real values. */
export const APPROVE_SET = { lifecycleState: "available", reuseAllowed: 1 } as const;
const REJECT_SET = { lifecycleState: "rejected", reuseAllowed: 0 } as const;

const PROVIDERS: readonly string[] = SHOP_MEDIA_PROVIDERS;
const CHUNK = 200;

export interface ListShopMediaInput {
  state: ShopMediaState;
  kind?: ShopMediaKind;
  orientation?: ShopMediaOrientation;
  people?: string;
  tag?: string;
  cursor?: number;
  limit?: number;
}

function stateCondition(state: ShopMediaState): SQL {
  if (state === "approved") return and(eq(mediaAssets.lifecycleState, "available"), eq(mediaAssets.reuseAllowed, 1)) as SQL;
  return eq(mediaAssets.lifecycleState, state);
}

interface Triage { subject?: unknown; tags?: unknown; quality?: unknown; moe?: unknown; people?: unknown; plate?: unknown }
function readParams(json: string | null): { capturedAt: string | null; faces: number | null; triage: Triage } {
  try {
    const p = json ? (JSON.parse(json) as { capturedAt?: unknown; faces?: unknown; triage?: Triage }) : {};
    return {
      capturedAt: typeof p.capturedAt === "string" ? p.capturedAt : null,
      faces: typeof p.faces === "number" ? p.faces : null,
      triage: p.triage && typeof p.triage === "object" ? p.triage : {},
    };
  } catch {
    return { capturedAt: null, faces: null, triage: {} };
  }
}

type ListRow = {
  id: string; runtimeUrl: string | null; format: string; width: number | null; height: number | null; durationMs: number | null;
  rightsStatus: string; lifecycleState: string; reuseAllowed: number; generationParamsJson: string | null;
};

function toItem(row: ListRow): ShopMediaItem {
  const { capturedAt, faces, triage } = readParams(row.generationParamsJson);
  return {
    assetId: row.id,
    url: row.runtimeUrl,
    kind: row.format === "video" ? "video" : "photo",
    width: row.width,
    height: row.height,
    durationMs: row.durationMs,
    capturedAt,
    subject: typeof triage.subject === "string" ? triage.subject : null,
    tags: Array.isArray(triage.tags) ? triage.tags.filter((t): t is string => typeof t === "string") : [],
    faces,
    moe: typeof triage.moe === "boolean" ? triage.moe : null,
    people: typeof triage.people === "string" ? triage.people : null,
    plate: typeof triage.plate === "boolean" ? triage.plate : null,
    quality: typeof triage.quality === "number" ? triage.quality : null,
    rightsStatus: row.rightsStatus,
    lifecycleState: row.lifecycleState,
    reuseAllowed: Number(row.reuseAllowed) === 1,
  };
}

/**
 * One page of the library, newest first. people/tag live in the free-form
 * params TEXT, so they filter in JS; the cursor is the RAW row offset after the
 * last row consumed, which keeps paging exact however many rows a filter drops.
 */
export async function listShopMedia(database: DB, input: ListShopMediaInput): Promise<ShopMediaPage> {
  const limit = Math.min(Math.max(input.limit ?? 30, 1), 60);
  const conditions: SQL[] = [inArray(mediaAssets.provider, [...PROVIDERS]), eq(mediaAssets.isCurrent, 1), stateCondition(input.state)];
  if (input.kind) conditions.push(eq(mediaAssets.format, input.kind === "video" ? "video" : "image"));
  if (input.orientation === "vertical") conditions.push(gt(mediaAssets.height, mediaAssets.width));
  if (input.orientation === "horizontal") conditions.push(gte(mediaAssets.width, mediaAssets.height));
  const where = and(...conditions);

  const items: ShopMediaItem[] = [];
  let offset = input.cursor ?? 0;
  for (;;) {
    const batch = (await database.select({
      id: mediaAssets.id, runtimeUrl: mediaAssets.runtimeUrl, format: mediaAssets.format, width: mediaAssets.width,
      height: mediaAssets.height, durationMs: mediaAssets.durationMs, rightsStatus: mediaAssets.rightsStatus,
      lifecycleState: mediaAssets.lifecycleState, reuseAllowed: mediaAssets.reuseAllowed, generationParamsJson: mediaAssets.generationParamsJson,
    }).from(mediaAssets).where(where)
      .orderBy(desc(mediaAssets.createdAt), desc(mediaAssets.id))
      .limit(CHUNK).offset(offset)) as ListRow[];
    for (let i = 0; i < batch.length; i++) {
      const item = toItem(batch[i]);
      if (input.people && item.people !== input.people) continue;
      if (input.tag && !item.tags.includes(input.tag)) continue;
      items.push(item);
      if (items.length === limit) {
        const more = i + 1 < batch.length || batch.length === CHUNK;
        return { items, nextCursor: more ? offset + i + 1 : null };
      }
    }
    if (batch.length < CHUNK) return { items, nextCursor: null };
    offset += batch.length;
  }
}

function affected(result: unknown): number {
  const header = Array.isArray(result) ? result[0] : result;
  return Number((header as { affectedRows?: number } | undefined)?.affectedRows ?? 0);
}

/**
 * Approve or reject. Each write is a compare-and-swap on the exact row state
 * read (id, lifecycle, provider, reuse, current): a row someone else changed
 * in between matches nothing and is skipped with its real new state.
 */
export async function reviewShopMedia(database: DB, assetIds: string[], decision: "approve" | "reject"): Promise<ShopMediaReviewResult> {
  const ids = [...new Set(assetIds)];
  const rows = (await database.select({
    id: mediaAssets.id, lifecycleState: mediaAssets.lifecycleState, provider: mediaAssets.provider,
    reuseAllowed: mediaAssets.reuseAllowed, isCurrent: mediaAssets.isCurrent,
  }).from(mediaAssets).where(inArray(mediaAssets.id, ids))) as Array<{ id: string; lifecycleState: string; provider: string | null; reuseAllowed: number; isCurrent: number }>;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const changed: string[] = [];
  const skipped: ShopMediaReviewResult["skipped"] = [];

  for (const id of ids) {
    const row = byId.get(id);
    if (!row) { skipped.push({ assetId: id, reason: "not_found" }); continue; }
    if (!row.provider || !PROVIDERS.includes(row.provider)) { skipped.push({ assetId: id, reason: `not_shop_media:${row.provider ?? "none"}` }); continue; }
    if (Number(row.isCurrent) !== 1) { skipped.push({ assetId: id, reason: "not_current_version" }); continue; }
    if (decision === "approve" && row.lifecycleState !== "quarantined") { skipped.push({ assetId: id, reason: `not_quarantined:${row.lifecycleState}` }); continue; }
    if (decision === "reject" && row.lifecycleState !== "quarantined" && row.lifecycleState !== "available") {
      skipped.push({ assetId: id, reason: `not_reviewable:${row.lifecycleState}` }); continue;
    }
    const result = await database.update(mediaAssets)
      .set(decision === "approve" ? APPROVE_SET : REJECT_SET)
      .where(and(
        eq(mediaAssets.id, row.id),
        eq(mediaAssets.lifecycleState, row.lifecycleState),
        eq(mediaAssets.provider, row.provider),
        eq(mediaAssets.reuseAllowed, row.reuseAllowed),
        eq(mediaAssets.isCurrent, 1),
      ));
    if (affected(result) === 1) { changed.push(id); continue; }
    const [now] = await database.select({ id: mediaAssets.id, lifecycleState: mediaAssets.lifecycleState })
      .from(mediaAssets).where(eq(mediaAssets.id, id)) as Array<{ id: string; lifecycleState: string }>;
    skipped.push({ assetId: id, reason: `changed_concurrently:${now?.lifecycleState ?? "missing"}` });
  }
  log.info("shop media reviewed", { decision, changed: changed.length, skipped: skipped.length });
  return { changed, skipped };
}

/** Counts by state x kind over current shop-media rows. */
export async function shopMediaStats(database: DB): Promise<ShopMediaStats> {
  const rows = await database.select({
    lifecycleState: mediaAssets.lifecycleState, reuseAllowed: mediaAssets.reuseAllowed, format: mediaAssets.format,
    n: sql<number>`count(*)`,
  }).from(mediaAssets)
    .where(and(inArray(mediaAssets.provider, [...PROVIDERS]), eq(mediaAssets.isCurrent, 1)))
    .groupBy(mediaAssets.lifecycleState, mediaAssets.reuseAllowed, mediaAssets.format);
  const out: ShopMediaStats = {
    quarantined: { photo: 0, video: 0 }, approved: { photo: 0, video: 0 }, rejected: { photo: 0, video: 0 }, other: { photo: 0, video: 0 },
  };
  for (const r of rows) {
    const kind: ShopMediaKind = r.format === "video" ? "video" : "photo";
    const bucket = r.lifecycleState === "available" && Number(r.reuseAllowed) === 1 ? "approved"
      : r.lifecycleState === "quarantined" ? "quarantined"
      : r.lifecycleState === "rejected" ? "rejected" : "other";
    out[bucket][kind] += Number(r.n);
  }
  return out;
}
