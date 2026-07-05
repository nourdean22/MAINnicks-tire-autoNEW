/**
 * Regression · getEmbedding dimension pin (2026-07-04 chat-pipeline
 * audit, PLAUSIBLE finding → code-verified).
 *
 * The chain's contract (provider.ts header: "Every provider in the
 * chain is pinned to 1024 dims so the vector space never desyncs")
 * was NOT enforced for Cohere: the /v2/embed request sent no
 * output_dimension, and embed-v4.0's server default is larger than
 * 1024 — so query/write vectors could come back e.g. 1536-dim while
 * knnSearch (lib/db/pgvector.ts) filters rows by the RAW query-vector
 * width (`vector_dims(embedding_vec) = ${dim}`). Result: recall
 * silently scans the wrong-width partition and returns nothing.
 *
 * Pins: (1) the Cohere request carries output_dimension: 1024;
 * (2) even if the API ignores it (env-pinned older model), the
 * returned vector is normalized to 1024 before it escapes.
 *
 * singleFork hygiene: fetch is stubbed via vi.stubGlobal and restored
 * in afterEach; env is saved/restored.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEmbedding } from "@/lib/ai/provider";

const savedCohere = process.env.COHERE_API_KEY;
const savedModel = process.env.COHERE_EMBED_MODEL;

describe("getEmbedding · Cohere dimension pin", () => {
  beforeEach(() => {
    process.env.COHERE_API_KEY = "test-cohere-key";
    delete process.env.COHERE_EMBED_MODEL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (savedCohere === undefined) delete process.env.COHERE_API_KEY;
    else process.env.COHERE_API_KEY = savedCohere;
    if (savedModel === undefined) delete process.env.COHERE_EMBED_MODEL;
    else process.env.COHERE_EMBED_MODEL = savedModel;
  });

  it("sends output_dimension: 1024 and returns the 1024-dim vector as-is", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { body: string }) => {
        calls.push({ url: String(url), body: JSON.parse(init.body) });
        return {
          ok: true,
          json: async () => ({ embeddings: { float: [new Array(1024).fill(0.1)] } }),
        };
      }),
    );

    const vec = await getEmbedding("dimension pin regression check");
    expect(vec.length).toBe(1024);
    const cohereCall = calls.find((c) => c.url.includes("api.cohere.com"));
    expect(cohereCall).toBeTruthy();
    expect(cohereCall!.body.output_dimension).toBe(1024);
  });

  it("normalizes an off-contract response (e.g. 1536-dim) down to 1024 instead of leaking it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ embeddings: { float: [new Array(1536).fill(0.2)] } }),
      })),
    );

    const vec = await getEmbedding("off-contract dimension check");
    // A 1536-dim vector escaping here splits the pgvector space:
    // knnSearch would filter vector_dims(embedding_vec) = 1536 and
    // never see the 1024-dim rows the write path maintains.
    expect(vec.length).toBe(1024);
  });
});
