/**
 * Provenance records for non-reel social inventory (posts, carousels, stories).
 *
 * Reels have had this since the approval-integrity arc: an approval writes
 * briefHash + mediaHash into social_content_approvals, and publish recomputes
 * both and refuses on mismatch — so what goes live is byte-identical to what
 * a human approved. Every OTHER format published whatever URLs the row (or
 * worse, the client) carried at publish time, with no integrity check at all
 * (2026-07-16 verification pass; missed by both prior audits). This service
 * gives the other formats the same guarantee.
 *
 * Hash semantics (parity with the reel path in routers/instagramAdmin.ts):
 * - briefHash  = sha256(briefJson string, verbatim)
 * - mediaHash  = single URL → sha256(bytes); multiple URLs (carousel) →
 *   sha256(joined per-URL sha256 hex digests, in order) — order is part of
 *   the approval: a reordered carousel is a different post.
 * - "mock://" URLs hash to the reel path's fixed sentinel so tests and dry
 *   runs never fetch.
 */
import { createHash } from "crypto";
import { eq, and } from "drizzle-orm";
import { socialContentApprovals } from "../../drizzle/schema";
import type { DB } from "../db";

const MOCK_MEDIA_HASH = "mocked_media_hash_32chars_long_hash";

async function hashOneUrl(url: string): Promise<string> {
  if (url.startsWith("mock://")) return MOCK_MEDIA_HASH;
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) {
    throw new Error(`Failed to download media for integrity hashing: HTTP ${res.status} (${url.slice(0, 120)})`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return createHash("sha256").update(buf).digest("hex");
}

export async function computeMediaHash(urls: string[]): Promise<string> {
  if (urls.length === 0) throw new Error("No media URLs to hash");
  const digests: string[] = [];
  for (const url of urls) digests.push(await hashOneUrl(url));
  if (digests.length === 1) return digests[0];
  return createHash("sha256").update(digests.join("|")).digest("hex");
}

export function computeBriefHash(briefJson: string | null): string {
  return createHash("sha256").update(briefJson || "").digest("hex");
}

/** Write the approval record for (inventoryId, version). Idempotent per the
 *  table's unique (inventoryId, version) index — a re-approve of the same
 *  version replaces nothing and surfaces as a duplicate-key error upstream. */
export async function createApprovalRecord(
  database: DB,
  args: { inventoryId: string; version: number; approvedBy: number; briefJson: string | null; mediaUrls: string[] },
): Promise<{ approvalId: string; briefHash: string; mediaHash: string }> {
  const { randomUUID } = await import("crypto");
  const briefHash = computeBriefHash(args.briefJson);
  const mediaHash = await computeMediaHash(args.mediaUrls);
  const approvalId = `appr_${randomUUID()}`;
  await database.insert(socialContentApprovals).values({
    id: approvalId,
    inventoryId: args.inventoryId,
    version: args.version,
    approvedBy: args.approvedBy,
    briefHash,
    mediaHash,
    mediaUrl: JSON.stringify(args.mediaUrls),
  });
  return { approvalId, briefHash, mediaHash };
}

export type ApprovalVerification =
  | { ok: true }
  | { ok: false; reason: "no_record" }
  | { ok: false; reason: "brief_mismatch" | "media_mismatch" };

/**
 * Recompute hashes for the CURRENT row state and compare against the approval
 * record for (inventoryId, version). "no_record" is a distinct outcome so
 * callers can decide policy: the V2 publish path fails closed on it, while the
 * cron publisher lets legacy rows (approved before this service existed)
 * through with a warning rather than bricking the whole queue.
 */
export async function verifyApprovalRecord(
  database: DB,
  args: { inventoryId: string; version: number; briefJson: string | null; mediaUrls: string[] },
): Promise<ApprovalVerification> {
  const rows = await database
    .select()
    .from(socialContentApprovals)
    .where(and(eq(socialContentApprovals.inventoryId, args.inventoryId), eq(socialContentApprovals.version, args.version)))
    .limit(1);
  if (!rows.length) return { ok: false, reason: "no_record" };
  const approval = rows[0];
  if (computeBriefHash(args.briefJson) !== approval.briefHash) return { ok: false, reason: "brief_mismatch" };
  if ((await computeMediaHash(args.mediaUrls)) !== approval.mediaHash) return { ok: false, reason: "media_mismatch" };
  return { ok: true };
}
