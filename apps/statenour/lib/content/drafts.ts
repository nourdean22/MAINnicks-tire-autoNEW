/**
 * Content draft store · v10.0.529.106 · Wave 76.
 *
 * Pre-Wave-76 the content pipeline (lib/ai/content-multi.ts +
 * lib/social/buffer.ts + lib/social/meta-publish.ts) shipped posts
 * directly · there was no "drafts pending approval" queue.
 *
 * This module adds the approval-queue layer using BrainMemory as
 * storage (no new table per the no-duplicate-data rule):
 *   · category="content_draft"
 *   · key="draft_<cuid>"
 *   · content = the post text
 *   · metadata = { imageUrl, suggestedPlatforms, status,
 *                  generatedAt, approvedAt, scheduledFor }
 *
 * Status lifecycle: pending → approved → scheduled OR pending → rejected
 *
 * The /content page (Wave 76 UI) reads pending drafts, lets the
 * operator approve/edit/schedule with one tap.
 */

import { prisma } from "@/lib/prisma";
import { randomUUID } from "node:crypto";

// v10.0.529.106 · Wave 76 · use built-in crypto.randomUUID for ID
// generation · matches the runner-auth pattern · no new npm dep needed.
const createId = () => randomUUID().replace(/-/g, "").slice(0, 24);

export type DraftStatus = "pending" | "approved" | "rejected" | "scheduled" | "published";

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
}

export interface ContentDraft {
  id: string;
  key: string;
  content: string;
  metadata: ContentDraftMetadata;
  createdAt: Date;
  updatedAt: Date;
}

const CATEGORY = "content_draft";

/**
 * Create a new draft · returns the BrainMemory id + key for follow-up.
 * Operator-facing entry point for "Nick generated 3 ideas · here they are."
 */
export async function createDraft(input: {
  content: string;
  imageUrl?: string | null;
  suggestedPlatforms?: string[];
  kind?: ContentDraftMetadata["kind"];
  source?: string;
}): Promise<{ id: string; key: string }> {
  const key = `draft_${createId()}`;
  const metadata: ContentDraftMetadata = {
    status: "pending",
    generatedAt: new Date().toISOString(),
    imageUrl: input.imageUrl ?? null,
    suggestedPlatforms: input.suggestedPlatforms ?? [],
    kind: input.kind ?? "post",
    source: input.source ?? "manual",
  };
  const row = await prisma.brainMemory.create({
    data: {
      category: CATEGORY,
      key,
      content: input.content.slice(0, 4000),
      source: input.source ?? "content_drafts",
      confidence: 0.6,
      metadata: metadata as never,
    },
  });
  return { id: row.id, key };
}

/**
 * List drafts · optional status filter. Defaults to pending (the
 * approval queue's primary use case). Newest first.
 */
export async function listDrafts(opts: {
  status?: DraftStatus | "all";
  limit?: number;
} = {}): Promise<ContentDraft[]> {
  const status = opts.status ?? "pending";
  const limit = Math.min(opts.limit ?? 50, 200);

  const rows = await prisma.brainMemory.findMany({
    where: { category: CATEGORY, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: limit * 2, // oversample · we filter by status in JS
    select: {
      id: true,
      key: true,
      content: true,
      metadata: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const filtered = rows
    .map((r) => ({
      id: r.id,
      key: r.key,
      content: r.content,
      metadata: (r.metadata ?? {}) as unknown as ContentDraftMetadata,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }))
    .filter((d) => status === "all" || d.metadata.status === status)
    .slice(0, limit);

  return filtered;
}

/**
 * Approve a draft · marks it as approved + sets approvedAt.
 * After approval the operator separately calls scheduleDraft() or
 * publishes via /api/social/publish.
 */
export async function approveDraft(key: string): Promise<ContentDraft | null> {
  const existing = await prisma.brainMemory.findUnique({
    where: { category_key: { category: CATEGORY, key } },
    select: { id: true, content: true, metadata: true },
  });
  if (!existing) return null;
  const meta = (existing.metadata ?? {}) as unknown as ContentDraftMetadata;
  const updated: ContentDraftMetadata = {
    ...meta,
    status: "approved",
    approvedAt: new Date().toISOString(),
  };
  const row = await prisma.brainMemory.update({
    where: { category_key: { category: CATEGORY, key } },
    data: { metadata: updated as never },
  });
  return {
    id: row.id,
    key: row.key,
    content: row.content,
    metadata: updated,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Reject a draft · soft-deletes the row (operator can recover via
 * /system trash views per the v7.9 universal soft-delete contract).
 */
export async function rejectDraft(key: string, reason?: string): Promise<void> {
  const existing = await prisma.brainMemory.findUnique({
    where: { category_key: { category: CATEGORY, key } },
    select: { metadata: true },
  });
  if (!existing) return;
  const meta = (existing.metadata ?? {}) as unknown as ContentDraftMetadata;
  await prisma.brainMemory.update({
    where: { category_key: { category: CATEGORY, key } },
    data: {
      metadata: {
        ...meta,
        status: "rejected",
        rejectedAt: new Date().toISOString(),
      } as never,
      deletedAt: new Date(),
    },
  });
  if (reason) {
    // Log the reason for future pattern detection · "Nour rejects
    // CTA-heavy drafts" type insights.
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
 * Mark a draft as scheduled · used after the operator triggers
 * publish/schedule via /api/social/* with the draft's key reference.
 */
export async function markScheduled(key: string, scheduledFor: string): Promise<void> {
  const existing = await prisma.brainMemory.findUnique({
    where: { category_key: { category: CATEGORY, key } },
    select: { metadata: true },
  });
  if (!existing) return;
  const meta = (existing.metadata ?? {}) as unknown as ContentDraftMetadata;
  await prisma.brainMemory.update({
    where: { category_key: { category: CATEGORY, key } },
    data: {
      metadata: {
        ...meta,
        status: "scheduled",
        scheduledFor,
      } as never,
    },
  });
}

/**
 * Rollup counts for the page header · quick "5 pending · 12 scheduled"
 * style stats. Single query · groupBy on status path.
 */
export async function getDraftCounts(): Promise<Record<DraftStatus | "total", number>> {
  const rows = await prisma.brainMemory.findMany({
    where: { category: CATEGORY, deletedAt: null },
    select: { metadata: true },
    take: 500,
  });
  const counts: Record<DraftStatus | "total", number> = {
    pending: 0,
    approved: 0,
    rejected: 0,
    scheduled: 0,
    published: 0,
    total: rows.length,
  };
  for (const r of rows) {
    const m = (r.metadata ?? {}) as unknown as ContentDraftMetadata;
    const s = (m.status ?? "pending") as DraftStatus;
    if (counts[s] !== undefined) counts[s]++;
  }
  return counts;
}
