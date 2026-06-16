/**
 * HuggingFace Inference embeddings backend
 *
 * Category 1 of apps/nickstire/docs/eval-rubrics/huggingface-model-strategy.md.
 * Embedding provider that calls HF Inference API · 50× cheaper than
 * OpenAI text-embedding-3-small and gives access to multilingual
 * models like `intfloat/multilingual-e5-large` for Spanish customer
 * content.
 *
 * This is one tier of the provider.ts embedding fallback chain:
 *   1. Venice (primary · text-embedding-bge-m3 · 1024-dim)
 *   2. Ollama Cloud (nomic-embed-text · 768-dim)
 *   3. Cohere (embed-v4.0 · 1024-dim multilingual)
 *   4. HuggingFace Inference (THIS FILE · 1024-dim default, configurable)
 *   5. OpenAI (text-embedding-3-small · 1536-dim · final fallback)
 *
 * The provider chain calls each in order until one succeeds.
 *
 * IMPORTANT · embedding model swap requires CORPUS RE-EMBED. The
 * vector space is model-specific · cosine distances are only
 * comparable WITHIN a model. The retrieval layer at memory-recall.ts
 * pads/truncates dimensions for compatibility BUT silently lossy
 * cross-model search produces noise.
 *
 * Operator playbook for promoting HF to primary:
 *   1. Verify recall on a 20-query baseline with HF backend
 *   2. Run scripts/embed-backfill.ts with HF_EMBED_BACKFILL=true to
 *      re-embed every memory with the HF model
 *   3. Once backfill completes, set HF_EMBED_PRIMARY=true to flip the
 *      provider chain order (or remove Venice/Ollama from the chain)
 * See docs/runbooks/hf-embeddings-cutover.md.
 */

const HF_INFERENCE_URL = "https://router.huggingface.co/hf-inference/models";
const DEFAULT_MODEL = "intfloat/multilingual-e5-large";
const DEFAULT_TIMEOUT_MS = 8_000;

/**
 * True if HF embeddings are reachable · HF_API_KEY must be set.
 */
export function isHfEmbeddingAvailable(): boolean {
  return Boolean(process.env.HF_API_KEY);
}

/**
 * Fetch one HF embedding via the Inference API. Returns the raw
 * number[] on success, or null on any failure (caller should fall
 * through to the next backend in the chain).
 *
 * HF returns embeddings in one of two shapes depending on model:
 *   - sentence-transformers: number[][] (one row per input)
 *   - feature-extraction: number[][] of token vectors (caller pools)
 *
 * For sentence-transformer-style models (default `multilingual-e5-large`),
 * the response is `[[<dim values>]]` · we unwrap once.
 *
 * Cold-load behavior · HF returns 503 with `{"error":"...currently loading"}`
 * on first request to a cold model. The caller treats null as a
 * fallthrough signal · no retry-in-place. Subsequent requests within
 * ~15min are warm.
 */
export async function getHfEmbedding(text: string): Promise<number[] | null> {
  const apiKey = process.env.HF_API_KEY;
  if (!apiKey) return null;

  const model = process.env.HF_EMBED_MODEL?.trim() || DEFAULT_MODEL;
  const input = text.slice(0, 30_000);

  try {
    // E5 models expect a "query: " or "passage: " prefix · this is
    // the standard E5 instruction-tuning convention. For non-E5 models
    // it's a harmless no-op (most ignore the prefix).
    const isE5 = model.toLowerCase().includes("e5");
    const formatted = isE5 ? `query: ${input}` : input;

    const res = await fetch(`${HF_INFERENCE_URL}/${encodeURIComponent(model)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: formatted,
        options: { wait_for_model: false }, // fail fast on cold load · let chain fall through
      }),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });

    if (res.status === 503) {
      // Model loading on cold cache · don't block the chat path
      console.warn(`[ai:embedding] HF cold-load (503) on ${model} · falling through`);
      return null;
    }
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.warn(
        `[ai:embedding] HF failed (${res.status}) on ${model}: ${errBody.slice(0, 200)}`,
      );
      return null;
    }

    const data = (await res.json()) as number[] | number[][];

    // Handle both shapes:
    //   - sentence-transformer: [[v1, v2, ...]] (one row)
    //   - some models return flat [v1, v2, ...]
    let vec: number[] | undefined;
    if (Array.isArray(data) && data.length > 0) {
      if (typeof data[0] === "number") {
        vec = data as number[];
      } else if (Array.isArray(data[0])) {
        vec = data[0] as number[];
      }
    }

    if (vec && vec.length > 0) return vec;

    console.warn(
      `[ai:embedding] HF returned 200 but no embedding parsable from response (model: ${model})`,
    );
    return null;
  } catch (err) {
    console.warn(
      `[ai:embedding] HF fetch threw: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}
