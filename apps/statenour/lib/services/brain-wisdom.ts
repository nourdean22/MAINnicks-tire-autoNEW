/**
 * Brain wisdom curation service · Phase UU (2026-05-19 AM).
 *
 * Reads + curation actions for the /brain/wisdom dashboard. Called
 * by BOTH the legacy REST endpoints AND the new `trpc.brain.wisdom*`
 * procedures · drift between consumers structurally impossible.
 *
 * The wisdom layer is high-stakes (top-3 always-on slot per chat
 * turn · source-trust 1.5x boost). Operator-curated edits set
 * confidence=1.0 automatically. Re-runs are idempotent.
 */

import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

export interface WisdomEntry {
  id: string;
  key: string;
  content: string;
  confidence: number;
  seenCount: number;
  /** Derived from metadata.origin · falls back to inferring from key. */
  origin: string;
  source: string;
  createdAt: string;
  lastSeen: string;
  ageDays: number;
  hotness: number; // 0-1 score
}

export interface WisdomFeedView {
  total: number;
  totalRecalls: number;
  groupings: {
    origin: Record<string, number>;
    source: Record<string, number>;
  };
  hottest: WisdomEntry[];
  freshest: WisdomEntry[];
  entries: WisdomEntry[];
}

function inferOrigin(key: string, metaOrigin: string | null): string {
  if (metaOrigin) return metaOrigin;
  if (key.startsWith("wisdom_jobs_")) return "steve-jobs";
  if (key.startsWith("wisdom_satori_")) return "satori";
  if (key.startsWith("wisdom_distilled_")) return "distiller";
  if (key.startsWith("wisdom_from_")) return "consolidation";
  if (key.startsWith("nick_advice_")) return "chat-scrape";
  return "uncategorized";
}

export async function buildWisdomFeed(): Promise<WisdomFeedView> {
  const rows = await prisma.brainMemory.findMany({
    where: { category: BRAIN_CATEGORIES.WISDOM, deletedAt: null },
    orderBy: [{ confidence: "desc" }, { seenCount: "desc" }],
    select: {
      id: true,
      key: true,
      content: true,
      confidence: true,
      seenCount: true,
      source: true,
      createdAt: true,
      lastSeen: true,
      metadata: true,
    },
  });

  const now = Date.now();
  const maxSeen = Math.max(1, ...rows.map((r) => r.seenCount));

  const entries: WisdomEntry[] = rows.map((r) => {
    const meta = r.metadata as { origin?: string } | null;
    const origin = inferOrigin(r.key, meta?.origin ?? null);
    const ageDays = Math.round((now - r.createdAt.getTime()) / 86400_000);
    const recallScore = Math.log10(1 + r.seenCount) / Math.log10(1 + maxSeen);
    const hotness = Math.min(1, recallScore * 0.7 + r.confidence * 0.3);
    return {
      id: r.id,
      key: r.key,
      content: r.content,
      confidence: r.confidence,
      seenCount: r.seenCount,
      origin,
      source: r.source,
      createdAt: r.createdAt.toISOString(),
      lastSeen: r.lastSeen.toISOString(),
      ageDays,
      hotness,
    };
  });

  const groupingsOrigin: Record<string, number> = {};
  const groupingsSource: Record<string, number> = {};
  let totalRecalls = 0;
  for (const e of entries) {
    groupingsOrigin[e.origin] = (groupingsOrigin[e.origin] ?? 0) + 1;
    groupingsSource[e.source] = (groupingsSource[e.source] ?? 0) + 1;
    totalRecalls += e.seenCount;
  }

  const hottest = [...entries]
    .sort((a, b) => b.seenCount - a.seenCount)
    .slice(0, 5);
  const freshest = [...entries]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  return {
    total: entries.length,
    totalRecalls,
    groupings: { origin: groupingsOrigin, source: groupingsSource },
    hottest,
    freshest,
    entries,
  };
}

// ─── Curation mutations ───────────────────────────────────────

export class WisdomNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`wisdom not found: ${id}`);
    this.name = "WisdomNotFoundError";
  }
}

export class NoValidFieldsError extends Error {
  constructor() {
    super("no valid fields to update");
    this.name = "NoValidFieldsError";
  }
}

export class WrongCategoryError extends Error {
  constructor(public readonly category: string) {
    super(`cannot promote · category is ${category} not wisdom_candidate`);
    this.name = "WrongCategoryError";
  }
}

export async function updateWisdom(args: {
  id: string;
  content?: string;
  confidence?: number;
}): Promise<{ ok: true; memory: { id: string; content: string; confidence: number; category: string } }> {
  const update: {
    content?: string;
    confidence?: number;
    lastSeen?: Date;
    createdBy?: string;
  } = {};
  if (typeof args.content === "string" && args.content.trim().length >= 30) {
    update.content = args.content.trim().slice(0, 2000);
  }
  if (
    typeof args.confidence === "number" &&
    args.confidence >= 0 &&
    args.confidence <= 1
  ) {
    update.confidence = args.confidence;
  }
  if (Object.keys(update).length === 0) {
    throw new NoValidFieldsError();
  }
  update.lastSeen = new Date();
  update.createdBy = "user";

  const updated = await prisma.brainMemory.update({
    where: { id: args.id },
    data: update,
    select: { id: true, content: true, confidence: true, category: true },
  });
  return { ok: true, memory: updated };
}

export type WisdomAction = "deprecate" | "promote" | "restore";

export async function actOnWisdom(args: {
  id: string;
  action: WisdomAction;
}): Promise<
  | { ok: true; action: "deprecated" | "restored"; id: string }
  | { ok: true; action: "promoted"; memory: { id: string; category: string; confidence: number } }
> {
  if (args.action === "deprecate") {
    const updated = await prisma.brainMemory.update({
      where: { id: args.id },
      data: { deletedAt: new Date() },
      select: { id: true, deletedAt: true },
    });
    return { ok: true, action: "deprecated", id: updated.id };
  }
  if (args.action === "restore") {
    const updated = await prisma.brainMemory.update({
      where: { id: args.id },
      data: { deletedAt: null },
      select: { id: true, deletedAt: true },
    });
    return { ok: true, action: "restored", id: updated.id };
  }
  // promote · wisdom_candidate → wisdom
  const existing = await prisma.brainMemory.findUnique({
    where: { id: args.id },
    select: { id: true, category: true, metadata: true },
  });
  if (!existing) throw new WisdomNotFoundError(args.id);
  if (existing.category !== "wisdom_candidate") {
    throw new WrongCategoryError(existing.category);
  }
  const meta = (existing.metadata ?? {}) as Record<string, unknown>;
  delete meta.gateReject;
  delete meta.gateDetail;
  meta.promotedFromCandidate = new Date().toISOString();
  const updated = await prisma.brainMemory.update({
    where: { id: args.id },
    data: {
      category: BRAIN_CATEGORIES.WISDOM,
      confidence: 0.9,
      createdBy: "user",
      metadata: meta as never,
    },
    select: { id: true, category: true, confidence: true },
  });
  return { ok: true, action: "promoted", memory: updated };
}
