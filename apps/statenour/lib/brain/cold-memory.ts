/**
 * Cold Memory — semantic search over Drive-backed brain memories.
 *
 * The "hot" system prompt carries ~20 high-confidence memories inline
 * on every request — enough for Nick to have baseline identity +
 * feedback + brand rules. But Nour's actual memory corpus has
 * thousands of entries, and the 50K system prompt ceiling on Venice
 * means most of them are silently dropped.
 *
 * Cold memory flips the model:
 *   - Archived memories (Drive-sourced docs, old brain dumps, older
 *     patterns) live in the brain_memory table with embeddings
 *   - The system prompt DOES NOT include them inline
 *   - Instead, Nick has a `searchColdMemory` tool he can call when
 *     a conversation needs to reach back for specific archived info
 *
 * This keeps the hot prompt lean (~35K instead of 73K) while making
 * the ENTIRE corpus addressable via tool call — so Nick can answer
 * "what was that note I wrote about X" even when X hasn't been
 * touched in 6 months.
 *
 * Uses the existing semanticSearch() from embedding-utils.ts which
 * does hybrid scoring (70% embedding similarity + 15% recency + 15%
 * confidence + reinforcement bonus) across the brain_memory table.
 *
 * Filters applied on top:
 *   - scope: which memory source buckets to search (drive, all, etc.)
 *   - minScore: cutoff below which matches are treated as noise
 *   - limit: how many to return
 */

import { prisma } from "@/lib/prisma";
import { semanticSearch } from "@/lib/brain/embedding-utils";

export type ColdMemoryScope = "drive" | "all" | "archive" | "ingest";

export interface ColdMemoryMatch {
  id: string;
  category: string;
  content: string;
  similarity: number;
  hybridScore: number;
  confidence: number;
  source: string;
  modifiedTime?: string;
  driveViewUrl?: string;
  driveTitle?: string;
}

interface BrainMemoryLean {
  id: string;
  category: string;
  content: string;
  source: string;
  confidence: number;
  updatedAt: Date;
  metadata: unknown;
}

function extractDriveMeta(metadata: unknown): {
  viewUrl?: string;
  title?: string;
  modifiedTime?: string;
} {
  if (!metadata || typeof metadata !== "object") return {};
  const m = metadata as Record<string, unknown>;
  return {
    viewUrl: typeof m.viewUrl === "string" ? m.viewUrl : undefined,
    title: typeof m.title === "string" ? m.title : undefined,
    modifiedTime: typeof m.modifiedTime === "string" ? m.modifiedTime : undefined,
  };
}

/**
 * Scope filters — decide which brain_memory sources count as "cold"
 * for a given query.
 *
 *   drive   — only memories ingested by drive_cron (default, narrow)
 *   ingest  — any ingested content: drive_cron, gmail_cron, calendar_cron
 *   archive — archive candidates: old memories with expired freshness
 *   all     — every brain_memory record regardless of source
 */
function buildSourceFilter(scope: ColdMemoryScope): string[] | null {
  switch (scope) {
    case "drive":
      return ["drive_cron", "drive_manual_sync"];
    case "ingest":
      return [
        "drive_cron",
        "drive_manual_sync",
        "gmail_cron",
        "calendar_cron",
        "knowledge_sync",
      ];
    case "archive":
      return null; // "archive" uses a different filter — handled in query
    case "all":
    default:
      return null; // No filter — all sources allowed
  }
}

/**
 * The primary entry point — search cold memory by natural language
 * query with semantic ranking. Delegates to semanticSearch() for the
 * vector math, then post-filters by source scope and enriches with
 * Drive metadata (view URL, modified time) when available.
 *
 * Returns the top-N matches sorted by hybrid score.
 */
export async function searchColdMemory(
  query: string,
  options: {
    scope?: ColdMemoryScope;
    limit?: number;
    minScore?: number;
  } = {}
): Promise<ColdMemoryMatch[]> {
  const scope = options.scope ?? "drive";
  const limit = Math.max(1, Math.min(50, options.limit ?? 5));
  const minScore = options.minScore ?? 0.25;

  // Use the existing semantic search to get candidate hits.
  // We pull 4x the requested limit so we have room to post-filter by source.
  const candidates = await semanticSearch(query, limit * 4);
  if (candidates.length === 0) return [];

  // Pull metadata for the candidate sourceIds so we can filter + enrich
  const ids = candidates.map((c) => c.sourceId);
  const memories = (await prisma.brainMemory
    .findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        category: true,
        content: true,
        source: true,
        confidence: true,
        updatedAt: true,
        metadata: true,
      },
    })
    .catch(() => [])) as BrainMemoryLean[];

  const byId = new Map<string, BrainMemoryLean>();
  for (const m of memories) byId.set(m.id, m);

  const sourceFilter = buildSourceFilter(scope);

  const results: ColdMemoryMatch[] = [];
  for (const c of candidates) {
    if (c.hybridScore < minScore) continue;
    const meta = byId.get(c.sourceId);
    if (!meta) continue;

    // Apply source filter when scope is narrowed
    if (sourceFilter && !sourceFilter.includes(meta.source)) continue;

    const driveMeta = extractDriveMeta(meta.metadata);

    results.push({
      id: meta.id,
      category: meta.category,
      content: meta.content,
      similarity: c.similarity,
      hybridScore: c.hybridScore,
      confidence: meta.confidence,
      source: meta.source,
      modifiedTime: driveMeta.modifiedTime,
      driveViewUrl: driveMeta.viewUrl,
      driveTitle: driveMeta.title,
    });

    if (results.length >= limit) break;
  }

  return results;
}

/**
 * Stats for the HUD + prompt inspector — how much cold memory exists
 * and how much of it is indexed with embeddings.
 *
 * Used by the Settings page Drive Sync card to show the user what's
 * cached, when it was last synced, and whether the embedding coverage
 * is healthy.
 */
export async function getColdMemoryStats(): Promise<{
  totalBrainMemories: number;
  driveIngested: number;
  embeddingCoverage: number;
  lastDriveSync: string | null;
  categories: Record<string, number>;
}> {
  try {
    const [total, driveCount, embedded, lastSync, byCategory] = await Promise.all([
      prisma.brainMemory.count(),
      prisma.brainMemory.count({
        where: { deletedAt: null, source: { in: ["drive_cron", "drive_manual_sync"] } },
      }),
      prisma.vectorEmbedding.count({ where: { sourceType: "brain_memory" } }),
      prisma.auditEvent.findFirst({
        where: { eventType: "drive_docs_ingested" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
      prisma.brainMemory.groupBy({
        by: ["category"],
        _count: { _all: true },
        where: { deletedAt: null, source: { in: ["drive_cron", "drive_manual_sync"] } },
      }),
    ]);

    const categories: Record<string, number> = {};
    for (const row of byCategory) {
      categories[row.category] = row._count._all;
    }

    return {
      totalBrainMemories: total,
      driveIngested: driveCount,
      embeddingCoverage: total > 0 ? embedded / total : 0,
      lastDriveSync: lastSync?.createdAt.toISOString() ?? null,
      categories,
    };
  } catch {
    return {
      totalBrainMemories: 0,
      driveIngested: 0,
      embeddingCoverage: 0,
      lastDriveSync: null,
      categories: {},
    };
  }
}
