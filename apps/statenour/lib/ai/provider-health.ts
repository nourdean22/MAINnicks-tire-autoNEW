/**
 * PROVIDER HEALTH — single-pane snapshot of every AI lane.
 *
 * v6 · BATCH 2 · Apr 28 — built so the rate-limit HUD pill, the
 * `/system/costs` dashboard, and the chat-health page all read the
 * same numbers instead of each route hitting the breakers independently.
 *
 * What it tells you in one call:
 *   1. ─ Per-provider availability ─
 *      - Configured? (env key present)
 *      - Quota-exhausted breaker tripped? (Venice 402, Ollama X)
 *      - Cooldown remaining
 *   2. ─ Per-provider tool-call support ─
 *      - Venice fast model has NO function calling (silent strip)
 *      - Other providers all support tools
 *   3. ─ Recent error counts (last hour, from AiGeneration.status) ─
 *      - timeouts, garbage-content gates, errors per provider
 *   4. ─ App-level rate-limit (in-memory bucket) ─
 *      - active keys + remaining quota in current window
 *
 * Pure read-only. No mutation, no DB writes. Cheap to call from a
 * polling pill (~30ms when warm, mostly the AiGeneration query).
 */

import { prisma } from "@/lib/prisma";
import {
  isOllamaQuotaExhausted,
  isGeminiQuotaExhausted,
  getProviderStatus,
  getOllamaCooldownRemainingMs,
  getGeminiCooldownRemainingMs,
  getOpenAiCooldownRemainingMs,
  getAnthropicCooldownRemainingMs,
  RUNTIME_PROVIDERS,
  type ProviderName,
} from "./provider";
import { PROVIDERS_REGISTRY } from "@/config/ai-providers";

// Models known to NOT support function calling. Mirror of the set in
// provider.ts so the dashboard can show a yellow flag without importing
// a private. Add to both when a new model joins the list.
const NO_TOOLS_MODELS = new Set<string>();

export interface ProviderHealth {
  name: ProviderName;
  configured: boolean;
  available: boolean;
  modelId: string;
  quotaExhausted: boolean;
  quotaCooldownRemainingMs: number;
  toolsSupported: boolean;
  recentCalls: number;          // last hour
  recentErrors: number;         // last hour
  errorRate: number;            // 0-1 over last hour
  avgLatencyMs: number;         // last hour
}

export interface RateLimitState {
  /** Active keys in the in-memory rate-limit store. */
  activeKeys: number;
  /** Lambda-warm flag — false = first call after cold start. */
  warm: boolean;
  /** Per-bucket config — copied from RATE_LIMITS in lib/rate-limit.ts. */
  buckets: Array<{ name: string; windowMs: number; max: number }>;
}

export interface ProviderHealthSnapshot {
  generatedAt: string;
  providers: ProviderHealth[];
  rateLimit: RateLimitState;
  /** Convenience rollup — green/amber/red based on worst provider. */
  overallTone: "green" | "amber" | "red";
  /** Short human label for the HUD pill. */
  pillLabel: string;
}

// ── Quota cooldown remaining helpers ──
// We query the quota breaker's remainingMs() directly to get the precise cooldown time.

// ── Recent-call telemetry ──
// One AiGeneration query, grouped by model, then we map model → provider
// using a heuristic (model name prefix). Avoids a separate provider field
// on AiGeneration (which would require a migration).
export function modelToProvider(model: string): ProviderName | null {
  if (!model) return null;
  const m = model.toLowerCase();
  for (const provider of RUNTIME_PROVIDERS) {
    const cfg = PROVIDERS_REGISTRY[provider];
    if (m === cfg.defaultModel.toLowerCase() || (cfg.defaultVisionModel && m === cfg.defaultVisionModel.toLowerCase())) {
      return provider;
    }
    for (const sub of cfg.modelSubstrings) {
      if (m.includes(sub.toLowerCase())) {
        return provider;
      }
    }
  }
  return null;
}

async function getRecentTelemetry(): Promise<Record<ProviderName, { calls: number; errors: number; avgMs: number }>> {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const empty = { calls: 0, errors: 0, avgMs: 0 };
  const out: Record<ProviderName, { calls: number; errors: number; avgMs: number }> = {
    ollama: { ...empty },
    gemini: { ...empty },
    openai: { ...empty },
    anthropic: { ...empty },
    openrouter: { ...empty },
    emergency: { ...empty },
  };
  try {
    const rows = await prisma.aiGeneration.groupBy({
      by: ["model"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { durationMs: true },
    });
    // Errors require a separate query (status filter)
    const errorRows = await prisma.aiGeneration.groupBy({
      by: ["model"],
      where: { createdAt: { gte: since }, status: { not: "complete" } },
      _count: { _all: true },
    });
    const errMap = new Map<string, number>(
      errorRows.map((r) => [r.model, r._count._all]),
    );
    for (const row of rows) {
      const provider = modelToProvider(row.model);
      if (!provider) continue;
      const calls = row._count._all;
      const totalMs = row._sum.durationMs ?? 0;
      const errors = errMap.get(row.model) ?? 0;
      const slot = out[provider];
      slot.calls += calls;
      slot.errors += errors;
      slot.avgMs = slot.calls > 0
        ? Math.round((slot.avgMs * (slot.calls - calls) + totalMs) / slot.calls)
        : 0;
    }
  } catch (err) {
    console.warn("[provider-health] telemetry query failed:", err instanceof Error ? err.message : err);
  }
  return out;
}

// ── Bucket-from-rate-limit-store snapshot ──
// We can't peek at the rate-limit Map from outside lib/rate-limit.ts
// without exposing internals. Add a thin reader.
async function readRateLimitState(): Promise<RateLimitState> {
  // v10.0.77 · activeKeys wired via the new getActiveKeyCount() reader.
  // Uses store.size (O(1)); slight over-count is acceptable HUD signal
  // (entries within their 5-minute cleanup grace window but past their
  // windowMs may still be counted).
  const { RATE_LIMITS, getActiveKeyCount } = await import("@/lib/rate-limit");
  return {
    activeKeys: getActiveKeyCount(),
    warm: true,
    buckets: Object.entries(RATE_LIMITS).map(([name, cfg]) => ({
      name,
      windowMs: cfg.windowMs,
      max: cfg.max,
    })),
  };
}

/**
 * Single-call snapshot of every provider's state. Caller should poll at
 * 30-60s for the HUD pill, on-demand for the dashboard. Cached for 10s
 * in-memory below to avoid DB hammering when the chat header polls.
 */
let cached: { snapshot: ProviderHealthSnapshot; at: number } | null = null;
const CACHE_MS = 10_000;

export async function getProviderHealth(force = false): Promise<ProviderHealthSnapshot> {
  if (!force && cached && Date.now() - cached.at < CACHE_MS) {
    return cached.snapshot;
  }

  const status = getProviderStatus();
  const telemetry = await getRecentTelemetry();
  const rateLimit = await readRateLimitState();

  const providers: ProviderHealth[] = status.providers.map((p) => {
    const isOllama = p.name === "ollama";
    const isGemini = p.name === "gemini";
    const exhausted = isOllama
        ? isOllamaQuotaExhausted()
        : isGemini
          ? isGeminiQuotaExhausted()
          : false;
    const tel = telemetry[p.name] ?? { calls: 0, errors: 0, avgMs: 0 };
    let quotaCooldownRemainingMs = 0;
    if (exhausted) {
      if (p.name === "ollama") quotaCooldownRemainingMs = getOllamaCooldownRemainingMs();
      else if (p.name === "gemini") quotaCooldownRemainingMs = getGeminiCooldownRemainingMs();
      else if (p.name === "openai") quotaCooldownRemainingMs = getOpenAiCooldownRemainingMs();
      else if (p.name === "anthropic") quotaCooldownRemainingMs = getAnthropicCooldownRemainingMs();
    }
    return {
      name: p.name,
      configured: p.available || exhausted, // configured but tripped still counts as configured
      available: p.available && !exhausted,
      modelId: p.modelId,
      quotaExhausted: exhausted,
      quotaCooldownRemainingMs,
      toolsSupported: !NO_TOOLS_MODELS.has(p.modelId),
      recentCalls: tel.calls,
      recentErrors: tel.errors,
      errorRate: tel.calls > 0 ? tel.errors / tel.calls : 0,
      avgLatencyMs: tel.avgMs,
    };
  });

  // Overall tone: red = no provider available, amber = primary down,
  // green = at least venice OR ollama up.
  const anyAvailable = providers.some((p) => p.available);
  const primaryDown = providers
    .filter((p) => p.name === "ollama" || p.name === "gemini")
    .some((p) => p.configured && !p.available);
  const overallTone: "green" | "amber" | "red" = !anyAvailable
    ? "red"
    : primaryDown
      ? "amber"
      : "green";

  const pillLabel = overallTone === "red"
    ? "AI offline"
    : overallTone === "amber"
      ? "fallback active"
      : "all green";

  const snapshot: ProviderHealthSnapshot = {
    generatedAt: new Date().toISOString(),
    providers,
    rateLimit,
    overallTone,
    pillLabel,
  };

  cached = { snapshot, at: Date.now() };
  return snapshot;
}

/** Hot-flush — used after a knowledge change forces a rebuild. */
export function invalidateProviderHealthCache(): void {
  cached = null;
}
