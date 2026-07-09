/**
 * lib/brain/wisdom-evolution.ts · v10.0.406
 *
 * Self-improving wisdom layer · surfaces concrete EVOLUTION
 * CANDIDATES the operator can approve in /brain/wisdom · never
 * auto-mutates the wisdom corpus.
 *
 * Three candidate categories:
 *
 *   STALE      · wisdom hasn't been touched in N+ days AND confidence
 *                is below the floor · likely no longer relevant
 *
 *   REDUNDANT  · two wisdoms with cosine ≥ 0.92 and overlapping topic
 *                tags · candidate for merge (keep higher confidence)
 *
 *   LOW_TRUST  · operator-promoted but confidence < 0.5 after multiple
 *                last-seen events · pattern of doubt-then-deprecate
 *
 * Why operator-confirm not auto-edit · the wisdom corpus is the brain's
 * memory · auto-demoting based on heuristics could erase the operator's
 * hard-won curation. Surfacing candidates keeps the human in the loop.
 *
 * v10.0.402 added the cosine-similarity graph endpoint. This layer
 * runs the same calculation across ALL wisdom pairs (O(n²)) but
 * caps at top redundancy candidates so we don't waste compute on
 * the long tail.
 */

import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/utils/error-log";
import { cosineSimilarity } from "@/lib/brain/embedding-utils";
import { tagWisdomTopics, type WisdomTopic } from "@/lib/brain/wisdom-topic-tagger";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

const STALE_DAYS_THRESHOLD = 60;
const STALE_CONFIDENCE_FLOOR = 0.5;
const REDUNDANT_SIMILARITY_THRESHOLD = 0.92;
const TOP_REDUNDANT_PAIRS = 20;
const TOP_STALE_PER_RUN = 30;

export interface StaleCandidate {
  type: "stale";
  id: string;
  key: string;
  content: string;
  confidence: number;
  lastSeen: Date;
  daysSinceLastSeen: number;
  reason: string;
}

export interface RedundantPair {
  type: "redundant";
  keepId: string;
  keepKey: string;
  keepContent: string;
  keepConfidence: number;
  mergeId: string;
  mergeKey: string;
  mergeContent: string;
  mergeConfidence: number;
  similarity: number;
  sharedTopics: WisdomTopic[];
  reason: string;
}

export interface LowTrustCandidate {
  type: "low_trust";
  id: string;
  key: string;
  content: string;
  confidence: number;
  lastSeen: Date;
  reason: string;
}

export type EvolutionCandidate = StaleCandidate | RedundantPair | LowTrustCandidate;

interface WisdomRow {
  id: string;
  key: string;
  content: string;
  confidence: number;
  lastSeen: Date;
}

interface EmbedRow {
  sourceId: string;
  embedding: string;
}

/**
 * Find stale wisdoms · last_seen old + confidence low.
 *
 * Sorted by staleness × inverse-confidence so the most-rotting
 * candidates surface first.
 */
export async function findStaleCandidates(
  daysThreshold = STALE_DAYS_THRESHOLD,
  confidenceFloor = STALE_CONFIDENCE_FLOOR,
): Promise<StaleCandidate[]> {
  const cutoff = new Date(Date.now() - daysThreshold * 86_400_000);
  const rows = await prisma.brainMemory.findMany({
    where: {
      category: BRAIN_CATEGORIES.WISDOM,
      deletedAt: null,
      lastSeen: { lt: cutoff },
      confidence: { lt: confidenceFloor },
    },
    select: {
      id: true,
      key: true,
      content: true,
      confidence: true,
      lastSeen: true,
    },
    orderBy: [{ lastSeen: "asc" }, { confidence: "asc" }],
    take: TOP_STALE_PER_RUN,
  });
  const now = Date.now();
  return rows.map((r) => ({
    type: "stale" as const,
    id: r.id,
    key: r.key,
    content: r.content,
    confidence: r.confidence,
    lastSeen: r.lastSeen,
    daysSinceLastSeen: Math.floor(
      (now - new Date(r.lastSeen).getTime()) / 86_400_000,
    ),
    reason: `Last seen ${Math.floor((now - new Date(r.lastSeen).getTime()) / 86_400_000)}d ago · confidence ${r.confidence.toFixed(2)} < ${confidenceFloor}`,
  }));
}

/**
 * Find redundant wisdom pairs · cosine similarity ≥ threshold AND
 * at least one shared topic. Returns the keep/merge designation
 * (higher-confidence wisdom kept) and the rationale.
 *
 * Pure on-demand · O(n²) on embeddings · capped at the top-K most
 * similar pairs so the response stays bounded for the operator UI.
 */
export async function findRedundantPairs(
  threshold = REDUNDANT_SIMILARITY_THRESHOLD,
  topK = TOP_REDUNDANT_PAIRS,
): Promise<RedundantPair[]> {
  // Pull all active wisdoms with confidence ≥ 0.5 (skip the truly
  // low-confidence ones · those are already stale candidates).
  const wisdoms = await prisma.brainMemory.findMany({
    where: {
      category: BRAIN_CATEGORIES.WISDOM,
      deletedAt: null,
      confidence: { gte: 0.5 },
    },
    select: {
      id: true,
      key: true,
      content: true,
      confidence: true,
      lastSeen: true,
    },
  });
  if (wisdoms.length < 2) return [];

  // Pull embeddings for the ones that have them.
  const embedRows = await prisma.vectorEmbedding.findMany({
    where: {
      sourceType: "brain_memory",
      sourceId: { in: wisdoms.map((w) => w.id) },
    },
    select: { sourceId: true, embedding: true },
  });

  const wisdomById = new Map(wisdoms.map((w) => [w.id, w]));
  const parsed: { row: WisdomRow; vec: number[]; topics: WisdomTopic[] }[] = [];
  for (const er of embedRows) {
    const w = wisdomById.get(er.sourceId);
    if (!w) continue;
    try {
      const vec = JSON.parse(er.embedding) as number[];
      if (!Array.isArray(vec) || vec.length === 0) continue;
      parsed.push({ row: w, vec, topics: tagWisdomTopics(w.content) });
    } catch (err) {
      logError("brain.wisdom-evolution", err, { fn: "findRedundantPairs.parseVec", sourceId: er.sourceId });
    }
  }

  // O(n²) pairwise · capped by parsed.length × parsed.length / 2
  const all: { i: number; j: number; sim: number }[] = [];
  for (let i = 0; i < parsed.length; i++) {
    for (let j = i + 1; j < parsed.length; j++) {
      if (parsed[i].vec.length !== parsed[j].vec.length) continue;
      const sim = cosineSimilarity(parsed[i].vec, parsed[j].vec);
      if (sim < threshold) continue;
      all.push({ i, j, sim });
    }
  }
  all.sort((a, b) => b.sim - a.sim);

  const out: RedundantPair[] = [];
  const seenIds = new Set<string>();
  for (const { i, j, sim } of all) {
    if (out.length >= topK) break;
    const a = parsed[i], b = parsed[j];
    // De-dupe · don't surface a wisdom in two pairs · keeps the
    // operator UI clean (one merge decision per wisdom max).
    if (seenIds.has(a.row.id) || seenIds.has(b.row.id)) continue;

    const sharedTopics = a.topics.filter((t) => b.topics.includes(t));
    if (sharedTopics.length === 0) continue;

    // Higher confidence wins · ties broken by more-recent lastSeen
    const keep = a.row.confidence > b.row.confidence
      ? a
      : a.row.confidence < b.row.confidence
        ? b
        : a.row.lastSeen > b.row.lastSeen ? a : b;
    const merge = keep === a ? b : a;

    out.push({
      type: "redundant",
      keepId: keep.row.id,
      keepKey: keep.row.key,
      keepContent: keep.row.content,
      keepConfidence: keep.row.confidence,
      mergeId: merge.row.id,
      mergeKey: merge.row.key,
      mergeContent: merge.row.content,
      mergeConfidence: merge.row.confidence,
      similarity: Math.round(sim * 1000) / 1000,
      sharedTopics,
      reason: `Cosine ${sim.toFixed(3)} · shared topics: ${sharedTopics.join(", ")} · keep higher-confidence (${keep.row.confidence.toFixed(2)} vs ${merge.row.confidence.toFixed(2)})`,
    });
    seenIds.add(a.row.id);
    seenIds.add(b.row.id);
  }
  return out;
}

/**
 * Find low-trust wisdoms · operator promoted them at some point
 * but confidence drifted below 0.5 with multiple last-seen events
 * (pattern of doubt). These are NOT stale (they're being recalled)
 * but are losing trust.
 */
export async function findLowTrustCandidates(): Promise<LowTrustCandidate[]> {
  const recentCutoff = new Date(Date.now() - 14 * 86_400_000);
  const rows = await prisma.brainMemory.findMany({
    where: {
      category: BRAIN_CATEGORIES.WISDOM,
      deletedAt: null,
      confidence: { lt: 0.5, gte: 0.2 }, // not deleted-tier, not yet stale
      lastSeen: { gte: recentCutoff }, // recently active
    },
    select: {
      id: true,
      key: true,
      content: true,
      confidence: true,
      lastSeen: true,
    },
    orderBy: { confidence: "asc" },
    take: 15,
  });
  return rows.map((r) => ({
    type: "low_trust" as const,
    id: r.id,
    key: r.key,
    content: r.content,
    confidence: r.confidence,
    lastSeen: r.lastSeen,
    reason: `Active in last 14d but confidence ${r.confidence.toFixed(2)} drifting low · review for accuracy or deprecate`,
  }));
}

/**
 * One-shot · runs all three candidate finders and returns a merged
 * report. Counts kept separate so the UI can tab between them.
 */
export async function runWisdomEvolution(): Promise<{
  stale: StaleCandidate[];
  redundant: RedundantPair[];
  lowTrust: LowTrustCandidate[];
  totalCandidates: number;
}> {
  const [stale, redundant, lowTrust] = await Promise.all([
    findStaleCandidates(),
    findRedundantPairs(),
    findLowTrustCandidates(),
  ]);
  return {
    stale,
    redundant,
    lowTrust,
    totalCandidates: stale.length + redundant.length + lowTrust.length,
  };
}
