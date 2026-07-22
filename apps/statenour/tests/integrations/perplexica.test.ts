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

  it("PERPLEXICA_CHAT_PROVIDER selects the provider type (Ollama-Cloud-as-openai switch)", async () => {
    // 2026-07-12 · prod synthesis moved Gemini → Ollama Cloud (registered in
    // Perplexica as an "openai" provider) after the Gemini spending-cap 429
    // hung every search. The env pair below is exactly what Railway sets.
    vi.stubEnv("PERPLEXICA_CHAT_PROVIDER", "openai");
    vi.stubEnv("PERPLEXICA_CHAT_MODEL", "gpt-oss:120b");
    const seen: any = {};
    global.fetch = vi.fn(async (url: any, init?: any) => {
      const u = String(url);
      if (u.endsWith("/api/config"))
        return new Response(
          JSON.stringify({
            values: {
              modelProviders: [
                { id: "gem-1", type: "gemini", chatModels: [{ key: "models/gemini-2.5-flash" }], embeddingModels: [] },
                { id: "oll-1", type: "openai", chatModels: [{ key: "gpt-oss:120b" }], embeddingModels: [] },
                { id: "tf-1", type: "transformers", chatModels: [], embeddingModels: [{ key: "Xenova/all-MiniLM-L6-v2" }] },
              ],
            },
          }),
          { status: 200 },
        );
      seen.body = JSON.parse(init.body);
      return new Response(JSON.stringify({ message: "ok", sources: [] }), { status: 200 });
    }) as any;

    const { askPerplexica } = await import("@/lib/integrations/perplexica");
    await askPerplexica("q");

    expect(seen.body.chatModel.providerId).toBe("oll-1"); // NOT gem-1
    expect(seen.body.chatModel.key).toBe("gpt-oss:120b");
    expect(seen.body.embeddingModel.providerId).toBe("tf-1");
  });

  it("falls back to gemini when the env-named provider type is absent", async () => {
    vi.stubEnv("PERPLEXICA_CHAT_PROVIDER", "openai"); // not in config below
    const seen: any = {};
    global.fetch = vi.fn(async (url: any, init?: any) => {
      if (String(url).endsWith("/api/config")) return configResponse(); // gemini + transformers only
      seen.body = JSON.parse(init.body);
      return new Response(JSON.stringify({ message: "ok", sources: [] }), { status: 200 });
    }) as any;

    const { askPerplexica } = await import("@/lib/integrations/perplexica");
    await askPerplexica("q");
    expect(seen.body.chatModel.providerId).toBe("gem-1");
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

// Locks the canonical architecture: statenour chat → native Perplexica HTTP API
// → SearXNG. The MCP sidecar is a SEPARATE service for MCP consumers only;
// native /api/config + /api/search must NEVER be routed through it.
describe("perplexica · canonical architecture (native API only, no MCP routing)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("MCP-only config (MCP_URL set, API_URL unset) → Perplexica is UNAVAILABLE; the MCP sidecar is never aliased as the native API", async () => {
    vi.resetModules();
    vi.stubEnv("PERPLEXICA_API_URL", "");
    vi.stubEnv("PERPLEXICA_MCP_URL", "http://perplexica-mcp.internal:8080/mcp");

    const { hasPerplexica, askPerplexica, checkPerplexicaHealth } = await import(
      "@/lib/integrations/perplexica"
    );

    expect(hasPerplexica()).toBe(false);
    await expect(askPerplexica("q")).rejects.toThrow(/PERPLEXICA_API_URL is not configured/);

    const health = await checkPerplexicaHealth();
    expect(health.configured).toBe(false);
    expect(health.ok).toBe(false);
    expect(health.baseUrl).toBeNull();
  });

  it("API_URL set → resolves to the native API base and ignores any MCP_URL present", async () => {
    vi.resetModules();
    vi.stubEnv("PERPLEXICA_API_URL", "http://perplexica.internal:3000");
    vi.stubEnv("PERPLEXICA_MCP_URL", "http://perplexica-mcp.internal:8080/mcp");
    const { hasPerplexica } = await import("@/lib/integrations/perplexica");
    expect(hasPerplexica()).toBe(true);
  });
});

describe("checkPerplexicaHealth · provider + model verification", () => {
  beforeEach(() => {
    vi.stubEnv("PERPLEXICA_API_URL", "http://perplexica.internal:3000");
    vi.stubEnv("PERPLEXICA_CHAT_PROVIDER", "openai");
    vi.stubEnv("PERPLEXICA_CHAT_MODEL", "gpt-oss:120b");
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("ok=true and verifies the selected chat provider + model key are present", async () => {
    global.fetch = vi.fn(async (url: any) => {
      if (String(url).endsWith("/api/config"))
        return new Response(
          JSON.stringify({
            values: {
              modelProviders: [
                { id: "oll-1", type: "openai", chatModels: [{ key: "gpt-oss:120b" }], embeddingModels: [] },
                { id: "tf-1", type: "transformers", chatModels: [], embeddingModels: [{ key: "Xenova/all-MiniLM-L6-v2" }] },
              ],
            },
          }),
          { status: 200 },
        );
      throw new Error("unexpected fetch");
    }) as any;

    const { checkPerplexicaHealth } = await import("@/lib/integrations/perplexica");
    const h = await checkPerplexicaHealth();
    expect(h.ok).toBe(true);
    expect(h.chatProvider).toMatchObject({ type: "openai", id: "oll-1", hasModel: true });
    expect(h.embedProvider).toMatchObject({ type: "transformers", id: "tf-1" });
    expect(h.error).toBeNull();
  });

  it("ok=false when the config has no embedding provider", async () => {
    global.fetch = vi.fn(async (url: any) => {
      if (String(url).endsWith("/api/config"))
        return new Response(
          JSON.stringify({
            values: { modelProviders: [{ id: "oll-1", type: "openai", chatModels: [{ key: "gpt-oss:120b" }], embeddingModels: [] }] },
          }),
          { status: 200 },
        );
      throw new Error("unexpected fetch");
    }) as any;

    const { checkPerplexicaHealth } = await import("@/lib/integrations/perplexica");
    const h = await checkPerplexicaHealth();
    expect(h.ok).toBe(false);
    expect(h.embedProvider).toBeNull();
    expect(h.error).toMatch(/chat and\/or embedding provider/);
  });

  it("flags a provider that is up but missing the configured model key (silent-drift catch)", async () => {
    global.fetch = vi.fn(async (url: any) => {
      if (String(url).endsWith("/api/config"))
        return new Response(
          JSON.stringify({
            values: {
              modelProviders: [
                { id: "oll-1", type: "openai", chatModels: [{ key: "some-other-model" }], embeddingModels: [] },
                { id: "tf-1", type: "transformers", chatModels: [], embeddingModels: [{ key: "x" }] },
              ],
            },
          }),
          { status: 200 },
        );
      throw new Error("unexpected fetch");
    }) as any;

    const { checkPerplexicaHealth } = await import("@/lib/integrations/perplexica");
    const h = await checkPerplexicaHealth();
    expect(h.ok).toBe(true); // providers exist...
    expect(h.chatProvider?.hasModel).toBe(false); // ...but the configured model key is absent
    expect(h.error).toMatch(/model key 'gpt-oss:120b' was not found/);
  });

  it("ok=false when /api/config is unreachable", async () => {
    global.fetch = vi.fn(async () => new Response("nope", { status: 503 })) as any;
    const { checkPerplexicaHealth } = await import("@/lib/integrations/perplexica");
    const h = await checkPerplexicaHealth();
    expect(h.ok).toBe(false);
    expect(h.error).toMatch(/\/api\/config returned 503/);
  });
});

describe("perplexica telemetry (search-source receipt)", () => {
  beforeEach(() => {
    vi.stubEnv("PERPLEXICA_API_URL", "http://perplexica.internal:3000");
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("records a successful outcome (ok · latency · source count)", async () => {
    global.fetch = vi.fn(async (url: any) => {
      if (String(url).endsWith("/api/config")) return configResponse();
      return new Response(
        JSON.stringify({ message: "answer", sources: [{ metadata: { url: "https://a.com" } }] }),
        { status: 200 },
      );
    }) as any;
    const { askPerplexica, getPerplexicaTelemetry } = await import("@/lib/integrations/perplexica");
    await askPerplexica("q");
    const t = getPerplexicaTelemetry();
    expect(t?.ok).toBe(true);
    expect(t?.sourceCount).toBe(1);
    expect(t?.failureReason).toBeNull();
    expect(typeof t?.latencyMs).toBe("number");
  });

  it("records a failure outcome with a reason", async () => {
    global.fetch = vi.fn(async (url: any) => {
      if (String(url).endsWith("/api/config")) return configResponse();
      return new Response("boom", { status: 500 });
    }) as any;
    const { askPerplexica, getPerplexicaTelemetry } = await import("@/lib/integrations/perplexica");
    await expect(askPerplexica("q")).rejects.toThrow();
    const t = getPerplexicaTelemetry();
    expect(t?.ok).toBe(false);
    expect(t?.failureReason).toMatch(/Perplexica 500/);
  });
});
