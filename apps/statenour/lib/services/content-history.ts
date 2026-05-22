/**
 * lib/services/content-history.ts · misc-pages slice (2026-05-22 ·
 * legacy-modernizer REST→tRPC).
 *
 * Shared read for the /content/history pattern-mining surface — past
 * content scored by the 7-axis output critic (brain_memory rows,
 * category="nick_quality"). Pre-slice the `/api/content/history` GET
 * inlined this query + the in-memory metadata filter + the aggregate
 * stats; this module extracts all of it so the REST route AND the
 * `operator.contentHistory` tRPC procedure call ONE function — drift
 * structurally impossible.
 *
 * TS2589 firewall · the `brain_memory.metadata` Json column would leak
 * Prisma's recursive `JsonValue` into the AppRouter. `ContentHistoryRow`
 * below projects `metadata` to the flat `QualityMetadata` shape (a
 * non-recursive interface) and stringifies `createdAt`, so the
 * procedure's return type stays shallow.
 */

import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

/** Flat 7-axis quality metadata · non-recursive · the firewall shape
 *  for the brain_memory Json column. Mirrors the page's read fields. */
export interface QualityMetadata {
  conversationId?: string;
  overall?: number;
  specificity?: number;
  cliche?: number;
  antiNour?: number;
  length?: number;
  brandElement?: number;
  cta?: number;
  hashtagQuality?: number;
  contentMode?: boolean;
  shouldRegen?: boolean;
  wordCount?: number;
  turnIntent?: string;
  turnShape?: string;
  persona?: string;
}

export interface ContentHistoryRow {
  id: string;
  content: string;
  createdAt: string;
  metadata: QualityMetadata;
}

export interface ContentHistoryStats {
  avgOverall: number;
  avgSpecificity: number;
  avgCliche: number;
  avgAntiNour: number;
  avgLength: number;
  avgBrand: number;
  avgCTA: number;
  avgHashtag: number;
  regenRate: number;
  contentModeRate: number;
  byShape: Record<string, number>;
  byIntent: Record<string, number>;
}

export interface ContentHistoryPayload {
  ok: true;
  window: { days: number; since: string };
  filters: {
    q: string;
    minScore: number;
    maxScore: number;
    shape: string;
    intent: string;
    contentModeOnly: boolean;
  };
  count: number;
  rows: ContentHistoryRow[];
  stats: ContentHistoryStats;
}

export interface ContentHistoryQuery {
  q?: string;
  minScore?: number;
  maxScore?: number;
  shape?: string;
  intent?: string;
  contentModeOnly?: boolean;
  days?: number;
}

/**
 * Search scored content. The legacy route clamped each numeric input
 * at the boundary; the same clamps live here so the service is
 * self-defending regardless of caller (the tRPC `.input()` also
 * bounds them — defense in depth).
 */
export async function getContentHistory(
  query: ContentHistoryQuery = {},
): Promise<ContentHistoryPayload> {
  const q = (query.q ?? "").trim();
  const minScore = Math.max(0, Math.min(100, Number(query.minScore ?? 0)));
  const maxScore = Math.max(0, Math.min(100, Number(query.maxScore ?? 100)));
  const shape = query.shape ?? "";
  const intent = query.intent ?? "";
  const contentModeOnly = query.contentModeOnly === true;
  const days = Math.max(1, Math.min(365, Number(query.days ?? 30)));

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await prisma.brainMemory
    .findMany({
      where: {
        category: BRAIN_CATEGORIES.NICK_QUALITY,
        createdAt: { gte: since },
        ...(q && { content: { contains: q, mode: "insensitive" as const } }),
      },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        id: true,
        content: true,
        createdAt: true,
        metadata: true,
      },
    })
    .catch(
      () =>
        [] as Array<{
          id: string;
          content: string;
          createdAt: Date;
          metadata: unknown;
        }>,
    );

  // Filter in-memory by metadata fields (Prisma JSON path filters can
  // be finicky across DB versions; a 500-row JS filter is fast enough).
  const filtered = rows.filter((r) => {
    const meta = (r.metadata as QualityMetadata | null) ?? {};
    if (typeof meta.overall === "number") {
      if (meta.overall < minScore || meta.overall > maxScore) return false;
    }
    if (shape && meta.turnShape !== shape) return false;
    if (intent && meta.turnIntent !== intent) return false;
    if (contentModeOnly && !meta.contentMode) return false;
    return true;
  });

  const stats = aggregateStats(filtered);

  return {
    ok: true,
    window: { days, since: since.toISOString() },
    filters: { q, minScore, maxScore, shape, intent, contentModeOnly },
    count: filtered.length,
    rows: filtered.slice(0, 200).map((r) => ({
      id: r.id,
      content: r.content,
      createdAt: r.createdAt.toISOString(),
      metadata: (r.metadata as QualityMetadata | null) ?? {},
    })),
    stats,
  };
}

function aggregateStats(
  rows: Array<{ metadata: unknown }>,
): ContentHistoryStats {
  if (rows.length === 0) {
    return {
      avgOverall: 0,
      avgSpecificity: 0,
      avgCliche: 0,
      avgAntiNour: 0,
      avgLength: 0,
      avgBrand: 0,
      avgCTA: 0,
      avgHashtag: 0,
      regenRate: 0,
      contentModeRate: 0,
      byShape: {},
      byIntent: {},
    };
  }
  const sum = (k: keyof QualityMetadata): number => {
    let total = 0;
    let count = 0;
    for (const r of rows) {
      const meta = (r.metadata as QualityMetadata | null) ?? {};
      const v = meta[k];
      if (typeof v === "number") {
        total += v;
        count++;
      }
    }
    return count > 0 ? Math.round(total / count) : 0;
  };

  const byShape: Record<string, number> = {};
  const byIntent: Record<string, number> = {};
  let regen = 0;
  let contentMode = 0;
  for (const r of rows) {
    const meta = (r.metadata as QualityMetadata | null) ?? {};
    if (meta.turnShape) byShape[meta.turnShape] = (byShape[meta.turnShape] ?? 0) + 1;
    if (meta.turnIntent)
      byIntent[meta.turnIntent] = (byIntent[meta.turnIntent] ?? 0) + 1;
    if (meta.shouldRegen) regen++;
    if (meta.contentMode) contentMode++;
  }

  return {
    avgOverall: sum("overall"),
    avgSpecificity: sum("specificity"),
    avgCliche: sum("cliche"),
    avgAntiNour: sum("antiNour"),
    avgLength: sum("length"),
    avgBrand: sum("brandElement"),
    avgCTA: sum("cta"),
    avgHashtag: sum("hashtagQuality"),
    regenRate: Math.round((regen / rows.length) * 100) / 100,
    contentModeRate: Math.round((contentMode / rows.length) * 100) / 100,
    byShape,
    byIntent,
  };
}
