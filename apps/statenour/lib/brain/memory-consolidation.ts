/**
 * Memory Consolidation Engine — Makes the memory SMARTER over time
 *
 * Like sleep consolidation in the human brain:
 * 1. MERGE — combine similar memories into stronger, richer ones
 * 2. PROMOTE — elevate frequently-seen patterns to "wisdom"
 * 3. PRUNE — garbage collect noise, keep signal
 * 4. DISTILL — extract higher-order knowledge from accumulated data
 * 5. SCORE — rank every memory by dynamic importance
 *
 * Runs as part of the evening cron — the brain "sleeps" and consolidates.
 */

import { prisma } from "@/lib/prisma";
import { recordError } from "@/lib/errors/record-error";
import { brainMemory } from "./memory-manager";
// v10.0.64 · AgentTrace coverage.
import { makeTracedAiChat } from "@/lib/ai/traced-aichat";
const aiChat = makeTracedAiChat("memory-consolidation");
import { extractJsonArray } from "@/lib/ai/extract-structured";
import { today, daysAgo } from "@/lib/utils/datetime";
// v10.0.65 · structured logger for surfacing dedupe-delete failures.
import { logger as rootLogger } from "@/lib/logger";
import { BRAIN_CATEGORIES, CONSOLIDATION_EXCLUDE_CATEGORIES } from "@/lib/brain/categories";
const log = rootLogger.withSurface("brain/memory-consolidation");

// ─── 1. MERGE: Combine similar memories ──────────────────

export async function mergeMemories(): Promise<{ merged: number }> {
  // Get all memories grouped by category. 2026-07-12 · EXCLUDE structured
  // categories — merging rewrites a category's rows into one PROSE blob,
  // which corrupts JSON-payload categories (their readers JSON.parse
  // content). See CONSOLIDATION_EXCLUDE_CATEGORIES.
  const categories = await prisma.brainMemory.groupBy({
    by: ["category"],
    where: { category: { notIn: [...CONSOLIDATION_EXCLUDE_CATEGORIES] } },
    _count: { id: true },
    having: { id: { _count: { gt: 3 } } },
  });

  let totalMerged = 0;

  for (const cat of categories) {
    // v10.0.35 — `deletedAt: null` filter. Pre-fix soft-deleted
    // rows were included in merge candidates, fed to the AI, and
    // could be promoted into new keeper rows — effectively
    // resurrecting deleted memories. Same pattern as the
    // `memory_promotion` autonomous-engine rule already uses.
    const memories = await prisma.brainMemory.findMany({
      where: { category: cat.category, deletedAt: null },
      orderBy: { confidence: "desc" },
      select: { id: true, key: true, content: true, confidence: true, seenCount: true },
    });

    if (memories.length < 4) continue;

    // Ask AI to find mergeable groups
    const memList = memories.slice(0, 30).map((m, i) => `[${i}] (conf: ${m.confidence.toFixed(2)}, seen: ${m.seenCount}) ${m.content.slice(0, 100)}`).join("\n");

    const result = await aiChat([
      {
        role: "system",
        content: `You are the Memory Consolidation Engine. Given a list of memories in the "${cat.category}" category, identify groups that should be MERGED into a single stronger memory.

Return ONLY JSON:
[{ "indices": [0, 3, 7], "merged": "The consolidated memory text that captures all three" }]

Rules:
- Only merge memories that are genuinely about the SAME thing
- The merged text should be MORE insightful than any individual memory
- Keep the strongest evidence from each source
- Max 5 merge groups
- Return [] if nothing should be merged`,
      },
      { role: "user", content: memList },
    ], "fast");

    const extracted = extractJsonArray<{ indices: number[]; merged: string }>(result.content);
    if (!extracted.ok) continue;

    try {
      const groups = extracted.value;
      if (!Array.isArray(groups)) continue;

      for (const group of groups.slice(0, 5)) {
        if (!Array.isArray(group.indices) || group.indices.length < 2 || !group.merged) continue;

        // Keep the highest-confidence memory, update it with merged content
        const toMerge = group.indices.map(i => memories[i]).filter(Boolean);
        if (toMerge.length < 2) continue;

        const keeper = toMerge.sort((a, b) => b.confidence - a.confidence)[0];
        const others = toMerge.filter(m => m.id !== keeper.id);

        // 2026-07-12 · belt-and-suspenders: even inside a merge-eligible
        // category, if the keeper's content parses as JSON it is a
        // structured payload some reader depends on — never overwrite it
        // with prose. Skips the group; the CONSOLIDATION_EXCLUDE list is
        // the primary guard, this catches any not-yet-listed JSON category.
        try {
          JSON.parse(keeper.content);
          continue; // structured row — do not merge into prose
        } catch {
          // free-text belief row — safe to consolidate
        }

        // v10.0.34 — wrap update + deletes in a transaction so the
        // group either fully merges or doesn't change. Pre-fix the
        // delete-with-bare-.catch swallowed partial failures: a
        // failed delete left N+1 dupes around AND the keeper already
        // had its confidence boosted, so re-running the cron found
        // the same group, picked a (now-different) keeper, and
        // inflated confidence again.
        await prisma.$transaction([
          prisma.brainMemory.update({
            where: { id: keeper.id },
            data: {
              content: group.merged,
              confidence: Math.min(keeper.confidence + 0.15, 1.0),
              seenCount: toMerge.reduce((s, m) => s + m.seenCount, 0),
            },
          }),
          // SOFT-delete merged sources instead of hard-delete. 2026
          // research (LLM consolidation that destroys source evidence
          // degrades recall quality) argues for preserving originals.
          // Recall already filters `deletedAt: null`, so what gets
          // recalled is UNCHANGED — but merged-away rows stay
          // recoverable/auditable instead of being destroyed nightly.
          ...others.map((other) =>
            prisma.brainMemory.update({
              where: { id: other.id },
              data: { deletedAt: new Date() },
            }),
          ),
        ]).catch((err) => {
          // Atomic failure → no partial merge. Log + skip group;
          // next cron run can retry the same group cleanly.
          log.warn("merge_transaction_failed", { err: err instanceof Error ? err.message : String(err) });
        });

        totalMerged += others.length;
      }
    } catch { /* parsing failed */ }
  }

  return { merged: totalMerged };
}

// ─── 2. PROMOTE: Elevate high-signal memories to wisdom ──

export async function promoteToWisdom(): Promise<{ promoted: number }> {
  // Find memories with high confidence + high seen count
  const candidates = await prisma.brainMemory.findMany({
    where: {
      confidence: { gte: 0.8 },
      seenCount: { gte: 5 },
      category: { notIn: ["wisdom", "action_frequency", "emotional_state"] },
    },
    orderBy: { seenCount: "desc" },
    take: 10,
    select: { id: true, category: true, content: true, confidence: true, seenCount: true },
  });

  if (candidates.length === 0) return { promoted: 0 };

  let promoted = 0;
  for (const c of candidates) {
    // Dupe guard — strip dates before comparing. The old guard used
    // the first 50 chars which always included the [YYYY-MM-DD] suffix
    // from daily-snapshot engines, so the same topic promoted every
    // day slipped past. Canonicalize by removing dates + whitespace
    // normalization, then check for any wisdom row that shares the
    // distinctive head.
    const canonical = c.content
      .replace(/\[\d{4}-\d{2}-\d{2}\]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const probe = canonical.slice(0, 40);
    const existing =
      probe.length >= 20
        ? await prisma.brainMemory.findFirst({
            where: { category: BRAIN_CATEGORIES.WISDOM, content: { contains: probe } },
          })
        : null;

    // v10.0.416 · gate the consolidation promotion · same audit
    // finding as autonomous-engine.ts · run wisdom-quality-gate
    // BEFORE creating the wisdom row to keep the recall pool clean.
    const { gateWisdom } = await import("@/lib/brain/wisdom-quality-gate");
    const gateResult = gateWisdom(c.content);
    if (!gateResult.pass) continue; // skip · don't pollute the wisdom layer

    if (!existing) {
      // v11.1 · Swapped .create → .upsert. The prior create was the
      // cause of the 44s-then-500 consolidate cron failure: the
      // fuzzy `contains(probe)` pre-check above misses when the
      // content string mutates (reinforcement counts change the
      // text), but the (category="wisdom", key=`wisdom_from_{id}`)
      // unique constraint still catches the collision → 500. Upsert
      // makes this idempotent: if the row exists, refresh its
      // content + boost seenCount; otherwise create. Either way the
      // cron chain continues.
      try {
        await prisma.brainMemory.upsert({
          where: { category_key: { category: BRAIN_CATEGORIES.WISDOM, key: `wisdom_from_${c.id}` } },
          create: {
            category: BRAIN_CATEGORIES.WISDOM,
            key: `wisdom_from_${c.id}`,
            content: `[PROVEN PATTERN] ${c.content} (confirmed ${c.seenCount}x, ${(c.confidence * 100).toFixed(0)}% confidence)`,
            confidence: 1.0,
            seenCount: c.seenCount,
            source: "consolidation",
          },
          update: {
            content: `[PROVEN PATTERN] ${c.content} (confirmed ${c.seenCount}x, ${(c.confidence * 100).toFixed(0)}% confidence)`,
            seenCount: c.seenCount,
          },
        });
        promoted++;
      } catch {
        // Belt + suspenders — if upsert itself throws, don't take
        // the whole consolidate chain down. Next stage continues.
      }
    }
  }

  return { promoted };
}

// ─── 3. PRUNE: Garbage collect noise ─────────────────────

export async function pruneNoise(): Promise<{ pruned: number }> {
  // Delete expired temporary memories. Collect the ids FIRST: deleteMany only
  // returns a count, and without the ids the matching vector_embeddings rows
  // cannot be removed — which is how this sweep silently produced orphans that
  // outlived their memory (vector_embeddings keeps a `content` copy).
  const expiringIds = (
    await prisma.brainMemory.findMany({
      where: { expiresAt: { lt: new Date() } },
      select: { id: true },
    })
  ).map((r) => r.id);
  const expired = await prisma.brainMemory.deleteMany({
    where: { id: { in: expiringIds } },
  });
  const { dropEmbeddingsForMemories } = await import("@/lib/brain/memory-tombstone");
  await dropEmbeddingsForMemories(expiringIds, "pruneNoise.expired");

  // Soft-delete very low confidence memories (below 0.1) that haven't
  // been seen in 14+ days. Was a hard deleteMany; the rest of this file
  // (mergeMemories) soft-deletes to preserve source evidence + keep rows
  // recoverable/auditable. Recall already filters deletedAt:null, so what
  // gets recalled is UNCHANGED — but the rows aren't destroyed nightly.
  const stale = await prisma.brainMemory.updateMany({
    where: {
      confidence: { lt: 0.1 },
      lastSeen: { lt: daysAgo(14) },
      deletedAt: null,
    },
    data: { deletedAt: new Date() },
  });

  // Delete duplicate action_frequency entries (keep the latest)
  // v10.0.34 — bounded scan. Pre-fix loaded ALL action_frequency
  // rows into memory; on a mature DB (10k+) this OOMs the function
  // before pruning starts, so the cron silently times out without
  // doing any work. 500 newest covers all realistic dupes
  // (each unique key keeps only its newest, so the long tail is
  // already pruned by prior runs).
  const freqDupes = await prisma.brainMemory.findMany({
    where: { category: BRAIN_CATEGORIES.ACTION_FREQUENCY },
    orderBy: { createdAt: "desc" },
    select: { id: true, key: true },
    take: 500,
  });

  const seenKeys = new Set<string>();
  let dupesPruned = 0;
  let dupeDeleteFailures = 0;
  for (const f of freqDupes) {
    if (seenKeys.has(f.key)) {
      // v10.0.65 · pre-fix .catch(() => {}) silently swallowed
      // delete failures, so the loop continued counting "pruned"
      // even when the row stayed in the DB. Now: count failures
      // separately + log via structured logger so /system/errors
      // surfaces a stuck-on-this-row regression.
      try {
        await prisma.brainMemory.delete({ where: { id: f.id } });
        await dropEmbeddingsForMemories([f.id], "pruneNoise.duplicate");
        dupesPruned++;
      } catch (err) {
        dupeDeleteFailures++;
        log.warn("dupe_delete_failed", {
          memoryId: f.id,
          key: f.key,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      seenKeys.add(f.key);
    }
  }

  return { pruned: expired.count + stale.count + dupesPruned };
}

// ─── 4. DISTILL: Extract higher-order knowledge ──────────

export async function distillKnowledge(): Promise<{ insights: number }> {
  // Get all high-confidence memories from the last 30 days
  const recentMemories = await prisma.brainMemory.findMany({
    where: { confidence: { gte: 0.5 }, createdAt: { gte: daysAgo(30) } },
    orderBy: { confidence: "desc" },
    take: 50,
    select: { category: true, content: true, confidence: true },
  });

  if (recentMemories.length < 10) return { insights: 0 };

  const memContext = recentMemories.map(m => `[${m.category}] (${(m.confidence * 100).toFixed(0)}%) ${m.content.slice(0, 120)}`).join("\n");

  const result = await aiChat([
    {
      role: "system",
      content: `You are the Knowledge Distillation Engine. Given 30 days of accumulated memories, extract HIGHER-ORDER KNOWLEDGE — things that aren't stated in any single memory but emerge from the pattern of all of them.

Return ONLY JSON:
[{ "insight": "The higher-order knowledge", "evidence": "What memories support this", "category": "wisdom|pattern|rule|principle" }]

GOOD distillations:
- "Nour's productivity follows a 3-day cycle: high day, medium day, crash day. The crash always follows a late-night system-building session."
- "Revenue correlates more with follow-up speed than with ad spend. Every $1 in follow-up effort returns $8 in conversions."
- "The pattern of opening new loops while existing ones are open is not ADHD — it's avoidance of the hard next step on the current loop."

BAD distillations:
- "Things are going well" (too vague)
- "Nour should exercise more" (advice, not knowledge)

Max 3 insights.`,
    },
    { role: "user", content: memContext },
  ], "reason");

  const extracted = extractJsonArray<{ insight: string; evidence: string; category: string }>(result.content);
  if (!extracted.ok) return { insights: 0 };

  try {
    const insights = extracted.value;
    if (!Array.isArray(insights)) return { insights: 0 };

    let stored = 0;
    for (const ins of insights.slice(0, 3)) {
      // v11.1 · Wrapped in try/catch. Key uses Date.now() + index,
      // so collisions are nearly impossible — but if one sneaks in
      // or the metadata fails validation, don't tank the whole
      // consolidate chain for one insight.
      try {
        // v10.0.65 · content-based key replaces Date.now()-based key.
        // Pre-fix every distillation run wrote a NEW row even if the
        // insight matched a recent run, growing the wisdom category
        // without dedupe (~7300 new rows/year potential bloat —
        // same shape as v10.0.46 deep-scan fix). Now: hash a 64-char
        // prefix of the insight content, scoped by today's date so a
        // genuinely-new insight on a different day still records.
        const insightFingerprint = ins.insight
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .slice(0, 48);
        await prisma.brainMemory.create({
          data: {
            // 2026-07-12 · clamp the LLM-chosen category — distillation
            // writes free-text `insight` prose, so it must never land in a
            // structured-payload category (same corruption vector as MERGE).
            category:
              CONSOLIDATION_EXCLUDE_CATEGORIES.includes(ins.category)
                ? "wisdom"
                : (ins.category || "wisdom"),
            key: `distilled_${today()}_${insightFingerprint}_${stored}`,
            content: ins.insight,
            confidence: 0.9,
            source: "distillation",
            metadata: { evidence: ins.evidence, distilledOn: today() },
          },
        });
        stored++;
      } catch {
        // skip one bad insight, keep going
      }
    }

    return { insights: stored };
  } catch { return { insights: 0 }; }
}

// ─── 5. SCORE: Dynamic importance ranking ────────────────

export async function scoreMemories(): Promise<{ scored: number }> {
  // Get all memories that haven't been scored recently
  const memories = await prisma.brainMemory.findMany({
    // v10.0.35 — exclude wisdom rows. Pre-fix scoreMemories
    // unconditionally overwrote confidence with the recency-weighted
    // importance score, which downgraded wisdom rows (manually set
    // to 1.0 by promoteToWisdom) whenever they hadn't been seen in
    // 30d. The next consolidation run promoted them right back to
    // 1.0 — a perpetual see-saw burning DB writes every cycle.
    // 2026-06-10 — also exclude operator-curated rows (source="manual"),
    // same rationale: manual confidence is an explicit operator signal
    // (the highest-trust value in the system); the recency scorer must
    // not silently erode it.
    where: { confidence: { gt: 0 }, category: { not: "wisdom" }, source: { not: "manual" } },
    orderBy: { updatedAt: "asc" },
    take: 100,
    select: { id: true, category: true, content: true, confidence: true, seenCount: true, lastSeen: true, createdAt: true },
  });

  // v10.0.34 — pre-compute connection counts via TWO grouped queries
  // (one per direction in the OR) instead of N count() queries inside
  // the loop. Pre-fix: 100 memories = 100 sequential round-trips,
  // which timed out the 60s maxDuration on a warm DB. Now: 2 queries
  // total + a Map lookup per memory.
  const memoryIds = memories.map((m) => m.id);
  const [sourceCounts, targetCounts] = await Promise.all([
    prisma.memoryEdge
      .groupBy({
        by: ["sourceId"],
        where: { sourceType: "memory", sourceId: { in: memoryIds } },
        _count: { _all: true },
      })
      .catch(() => [] as Array<{ sourceId: string; _count: { _all: number } }>),
    prisma.memoryEdge
      .groupBy({
        by: ["targetId"],
        where: { targetType: "memory", targetId: { in: memoryIds } },
        _count: { _all: true },
      })
      .catch(() => [] as Array<{ targetId: string; _count: { _all: number } }>),
  ]);
  const connectionMap = new Map<string, number>();
  for (const row of sourceCounts) {
    connectionMap.set(row.sourceId, (connectionMap.get(row.sourceId) ?? 0) + row._count._all);
  }
  for (const row of targetCounts) {
    connectionMap.set(row.targetId, (connectionMap.get(row.targetId) ?? 0) + row._count._all);
  }

  let scored = 0;
  for (const m of memories) {
    // Calculate dynamic importance score
    const recency = Math.max(0, 1 - (Date.now() - m.lastSeen.getTime()) / (30 * 24 * 60 * 60 * 1000)); // 0-1, 1=today
    const frequency = Math.min(m.seenCount / 10, 1); // 0-1, max at 10 sightings
    const categoryWeight = getCategoryWeight(m.category);

    const connections = connectionMap.get(m.id) ?? 0;
    const connectedness = Math.min(connections / 5, 1); // 0-1, max at 5 connections

    // Composite importance score
    const importance = (recency * 0.2) + (frequency * 0.25) + (categoryWeight * 0.3) + (connectedness * 0.15) + (m.confidence * 0.1);

    // Update confidence to reflect importance (keeps memories in priority order)
    const newConfidence = Math.max(0.05, Math.min(1.0, importance));
    if (Math.abs(newConfidence - m.confidence) > 0.05) {
      await prisma.brainMemory.update({
        where: { id: m.id },
        data: { confidence: newConfidence },
      });
      scored++;
    }
  }

  return { scored };
}

function getCategoryWeight(category: string): number {
  const weights: Record<string, number> = {
    wisdom: 1.0,
    business_alert: 0.9,
    contradiction: 0.85,
    pattern: 0.8,
    insight: 0.75,
    anomaly: 0.7,
    business_event: 0.65,
    preference: 0.6,
    action_outcome: 0.55,
    emotional_state: 0.5,
    device_behavior: 0.3,
    action_frequency: 0.2,
  };
  return weights[category] ?? 0.5;
}

// ─── 6. CROSS-POLLINATE: Connect insights across layers ──

export async function crossPollinate(): Promise<{ connections: number }> {
  // Find unconnected high-value memories and link them
  const [wisdoms, contradictions, predictions, reflections] = await Promise.all([
    prisma.brainMemory.findMany({ where: { category: BRAIN_CATEGORIES.WISDOM }, take: 10, select: { id: true, content: true } }),
    prisma.contradiction.findMany({ where: { resolved: false }, take: 5, select: { id: true, claim: true, gap: true } }),
    prisma.prediction.findMany({ where: { status: "pending" }, take: 5, select: { id: true, prediction: true } }),
    prisma.reflection.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, insight: true } }),
  ]);

  let connections = 0;

  // Connect contradictions to relevant wisdom
  for (const c of contradictions) {
    for (const w of wisdoms) {
      if (w.content.toLowerCase().includes(c.claim.slice(0, 20).toLowerCase()) ||
          c.gap.toLowerCase().includes(w.content.slice(0, 20).toLowerCase())) {
        const { connect: connectEdge } = await import("./relational-graph");
        await connectEdge(
          { type: "memory", id: w.id },
          { type: "memory", id: c.id },
          "contradicts",
          `Wisdom "${w.content.slice(0, 40)}" contradicts "${c.claim.slice(0, 40)}"`
        ).catch((err) => {
          recordError("brain:memory-consolidation", err, { edge: "contradicts", sourceId: w.id, targetId: c.id });
        });
        connections++;
      }
    }
  }

  // Connect predictions to relevant reflections
  for (const p of predictions) {
    for (const r of reflections) {
      const pWords = new Set(p.prediction.toLowerCase().split(/\s+/).filter(w => w.length > 4));
      const rWords = new Set(r.insight.toLowerCase().split(/\s+/).filter(w => w.length > 4));
      const overlap = [...pWords].filter(w => rWords.has(w)).length;
      if (overlap >= 2) {
        const { connect: connectEdge } = await import("./relational-graph");
        await connectEdge(
          { type: "reflection", id: r.id },
          { type: "prediction", id: p.id },
          "supports",
          `Shared concepts: ${overlap} overlapping terms`
        ).catch((err) => {
          recordError("brain:memory-consolidation", err, { edge: "supports", sourceId: r.id, targetId: p.id });
        });
        connections++;
      }
    }
  }

  return { connections };
}

// ─── 7. SELF-HEAL: Detect and fix broken data ───────────

export async function selfHeal(): Promise<{ fixed: number }> {
  let fixed = 0;

  // Fix orphaned memories (no category)
  const orphaned = await prisma.brainMemory.updateMany({
    where: { category: "" },
    data: { category: BRAIN_CATEGORIES.UNCATEGORIZED },
  });
  fixed += orphaned.count;

  // Fix memories with zero confidence that shouldn't be zero
  const zeroed = await prisma.brainMemory.updateMany({
    where: { confidence: 0, seenCount: { gt: 1 } },
    data: { confidence: 0.3 },
  });
  fixed += zeroed.count;

  // Fix predictions stuck in "pending" past their target date
  const stalePredictions = await prisma.prediction.updateMany({
    where: {
      status: "pending",
      targetDate: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0] },
    },
    data: { status: "expired" },
  });
  fixed += stalePredictions.count;

  // Fix contradictions older than 30 days — auto-resolve
  const oldContradictions = await prisma.contradiction.updateMany({
    where: {
      resolved: false,
      createdAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    },
    data: { resolved: true, resolvedHow: "Auto-resolved after 30 days without action" },
  });
  fixed += oldContradictions.count;

  // Fix environmental signals past expiry
  // EnvironmentalSignal model removed — no-op
  fixed += 0;

  return { fixed };
}

// ─── 8. SYSTEM HEALTH CHECK ──────────────────────────────

export async function systemHealthCheck(): Promise<Record<string, unknown>> {
  const [
    memoryCount, wisdomCount, contradictionCount, predictionCount,
    reflectionCount, edgeCount, simulationCount, identityCount,
    causalCount, signalCount, personCount,
  ] = await Promise.all([
    // v7.9: health stats only count alive rows so soft-deleted entries
    // don't trigger false "we have memories" green checks.
    prisma.brainMemory.count({ where: { deletedAt: null } }),
    prisma.brainMemory.count({ where: { category: BRAIN_CATEGORIES.WISDOM, deletedAt: null } }),
    prisma.contradiction.count({ where: { resolved: false } }),
    prisma.prediction.count({ where: { status: "pending" } }),
    prisma.reflection.count({ where: { deletedAt: null } }),
    prisma.memoryEdge.count(),
    // v10.0.529.106 · Wave 58 · the simulation engine writes to
    // BrainMemory(category="simulation") · count from there instead of
    // the prior Promise.resolve(0) that always showed 0 simulations
    // even after dozens had been run.
    prisma.brainMemory.count({ where: { category: BRAIN_CATEGORIES.SIMULATION, deletedAt: null } }),
    prisma.identitySnapshot.count({ where: { deletedAt: null } }),
    prisma.causalChain.count(),
    Promise.resolve(0),
    prisma.personProfile.count(),
  ]);

  const avgConfidence = await prisma.brainMemory.aggregate({
    where: { deletedAt: null }, // v7.9
    _avg: { confidence: true },
  });

  // Detect health issues
  const issues: string[] = [];
  if (memoryCount === 0) issues.push("CRITICAL: No memories in brain");
  if (wisdomCount === 0 && memoryCount > 50) issues.push("WARNING: No wisdom promoted despite 50+ memories");
  if (contradictionCount > 10) issues.push("WARNING: 10+ unresolved contradictions — identity confusion risk");
  if ((avgConfidence._avg.confidence ?? 0) < 0.3) issues.push("WARNING: Average memory confidence below 0.3 — brain is uncertain");
  if (edgeCount === 0 && memoryCount > 20) issues.push("WARNING: No relational edges — memories are isolated");
  if (reflectionCount === 0) issues.push("INFO: No reflections yet — evening cron needs to run");
  if (predictionCount === 0) issues.push("INFO: No predictions yet — evening cron needs to run");

  return {
    health: issues.length === 0 ? "HEALTHY" : issues.some(i => i.startsWith("CRITICAL")) ? "CRITICAL" : "DEGRADED",
    issues,
    layers: {
      L1_episodic: memoryCount,
      L2_extracted: await prisma.executionInsight.count().catch(() => 0),
      L4_reflections: reflectionCount,
      L5_predictions: predictionCount,
      L6_edges: edgeCount,
      L7_contradictions: contradictionCount,
      L8_identity: identityCount,
      L9_simulations: simulationCount,
      L10_causal: causalCount,
      L11_people: personCount,
      L12_signals: signalCount,
    },
    wisdom: wisdomCount,
    avgConfidence: Math.round((avgConfidence._avg.confidence ?? 0) * 100) / 100,
  };
}

// ─── 9. EVOLVE: Self-modifying layer optimization ────────

export async function evolveMemory(): Promise<{ evolved: string[] }> {
  const evolved: string[] = [];

  // Check which categories are growing fastest and adjust weights
  const growth = await prisma.brainMemory.groupBy({
    by: ["category"],
    where: { deletedAt: null, createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
  });

  if (growth.length > 0) {
    const topCategory = growth[0].category;
    const topCount = growth[0]._count.id;

    // If one category is dominating, create a meta-memory about it
    if (topCount > 10) {
      await brainMemory.remember(
        "meta_pattern",
        `dominant_category_${today()}`,
        `The "${topCategory}" category is growing fastest (${topCount} new in 7 days). This indicates heavy focus on ${topCategory}-related thinking.`,
        "evolution_engine"
      );
      evolved.push(`Detected dominant category: ${topCategory} (${topCount}/7d)`);
    }
  }

  // Check prediction accuracy and adjust confidence baseline
  const [confirmed, disproven] = await Promise.all([
    prisma.prediction.count({ where: { status: "confirmed" } }),
    prisma.prediction.count({ where: { status: "disproven" } }),
  ]);

  const total = confirmed + disproven;
  if (total >= 5) {
    const accuracy = confirmed / total;
    await brainMemory.remember(
      "meta_pattern",
      `prediction_accuracy_${today()}`,
      `Prediction accuracy: ${(accuracy * 100).toFixed(0)}% (${confirmed}/${total}). ${accuracy > 0.7 ? "Model is well-calibrated." : accuracy > 0.5 ? "Model needs refinement." : "Model is unreliable — predictions should carry lower weight."}`,
      "evolution_engine"
    );
    evolved.push(`Prediction accuracy: ${(accuracy * 100).toFixed(0)}%`);
  }

  // Identify memory categories that are decaying (low avg confidence)
  const categoryHealth = await prisma.brainMemory.groupBy({
    by: ["category"],
    where: { deletedAt: null },
    _avg: { confidence: true },
    _count: { id: true },
    having: { id: { _count: { gt: 5 } } },
  });

  for (const cat of categoryHealth) {
    if ((cat._avg.confidence ?? 1) < 0.3) {
      evolved.push(`Category "${cat.category}" is decaying (avg conf: ${((cat._avg.confidence ?? 0) * 100).toFixed(0)}%)`);
    }
  }

  return { evolved };
}

// ─── MASTER: Run full consolidation cycle (QUADRUPLED) ───

export interface ConsolidationResult {
  merged: number;
  promoted: number;
  pruned: number;
  insights: number;
  scored: number;
  connections: number;
  healed: number;
  health: Record<string, unknown>;
  evolved: string[];
}

export async function runConsolidation(): Promise<ConsolidationResult> {
  // v11.1 · Each stage wrapped in a safe-stage runner so one bad
  // step (e.g. a unique-constraint collision in promoteToWisdom)
  // doesn't tank the other 8 stages. Before: 44s into the run, one
  // brainMemory.create would collide and the whole cron 500'd every
  // evening. Now: that stage logs, returns a zero-value fallback,
  // and the chain keeps going.
  const safe = async <T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("stage_failed", { stage: label, msg });
      return fallback;
    }
  };

  const pruned     = await safe("pruneNoise",        pruneNoise,        { pruned: 0 });
  const merged     = await safe("mergeMemories",     mergeMemories,     { merged: 0 });
  const promoted   = await safe("promoteToWisdom",   promoteToWisdom,   { promoted: 0 });
  const distilled  = await safe("distillKnowledge",  distillKnowledge,  { insights: 0 });
  const scored     = await safe("scoreMemories",     scoreMemories,     { scored: 0 });
  const crossLinked= await safe("crossPollinate",    crossPollinate,    { connections: 0 });
  const healed     = await safe("selfHeal",          selfHeal,          { fixed: 0 });
  const health     = await safe("systemHealthCheck", systemHealthCheck, { health: "UNKNOWN", issues: ["stage failed"] } as Record<string, unknown>);
  const evolution  = await safe("evolveMemory",      evolveMemory,      { evolved: [] as string[] });

  return {
    merged: merged.merged,
    promoted: promoted.promoted,
    pruned: pruned.pruned,
    insights: distilled.insights,
    scored: scored.scored,
    connections: crossLinked.connections,
    healed: healed.fixed,
    health,
    evolved: evolution.evolved,
  };
}
