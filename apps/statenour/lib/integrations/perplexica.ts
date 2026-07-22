/**
 * Perplexica — self-hosted, free, unlimited web search with AI synthesis.
 *
 * Talks DIRECTLY to the Perplexica v1.12 HTTP API (POST /api/search) — no MCP
 * wrapper. The stack: statenour → Perplexica (Gemini synth + local embeddings)
 * → SearXNG (metasearch). Deployed on Railway as the `perplexica` +
 * `searxng-perplexica` services; reached over the private network via
 * PERPLEXICA_API_URL (…perplexica.railway.internal:3000).
 *
 * Shaped identically to the other search sources (perplexity/tavily/exa) so the
 * multi-source orchestrator + arsenalWebSearch consume it with no branching.
 *
 * Provider-id resolution: Perplexica identifies models by a per-config UUID
 * (providerId) that REGENERATES whenever its config DB is reset (e.g. a volume
 * remount). So we never hardcode the UUID — we DISCOVER it from GET /api/config
 * at call time (cached 5 min) by provider `type`. Robust to resets.
 */

import { withGuardian } from "@/lib/tools/guardian";

export interface PerplexicaCitation {
  url: string;
  title?: string;
}

export interface PerplexicaResponse {
  content: string;
  citations: PerplexicaCitation[];
  model: string;
}

export interface PerplexicaOptions {
  /** speed = 1 pass (default, ~15s) · balanced/quality = deeper + slower. */
  optimizationMode?: "speed" | "balanced" | "quality";
}

// Model keys are stable across resets (unlike provider UUIDs); overridable.
const CHAT_MODEL_KEY = process.env.PERPLEXICA_CHAT_MODEL || "models/gemini-2.5-flash";
const EMBED_MODEL_KEY = process.env.PERPLEXICA_EMBED_MODEL || "Xenova/all-MiniLM-L6-v2";
// 2026-07-12 · which provider TYPE carries the chat model. Prod switched
// synthesis Gemini → Ollama Cloud (registered in Perplexica as an "openai"
// provider at https://ollama.com/v1) after the Gemini key hit its monthly
// spending cap and hung every search. Env-driven so flipping back when the
// cap resets is a Railway var change, not a deploy:
//   PERPLEXICA_CHAT_PROVIDER=openai + PERPLEXICA_CHAT_MODEL=gpt-oss:120b
const CHAT_PROVIDER_TYPE = process.env.PERPLEXICA_CHAT_PROVIDER || "gemini";

// Canonical native-API base. ONE source of truth: PERPLEXICA_API_URL — the
// Perplexica core HTTP API (…perplexica.railway.internal:3000).
//
// PERPLEXICA_MCP_URL is deliberately NOT consulted here. The MCP wrapper is a
// SEPARATE Railway service (perplexica-mcp) on a different host:port speaking
// the MCP protocol (/mcp, /sse) — NOT the native REST API. An earlier revision
// aliased MCP_URL by stripping its path, which silently pointed /api/config +
// /api/search at the wrong service whenever the two diverged. Native REST calls
// must never route through the MCP sidecar; the sidecar is for MCP consumers
// only. If the core API is unset, Perplexica is simply unavailable (callers
// degrade to the metered quorum) — an honest null beats a wrong base.
function resolvePerplexicaUrl(): string | null {
  const direct = process.env.PERPLEXICA_API_URL;
  return direct ? direct.replace(/\/+$/, "") : null;
}

function baseUrl(): string {
  const u = resolvePerplexicaUrl();
  if (!u) throw new Error("PERPLEXICA_API_URL is not configured");
  return u;
}

// Per-source wall-clock budget for Perplexica. Its synthesis (SearXNG fan-out
// over 30-60 sources → LLM fold) measures 24-38s on Ollama-Cloud gpt-oss:120b —
// an order of magnitude longer than the metered sources (~2-4s). Callers that
// lump Perplexica into a generic 8s per-source budget guarantee it ALWAYS times
// out and never contributes a single result. Exported so multiSourceSearch
// gives it the right budget from one place. Matches askPerplexica's guardian
// inner timeout (35s) so the race is decided by real completion, not the clock.
export const PERPLEXICA_TIMEOUT_MS = 35_000;

/* ---------- search-source telemetry (instance-scoped receipt) ---------- */

export interface PerplexicaOutcome {
  ok: boolean;
  /** ISO timestamp of the attempt. */
  at: string;
  latencyMs: number;
  /** Citation (source) count on success; 0 on failure. */
  sourceCount: number;
  failureReason: string | null;
}

// Last outcome observed on THIS server instance. Serverless instances recycle,
// so this is a best-effort passive receipt — the /perplexica diagnostic returns
// a freshly-measured outcome for authoritative proof.
let lastOutcome: PerplexicaOutcome | null = null;

/** Most recent Perplexica search outcome on this instance (last success /
 *  latency / source count / failure reason), or null if none yet. */
export function getPerplexicaTelemetry(): PerplexicaOutcome | null {
  return lastOutcome;
}

interface ProviderIds {
  chatProviderId: string;
  embedProviderId: string;
  at: number;
}
let cachedIds: ProviderIds | null = null;
const IDS_TTL_MS = 5 * 60_000;

/**
 * Discover the chat + embedding provider UUIDs from Perplexica's live config.
 * Prefers gemini (chat) + transformers/local (embeddings); falls back to any
 * provider that actually exposes the right model class.
 */
async function resolveProviderIds(): Promise<ProviderIds> {
  if (cachedIds && Date.now() - cachedIds.at < IDS_TTL_MS) return cachedIds;

  const res = await fetch(`${baseUrl()}/api/config`);
  if (!res.ok) throw new Error(`Perplexica /api/config ${res.status}`);
  const cfg = (await res.json()) as {
    values?: { modelProviders?: Array<{ id: string; type: string; chatModels?: unknown[]; embeddingModels?: unknown[] }> };
  };
  const providers = cfg.values?.modelProviders ?? [];

  const chat =
    providers.find((p) => p.type === CHAT_PROVIDER_TYPE) ??
    providers.find((p) => p.type === "gemini") ??
    providers.find((p) => (p.chatModels?.length ?? 0) > 0);
  const embed =
    providers.find((p) => p.type === "transformers") ??
    providers.find((p) => (p.embeddingModels?.length ?? 0) > 0);

  if (!chat || !embed) {
    throw new Error("Perplexica has no chat/embedding provider configured");
  }
  cachedIds = { chatProviderId: chat.id, embedProviderId: embed.id, at: Date.now() };
  return cachedIds;
}

async function _askPerplexica(
  query: string,
  opts: PerplexicaOptions = {},
): Promise<PerplexicaResponse> {
  const start = Date.now();
  try {
    const ids = await resolveProviderIds();

    const res = await fetch(`${baseUrl()}/api/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sources: ["web"],
        query,
        optimizationMode: opts.optimizationMode ?? "speed",
        stream: false,
        history: [],
        chatModel: { providerId: ids.chatProviderId, key: CHAT_MODEL_KEY },
        embeddingModel: { providerId: ids.embedProviderId, key: EMBED_MODEL_KEY },
      }),
    });

    if (!res.ok) {
      // A stale cached providerId (config reset since last call) shows up as a
      // 4xx/5xx here — drop the cache so the guardian retry rediscovers it.
      cachedIds = null;
      const body = await res.text().catch(() => "");
      const err: Error & { status?: number } = new Error(
        `Perplexica ${res.status}: ${body.slice(0, 200)}`,
      );
      err.status = res.status;
      throw err;
    }

    const j = (await res.json()) as {
      message?: string;
      sources?: Array<{ metadata?: { url?: string; title?: string }; url?: string; title?: string }>;
    };
    const citations: PerplexicaCitation[] = (j.sources ?? [])
      .map((s) => ({ url: s.metadata?.url ?? s.url ?? "", title: s.metadata?.title ?? s.title }))
      .filter((c) => c.url.length > 0);

    lastOutcome = {
      ok: true,
      at: new Date().toISOString(),
      latencyMs: Date.now() - start,
      sourceCount: citations.length,
      failureReason: null,
    };
    return { content: (j.message ?? "").trim(), citations, model: "perplexica" };
  } catch (err) {
    lastOutcome = {
      ok: false,
      at: new Date().toISOString(),
      latencyMs: Date.now() - start,
      sourceCount: 0,
      failureReason: String((err as { message?: string })?.message ?? err).slice(0, 200),
    };
    throw err;
  }
}

/**
 * Guardian-wrapped exterior. Internal sub-op → reliabilityOnly (skips the
 * AI-tool policy gate, keeps retry/timeout). Perplexica synthesis is ~15s so
 * the timeout is generous; one retry rediscovers a reset providerId.
 */
export const askPerplexica = withGuardian("perplexica-search", _askPerplexica, {
  timeoutMs: 35_000,
  maxRetries: 1,
  reliabilityOnly: true,
});

/** True when Perplexica is configured (used to gate it as a search source). */
export function hasPerplexica(): boolean {
  return Boolean(resolvePerplexicaUrl());
}

export interface PerplexicaHealth {
  /** Overall: reachable AND has a usable chat + embedding provider. */
  ok: boolean;
  /** PERPLEXICA_API_URL is set. */
  configured: boolean;
  baseUrl: string | null;
  latencyMs: number;
  /** The chat provider that would be selected + whether the configured model key is present. */
  chatProvider: { type: string; id: string; hasModel: boolean } | null;
  embedProvider: { type: string; id: string } | null;
  providersFound: number;
  chatModelKey: string;
  chatProviderType: string;
  embedModelKey: string;
  error: string | null;
}

/**
 * Active health probe. Hits GET /api/config and verifies the SELECTED chat
 * provider + chat-model key + an embedding provider actually exist — the exact
 * resolution askPerplexica performs at call time. Catches a silently-broken
 * Perplexica (config volume reset, provider removed, model key renamed) BEFORE
 * a chat search fails opaquely, and surfaces WHICH leg is broken. Never throws.
 */
export async function checkPerplexicaHealth(): Promise<PerplexicaHealth> {
  const base = resolvePerplexicaUrl();
  const shape = {
    chatModelKey: CHAT_MODEL_KEY,
    chatProviderType: CHAT_PROVIDER_TYPE,
    embedModelKey: EMBED_MODEL_KEY,
  };
  if (!base) {
    return {
      ok: false, configured: false, baseUrl: null, latencyMs: 0,
      chatProvider: null, embedProvider: null, providersFound: 0,
      ...shape, error: "PERPLEXICA_API_URL is not configured",
    };
  }
  const start = Date.now();
  try {
    const res = await fetch(`${base}/api/config`, { signal: AbortSignal.timeout(10_000) });
    const latencyMs = Date.now() - start;
    if (!res.ok) {
      return {
        ok: false, configured: true, baseUrl: base, latencyMs,
        chatProvider: null, embedProvider: null, providersFound: 0,
        ...shape, error: `/api/config returned ${res.status}`,
      };
    }
    const cfg = (await res.json()) as {
      values?: { modelProviders?: Array<{ id: string; type: string; chatModels?: Array<{ key?: string; name?: string }>; embeddingModels?: unknown[] }> };
    };
    const providers = cfg.values?.modelProviders ?? [];
    const chat =
      providers.find((p) => p.type === CHAT_PROVIDER_TYPE) ??
      providers.find((p) => p.type === "gemini") ??
      providers.find((p) => (p.chatModels?.length ?? 0) > 0) ??
      null;
    const embed =
      providers.find((p) => p.type === "transformers") ??
      providers.find((p) => (p.embeddingModels?.length ?? 0) > 0) ??
      null;
    const hasModel = Boolean(
      chat?.chatModels?.some((m) => m?.key === CHAT_MODEL_KEY || m?.name === CHAT_MODEL_KEY),
    );
    const ok = Boolean(chat && embed);
    return {
      ok, configured: true, baseUrl: base, latencyMs,
      chatProvider: chat ? { type: chat.type, id: chat.id, hasModel } : null,
      embedProvider: embed ? { type: embed.type, id: embed.id } : null,
      providersFound: providers.length,
      ...shape,
      error: ok
        ? hasModel ? null : `chat provider '${chat?.type}' is up but model key '${CHAT_MODEL_KEY}' was not found in its chatModels`
        : "Perplexica config has no usable chat and/or embedding provider",
    };
  } catch (e) {
    return {
      ok: false, configured: true, baseUrl: base, latencyMs: Date.now() - start,
      chatProvider: null, embedProvider: null, providersFound: 0,
      ...shape, error: String((e as { message?: string })?.message ?? e).slice(0, 200),
    };
  }
}
