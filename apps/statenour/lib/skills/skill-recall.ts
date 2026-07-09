/**
 * lib/skills/skill-recall.ts · v10.0.433
 *
 * Semantic recall over the 1,423 installed Claude skills.
 *
 * Two entry points:
 *
 *   1. `recallSkills(query, topK)` · embedding-based · returns the
 *      top-K skills most similar to the query string. Used by:
 *        · the chat system-prompt (auto-inject top 3 skills relevant
 *          to the current operator message)
 *        · the `searchSkills` tool when the model wants to look
 *          something up explicitly
 *        · future agents that need skill discovery
 *
 *
 * Implementation notes:
 *   · Embeddings live in vector_embeddings with sourceType="skill" ·
 *     populated by scripts/embed-skills.ts (v10.0.432)
 *   · Cosine similarity in JS · matches the v10.0.402 wisdom-graph
 *     pattern. Could move to pgvector HNSW later if performance
 *     warrants, but 1,423 rows × 1024 dims = 5.8M float ops per
 *     query · 60-90ms in practice · fine.
 *   · Returns at most TOP_K_HARD_CAP=10 to keep prompt budget tight
 *   · Floor at 0.30 cosine · below that the match is noise
 */

import { prisma } from "@/lib/prisma";
import { cosineSimilarity } from "@/lib/brain/embedding-utils";
import { getEmbedding } from "@/lib/ai/provider";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("skills/recall");

const TOP_K_HARD_CAP = 10;
const SIMILARITY_FLOOR = 0.30;
const QUERY_CACHE_TTL_MS = 60 * 1000;

export interface SkillMatch {
  name: string;
  description: string;
  similarity: number;
  category?: string;
  tags?: string[];
  /** Path on disk · ~/.claude/skills/<name>/ */
  path?: string;
}

interface SkillRegistryEntry {
  name: string;
  description: string;
  category?: string;
  tags?: string[];
  source?: string;
  risk?: string;
  path: string;
}

interface RegistryFile {
  generatedAt: string;
  totalSkills: number;
  skills: SkillRegistryEntry[];
}

// ── lazy loaders ────────────────────────────────────────────────

let cachedRegistry: RegistryFile | null = null;
let cachedRegistryAt = 0;
const REGISTRY_TTL_MS = 60 * 60_000;

async function loadRegistry(): Promise<RegistryFile | null> {
  if (cachedRegistry && Date.now() - cachedRegistryAt < REGISTRY_TTL_MS) {
    return cachedRegistry;
  }
  try {
    const { readFile } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    const path = resolve(process.cwd(), "data", "skills-registry.json");
    const text = await readFile(path, "utf8");
    const data = JSON.parse(text) as RegistryFile;
    cachedRegistry = data;
    cachedRegistryAt = Date.now();
    return data;
  } catch (err) {
    log.warn("registry_load_failed", {
      err: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    return null;
  }
}

// ── query embedding cache ───────────────────────────────────────

const queryCache = new Map<string, { vec: number[]; at: number }>();

async function embedQuery(query: string): Promise<number[] | null> {
  const key = query.trim().toLowerCase();
  const cached = queryCache.get(key);
  if (cached && Date.now() - cached.at < QUERY_CACHE_TTL_MS) {
    return cached.vec;
  }
  try {
    const vec = await getEmbedding(key.slice(0, 1500));
    if (!Array.isArray(vec) || vec.length === 0) return null;
    queryCache.set(key, { vec, at: Date.now() });
    // Bound cache size · keep last 100 queries
    if (queryCache.size > 100) {
      const first = queryCache.keys().next().value;
      if (first) queryCache.delete(first);
    }
    return vec;
  } catch (err) {
    log.warn("query_embed_failed", {
      err: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    return null;
  }
}

// ── recall ──────────────────────────────────────────────────────

/**
 * Top-K skills semantically similar to `query`. Returns empty array
 * if registry or embeddings are unavailable.
 */
export async function recallSkills(
  query: string,
  topK = 5,
): Promise<SkillMatch[]> {
  if (!query || query.trim().length < 3) return [];
  const k = Math.max(1, Math.min(TOP_K_HARD_CAP, topK));

  const reg = await loadRegistry();
  if (!reg) return [];

  const queryVec = await embedQuery(query);
  if (!queryVec) return [];

  // Pull the embedding rows for sourceType=skill.
  const rows = await prisma.vectorEmbedding.findMany({
    where: { sourceType: "skill" },
    select: { sourceId: true, embedding: true },
  });
  if (rows.length === 0) return [];

  // Build registry lookup map · O(1) access during scoring.
  const byName = new Map<string, SkillRegistryEntry>();
  for (const s of reg.skills) byName.set(s.name, s);

  const scored: { name: string; sim: number }[] = [];
  for (const r of rows) {
    try {
      const vec = JSON.parse(r.embedding) as number[];
      if (vec.length !== queryVec.length) continue;
      const sim = cosineSimilarity(queryVec, vec);
      if (sim < SIMILARITY_FLOOR) continue;
      scored.push({ name: r.sourceId, sim });
    } catch {
      // skip malformed embedding row
    }
  }
  scored.sort((a, b) => b.sim - a.sim);

  const out: SkillMatch[] = [];
  for (const s of scored.slice(0, k)) {
    const entry = byName.get(s.name);
    if (!entry) continue;
    out.push({
      name: entry.name,
      description: entry.description,
      similarity: Math.round(s.sim * 1000) / 1000,
      category: entry.category,
      tags: entry.tags,
      path: entry.path,
    });
  }
  return out;
}

/**
 * Compact rendering for the system-prompt surface. Top-N matches
 * formatted as a tight list · easy for the model to reference.
 *
 * Output:
 *   ## Relevant skills (top 3)
 *   - kaizen · 0.78 · Continuous improvement, error-proofing, JIT…
 *   - simplify-code · 0.72 · Review a diff for safe simplifications…
 *   - code-refactoring-tech-debt · 0.68 · Identify + quantify debt…
 */
export function formatSkillsBlock(matches: SkillMatch[], heading = "Relevant skills"): string {
  if (matches.length === 0) return "";
  const lines = [`## ${heading} (top ${matches.length})`];
  for (const m of matches) {
    const desc = m.description.replace(/\s+/g, " ").trim().slice(0, 110);
    lines.push(`- ${m.name} · ${m.similarity.toFixed(2)} · ${desc}${desc.length === 110 ? "…" : ""}`);
  }
  return lines.join("\n");
}
