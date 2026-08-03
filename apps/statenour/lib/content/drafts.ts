/**
 * Content draft store · v10.0.529.106 · Wave 76.
 *
 * Refactored to use the dedicated `SocialPublishQueue` Postgres table
 * in Statenour instead of `BrainMemory`.
 *
 * Status lifecycle: pending → approved → scheduled OR pending → rejected
 *
 * The /content page (Wave 76 UI) reads pending drafts, lets the
 * operator approve/edit/schedule with one tap.
 */

import { prisma } from "@/lib/prisma";
import { ServiceError } from "@/lib/utils/service-error";
import { randomUUID } from "node:crypto";

// v10.0.529.106 · Wave 76 · use built-in crypto.randomUUID for ID
// generation · matches the runner-auth pattern · no new npm dep needed.
const createId = () => randomUUID().replace(/-/g, "").slice(0, 24);

export type DraftStatus = "pending" | "approved" | "rejected" | "scheduled" | "published" | "rendering";

export interface ContentDraftMetadata {
  imageUrl?: string | null;
  suggestedPlatforms?: string[];
  status: DraftStatus;
  generatedAt: string;
  approvedAt?: string;
  rejectedAt?: string;
  scheduledFor?: string;
  publishedAt?: string;
  publishUrls?: string[];
  /** What kind of draft this is · drives display + filter. */
  kind?: "post" | "thread" | "story" | "reel";
  /** Free-text source attribution · "nick autogenerate" · "manual draft" · etc. */
  source?: string;
  /** Link to a Statenour mission if applicable */
  missionId?: string | null;
  /** JSON payload of source evidence (reviews, invoices, repairId) */
  sourceMetadata?: Record<string, any> | null;
}

export interface ContentDraft {
  id: string;
  key: string;
  content: string;
  metadata: ContentDraftMetadata;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Extracts the database CUID/UUID from a potential 'draft_xxx' or 'queue_xxx' key.
 */
function parseIdFromKey(key: string): string {
  if (key.startsWith("draft_")) {
    return key.slice(6);
  }
  if (key.startsWith("queue_")) {
    return key.slice(6);
  }
  return key;
}

/**
 * Maps a SocialPublishQueue row to the ContentDraft shape for backward compatibility.
 */
function mapQueueItemToDraft(item: any): ContentDraft {
  return {
    id: item.id,
    key: `draft_${item.id}`,
    content: item.content,
    metadata: {
      status: item.status as DraftStatus,
      imageUrl: item.imageUrl,
      suggestedPlatforms: item.platforms,
      scheduledFor: item.scheduledFor?.toISOString() ?? undefined,
      publishedAt: item.publishedAt?.toISOString() ?? undefined,
      publishUrls: item.publishUrls ?? [],
      kind: item.kind as ContentDraftMetadata["kind"],
      source: item.source,
      generatedAt: item.createdAt.toISOString(),
      approvedAt: item.approvedAt?.toISOString() ?? undefined,
      rejectedAt: item.rejectedAt?.toISOString() ?? undefined,
      missionId: item.missionId,
      sourceMetadata: (item.sourceMetadata ?? {}) as Record<string, any>,
    },
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

/**
 * Create a new draft · returns the SocialPublishQueue id + key.
 */
export async function createDraft(input: {
  content: string;
  imageUrl?: string | null;
  suggestedPlatforms?: string[];
  kind?: ContentDraftMetadata["kind"];
  source?: string;
  missionId?: string | null;
  sourceMetadata?: Record<string, any> | null;
}): Promise<{ id: string; key: string }> {
  const id = createId();
  const key = `draft_${id}`;

  const row = await prisma.socialPublishQueue.create({
    data: {
      id,
      content: input.content.slice(0, 4000),
      status: "pending",
      imageUrl: input.imageUrl ?? null,
      platforms: input.suggestedPlatforms ?? [],
      kind: input.kind ?? "post",
      source: input.source ?? "manual",
      missionId: input.missionId ?? null,
      sourceMetadata: input.sourceMetadata ?? {},
    },
  });

  return { id: row.id, key };
}

/**
 * List drafts · optional status filter. Defaults to pending.
 * Newest first.
 */
export async function listDrafts(opts: {
  status?: DraftStatus | "all";
  limit?: number;
} = {}): Promise<ContentDraft[]> {
  const status = opts.status ?? "pending";
  const limit = Math.min(opts.limit ?? 50, 200);

  const rows = await prisma.socialPublishQueue.findMany({
    where: {
      deletedAt: null,
      ...(status !== "all" ? { status } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return rows.map(mapQueueItemToDraft);
}

/**
 * Statuses whose row must not be re-stated by an operator action.
 *
 * `rendering` is held by a worker (the Remotion render lane AND the durable
 * publish worker both use it). Moving it out from under the publish worker
 * trips its finalize lock (social-publish.ts `social_publish_db_lock_abort`),
 * so a post that DID go live on Instagram never records publishedAt/
 * publishUrls — and the row lands back in the claim set, where the next
 * dispatch double-posts it. `published` is terminal.
 *
 * `rejected` is deliberately NOT here: re-approving a rejected draft is a
 * legitimate retry.
 */
const UNTOUCHABLE_STATUSES = ["rendering", "published"];

/** An operator action tried to re-state a row a worker owns. 409 via apiHandler. */
export class DraftStateError extends ServiceError {
  constructor(action: string, status: string) {
    super(`Cannot ${action} a draft that is "${status}" — a worker owns it.`, 409);
    this.name = "DraftStateError";
  }
}

/**
 * Approve a draft · marks it as approved + sets approvedAt.
 */
export async function approveDraft(key: string): Promise<ContentDraft | null> {
  const id = parseIdFromKey(key);
  const existing = await prisma.socialPublishQueue.findFirst({
    where: { id, deletedAt: null },
  });
  if (!existing) return null;
  if (UNTOUCHABLE_STATUSES.includes(existing.status)) {
    throw new DraftStateError("approve", existing.status);
  }

  // Compare-and-set, not a bare update: the read above can go stale between
  // the check and the write, which is exactly the window that double-posts.
  const claimed = await prisma.socialPublishQueue.updateMany({
    where: { id, deletedAt: null, status: { notIn: UNTOUCHABLE_STATUSES } },
    data: {
      status: "approved",
      approvedAt: new Date(),
    },
  });
  if (claimed.count !== 1) {
    throw new DraftStateError("approve", "claimed by a worker mid-update");
  }

  const row = await prisma.socialPublishQueue.findUnique({ where: { id } });
  return row ? mapQueueItemToDraft(row) : null;
}

/**
 * AG-33 · Replace a draft's content (the revise loop). Merges the new
 * critic metadata into sourceMetadata rather than clobbering whatever
 * the generator stored.
 */
export async function updateDraftContent(
  key: string,
  content: string,
  sourceMetadataPatch?: Record<string, unknown>,
): Promise<ContentDraft | null> {
  const id = parseIdFromKey(key);
  const existing = await prisma.socialPublishQueue.findFirst({
    where: { id, deletedAt: null },
  });
  if (!existing) return null;

  const mergedMeta = {
    ...((existing.sourceMetadata ?? {}) as Record<string, unknown>),
    ...(sourceMetadataPatch ?? {}),
  };
  const row = await prisma.socialPublishQueue.update({
    where: { id },
    data: {
      content,
      sourceMetadata: mergedMeta as never,
    },
  });
  return mapQueueItemToDraft(row);
}

/**
 * Reject a draft · soft-deletes the row.
 */
export async function rejectDraft(key: string, reason?: string): Promise<void> {
  const id = parseIdFromKey(key);
  const existing = await prisma.socialPublishQueue.findFirst({
    where: { id, deletedAt: null },
  });
  if (!existing) return;

  await prisma.socialPublishQueue.update({
    where: { id },
    data: {
      status: "rejected",
      rejectedAt: new Date(),
      rejectionReason: reason ?? null,
      deletedAt: new Date(),
    },
  });

  if (reason) {
    await prisma.auditEvent.create({
      data: {
        actor: "content_drafts",
        eventType: "draft_rejected",
        detail: reason.slice(0, 200),
        payload: { key, reason: reason.slice(0, 500) } as never,
      },
    }).catch(() => undefined);
  }
}

/**
 * Mark a draft as scheduled.
 */
export async function markScheduled(key: string, scheduledFor: string): Promise<void> {
  const id = parseIdFromKey(key);
  const existing = await prisma.socialPublishQueue.findFirst({
    where: { id, deletedAt: null },
  });
  if (!existing) return;
  if (UNTOUCHABLE_STATUSES.includes(existing.status)) {
    throw new DraftStateError("schedule", existing.status);
  }

  const claimed = await prisma.socialPublishQueue.updateMany({
    where: { id, deletedAt: null, status: { notIn: UNTOUCHABLE_STATUSES } },
    data: {
      status: "scheduled",
      scheduledFor: new Date(scheduledFor),
    },
  });
  if (claimed.count !== 1) {
    throw new DraftStateError("schedule", "claimed by a worker mid-update");
  }
}

/**
 * Rollup counts for the page header · quick "5 pending · 12 scheduled"
 * style stats.
 */
export async function getDraftCounts(): Promise<Record<DraftStatus | "total", number>> {
  const counts: Record<DraftStatus | "total", number> = {
    pending: 0,
    approved: 0,
    rejected: 0,
    scheduled: 0,
    published: 0,
    rendering: 0,
    total: 0,
  };

  const statusGroups = await prisma.socialPublishQueue.groupBy({
    by: ["status"],
    where: { deletedAt: null },
    _count: {
      _all: true,
    },
  });

  for (const group of statusGroups) {
    const s = group.status as DraftStatus;
    if (counts[s] !== undefined) {
      counts[s] = group._count._all;
      counts.total += group._count._all;
    }
  }

  return counts;
}
