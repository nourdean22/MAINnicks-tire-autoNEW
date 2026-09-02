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
import { resolveWisdomOrigin } from "@/lib/brain/wisdom-origins";

/**
 * Hard ceiling on rows shipped in one feed.
 *
 * 2026-09-02 self-audit, defect #7: this query had no `take` at all. It
 * shipped every wisdom row (~991 today) with full `content` (up to 2000
 * chars each, see `updateWisdom` below) on every call — and the wisdom
 * tab refetched the whole thing on any `brain` bus event.
 *
 * The ceiling is deliberately ABOVE today's corpus rather than a page
 * size. the `brain.wisdom` tRPC procedure calls `buildWisdomFeed()` with
 * no input and the tab has no pager, so a limit that bit today would
 * hide rows the operator has no way to reach — a worse defect than the
 * one being fixed. What it does buy: the query's cost is bounded no
 * matter how the corpus grows, and `truncated` makes the crossing
 * VISIBLE (the tab renders a warning) instead of silently dropping the
 * tail. Plumbing a real limit through the tRPC procedure is the
 * follow-up; it needs `brain.ts`, which this change does not touch.
 */
export const WISDOM_FEED_LIMIT = 1500;

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
  /** Whole corpus · counted in the DB, NOT `entries.length`. */
  total: number;
  /**
   * Rows actually shipped in `entries` — the pool every filter, search,
   * chip count and "showing X of Y" on the wisdom tab operates over.
   * Equals `total` until the corpus crosses `WISDOM_FEED_LIMIT`.
   */
  loaded: number;
  /** `loaded < total` · the tab warns rather than silently dropping the tail. */
  truncated: boolean;
  /** Whole corpus · summed in the DB so a truncated page can't undercount it. */
  totalRecalls: number;
  groupings: {
    origin: Record<string, number>;
    source: Record<string, number>;
  };
  hottest: WisdomEntry[];
  freshest: WisdomEntry[];
  entries: WisdomEntry[];
}

export async function buildWisdomFeed(limit = WISDOM_FEED_LIMIT): Promise<WisdomFeedView> {
  const where = { category: BRAIN_CATEGORIES.WISDOM, deletedAt: null };

  // `total` and `totalRecalls` are corpus-wide readings, so they come
  // from the DB rather than from the (possibly bounded) page. Deriving
  // them from `entries` is what would make a truncated feed lie about
  // the size of the corpus it truncated.
  const [agg, rows] = await Promise.all([
    prisma.brainMemory.aggregate({
      where,
      _count: { _all: true },
      _sum: { seenCount: true },
    }),
    prisma.brainMemory.findMany({
      where,
      orderBy: [{ confidence: "desc" }, { seenCount: "desc" }],
      take: limit,
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
    }),
  ]);

  const now = Date.now();
  const maxSeen = Math.max(1, ...rows.map((r) => r.seenCount));

  const entries: WisdomEntry[] = rows.map((r) => {
    const meta = r.metadata as { origin?: string } | null;
    const origin = resolveWisdomOrigin(r.key, meta?.origin ?? null);
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

  // Groupings are counted over `entries`, NOT over the corpus, and that
  // is load-bearing: the origin chips filter `entries`, so a chip
  // reading a corpus-wide count would promise rows the tab cannot show.
  // `sum(groupings.origin) === loaded === entries.length` is the
  // invariant the "all (N)" chip and "showing X of Y" both depend on.
  const groupingsOrigin: Record<string, number> = {};
  const groupingsSource: Record<string, number> = {};
  for (const e of entries) {
    groupingsOrigin[e.origin] = (groupingsOrigin[e.origin] ?? 0) + 1;
    groupingsSource[e.source] = (groupingsSource[e.source] ?? 0) + 1;
  }

  const hottest = [...entries]
    .sort((a, b) => b.seenCount - a.seenCount)
    .slice(0, 5);
  const freshest = [...entries]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  const total = agg._count._all;
  return {
    total,
    loaded: entries.length,
    truncated: entries.length < total,
    totalRecalls: agg._sum.seenCount ?? 0,
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
