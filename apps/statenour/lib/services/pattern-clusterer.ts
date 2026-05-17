/**
 * pattern-clusterer · Wave 23 (v10.0.529.79) · #2
 *
 * Scans the last 7 days of BrainMemory(category="task_insight") rows
 * (regex + LLM-enriched) and clusters them by metadata.axis. When 3+
 * insights share an axis, emit a BrainMemory(category="task_pattern")
 * row so /brain (and /trends) can surface "the system noticed" cards.
 *
 * The cluster also tracks the dominant wisdom_query across its
 * members · this becomes the cluster's recommended next-action
 * prompt (a thread the operator can pull on).
 *
 * Design choices:
 *   · Pure read-side · the regex insight rows already exist · this
 *     is summary generation, not new write paths
 *   · Idempotent · upserts by (category, key) so re-running the
 *     clusterer doesn't multiply rows · same key = same cluster
 *   · Cluster threshold MIN_MEMBERS=3 · below this it's coincidence,
 *     not a pattern
 *   · Stale clusters auto-expire via lastSeen TTL · BrainMemory
 *     has hourly-decay support already
 *
 * Two callers:
 *   1. /api/brain/patterns endpoint reads the rows · UI displays them
 *   2. Nightly cron `mega-evening` calls runPatternClustering() once
 *      so today's check-offs are clustered before tomorrow's brief
 *
 * Skills applied:
 *   · agent-memory-systems · clustering by metadata key
 *   · vector-database-engineer · keyword Jaccard is the cheap first
 *     pass; pgvector embedding cosine is the v24 upgrade
 *   · ux-flow · the "system noticed" moment lives wherever the
 *     operator reads (brain, trends, daily-brief)
 */

import { prisma } from "@/lib/prisma";
import { activeOnly } from "@/lib/db/soft-delete";
import { logger } from "@/lib/logger";
import { cosineSimilarity } from "@/lib/brain/embedding-utils";

const log = logger.withSurface("pattern-clusterer");

/** How many insights in the same axis before we call it a pattern. */
const MIN_MEMBERS = 3;

/** Lookback window for clustering. */
const LOOKBACK_DAYS = 7;

/** Max patterns surfaced at once · keeps /brain readable. */
const MAX_PATTERNS = 10;

/** Cosine similarity threshold for the v25 semantic cluster pass.
 *  Higher than 0.5 (catches synonyms) but below 0.85 (catches near-
 *  duplicates only). 0.7 is the empirical sweet spot for clustering
 *  task insights — pulls "researched X" + "studied Y" together when
 *  they're in the same neighborhood, leaves unrelated work separate. */
const SEMANTIC_CLUSTER_THRESHOLD = 0.7;

interface InsightRow {
  id: string;
  key: string;
  content: string;
  metadata: { axis?: string | null; wisdom_query?: string | null } | null;
  createdAt: Date;
  lastSeen: Date;
}

export interface ClusteredPattern {
  axis: string;
  memberCount: number;
  memberKeys: string[];
  /** Sample of insight content lines (max 3) for display. */
  sampleContent: string[];
  /** Most-common wisdom_query across the cluster · drives the next-
   *  action recall. */
  dominantWisdomQuery: string | null;
  /** Most-recent member's lastSeen · for sort + freshness. */
  freshness: string;
}

/**
 * Cluster recent insights by axis and persist as BrainMemory(category
 * ="task_pattern") rows. Idempotent · safe to run repeatedly.
 */
export async function runPatternClustering(): Promise<{
  patterns: ClusteredPattern[];
  emitted: number;
}> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);

  const insights = (await prisma.brainMemory
    .findMany({
      where: activeOnly({
        category: "task_insight",
        lastSeen: { gte: since },
      }),
      select: {
        id: true,
        key: true,
        content: true,
        metadata: true,
        createdAt: true,
        lastSeen: true,
      },
      take: 500,
    })
    .catch((): InsightRow[] => [])) as InsightRow[];

  // Group by axis (skip nulls · those are not yet LLM-enriched).
  const buckets = new Map<string, InsightRow[]>();
  for (const row of insights) {
    const axis = row.metadata?.axis;
    if (!axis) continue;
    const list = buckets.get(axis) ?? [];
    list.push(row);
    buckets.set(axis, list);
  }

  const patterns: ClusteredPattern[] = [];
  for (const [axis, members] of buckets) {
    if (members.length < MIN_MEMBERS) continue;

    // Sort by lastSeen desc for freshness · take the top members
    // for the sample.
    members.sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime());

    // Find the dominant wisdom_query (mode across members).
    const wisdomCounts = new Map<string, number>();
    for (const m of members) {
      const wq = m.metadata?.wisdom_query;
      if (!wq) continue;
      wisdomCounts.set(wq, (wisdomCounts.get(wq) ?? 0) + 1);
    }
    let dominantWisdomQuery: string | null = null;
    let topCount = 0;
    for (const [q, c] of wisdomCounts) {
      if (c > topCount) {
        topCount = c;
        dominantWisdomQuery = q;
      }
    }

    patterns.push({
      axis,
      memberCount: members.length,
      memberKeys: members.slice(0, 10).map((m) => m.key),
      sampleContent: members.slice(0, 3).map((m) => m.content),
      dominantWisdomQuery,
      freshness: members[0]!.lastSeen.toISOString(),
    });
  }

  // v10.0.529.81 · Wave 25 · semantic cluster pass.
  // Load pgvector embeddings for the lookback-window insights and
  // group by cosine similarity ≥ SEMANTIC_CLUSTER_THRESHOLD. Catches
  // patterns the axis groupBy misses entirely · e.g. "researched
  // zustand" + "studied useReducer" cluster as the same thread even
  // when their LLM-assigned axis differs.
  try {
    const semantic = await runSemanticClusterPass(insights);
    patterns.push(...semantic);
  } catch (err) {
    log.warn("semantic_pass_failed", {
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
  }

  // Sort by memberCount desc · biggest patterns first.
  patterns.sort((a, b) => b.memberCount - a.memberCount);
  const top = patterns.slice(0, MAX_PATTERNS);

  // Persist each pattern as a BrainMemory row · key = "pattern:<axis>"
  // (one row per axis · upserts cleanly).
  let emitted = 0;
  for (const p of top) {
    const key = `pattern:${p.axis}`;
    try {
      await prisma.brainMemory.upsert({
        where: { category_key: { category: "task_pattern", key } },
        create: {
          category: "task_pattern",
          key,
          content: `${p.memberCount} task insights cluster on ${p.axis}`,
          confidence: Math.min(0.95, 0.6 + p.memberCount * 0.05),
          source: "pattern-clusterer",
          createdBy: "system:pattern-clusterer",
          metadata: {
            axis: p.axis,
            memberCount: p.memberCount,
            memberKeys: p.memberKeys,
            sampleContent: p.sampleContent,
            dominantWisdomQuery: p.dominantWisdomQuery,
            freshness: p.freshness,
            generatedAt: new Date().toISOString(),
          },
        },
        update: {
          content: `${p.memberCount} task insights cluster on ${p.axis}`,
          confidence: Math.min(0.95, 0.6 + p.memberCount * 0.05),
          metadata: {
            axis: p.axis,
            memberCount: p.memberCount,
            memberKeys: p.memberKeys,
            sampleContent: p.sampleContent,
            dominantWisdomQuery: p.dominantWisdomQuery,
            freshness: p.freshness,
            generatedAt: new Date().toISOString(),
          },
          lastSeen: new Date(),
          seenCount: { increment: 1 },
        },
      });
      emitted++;
    } catch (err) {
      log.warn("pattern_upsert_failed", {
        axis: p.axis,
        error: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
    }
  }

  return { patterns: top, emitted };
}

/**
 * v25 · semantic cluster pass · loads pgvector embeddings for the
 * lookback window's task_insight rows + greedy clusters by cosine
 * similarity. Surfaces threads the axis-only groupBy misses (e.g.
 * insights that the LLM enrichment hasn't reached yet, or whose
 * axis assignments differ but content is semantically related).
 *
 * Returns ClusteredPattern[] with axis="semantic:<seed-content>" so
 * the UI can distinguish these from axis-grouped clusters.
 */
async function runSemanticClusterPass(insights: InsightRow[]): Promise<ClusteredPattern[]> {
  if (insights.length < MIN_MEMBERS) return [];

  // Load embeddings for ALL lookback-window insight rows in one shot.
  const ids = insights.map((i) => i.id);
  const embedRows = await prisma.vectorEmbedding
    .findMany({
      where: {
        sourceType: "brain_memory",
        sourceId: { in: ids },
      },
      select: { sourceId: true, embedding: true },
    })
    .catch((): Array<{ sourceId: string; embedding: string }> => []);

  if (embedRows.length < MIN_MEMBERS) return [];

  // Parse vectors and build a lookup.
  const vecBySource = new Map<string, number[]>();
  for (const r of embedRows) {
    try {
      const v = JSON.parse(r.embedding) as number[];
      if (Array.isArray(v) && v.length > 0) vecBySource.set(r.sourceId, v);
    } catch {
      // skip malformed
    }
  }

  // Greedy cosine clustering · seed-and-grow.
  const insightById = new Map(insights.map((i) => [i.id, i]));
  const remaining = new Set<string>(vecBySource.keys());
  const clusters: { members: InsightRow[]; vecSum: number[]; size: number }[] = [];

  for (const seedId of vecBySource.keys()) {
    if (!remaining.has(seedId)) continue;
    const seedVec = vecBySource.get(seedId);
    if (!seedVec) continue;
    const seedInsight = insightById.get(seedId);
    if (!seedInsight) continue;

    const cluster = {
      members: [seedInsight],
      vecSum: [...seedVec],
      size: 1,
    };
    remaining.delete(seedId);

    for (const otherId of [...remaining]) {
      const otherVec = vecBySource.get(otherId);
      if (!otherVec || otherVec.length !== seedVec.length) continue;
      // Compare against the running centroid (vecSum / size).
      const centroid = cluster.vecSum.map((v) => v / cluster.size);
      const sim = cosineSimilarity(centroid, otherVec);
      if (sim >= SEMANTIC_CLUSTER_THRESHOLD) {
        const otherInsight = insightById.get(otherId);
        if (otherInsight) {
          cluster.members.push(otherInsight);
          for (let i = 0; i < cluster.vecSum.length; i++) {
            cluster.vecSum[i] = (cluster.vecSum[i] ?? 0) + (otherVec[i] ?? 0);
          }
          cluster.size++;
          remaining.delete(otherId);
        }
      }
    }

    if (cluster.members.length >= MIN_MEMBERS) {
      clusters.push(cluster);
    }
  }

  // Convert to ClusteredPattern shape. axis prefix marks semantic vs
  // axis-grouped origin so the PatternCard can render them
  // differently (or fold them together).
  return clusters.map((c) => {
    c.members.sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime());

    const wisdomCounts = new Map<string, number>();
    for (const m of c.members) {
      const wq = m.metadata?.wisdom_query;
      if (!wq) continue;
      wisdomCounts.set(wq, (wisdomCounts.get(wq) ?? 0) + 1);
    }
    let dominantWisdomQuery: string | null = null;
    let topCount = 0;
    for (const [q, count] of wisdomCounts) {
      if (count > topCount) {
        topCount = count;
        dominantWisdomQuery = q;
      }
    }

    // Derive an axis label from the most-common metadata.axis in the
    // cluster (when present). Prefix "semantic:" so the UI can
    // distinguish from a pure-axis cluster.
    const axisCounts = new Map<string, number>();
    for (const m of c.members) {
      const a = m.metadata?.axis;
      if (!a) continue;
      axisCounts.set(a, (axisCounts.get(a) ?? 0) + 1);
    }
    let topAxis: string | null = null;
    let topAxisCount = 0;
    for (const [a, count] of axisCounts) {
      if (count > topAxisCount) {
        topAxisCount = count;
        topAxis = a;
      }
    }
    const axisLabel = topAxis ? `semantic:${topAxis}` : "semantic:unsorted";

    return {
      axis: axisLabel,
      memberCount: c.members.length,
      memberKeys: c.members.slice(0, 10).map((m) => m.key),
      sampleContent: c.members.slice(0, 3).map((m) => m.content),
      dominantWisdomQuery,
      freshness: c.members[0]!.lastSeen.toISOString(),
    };
  });
}

/**
 * Read-side helper · returns the current patterns from BrainMemory
 * without re-running the clusterer. Used by /api/brain/patterns to
 * serve /brain + /trends fast.
 */
export async function loadCurrentPatterns(): Promise<ClusteredPattern[]> {
  const rows = await prisma.brainMemory
    .findMany({
      where: activeOnly({
        category: "task_pattern",
      }),
      orderBy: { confidence: "desc" },
      take: MAX_PATTERNS,
      select: { key: true, content: true, metadata: true, lastSeen: true },
    })
    .catch((): Array<{ key: string; content: string; metadata: unknown; lastSeen: Date }> => []);

  const out: ClusteredPattern[] = [];
  for (const r of rows) {
    try {
      const m = r.metadata as {
        axis?: string;
        memberCount?: number;
        memberKeys?: string[];
        sampleContent?: string[];
        dominantWisdomQuery?: string | null;
        freshness?: string;
      } | null;
      if (!m?.axis || !m?.memberCount) continue;
      out.push({
        axis: m.axis,
        memberCount: m.memberCount,
        memberKeys: m.memberKeys ?? [],
        sampleContent: m.sampleContent ?? [],
        dominantWisdomQuery: m.dominantWisdomQuery ?? null,
        freshness: m.freshness ?? r.lastSeen.toISOString(),
      });
    } catch {
      // skip malformed rows
    }
  }
  return out;
}
