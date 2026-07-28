import { prisma } from "@/lib/prisma";
import { daysAgo } from "@/lib/utils/datetime";
import { storeMemoryEmbedding } from "@/lib/brain/embedding-utils";
import { logger as rootLogger } from "@/lib/logger";
import { recordError } from "@/lib/errors/record-error";

const log = rootLogger.withSurface("brain/memory-manager");
import { softDelete, restore } from "@/lib/db/soft-delete";
import type { BrainMemory } from "@prisma/client";
import {
  canonicalCategory,
  isKnownCategory,
  DEPRECATED_CATEGORY_MAP,
} from "@/lib/brain/categories";
import { gateWisdom } from "@/lib/brain/wisdom-quality-gate";

/**
 * Runtime validation for category strings passed to remember().
 * Three behaviors stacked by severity:
 *   1. Unknown category → console.warn (does NOT throw — silent write
 *      to an unregistered bucket is bad, but throwing would break the
 *      caller. Warn loudly so /system/errors picks it up instead.)
 *   2. Deprecated category → console.info + rewrite to canonical form.
 *      Example: `skills` becomes `skill` before the row is created.
 *   3. Known non-deprecated category → pass-through, no noise.
 *
 * Returns the category the write should actually use.
 */
function validateAndCanonicalizeCategory(
  category: string,
  source: string,
): string {
  if (DEPRECATED_CATEGORY_MAP[category]) {
    const target = DEPRECATED_CATEGORY_MAP[category];
    // P.3 · elevated from log.info → log.warn so deprecated writes
    // appear in the /system/logs warnings tier alongside the existing
    // unknown_category warnings. Operator can spot drift without
    // needing to dig into info-level logs.
    log.warn("deprecated_category", {
      from: category,
      to: target,
      source,
      hint: "use BRAIN_CATEGORIES.* constant instead of the deprecated string · see lib/brain/categories.ts DEPRECATED_CATEGORY_MAP",
    });
    return target;
  }
  if (!isKnownCategory(category)) {
    log.warn("unknown_category", {
      category,
      source,
      hint: "add to lib/brain/categories.ts BRAIN_CATEGORIES",
    });
  }
  return category;
}

/**
 * Brain Memory Lifecycle:
 * 1. Raw observation → temporary insight (expires in 24h)
 * 2. Seen 3+ times → promoted to persistent memory (confidence boost)
 * 3. Not reinforced in 30 days → confidence decay
 * 4. Confidence < 0.1 → garbage collected (by data-cleanup cron)
 * 5. Manually confirmed by user → permanent, confidence = 1.0
 */

export class BrainMemoryManager {
  /**
   * Remember something. If it already exists, reinforce it.
   * New memories start with confidence 0.5 and expire in 24h.
   * After being seen 3+ times, they become permanent.
   */
  async remember(
    category: string,
    key: string,
    content: string,
    source: string,
    metadata?: Record<string, unknown>
  ): Promise<BrainMemory> {
    // Registry guard — rewrite deprecated categories, warn on unknown.
    // See lib/brain/categories.ts for the canonical list.
    let effectiveCategory = validateAndCanonicalizeCategory(category, source);

    // v10.0.356 · Wisdom quality gate. Wisdom writes are high-stakes
    // (recall reserves 3 slots per chat turn for category="wisdom").
    // Vague meta-summaries get redirected to "wisdom_candidate" with a
    // gateReject reason · operator can review on /brain/wisdom and
    // promote manually if the candidate is actually principle-shaped.
    // Operator-curated sources (skill_ingestion / manual / user) bypass
    // the gate entirely · the operator already vouched for them.
    let gateMetadata: Record<string, unknown> = {};
    const operatorTrusted =
      source === "skill_ingestion" || source === "manual" || source === "user";
    if (effectiveCategory === "wisdom" && !operatorTrusted) {
      const gate = gateWisdom(content);
      if (!gate.pass) {
        log.info("wisdom_gate_reject", {
          reason: gate.reason,
          detail: gate.detail,
          source,
          key,
          contentPreview: content.slice(0, 80),
        });
        effectiveCategory = "wisdom_candidate";
        gateMetadata = {
          gateReject: gate.reason,
          gateDetail: gate.detail,
          originalCategory: "wisdom",
        };
      }
    }

    const existing = await prisma.brainMemory.findUnique({
      where: { category_key: { category: effectiveCategory, key } },
    });

    // Spine-2 SHADOW gateway: record what the commit authority WOULD
    // decide for this write (same-source repetition = noop, changed
    // claim = update-not-reinforce, weaker-vs-stronger = review, ...).
    // Fire-and-forget; behavior below is UNCHANGED until the shadow
    // week's receipts are reviewed.
    void (async () => {
      const { shadowMemoryCommit } = await import("./memory-commit-gateway");
      const { isKnownCategory } = await import("./categories");
      await shadowMemoryCommit(
        {
          category: effectiveCategory,
          key,
          content,
          source,
          categoryKnown: isKnownCategory(effectiveCategory),
        },
        existing
          ? {
              content: existing.content,
              source: existing.source,
              seenCount: existing.seenCount,
              confidence: existing.confidence,
            }
          : null,
        existing ? "reinforce" : "create",
      );
    })().catch(() => {
      // shadow observation must never affect the real write path
    });

    if (existing) {
      return this.reinforce(existing.id, content);
    }

    // New memory — temporary (24h expiry) until reinforced
    const created = await prisma.brainMemory.create({
      data: {
        category: effectiveCategory,
        key,
        content,
        confidence: 0.5,
        source,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        metadata: { ...(metadata ?? {}), ...gateMetadata } as any,
      },
    });

    // Generate embedding async (non-blocking)
    storeMemoryEmbedding(created.id, `[${category}] ${key}: ${content}`).catch((err) => {
      recordError("brain:memory-embedding", err, { memoryId: created.id, category, key, phase: "create" });
    });

    return created;
  }

  /**
   * Reinforce a memory — boost confidence and update last seen.
   * After 3+ sightings, remove expiry (memory becomes permanent).
   */
  async reinforce(memoryId: string, newContent?: string): Promise<BrainMemory> {
    const memory = await prisma.brainMemory.findUniqueOrThrow({
      where: { id: memoryId },
    });

    const newSeenCount = memory.seenCount + 1;
    const newConfidence = Math.min(1.0, memory.confidence + 0.1);
    const shouldPromote = newSeenCount >= 3;

    const updated = await prisma.brainMemory.update({
      where: { id: memoryId },
      data: {
        seenCount: newSeenCount,
        confidence: newConfidence,
        lastSeen: new Date(),
        // Promote to permanent after 3 sightings
        ...(shouldPromote && { expiresAt: null }),
        // Update content if newer version provided
        ...(newContent && { content: newContent }),
      },
    });

    // Re-embed if content changed
    if (newContent) {
      storeMemoryEmbedding(memoryId, `[${updated.category}] ${updated.key}: ${newContent}`).catch((err) => {
        recordError("brain:memory-embedding", err, { memoryId, category: updated.category, key: updated.key, phase: "reinforce" });
      });
    }

    return updated;
  }

  /**
   * Recall memories by category and optional search query.
   * Returns sorted by confidence (highest first).
   */
  async recall(
    category?: string,
    options: { query?: string; minConfidence?: number; limit?: number } = {}
  ): Promise<BrainMemory[]> {
    return prisma.brainMemory.findMany({
      where: {
        ...(category && { category }),
        confidence: { gte: options.minConfidence ?? 0 },
        deletedAt: null, // v10.0.66 · public recall API
        ...(options.query && {
          OR: [
            { content: { contains: options.query, mode: "insensitive" } },
            { key: { contains: options.query, mode: "insensitive" } },
          ],
        }),
      },
      orderBy: { confidence: "desc" },
      take: options.limit ?? 50,
    });
  }

  /**
   * Record a contradiction — reduce confidence and flag for review.
   */
  async contradict(memoryId: string, newEvidence: string): Promise<BrainMemory> {
    return prisma.brainMemory.update({
      where: { id: memoryId },
      data: {
        confidence: { decrement: 0.2 },
        metadata: {
          contradicted: true,
          contradiction: newEvidence,
          contradictedAt: new Date().toISOString(),
        },
      },
    });
  }

  /**
   * Manually confirm a memory — permanent, max confidence.
   */
  async confirm(memoryId: string): Promise<BrainMemory> {
    return prisma.brainMemory.update({
      where: { id: memoryId },
      data: {
        confidence: 1.0,
        expiresAt: null,
        source: "manual",
      },
    });
  }

  /**
   * Forget a memory — v7.9: soft-delete (preserves the row for the brain
   * layer's "what did Nour intentionally drop" pattern mining + undo).
   * Use `purge(memoryId)` for hard-delete.
   */
  async forget(memoryId: string): Promise<void> {
    await softDelete("brainMemory", { id: memoryId });
  }

  /**
   * v7.9 — restore a soft-deleted memory (for undo / admin trash view).
   */
  async restore(memoryId: string): Promise<void> {
    await restore("brainMemory", { id: memoryId });
  }

  /**
   * v7.9 — permanent hard-delete. Used only by stale-data-purger and
   * GDPR-style scrub paths. UI deletes go through `forget`.
   */
  async purge(memoryId: string): Promise<void> {
    await prisma.brainMemory.delete({ where: { id: memoryId } });
  }

  /**
   * Decay confidence for memories not seen in 30+ days.
   * Returns count of decayed memories.
   */
  async decay(): Promise<number> {
    const thirtyDaysAgo = daysAgo(30);

    const stale = await prisma.brainMemory.findMany({
      where: {
        lastSeen: { lt: thirtyDaysAgo },
        confidence: { gt: 0.1 },
        expiresAt: null, // Only decay permanent memories
        deletedAt: null, // v10.0.66 · don't decay already-soft-deleted
      },
      select: { id: true },
    });

    if (stale.length === 0) return 0;

    await prisma.brainMemory.updateMany({
      where: { id: { in: stale.map((m) => m.id) } },
      data: { confidence: { decrement: 0.05 } },
    });

    return stale.length;
  }

  /**
   * Get brain status — memory counts and stats.
   */
  async getStatus(): Promise<Record<string, unknown>> {
    // Single raw query replaces 5 parallel queries — saves 4 round-trips to Neon.
    // Returns one row with totals and a jsonb array of per-category counts.
    const rows = await prisma.$queryRaw<
      Array<{
        total: bigint;
        permanent: bigint;
        temporary: bigint;
        avg_confidence: number | null;
        by_category: Array<{ category: string; count: number }> | null;
      }>
    >`
      WITH stats AS (
        SELECT
          COUNT(*)::bigint AS total,
          COUNT(*) FILTER (WHERE "expires_at" IS NULL)::bigint AS permanent,
          COUNT(*) FILTER (WHERE "expires_at" IS NOT NULL)::bigint AS temporary,
          AVG("confidence")::float8 AS avg_confidence
        FROM "brain_memories"
      ),
      cats AS (
        SELECT json_agg(
          json_build_object('category', category, 'count', c)
          ORDER BY c DESC
        ) AS by_category
        FROM (
          SELECT category, COUNT(*)::int AS c
          FROM "brain_memories"
          GROUP BY category
        ) x
      )
      SELECT stats.*, cats.by_category FROM stats, cats
    `;

    const r = rows[0] || {
      total: 0n,
      permanent: 0n,
      temporary: 0n,
      avg_confidence: 0,
      by_category: [],
    };

    return {
      total: Number(r.total),
      permanent: Number(r.permanent),
      temporary: Number(r.temporary),
      avgConfidence: Math.round((r.avg_confidence ?? 0) * 100) / 100,
      byCategory: r.by_category ?? [],
    };
  }
}

export const brainMemory = new BrainMemoryManager();
