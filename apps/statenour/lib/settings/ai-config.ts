/**
 * Global AI Configuration — live-mutable settings for the chat pipeline.
 *
 * Item #11 from the excellence marathon. Every hardcoded LLM param
 * (temperature, reasoning_effort, web_search), every default mode
 * selection, every tool opt-in/opt-out is now editable at runtime from
 * the Settings page. No redeploy needed — mutate the config, the next
 * chat request picks it up.
 *
 * Storage: single brain_memory row with category="ai_config" and
 * key="global". Avoids a new Prisma model (which would require the
 * overdue db push). The row is JSON-serialized and upserted on write.
 *
 * Read path: getAiConfig() → 30s in-memory cache → brain_memory row
 * Write path: updateAiConfig(patch) → merge → upsert → invalidate cache
 *
 * The chat route reads this config on each request via getAiConfig()
 * and applies it when building the LLM request body + pruning tools.
 */

import { prisma } from "@/lib/prisma";
import type { TaskType, ProviderName } from "@/lib/ai/provider";
import type { ChatMode } from "@/lib/ai/chat-mode";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

export interface AiConfig {
  // ── Provider + mode overrides ──
  // These force the chat pipeline to use specific settings. Omit to
  // keep automatic detection (quick/standard/deep + Venice-first).
  defaultProvider?: ProviderName;
  defaultMode?: ChatMode;
  defaultTaskType?: TaskType;

  // ── LLM generation parameters (override hardcoded defaults in provider.ts) ──
  temperature?: number; // 0.0 - 2.0
  reasoningEffort?: "none" | "low" | "medium" | "high" | "max";
  repetitionPenalty?: number; // 1.0 - 2.0
  minP?: number; // 0.0 - 0.5
  webSearch?: "auto" | "on" | "off";
  webScraping?: boolean;

  // ── Tool controls ──
  // Tools listed here are NEVER loaded regardless of mode. Use this
  // to disable a tool temporarily without editing nourTools.
  disabledTools?: string[];
  // Force these tools to ALWAYS be included even in quick mode. Use
  // for tools Nour considers non-negotiable.
  alwaysOnTools?: string[];

  // ── UI toggles (client reads these too) ──
  showSpeedRibbon?: boolean;
  hapticFeedback?: boolean;
  nightModeDim?: boolean;

  // ── Cache controls ──
  promptCacheTtlMs?: number; // default 45000
  toolEmbeddingsEnabled?: boolean; // default true

  // ── System prompt budget ──
  maxSystemChars?: number; // default 65000 for LLM

  // ── Metadata ──
  updatedAt?: string;
  updatedBy?: string;
}

export const DEFAULT_AI_CONFIG: AiConfig = {
  defaultProvider: undefined,
  defaultMode: undefined,
  defaultTaskType: undefined,
  temperature: undefined,
  reasoningEffort: undefined,
  repetitionPenalty: undefined,
  minP: undefined,
  webSearch: "auto",
  webScraping: true,
  disabledTools: [],
  alwaysOnTools: [],
  showSpeedRibbon: false,
  hapticFeedback: true,
  nightModeDim: false,
  promptCacheTtlMs: 45_000,
  toolEmbeddingsEnabled: true,
  maxSystemChars: 65_000,
};

// ── In-memory cache (per-lambda) ──
// Avoids DB hit on every chat request. 30s TTL balances freshness with
// perf — settings changes take effect within 30s without requiring an
// explicit invalidation.
const CACHE_TTL_MS = 30_000;
let cached: { config: AiConfig; expiresAt: number } | null = null;

/** Force-clear the cache (called after a write). */
export function invalidateAiConfigCache(): void {
  cached = null;
}

/**
 * Read the current live AI config. Returns the default shape if the
 * row doesn't exist yet. Cached for 30s to keep the chat hot path fast.
 */
export async function getAiConfig(): Promise<AiConfig> {
  if (cached && cached.expiresAt > Date.now()) {
    return cached.config;
  }

  try {
    const row = await prisma.brainMemory.findUnique({
      where: { category_key: { category: BRAIN_CATEGORIES.AI_CONFIG, key: "global" } },
      select: { content: true },
    });

    if (!row?.content) {
      cached = { config: DEFAULT_AI_CONFIG, expiresAt: Date.now() + CACHE_TTL_MS };
      return DEFAULT_AI_CONFIG;
    }

    const parsed = JSON.parse(row.content) as AiConfig;
    // Merge with defaults so new fields always have a sane value.
    const merged: AiConfig = { ...DEFAULT_AI_CONFIG, ...parsed };
    cached = { config: merged, expiresAt: Date.now() + CACHE_TTL_MS };
    return merged;
  } catch {
    // DB unreachable → fall back to defaults so chat still works
    return DEFAULT_AI_CONFIG;
  }
}

/**
 * Merge a patch into the live config and persist it. Invalidates the
 * local cache so the next getAiConfig() sees the fresh value.
 */
export async function updateAiConfig(
  patch: Partial<AiConfig>,
  updatedBy = "settings"
): Promise<AiConfig> {
  const current = await getAiConfig();
  const next: AiConfig = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };

  // Prisma's JSON input type wants something it can safely serialize.
  // Round-tripping through JSON.parse(JSON.stringify(...)) strips any
  // non-JSON-safe values and gives us the typed shape Prisma expects.
  const metaJson = JSON.parse(JSON.stringify({ lastPatch: patch }));

  try {
    await prisma.brainMemory.upsert({
      where: { category_key: { category: BRAIN_CATEGORIES.AI_CONFIG, key: "global" } },
      update: {
        content: JSON.stringify(next),
        source: "settings_ui",
        confidence: 1.0,
        seenCount: { increment: 1 },
        metadata: metaJson,
      },
      create: {
        category: BRAIN_CATEGORIES.AI_CONFIG,
        key: "global",
        content: JSON.stringify(next),
        source: "settings_ui",
        confidence: 1.0,
        metadata: metaJson,
      },
    });
  } catch {
    // Write failed — config update will be lost but chat still works
  }

  invalidateAiConfigCache();
  return next;
}

/**
 * Reset the config to defaults. Used by the "Reset to Nick's tuning"
 * button on the Settings page.
 */
export async function resetAiConfig(updatedBy = "settings"): Promise<AiConfig> {
  return updateAiConfig(
    {
      ...DEFAULT_AI_CONFIG,
      updatedAt: new Date().toISOString(),
      updatedBy,
    },
    updatedBy
  );
}
