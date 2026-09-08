/**
 * saveToBrain · May 02 · v10.0.143
 *
 * User-triggered ingest. Mirrors the importance-scorer's auto-persist
 * but lets Nour explicitly save content via `/save <text>` (or other
 * surfaces). No LLM call — heuristic-only auto-categorization keeps
 * it fast (<50ms). For full AI parsing of brain dumps, the existing
 * `/api/brain/parse` + journal-ingest path stays the heavyweight option.
 *
 * Categories (heuristic order — first match wins):
 *   1. decision        — "I decided", "decision:", "going with X"
 *   2. belief          — "I believe", "I think", "my view is"
 *   3. strategy        — "strategy:", "playbook", "approach"
 *   4. brand_marketing — "brand", "voice", "tone", "style", "blueprint",
 *                        "Instagram", "marketing"
 *   5. pattern         — "pattern", "always X", "every time", "rule:"
 *   6. user_save       — fallback; raw content with timestamp key
 *
 * Returns the saved BrainMemory id + the inferred category + a short
 * summary line for the confirmation message. Caller decides whether to
 * surface that summary in chat / a toast / nowhere.
 *
 * 2026-09-07 · the write path is ordered so that NOTHING the operator
 * typed depends on an AI provider being up:
 *   1. deterministic identity (exact row, then whitespace/case-insensitive
 *      over the category's recent rows) — the only thing that counts as
 *      "already saved";
 *   2. the row is created;
 *   3. the embedding is optional enrichment — if it fails the row still
 *      exists and `cron/embed-backfill` indexes it later (it selects
 *      brain_memories with no vector_embeddings row);
 *   4. a near-duplicate (similar vector, different statement) is KEPT and
 *      queued for the operator through the contradiction review flow —
 *      never merged or superseded automatically. #2175 review threads.
 */

import { prisma } from "@/lib/prisma";
import { getEmbedding } from "@/lib/ai/provider";
import {
  isPgvectorAvailable,
  vectorLiteral,
  padToVectorDim,
  assertSafeVectorLiteral,
  VECTOR_DIM_1536,
} from "@/lib/db/pgvector";
import { cosineSimilarity } from "@/lib/brain/embedding-utils";
import { surfaceNearDuplicate } from "@/lib/brain/contradiction-surfacer";

export type SaveCategory =
  | "decision"
  | "belief"
  | "strategy"
  | "brand_marketing"
  | "pattern"
  | "user_save";

export interface SaveToBrainInput {
  content: string;
  /**
   * Optional override for the auto-categorizer. When the caller already
   * knows the category (e.g. a UI button labeled "Save as belief"),
   * pass it through and skip the heuristic.
   */
  category?: SaveCategory;
  /** Optional human-readable label for the BrainMemory.key field. */
  keyHint?: string;
  /** Confidence value persisted to the row. Default 0.85. */
  confidence?: number;
  /** Optional source label — defaults to "user_save". */
  source?: string;
  /** Optional metadata blob persisted alongside the content. */
  metadata?: Record<string, unknown>;
}

/**
 * What the save actually did. 2026-09-07: before this field existed the
 * near-duplicate branch returned `Saved as …` while KEEPING the old row's
 * text and dropping the new statement on the floor — a changed amount, date
 * or negation embeds within cosine 0.95 of the sentence it corrects, so the
 * correction was silently discarded and the confirmation lied about it.
 *   created                 — a new row, nothing similar existed
 *   duplicate               — the same statement (whitespace/case-insensitive)
 *                             already exists; its sighting count was bumped
 *   created_near_duplicate  — similar text existed but the wording differs;
 *                             BOTH rows are kept, linked (metadata
 *                             .nearDuplicateOf) and queued for review
 */
export type SaveOutcome = "created" | "duplicate" | "created_near_duplicate";

export interface SaveToBrainOutput {
  id: string;
  category: SaveCategory;
  key: string;
  summary: string;
  outcome: SaveOutcome;
  /** The pre-existing row this save was measured against, when one was found. */
  relatedId?: string;
  /**
   * False when the embedding provider was unavailable: the row exists and
   * is recalled lexically; vector search reaches it after embed-backfill.
   */
  embedded: boolean;
  /** Contradiction-review row key when a near-duplicate was queued. */
  reviewKey?: string;
}

/**
 * The only thing that counts as "the same memory": equal after collapsing
 * whitespace and case. Embedding similarity nominates a RELATIONSHIP, never
 * a replacement — see SaveOutcome.
 */
export function isSameStatement(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  return norm(a) === norm(b);
}

function previewOf(text: string, max = 120): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * Pure function — testable without DB. Picks the category for content.
 */
export function categorizeForSave(content: string): SaveCategory {
  const lower = content.toLowerCase();
  if (
    /\b(decided|decision|going with|chose|choosing|i'?ll go|i will go|locked in|committed to)\b/i.test(content) ||
    /^\s*decision\s*[:.]/i.test(content)
  ) {
    return "decision";
  }
  if (
    /\b(i\s+(believe|think|feel|reckon|hold)\b|my\s+(view|take|stance|opinion)\s+is\b|in\s+my\s+experience\b)/i.test(
      content,
    )
  ) {
    return "belief";
  }
  if (
    /\b(strategy|playbook|approach|game\s*plan|tactic|tactics|north\s*star|operating\s+system)\b/i.test(
      content,
    ) ||
    /^\s*strategy\s*[:.]/i.test(content)
  ) {
    return "strategy";
  }
  if (
    /\b(brand|voice|tone|style|blueprint|messaging|positioning|marketing|copy|content\s+strategy|captions?|hashtags?)\b/i.test(
      lower,
    ) ||
    /\b(instagram|tiktok|reels?|short\s*form|creator|engagement)\b/i.test(lower)
  ) {
    return "brand_marketing";
  }
  if (
    /\b(pattern|every\s+time|always\b|rule\s*[:.]|principle\s*[:.]|when\s+x\s+then)\b/i.test(
      content,
    )
  ) {
    return "pattern";
  }
  return "user_save";
}

/**
 * Build a stable, sortable key for the BrainMemory row.
 *   user_save_<category>_<unix-ms>
 */
function buildKey(category: SaveCategory, hint?: string): string {
  const slug = (hint ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const stamp = Date.now();
  return slug ? `${category}_${slug}_${stamp}` : `${category}_${stamp}`;
}

interface RecentRow {
  id: string;
  key: string;
  content: string;
  createdAt?: Date | null;
}

/** The category's 100 most recent live rows — shared by the identity check and the JS cosine fallback. */
async function loadRecent(category: SaveCategory): Promise<RecentRow[]> {
  return prisma.brainMemory.findMany({
    where: { category, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, key: true, content: true, createdAt: true },
  });
}

/**
 * Deterministic identity — no AI provider in the loop. An exact match
 * anywhere in the category (indexed lookup), then a whitespace/case-
 * insensitive match over the recent rows.
 */
async function findSameStatement(
  category: SaveCategory,
  trimmed: string,
  recent: RecentRow[],
): Promise<RecentRow | null> {
  const exact = await prisma.brainMemory.findFirst({
    where: { category, deletedAt: null, content: trimmed },
    select: { id: true, key: true, content: true, createdAt: true },
  });
  if (exact) return exact;
  return recent.find((r) => isSameStatement(r.content, trimmed)) ?? null;
}

/** The same statement again: bump the sighting, keep the row, and SAY so. */
async function markDuplicate(row: RecentRow, category: SaveCategory): Promise<SaveToBrainOutput> {
  const updated = await prisma.brainMemory.update({
    where: { id: row.id },
    data: {
      seenCount: { increment: 1 },
      lastSeen: new Date(),
    },
    select: { seenCount: true },
  });
  const seen = typeof updated?.seenCount === "number" ? ` · seen ${updated.seenCount}×` : "";
  return {
    id: row.id,
    category,
    key: row.key,
    summary: `Already saved as ${category} · ${previewOf(row.content)}${seen}`,
    outcome: "duplicate",
    relatedId: row.id,
    embedded: true,
  };
}

interface NearHit extends RecentRow {
  similarity: number;
}

/** Nearest live row in the same category above the similarity floor, or null. Needs a vector. */
async function findNearDuplicate(
  category: SaveCategory,
  vec: number[],
  recent: RecentRow[],
): Promise<NearHit | null> {
  if (await isPgvectorAvailable()) {
    try {
      const lit = vectorLiteral(vec);
      assertSafeVectorLiteral(lit);
      // Same category, distance < 0.05 (cosine similarity > 0.95).
      const hits = await prisma.$queryRawUnsafe<
        Array<{ id: string; key: string; content: string; created_at: Date | null; distance: number }>
      >(
        `SELECT bm.id, bm.key, bm.content, bm.created_at,
                (ve.embedding_vec <=> '${lit}'::vector)::float8 AS distance
         FROM vector_embeddings ve
         JOIN brain_memories bm ON ve."sourceId" = bm.id
         WHERE ve."sourceType" = 'brain_memory'
           AND bm.category = $1
           AND bm.deleted_at IS NULL
           AND ve.embedding_vec IS NOT NULL
           AND (ve.embedding_vec <=> '${lit}'::vector) < 0.05
         ORDER BY (ve.embedding_vec <=> '${lit}'::vector) ASC
         LIMIT 1`,
        category,
      );
      if (hits && hits.length > 0) {
        const h = hits[0];
        return { id: h.id, key: h.key, content: h.content, createdAt: h.created_at ?? null, similarity: 1 - h.distance };
      }
    } catch (err) {
      console.warn("[saveToBrain] pgvector similarity check failed, falling back:", err);
    }
  }

  // JS cosine fallback over the recent rows' stored vectors.
  if (recent.length === 0) return null;
  const embeddings = await prisma.vectorEmbedding.findMany({
    where: { sourceType: "brain_memory", sourceId: { in: recent.map((m) => m.id) } },
    select: { sourceId: true, embedding: true },
  });
  let best: NearHit | null = null;
  for (const emb of embeddings) {
    try {
      const sim = cosineSimilarity(vec, JSON.parse(emb.embedding) as number[]);
      if (sim > 0.95 && (!best || sim > best.similarity)) {
        const row = recent.find((m) => m.id === emb.sourceId);
        if (row) best = { ...row, similarity: sim };
      }
    } catch {
      // malformed stored vector — skip
    }
  }
  return best;
}

export async function saveToBrain(input: SaveToBrainInput): Promise<SaveToBrainOutput> {
  const trimmed = input.content.trim();
  if (trimmed.length < 3) {
    throw new Error("Content too short to save (min 3 chars).");
  }
  const category: SaveCategory = input.category ?? categorizeForSave(trimmed);
  const key = buildKey(category, input.keyHint);
  const confidence = typeof input.confidence === "number" ? input.confidence : 0.85;
  const source = input.source ?? "user_save";

  // 1 · Identity first, deterministically. No provider can bypass this.
  const recent = await loadRecent(category);
  const same = await findSameStatement(category, trimmed, recent);
  if (same) return markDuplicate(same, category);

  // 2 · The near-duplicate RELATIONSHIP needs a vector; the save does not.
  const vec = await getEmbedding(trimmed).catch(() => [] as number[]);
  const near = vec.length > 0 ? await findNearDuplicate(category, vec, recent) : null;
  // A vector hit that is the same statement (older than the recent window,
  // or case-shifted past the exact lookup) is still a duplicate.
  if (near && isSameStatement(near.content, trimmed)) return markDuplicate(near, category);

  // 3 · Persist the operator's statement. Similar text with different wording
  // is NOT a duplicate: keep the new statement (it may be the correction),
  // keep the old one (it may be a distinct fact that merely embeds nearby),
  // link them, and queue the pair for review below.
  const metadata = near ? { ...(input.metadata ?? {}), nearDuplicateOf: near.id } : (input.metadata ?? null);
  const row = await prisma.brainMemory.create({
    data: {
      category,
      key,
      content: trimmed,
      confidence,
      source,
      metadata: metadata as Parameters<typeof prisma.brainMemory.create>[0]["data"]["metadata"],
    },
    select: { id: true },
  });

  // 4 · Optional enrichment: the vector. A failure here never fails the save;
  // cron/embed-backfill picks up rows with no vector_embeddings row.
  let embedded = false;
  if (vec.length > 0) {
    try {
      const createdEmbedding = await prisma.vectorEmbedding.create({
        data: {
          sourceType: "brain_memory",
          sourceId: row.id,
          content: trimmed,
          embedding: JSON.stringify(vec),
        },
      });
      embedded = true;
      if (await isPgvectorAvailable()) {
        const lit = vectorLiteral(vec);
        await prisma.$executeRawUnsafe(
          `UPDATE vector_embeddings SET embedding_vec = '${lit}'::vector WHERE id = $1`,
          createdEmbedding.id,
        );
        try {
          const lit1536 = vectorLiteral(padToVectorDim(vec, VECTOR_DIM_1536));
          await prisma.$executeRawUnsafe(
            `UPDATE vector_embeddings SET embedding_vec_1536 = '${lit1536}'::vector(${VECTOR_DIM_1536}) WHERE id = $1`,
            createdEmbedding.id,
          );
        } catch {
          // the 1536 mirror column is best-effort
        }
      }
    } catch (err) {
      console.warn("[saveToBrain] failed to write VectorEmbedding:", err);
    }
  }

  // 5 · Queue the near-duplicate pair for the operator. Same storage and
  // panel as every other contradiction; resolving it writes the supersession
  // columns recall filters on. Loud on failure, never blocking.
  let reviewKey: string | undefined;
  if (near) {
    try {
      reviewKey = await surfaceNearDuplicate({
        newMemoryId: row.id,
        oldMemoryId: near.id,
        newContent: trimmed,
        oldContent: near.content,
        similarity: near.similarity,
        oldCreatedAt: near.createdAt ?? null,
      });
    } catch (err) {
      console.warn("[saveToBrain] near-duplicate review enqueue failed:", err);
    }
  }

  const parts = [`Saved as ${category} · ${previewOf(trimmed)}`];
  if (near) {
    parts.push(`similar memory kept: ${previewOf(near.content, 60)}`);
    parts.push(reviewKey ? "queued for review" : "review enqueue failed");
  }
  if (vec.length === 0) parts.push("search index pending");

  return {
    id: row.id,
    category,
    key,
    summary: parts.join(" · "),
    outcome: near ? "created_near_duplicate" : "created",
    ...(near ? { relatedId: near.id } : {}),
    embedded,
    ...(reviewKey ? { reviewKey } : {}),
  };
}
