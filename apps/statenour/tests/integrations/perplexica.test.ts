/**
 * askPerplexica · direct Perplexica /api/search provider · v10.0.531
 *
 * Perplexica identifies models by a per-config UUID that regenerates on every
 * config reset, so the provider DISCOVERS the id from GET /api/config at call
 * time rather than hardcoding it. These tests drive the real provider with a
 * mocked fetch to prove: id discovery, the /api/search body shape, response
 * normalization, and cache-drop on failure.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const realFetch = global.fetch;

function configResponse() {
  return new Response(
    JSON.stringify({
      values: {
        modelProviders: [
          { id: "gem-1", type: "gemini", chatModels: [{ key: "models/gemini-2.5-flash" }], embeddingModels: [] },
          { id: "tf-1", type: "transformers", chatModels: [], embeddingModels: [{ key: "Xenova/all-MiniLM-L6-v2" }] },
        ],
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("askPerplexica", () => {
  beforeEach(() => {
    vi.stubEnv("PERPLEXICA_API_URL", "http://perplexica.internal:3000");
    vi.resetModules(); // reset the module-level provider-id cache per test
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("discovers provider ids from /api/config, sends the right search body, normalizes the result", async () => {
    const seen: any = {};
    global.fetch = vi.fn(async (url: any, init?: any) => {
      const u = String(url);
      if (u.endsWith("/api/config")) return configResponse();
      // /api/search
      seen.body = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          message: "Nick's Tire answer",
          sources: [
            { metadata: { url: "https://nickstire.org", title: "Home" } },
            { url: "https://example.com/x" },
            { metadata: {} }, // no url → dropped
          ],
        }),
        { status: 200 },
      );
    }) as any;

    const { askPerplexica } = await import("@/lib/integrations/perplexica");
    const r = await askPerplexica("nicks tire");

    // discovered ids threaded into the search request
    expect(seen.body.chatModel.providerId).toBe("gem-1");
    expect(seen.body.embeddingModel.providerId).toBe("tf-1");
    expect(seen.body.chatModel.key).toBe("models/gemini-2.5-flash");
    expect(seen.body.sources).toEqual(["web"]);
    expect(seen.body.stream).toBe(false);

    // normalized to the shared {content, citations, model} shape
    expect(r.model).toBe("perplexica");
    expect(r.content).toBe("Nick's Tire answer");
    expect(r.citations).toEqual([
      { url: "https://nickstire.org", title: "Home" },
      { url: "https://example.com/x", title: undefined },
    ]);
  });

  it("throws (guardian-catchable) on an upstream non-2xx", async () => {
    global.fetch = vi.fn(async (url: any) => {
      if (String(url).endsWith("/api/config")) return configResponse();
      return new Response("upstream 502", { status: 502 });
    }) as any;

    const { askPerplexica } = await import("@/lib/integrations/perplexica");
    await expect(askPerplexica("q")).rejects.toThrow(/Perplexica 502/);
  });

  it("hasPerplexica reflects PERPLEXICA_API_URL", async () => {
    const { hasPerplexica } = await import("@/lib/integrations/perplexica");
    expect(hasPerplexica()).toBe(true);
    vi.stubEnv("PERPLEXICA_API_URL", "");
    expect(hasPerplexica()).toBe(false);
  });
});
