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

// AG-16 · prod sets PERPLEXICA_MCP_URL (the MCP wrapper endpoint) but not
// PERPLEXICA_API_URL, which silently excluded the free self-hosted source
// from the quorum. Accept the MCP URL as an alias by stripping its /mcp or
// /sse path. PERPLEXICA_API_URL always takes precedence — setting it on
// Railway is the zero-risk override if the derived base is wrong (e.g. the
// wrapper runs on a different port than the Perplexica API).
function resolvePerplexicaUrl(): string | null {
  const direct = process.env.PERPLEXICA_API_URL;
  if (direct) return direct.replace(/\/+$/, "");
  const mcp = process.env.PERPLEXICA_MCP_URL;
  if (mcp) return mcp.replace(/\/+$/, "").replace(/\/(mcp|sse)$/, "");
  return null;
}

function baseUrl(): string {
  const u = resolvePerplexicaUrl();
  if (!u) throw new Error("PERPLEXICA_API_URL is not configured");
  return u;
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

  return { content: (j.message ?? "").trim(), citations, model: "perplexica" };
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
