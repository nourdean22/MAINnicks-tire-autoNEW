/**
 * Tool Embeddings — semantic tool selection for chat standard mode.
 *
 * Replaces the keyword regex in chat-mode.ts's pruneTools() with
 * cosine-similarity ranking. Every tool description is embedded once
 * and cached in-memory; every incoming user message is embedded at
 * request time and compared against the tool cache.
 *
 * Example of what this unlocks:
 *   - "my pipeline is drying up" → correctly ranks getRevenueAging,
 *     findCustomer, getWinbackSegments even though the literal word
 *     "aging" or "customer" isn't in the message. Keyword regex
 *     would have missed all three.
 *   - "tell me a joke about leads" → joke-style messages rank LOWER
 *     against data tools because the embedding captures the
 *     conversational intent, not just the keyword "lead".
 *
 * ── Apr 26 · BrainMemory persistence ──
 * Cold-lambda warmup used to re-embed all 149 tools (~5s + ~$0.0001
 * per cold start). Now we hydrate from BrainMemory first — each tool
 * embedding is persisted under category="tool_embedding" with a
 * description-fingerprint so changes to a tool's description trigger
 * a fresh embed rather than reusing a stale vector.
 *
 * Memory cost: 149 tools × 1536 floats × 4 bytes = ~900 KB. Cheap.
 * Persisted size: ~6KB JSON per tool × 149 = ~900KB on disk; trivial.
 * API cost on a clean slate: 149 embeddings × ~20 tokens × $0.02/1M
 * = ~$0.00006. Once persisted, cold starts pay zero embedding cost
 * and ~200ms of DB read.
 */

import { getEmbedding } from "@/lib/ai/provider";
import { nourTools } from "@/lib/ai/tools";
import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/utils/error-log";
import { withTimeout } from "@/lib/utils/with-timeout";
import { createHash } from "node:crypto";

// Module-level cache. Persists for the lifetime of the lambda instance.
const toolEmbeddings = new Map<string, number[]>();

let warmupPromise: Promise<void> | null = null;
let warmComplete = false;
let warmStartedAt = 0;
let warmFinishedAt = 0;
let hydratedFromDb = 0; // for stats — how many came from BrainMemory
let freshlyEmbedded = 0; // for stats — how many we paid the API for

const PERSIST_CATEGORY = "tool_embedding";

/**
 * Stable fingerprint of a tool's identity. If the description text or
 * tool name changes, the fingerprint changes and we re-embed instead
 * of reading a stale row from BrainMemory.
 */
function fingerprintTool(name: string, description: string): string {
  return createHash("sha256")
    .update(`${name}::${description}`)
    .digest("hex")
    .slice(0, 16);
}

/**
 * Is the tool embedding cache ready for semantic lookup?
 */
export function isToolEmbeddingCacheWarm(): boolean {
  return warmComplete;
}

/**
 * Stats for the HUD + debug. Tells you how many tools are cached,
 * when the cache was warmed, and how long it took.
 */
export function getToolEmbeddingStats(): {
  warm: boolean;
  cachedCount: number;
  totalTools: number;
  warmMs: number | null;
  hydratedFromDb: number;
  freshlyEmbedded: number;
} {
  return {
    warm: warmComplete,
    cachedCount: toolEmbeddings.size,
    totalTools: Object.keys(nourTools).length,
    warmMs: warmFinishedAt > 0 ? warmFinishedAt - warmStartedAt : null,
    hydratedFromDb,
    freshlyEmbedded,
  };
}

interface PersistedToolEmbedding {
  fingerprint: string;
  embedding: number[];
  dim: number;
  embeddedAt: number;
}

/**
 * Hydrate the in-memory cache from BrainMemory rows. Skips any row
 * whose fingerprint doesn't match the current tool description (those
 * tools will be re-embedded by the warm-up loop).
 *
 * Returns the set of tool names successfully hydrated.
 */
async function hydrateFromBrainMemory(
  fingerprintByName: Map<string, string>,
): Promise<Set<string>> {
  const hydrated = new Set<string>();
  // v10.0.203 · read from VectorEmbedding first (sourceType="tool_
  // catalog"). BrainMemory read kept as legacy fallback during the
  // dual-write window. Cuts tool_embedding from BrainMemory's
  // category abuse list — embeddings belong in vector_embeddings,
  // by definition.
  try {
    const veRows = await prisma.vectorEmbedding.findMany({
      where: { sourceType: "tool_catalog" },
      select: { sourceId: true, embedding: true, model: true },
    });
    for (const row of veRows) {
      const name = row.sourceId;
      const expected = fingerprintByName.get(name);
      if (!expected) continue;
      // v10.0.203 · model column doubles as the fingerprint for
      // tool_catalog entries (see persistEmbedding below).
      if (row.model !== expected) continue; // stale
      try {
        const vec = JSON.parse(row.embedding) as number[];
        if (!Array.isArray(vec) || vec.length === 0) continue;
        toolEmbeddings.set(name, vec);
        hydrated.add(name);
      } catch {
        continue;
      }
    }
    if (hydrated.size > 0) return hydrated;
  } catch (err) {
    logError("ai.tool-embeddings", err, { fn: "hydrateFromBrainMemory", table: "VectorEmbedding" }, "warn");
  }
  // Legacy fallback path · v10.0.203 keeps this until the next
  // warmup confirms VectorEmbedding has all rows. Phase 2 drops
  // the BrainMemory read entirely.
  try {
    const rows = await prisma.brainMemory.findMany({
      where: { category: PERSIST_CATEGORY, deletedAt: null },
      select: { key: true, metadata: true },
    });
    for (const row of rows) {
      const name = row.key.replace(/^tool:/, "");
      if (hydrated.has(name)) continue; // VE already had it
      const expected = fingerprintByName.get(name);
      if (!expected) continue;
      const meta = row.metadata as PersistedToolEmbedding | null;
      if (!meta || meta.fingerprint !== expected) continue;
      if (!Array.isArray(meta.embedding) || meta.embedding.length === 0) continue;
      toolEmbeddings.set(name, meta.embedding);
      hydrated.add(name);
    }
  } catch (err) {
    logError("ai.tool-embeddings", err, { fn: "hydrateFromBrainMemory", table: "BrainMemory" }, "warn");
  }
  return hydrated;
}

/**
 * Persist a freshly-computed embedding to BrainMemory so future cold
 * lambdas can hydrate from disk instead of paying the embedding API.
 * Fire-and-forget — failures are logged at warn, never thrown.
 */
async function persistEmbedding(
  name: string,
  fingerprint: string,
  embedding: number[],
): Promise<void> {
  const meta: PersistedToolEmbedding = {
    fingerprint,
    embedding,
    dim: embedding.length,
    embeddedAt: Date.now(),
  };
  try {
    // v10.0.203 · primary write to VectorEmbedding (sourceType=
    // "tool_catalog", sourceId=toolName, model=fingerprint).
    // Embeddings belong in the embeddings table by definition.
    // BrainMemory write retained as legacy until Phase 2 cutover.
    const existing = await prisma.vectorEmbedding.findFirst({
      where: { sourceType: "tool_catalog", sourceId: name },
      select: { id: true },
    });
    if (existing) {
      await prisma.vectorEmbedding.update({
        where: { id: existing.id },
        data: {
          content: `embedding(${embedding.length}d) for ${name}`,
          embedding: JSON.stringify(embedding),
          embedding_dim: embedding.length,
          model: fingerprint,
        },
      });
    } else {
      await prisma.vectorEmbedding.create({
        data: {
          sourceType: "tool_catalog",
          sourceId: name,
          content: `embedding(${embedding.length}d) for ${name}`,
          embedding: JSON.stringify(embedding),
          embedding_dim: embedding.length,
          model: fingerprint,
        },
      });
    }
    // Legacy BrainMemory write — preserved during dual-write window.
    await prisma.brainMemory.upsert({
      where: { category_key: { category: PERSIST_CATEGORY, key: `tool:${name}` } },
      update: {
        content: `embedding(${embedding.length}d) for ${name}`,
        confidence: 1,
        lastSeen: new Date(),
        metadata: meta as unknown as Parameters<
          typeof prisma.brainMemory.upsert
        >[0]["update"]["metadata"],
      },
      create: {
        category: PERSIST_CATEGORY,
        key: `tool:${name}`,
        source: "tool_embedding_warmup",
        content: `embedding(${embedding.length}d) for ${name}`,
        confidence: 1,
        seenCount: 1,
        metadata: meta as unknown as Parameters<
          typeof prisma.brainMemory.upsert
        >[0]["create"]["metadata"],
      },
    });
  } catch (err) {
    // Persistence is opportunistic — next warmup will retry.
    logError("ai.tool-embeddings", err, { fn: "persistEmbedding", tool: name }, "warn");
  }
}

/**
 * Kick off the warm-up in the background. Safe to call multiple
 * times — the first call starts the promise, subsequent calls return
 * the same in-flight promise. Returns a promise you can await if you
 * want to block on completion, but normal callers should fire-and-
 * forget.
 *
 * Two-phase warmup:
 *   1. Hydrate from BrainMemory (one DB query, ~200ms cold)
 *   2. For any tool not hydrated (new tool or stale fingerprint),
 *      embed via the embedding API in batches of 8.
 *
 * Each freshly-computed embedding is persisted to BrainMemory so the
 * NEXT cold lambda starts ~5s faster.
 */
export function warmToolEmbeddings(): Promise<void> {
  if (warmComplete) return Promise.resolve();
  if (warmupPromise) return warmupPromise;

  warmStartedAt = Date.now();

  warmupPromise = (async () => {
    const entries = Object.entries(nourTools);

    // Build (name → fingerprint) map up front — hydrate uses it to
    // discriminate stale rows, and the embedding loop uses it to
    // know what fingerprint to persist.
    const fingerprintByName = new Map<string, string>();
    for (const [name, tool] of entries) {
      const t = tool as { description?: string };
      const description = t.description || name;
      fingerprintByName.set(name, fingerprintTool(name, description));
    }

    // ── Phase 1: hydrate from BrainMemory ──
    const hydrated = await hydrateFromBrainMemory(fingerprintByName);
    hydratedFromDb = hydrated.size;

    // ── Phase 2: embed anything not hydrated ──
    const todo = entries.filter(([name]) => !hydrated.has(name));
    const BATCH_SIZE = 8;

    for (let i = 0; i < todo.length; i += BATCH_SIZE) {
      const batch = todo.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async ([name, tool]) => {
          if (toolEmbeddings.has(name)) return;
          const t = tool as { description?: string };
          const description = t.description || name;
          // Include the tool name in the embedding text so similar
          // names (e.g. "findCustomer" / "searchCustomers") get
          // similar vectors. Description alone is too generic.
          const text = `${name}: ${description}`;
          try {
            const emb = await getEmbedding(text);
            if (emb.length === 0) return;
            toolEmbeddings.set(name, emb);
            freshlyEmbedded++;
            // Persist for the next cold lambda. Don't await — let it
            // race; we don't want to block warmup completion on DB
            // writes.
            const fp = fingerprintByName.get(name)!;
            void persistEmbedding(name, fp, emb);
          } catch (err) {
            // Skip this tool — keyword fallback will cover it.
            logError("ai.tool-embeddings", err, { fn: "warmToolEmbeddings", tool: name }, "warn");
          }
        }),
      );
    }

    warmComplete = true;
    warmFinishedAt = Date.now();
    console.log(
      `[tool-embeddings] Warm-up complete: ${toolEmbeddings.size}/${entries.length} cached in ${warmFinishedAt - warmStartedAt}ms (db-hydrated=${hydratedFromDb} fresh=${freshlyEmbedded})`,
    );
  })();

  return warmupPromise;
}

/**
 * Cosine similarity between two equal-length vectors. Returns a
 * score in [-1, 1]; 1 = identical, 0 = orthogonal, -1 = opposite.
 */
function cosineSim(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Rank the entire tool catalog by semantic similarity to the given
 * user-message embedding. Returns the top-N tools sorted by score
 * descending. Tools not in the cache are silently excluded.
 *
 * `minScore` filters out weak matches — 0.3 is a reasonable floor
 * where the tool is plausibly relevant. Below that, the regex
 * fallback is probably doing a better job.
 */
export function rankToolsBySimilarity(
  userEmbedding: number[],
  topN = 20,
  minScore = 0.3,
): Array<[string, number]> {
  if (userEmbedding.length === 0 || toolEmbeddings.size === 0) return [];

  const scores: Array<[string, number]> = [];
  for (const [name, emb] of toolEmbeddings.entries()) {
    const score = cosineSim(userEmbedding, emb);
    if (score >= minScore) scores.push([name, score]);
  }

  scores.sort((a, b) => b[1] - a[1]);
  return scores.slice(0, topN);
}

/** Aggregate deadline for the on-demand embed — see embedUserMessage. */
const EMBED_USER_MESSAGE_TIMEOUT_MS = 12_000;

/**
 * Embed a user message on-demand. Returns [] on failure so callers
 * can safely fall back to the keyword path.
 *
 * 2026-08-09 · Now bounded by a WALL-CLOCK deadline, not just per-hop ones.
 * getEmbedding walks a SERIAL provider cascade (Cohere → HuggingFace →
 * OpenAI → OpenRouter) where each hop has its own AbortSignal but the CHAIN
 * has none — a worst case well past 40s. This sits on the chat route's
 * pre-stream path and the brain-context stage CHAINS on it, so a slow (not
 * failed) cascade held the whole turn with zero bytes on the wire, past the
 * client's 90s stall abort. The operator's report — long messages that never
 * answer — is that shape, and this function is length-scaling by definition.
 *
 * 12s is deliberately just above the FIRST hop's own 10s timeout: the primary
 * provider gets its full budget, and a failing primary degrades instead of
 * paying for three more hops. withTimeout REJECTS, which the catch below
 * already handles — so this adds a bound, not a new failure mode. [] is the
 * documented contract and callers fall back to keyword pruning.
 */
export async function embedUserMessage(text: string): Promise<number[]> {
  if (!text || text.length < 3) return [];
  // Truncate to 10,000 chars (roughly 2.5k tokens) to prevent token exhaustion
  // and OOM attacks. The semantic intent is captured well within this limit.
  const safeText = text.slice(0, 10000);
  try {
    return await withTimeout(
      getEmbedding(safeText),
      EMBED_USER_MESSAGE_TIMEOUT_MS,
      "embedUserMessage",
    );
  } catch {
    return [];
  }
}
