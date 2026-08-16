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
 * Phase-2 park target. A `review_required` verdict must not overwrite the
 * stronger claim, but it must not vanish either — so it lands as a staging
 * row in the queue the operator ALREADY has at /brain → Review.
 *
 * Deliberate choices:
 *  · Direct `prisma.brainMemory.upsert`, never `brainMemory.remember()` —
 *    routing back through remember() would re-enter the gateway on the
 *    staging write and, because candidate-store already imports this module,
 *    close an import cycle. `shadowMemoryCommit` writes the same way.
 *  · Category `research_pack` because that is the exact category
 *    lib/knowledge/candidate-store.ts scans (CANDIDATE_STAGING_CATEGORY), and
 *    it is a registered BRAIN_CATEGORIES value so nothing mints new taxonomy.
 *  · The metadata shape satisfies candidate-store's `isCandidateMetadata`
 *    (recordType + string candidateId) and its jsonb filter on
 *    `gateDecision === "review_required"`, so the existing GET/POST review
 *    route and the existing Review tab pick it up with zero new UI.
 *  · `kind: "observation"` — candidate-store refuses to promote "action" or
 *    "question" kinds (canonicalEligible check), and a parked memory write is
 *    exactly an observation awaiting corroboration.
 *  · `sourceType: "system"` + `parkedBy` so these rows are distinguishable
 *    from the Obsidian/NotebookLM/Graphify candidates sharing the queue.
 *
 * Never throws into the write path: a failed park falls through to the
 * caller's normal return, which is the pre-Phase-2 behavior.
 */
async function parkForReview(args: {
  category: string;
  key: string;
  content: string;
  source: string;
  verdict: { decision: string; reason: string; reasonCode: string; candidateEvidence: string };
  existingContent: string;
  existingSource: string;
}): Promise<void> {
  try {
    const { BRAIN_CATEGORIES } = await import("@/lib/brain/categories");
    const { createHash } = await import("node:crypto");
    const contentHash = createHash("sha256")
      .update(`${args.category}:${args.key}:${args.content}`)
      .digest("hex");
    const candidateId = `mg_${contentHash.slice(0, 24)}`;

    // One definition, used by BOTH upsert arms — a revived row must land in
    // the review queue in exactly the state a fresh one would.
    const parkedMetadata = {
      recordType: "knowledge_candidate",
      candidateId,
      contentHash,
      gateDecision: "review_required",
      gateReasons: [args.verdict.reason],
      reasonCode: args.verdict.reasonCode,
      kind: "observation",
      sourceType: "system",
      parkedBy: "memory-commit-gateway-phase2",
      candidateEvidence: args.verdict.candidateEvidence,
      targetCategory: args.category,
      targetKey: args.key,
      blockedClaim: args.existingContent.slice(0, 500),
      blockedClaimSource: args.existingSource,
      parkedAt: new Date().toISOString(),
    };

    await prisma.brainMemory.upsert({
      where: {
        category_key: {
          category: BRAIN_CATEGORIES.RESEARCH_PACK,
          key: `candidate_${candidateId.slice(3)}`,
        },
      },
      create: {
        category: BRAIN_CATEGORIES.RESEARCH_PACK,
        key: `candidate_${candidateId.slice(3)}`,
        content: args.content,
        confidence: 0,
        source: `memory_gateway:${args.source}`,
        expiresAt: null,
        metadata: parkedMetadata as never,
      },
      // The update arm must rewrite the FULL metadata, not just content
      // (review fix, 2026-08-16). A candidate the operator previously REJECTED
      // is soft-deleted with `gateDecision: "reject"` on the row. Re-parking
      // the same claim revives it via `deletedAt: null` — but
      // listPendingKnowledgeCandidates() filters on
      // `metadata.gateDecision === "review_required"`, so leaving the old
      // verdict in place made the revived row invisible to the review queue
      // while this module logged `memory_gateway_parked` as if it were
      // waiting. Same metadata object as `create` for exactly that reason.
      update: {
        content: args.content,
        confidence: 0,
        source: `memory_gateway:${args.source}`,
        expiresAt: null,
        deletedAt: null,
        lastSeen: new Date(),
        metadata: parkedMetadata as never,
      },
    });
  } catch (err) {
    log.warn("memory_gateway_park_failed", {
      category: args.category,
      key: args.key,
      error: err instanceof Error ? err.message : String(err),
    });
  }
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
    // Spine-3: an unknown category still writes (behavior unchanged until
    // the gateway leaves shadow mode) but is now MARKED for review so
    // category drift accumulates visibly instead of silently.
    {
      const { isKnownCategory } = await import("./categories");
      if (!isKnownCategory(effectiveCategory)) {
        gateMetadata.review_required = true;
        gateMetadata.review_reason = "unknown category";
      }
    }
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
      // 2026-08-11 · Phase-1 gateway graduation — LIVE by default, safe
      // subset ONLY: same-source repetition of the same claim is NOT
      // corroboration — the gateway's "noop" verdict skips the legacy
      // reinforce (which would bump confidence and advance promotion) and
      // returns the row untouched. Every other verdict keeps legacy
      // behavior byte-identical. Evidence for the default-on flip: the
      // 7-day shadow review (probe-gateway-agrees.ts, 2026-08-11) read
      // 1,788 receipts — noop 846 (47%) at ZERO legacy agreement, and
      // zero genuine independent-corroboration reinforces in the window.
      // Kill-switch: NICK_MEMORY_GATEWAY_PHASE1=0.
      if (process.env.NICK_MEMORY_GATEWAY_PHASE1 !== "0") {
        try {
          const { evaluateMemoryCandidate } = await import("./memory-commit-gateway");
          const { isKnownCategory } = await import("./categories");
          const verdict = evaluateMemoryCandidate(
            {
              category: effectiveCategory,
              key,
              content,
              source,
              categoryKnown: isKnownCategory(effectiveCategory),
            },
            {
              content: existing.content,
              source: existing.source,
              seenCount: existing.seenCount,
              confidence: existing.confidence,
            },
          );
          if (verdict.decision === "noop") {
            log.info("memory_gateway_noop", {
              category: effectiveCategory,
              key,
              source,
              reason: verdict.reason,
            });
            return existing;
          }

          // 2026-08-16 · Phase-2 — LIVE by default, kill-switch
          // NICK_MEMORY_GATEWAY_PHASE2=0, matching Phase-1's shape.
          //
          // Honest provenance: Phase-1 earned default-on with a 7-day shadow
          // review (1,788 receipts, noop at 0% legacy agreement). Phase-2 has
          // NO equivalent run — it shipped opt-in for that reason and was
          // flipped on explicit operator instruction ("we can take the risk"),
          // not on evidence. If write behavior looks wrong, set the kill-switch
          // FIRST and diagnose second; then run scripts/probe-gateway-agrees.ts.
          if (process.env.NICK_MEMORY_GATEWAY_PHASE2 !== "0") {
            // "update" = an equal-strength source CHANGED the claim. Legacy
            // treats that as corroboration and adds +0.1 — the audit's exact
            // P0. Take the new content, refuse the confidence.
            if (verdict.decision === "update") {
              log.info("memory_gateway_update_no_boost", {
                category: effectiveCategory,
                key,
                source,
                reason: verdict.reason,
              });
              return this.reinforce(existing.id, content, { bumpConfidence: false });
            }

            // "review_required" = weaker evidence contradicting a stronger
            // claim. Park it for operator review instead of overwriting.
            // DELIBERATELY NOT the unknown_category slice: that is the larger
            // share of the measured 349/wk and parking it would freeze whole
            // categories of automation writes behind a queue nobody asked for.
            if (
              verdict.decision === "review_required" &&
              verdict.reasonCode === "weaker_evidence"
            ) {
              await parkForReview({
                category: effectiveCategory,
                key,
                content,
                source,
                verdict,
                existingContent: existing.content,
                existingSource: existing.source,
              });
              log.info("memory_gateway_parked", {
                category: effectiveCategory,
                key,
                source,
                reason: verdict.reason,
              });
              return existing;
            }
          }
        } catch (err) {
          log.warn("memory_gateway_phase1_error", {
            category: effectiveCategory,
            key,
            error: err instanceof Error ? err.message : String(err),
          });
          // fail open to legacy reinforce — the gate must never block a write path
        }
      }
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
   *
   * `opts.bumpConfidence: false` (2026-08-16, gateway Phase-2) takes the new
   * CONTENT without treating the sighting as corroboration: no +0.1, and no
   * progress toward the 3-sighting permanence promotion. A changed claim is
   * a change, not extra evidence for the claim it replaced.
   *
   * Default stays `true` on purpose — lib/brain/pipeline-controller.ts uses
   * reinforce() as an action-FREQUENCY counter and depends on both bumps.
   */
  async reinforce(
    memoryId: string,
    newContent?: string,
    opts: { bumpConfidence?: boolean } = {},
  ): Promise<BrainMemory> {
    const bumpConfidence = opts.bumpConfidence !== false;
    const memory = await prisma.brainMemory.findUniqueOrThrow({
      where: { id: memoryId },
    });

    const newSeenCount = bumpConfidence ? memory.seenCount + 1 : memory.seenCount;
    const newConfidence = bumpConfidence
      ? Math.min(1.0, memory.confidence + 0.1)
      : memory.confidence;
    const shouldPromote = bumpConfidence && newSeenCount >= 3;

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
    // Spine-3: MERGE metadata and APPEND a contradiction event — the old
    // implementation replaced the whole metadata object, discarding
    // provenance/gate context and keeping only the LATEST contradiction.
    const current = await prisma.brainMemory.findUniqueOrThrow({
      where: { id: memoryId },
      select: { metadata: true },
    });
    const meta = (current.metadata ?? {}) as Record<string, unknown>;
    const events = Array.isArray(meta.contradictionEvents) ? meta.contradictionEvents : [];
    return prisma.brainMemory.update({
      where: { id: memoryId },
      data: {
        confidence: { decrement: 0.2 },
        metadata: {
          ...meta,
          contradicted: true,
          contradiction: newEvidence,
          contradictedAt: new Date().toISOString(),
          contradictionEvents: [
            ...events.slice(-9),
            { evidence: newEvidence.slice(0, 300), at: new Date().toISOString() },
          ],
        } as never,
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
        soft_deleted: bigint;
        avg_confidence: number | null;
        by_category: Array<{ category: string; count: number }> | null;
      }>
    >`
      WITH stats AS (
        SELECT
          COUNT(*) FILTER (WHERE "deleted_at" IS NULL)::bigint AS total,
          COUNT(*) FILTER (WHERE "deleted_at" IS NULL AND "expires_at" IS NULL)::bigint AS permanent,
          COUNT(*) FILTER (WHERE "deleted_at" IS NULL AND "expires_at" IS NOT NULL)::bigint AS temporary,
          COUNT(*) FILTER (WHERE "deleted_at" IS NOT NULL)::bigint AS soft_deleted,
          AVG("confidence") FILTER (WHERE "deleted_at" IS NULL)::float8 AS avg_confidence
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
          WHERE "deleted_at" IS NULL
          GROUP BY category
        ) x
      )
      SELECT stats.*, cats.by_category FROM stats, cats
    `;

    const r = rows[0] || {
      total: 0n,
      permanent: 0n,
      temporary: 0n,
      soft_deleted: 0n,
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
