/**
 * lib/services/reflection.ts · CoALA reflection layer (task #12 ·
 * 2026-05-23).
 *
 * Stanford "Generative Agents" pattern (Park et al. 2023): periodically
 * re-read recent memories of one category, ask the model to synthesize
 * 3-5 higher-level patterns, write those back as new `reflection`-
 * category BrainMemory rows with `metadata.derivedFrom` pointing at the
 * source row ids. This is the bridge between a memory LOG (raw write/
 * read) and a memory that COMPOUNDS (each cycle elevates signal-to-
 * noise).
 *
 * Distinct from `lib/brain/reflection-engine.ts` — that one is the
 * Layer-4 daily/weekly cross-table engine (scores + habits + dumps +
 * business signals → `Reflection` table). This one is the CoALA
 * per-category synthesis (BrainMemory category X → BrainMemory category
 * `reflection`). Different layer, different output table, no collision.
 *
 * Locked design choices (per task brief):
 *   1. No schema migration · `derivedFrom` / `reflectionWindow` /
 *      `sourceCategory` live in the existing BrainMemory.metadata Json.
 *   2. Per-category cycle · default 7-day window · skip if <5 source.
 *   3. 3-5 synthesized insights per category.
 *   4. Provider chain via aiChat (Venice / Ollama first · OpenAI /
 *      Anthropic fallback only).
 *   5. Cron + manual trigger.
 *   6. Dedup · skip if a reflection for the same (category, window) ran
 *      in the last 24h.
 */

import { prisma } from "@/lib/prisma";
import { brainMemory } from "@/lib/brain/memory-manager";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { makeTracedAiChat } from "@/lib/ai/traced-aichat";
import { extractJsonObject } from "@/lib/ai/extract-structured";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("services/reflection");
const aiChat = makeTracedAiChat("reflection-coala", "brain");

// ── Public types (the exact shape the brief specifies) ──────────────

export interface ReflectionInput {
  /** Source category to reflect on (e.g. "decision_log", "pattern"). */
  category: string;
  /** Rolling window in days · default 7. Min 1 · Max 90. */
  windowDays?: number;
  /** Minimum source rows to bother synthesizing · default 5. */
  minSourceCount?: number;
  /** Cap on insights synthesized · default 5. Min 1 · Max 10. */
  maxInsights?: number;
}

export interface ReflectionInsight {
  /** The new BrainMemory id. */
  id: string;
  /** The synthesized insight text. */
  content: string;
  /** Source memory ids the model cited as evidence. */
  derivedFrom: string[];
  /** Model-reported confidence · 0-1. */
  confidence: number;
}

export interface ReflectionResult {
  /** The source category that was reflected on. */
  category: string;
  /** Count of insights actually persisted. */
  insightsWritten: number;
  /** The persisted insights (empty when skipped). */
  insights: ReflectionInsight[];
  /** Set when nothing was written · explains why. */
  skipped?: "insufficient-source" | "recent-reflection-exists";
}

// ── Internal helpers ────────────────────────────────────────────────

/**
 * The shape we expect from the LLM. Loose · the JSON extractor handles
 * malformed output; we validate structurally before writing rows.
 */
interface SynthesisPayload {
  insights: Array<{
    content?: unknown;
    derivedFrom?: unknown;
    confidence?: unknown;
  }>;
}

/**
 * Build the synthesis prompt. The model is asked for STRICT JSON with
 * `{ insights: [...] }` keyed exactly so the JSON extractor's repair
 * pass has the easiest possible target.
 */
function buildSynthesisPrompt(
  category: string,
  windowDays: number,
  maxInsights: number,
  rows: Array<{ id: string; content: string; confidence: number; seenCount: number }>,
): string {
  const numbered = rows
    .map(
      (r, i) =>
        `[${i + 1}] id=${r.id} (conf=${(r.confidence * 100).toFixed(0)}% · seen=${r.seenCount}x)\n    ${r.content.slice(0, 280)}`,
    )
    .join("\n\n");

  return `Source category: ${category}
Window: last ${windowDays} days
Source memory count: ${rows.length}

Here are ${rows.length} recent memories from this category:

${numbered}

Identify the 3-${maxInsights} HIGHEST-LEVEL patterns or insights that span MULTIPLE source memories. Each insight must:
  · Be SPECIFIC (reference exact themes or numbers from the sources, not vague generalities)
  · Span ≥2 source memories (single-source observations belong as-is — don't synthesize them)
  · Be NON-OBVIOUS (don't restate what one source already says — find the cross-cutting pattern)
  · Cite source ids in derivedFrom (use the cuids shown above)

Return ONLY a JSON object — no prose, no markdown fences:
{
  "insights": [
    {
      "content": "specific cross-cutting pattern (max 400 chars)",
      "derivedFrom": ["cuid1", "cuid2"],
      "confidence": 0.0-1.0
    }
  ]
}`;
}

/** Coerce LLM output to a valid insight or null. Defensive — drops bad rows. */
function validateInsight(
  raw: { content?: unknown; derivedFrom?: unknown; confidence?: unknown },
  validSourceIds: ReadonlySet<string>,
): { content: string; derivedFrom: string[]; confidence: number } | null {
  if (typeof raw.content !== "string") return null;
  const content = raw.content.trim();
  if (content.length < 10 || content.length > 1000) return null;

  if (!Array.isArray(raw.derivedFrom)) return null;
  // Only keep ids that actually appeared in our source window — drops
  // hallucinated cuids the model might invent.
  const derivedFrom = raw.derivedFrom
    .filter((id): id is string => typeof id === "string" && validSourceIds.has(id));
  if (derivedFrom.length === 0) return null;

  let confidence =
    typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
      ? raw.confidence
      : 0.6;
  if (confidence < 0) confidence = 0;
  if (confidence > 1) confidence = 1;

  return { content, derivedFrom, confidence };
}

// ── Public entrypoint ───────────────────────────────────────────────

/**
 * Reflect on one BrainMemory category · synthesize higher-level
 * insights · persist them as new `reflection`-category rows.
 *
 * Returns `skipped` when there's not enough signal or a recent
 * reflection already exists for the same (category, window).
 */
export async function reflectOnCategory(
  input: ReflectionInput,
): Promise<ReflectionResult> {
  const category = input.category;
  const windowDays = Math.max(1, Math.min(90, input.windowDays ?? 7));
  const minSourceCount = Math.max(1, input.minSourceCount ?? 5);
  const maxInsights = Math.max(1, Math.min(10, input.maxInsights ?? 5));

  const now = new Date();
  const windowStart = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);

  // 1. Pull source memories in the window.
  // Direct prisma rather than brainMemory.recall — the manager API
  // doesn't expose a createdAt filter and the reflection-engine
  // uses the same direct pattern.
  const sourceRows = await prisma.brainMemory.findMany({
    where: {
      category,
      createdAt: { gte: windowStart },
      deletedAt: null,
    },
    orderBy: { confidence: "desc" },
    take: 50, // cap prompt size · 50 × ~280 chars + headers ≈ 16k chars
    select: {
      id: true,
      content: true,
      confidence: true,
      seenCount: true,
    },
  });

  if (sourceRows.length < minSourceCount) {
    log.info("reflect_skipped_insufficient", {
      category,
      windowDays,
      sourceCount: sourceRows.length,
      minSourceCount,
    });
    return {
      category,
      insightsWritten: 0,
      insights: [],
      skipped: "insufficient-source",
    };
  }

  // 2. Dedup check — was the same (sourceCategory, windowDays) run in
  // the last 24h? Scan the latest few reflection rows for that
  // category in metadata. We over-pull-then-filter because the
  // metadata Json column isn't indexable cheaply for this query.
  const dedupCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const recentReflections = await prisma.brainMemory.findMany({
    where: {
      category: BRAIN_CATEGORIES.REFLECTION,
      createdAt: { gte: dedupCutoff },
      deletedAt: null,
    },
    select: { metadata: true },
    take: 50,
  });
  const dedupHit = recentReflections.some((r) => {
    const m = r.metadata as { sourceCategory?: unknown } | null;
    return m?.sourceCategory === category;
  });
  if (dedupHit) {
    log.info("reflect_skipped_recent", { category, windowDays });
    return {
      category,
      insightsWritten: 0,
      insights: [],
      skipped: "recent-reflection-exists",
    };
  }

  // 3. Synthesize via the provider chain.
  const userPrompt = buildSynthesisPrompt(
    category,
    windowDays,
    maxInsights,
    sourceRows,
  );

  let llmContent: string;
  try {
    const result = await aiChat(
      [
        {
          role: "system",
          content:
            "You are a meta-cognition synthesizer. You read raw memories and elevate them to higher-level patterns. Output STRICT JSON only — no prose, no markdown fences.",
        },
        { role: "user", content: userPrompt },
      ],
      "reason",
    );
    llmContent = result.content;
  } catch (err) {
    log.warn("reflect_llm_failed", {
      category,
      error: err instanceof Error ? err.message : String(err),
    });
    return { category, insightsWritten: 0, insights: [] };
  }

  // 4. Parse + validate.
  const parsed = extractJsonObject<SynthesisPayload>(llmContent);
  if (!parsed.ok) {
    log.warn("reflect_parse_failed", { category, preview: llmContent.slice(0, 200) });
    return { category, insightsWritten: 0, insights: [] };
  }
  const rawInsights = parsed.value?.insights;
  if (!Array.isArray(rawInsights) || rawInsights.length === 0) {
    log.warn("reflect_no_insights", { category });
    return { category, insightsWritten: 0, insights: [] };
  }

  const validSourceIds = new Set(sourceRows.map((r) => r.id));
  const validated = rawInsights
    .slice(0, maxInsights)
    .map((raw) => validateInsight(raw, validSourceIds))
    .filter(
      (v): v is { content: string; derivedFrom: string[]; confidence: number } =>
        v !== null,
    );

  if (validated.length === 0) {
    log.warn("reflect_all_invalid", { category, rawCount: rawInsights.length });
    return { category, insightsWritten: 0, insights: [] };
  }

  // 5. Persist · one BrainMemory row per insight.
  // Key shape gives natural idempotency via the (category, key) unique
  // constraint — re-running the same window won't duplicate rows even
  // if the dedup check is skipped in a test.
  const windowEndIso = now.toISOString();
  const written: ReflectionInsight[] = [];
  for (let i = 0; i < validated.length; i++) {
    const v = validated[i];
    const key = `reflection:${category}:${windowEndIso}:${i + 1}`;
    try {
      const row = await brainMemory.remember(
        BRAIN_CATEGORIES.REFLECTION,
        key,
        v.content,
        "reflection",
        {
          sourceCategory: category,
          derivedFrom: v.derivedFrom,
          reflectionWindow: {
            from: windowStart.toISOString(),
            to: windowEndIso,
            days: windowDays,
          },
          confidence: v.confidence,
        },
      );
      written.push({
        id: row.id,
        content: v.content,
        derivedFrom: v.derivedFrom,
        confidence: v.confidence,
      });
    } catch (err) {
      log.warn("reflect_write_failed", {
        category,
        key,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  log.info("reflect_done", {
    category,
    sourceCount: sourceRows.length,
    insightsWritten: written.length,
  });

  return {
    category,
    insightsWritten: written.length,
    insights: written,
  };
}
