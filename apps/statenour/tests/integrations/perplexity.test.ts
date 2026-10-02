import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { askPerplexity, searchPerplexity } from "@/lib/integrations/perplexity";

const ORIGINAL_KEY = process.env.PERPLEXITY_API_KEY;

beforeEach(() => {
  vi.stubEnv("PERPLEXITY_API_KEY", "test-pplx-key");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  if (ORIGINAL_KEY === undefined) delete process.env.PERPLEXITY_API_KEY;
  else process.env.PERPLEXITY_API_KEY = ORIGINAL_KEY;
});

describe("Perplexity current APIs", () => {
  it("uses Agent API for synthesized cited answers", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        model: "agent-model",
        output: [
          { type: "search_results", results: [
            { title: "OpenAI", url: "https://openai.com/" },
          ] },
          { type: "message", content: [
            { type: "output_text", text: "OpenAI builds AI systems. [1]" },
          ] },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await askPerplexity("What is OpenAI?", {
      systemPrompt: "Cite sources.",
      allowedDomains: ["openai.com"],
      recency: "week",
      tier: "sonar-reasoning",
      maxTokens: 123,
    });

    expect(result.content).toContain("OpenAI builds AI systems");
    expect(result.citations).toEqual([
      { url: "https://openai.com/", title: "OpenAI" },
    ]);
    expect(result.model).toBe("agent-model");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.perplexity.ai/v1/agent");
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body).toMatchObject({
      preset: "low",
      input: "What is OpenAI?",
      instructions: "Cite sources.",
      max_output_tokens: 123,
    });
    expect(body.tools[0]).toMatchObject({
      type: "web_search",
      filters: {
        search_domain_filter: ["openai.com"],
        search_recency_filter: "week",
      },
    });
  });

  it.each(["failed", "cancelled"] as const)(
    "rejects HTTP 200 Agent runs whose response status is %s",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          new Response(
            JSON.stringify({
              status,
              error: { message: "provider run did not complete" },
              output: [],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        ),
      );

      await expect(askPerplexity("test")).rejects.toThrow(
        `Perplexity Agent API ${status}`,
      );
    },
  );

  it("uses Search API for retrieval-first verified search", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        id: "search-1",
        results: [
          {
            title: "OpenAI Docs",
            url: "https://platform.openai.com/docs",
            snippet: "Official developer documentation.",
            date: "2026-10-01",
          },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchPerplexity("OpenAI official docs", {
      recency: "month",
    });

    expect(result.model).toBe("perplexity-search");
    expect(result.content).toContain("Official developer documentation.");
    expect(result.citations[0]?.url).toBe("https://platform.openai.com/docs");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.perplexity.ai/search");
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body).toMatchObject({
      query: "OpenAI official docs",
      max_results: 10,
      search_recency_filter: "month",
    });
  });
});
