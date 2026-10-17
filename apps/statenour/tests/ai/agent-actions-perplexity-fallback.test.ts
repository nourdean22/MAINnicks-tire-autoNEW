import { beforeEach, describe, expect, it, vi } from "vitest";

const smartWebSearch = vi.fn();
const multiSourceSearch = vi.fn();

vi.mock("@/lib/integrations/perplexity", () => ({
  smartWebSearch: (...args: unknown[]) => smartWebSearch(...args),
}));

vi.mock("@/lib/ai/multi-search", () => ({
  multiSourceSearch: (...args: unknown[]) => multiSourceSearch(...args),
}));

import { handleArsenalWebSearch } from "@/lib/ai/agent-actions/arsenal-actions";

describe("agent action web search fallback", () => {
  beforeEach(() => {
    smartWebSearch.mockReset();
    multiSourceSearch.mockReset();
  });

  it("uses Perplexity when it returns content", async () => {
    smartWebSearch.mockResolvedValue({
      content: "fresh answer",
      citations: [{ url: "https://example.com" }],
      model: "perplexity-agent:fast",
    });

    const result = await handleArsenalWebSearch({ query: "latest tire news" }, "arsenal.webSearch");
    expect(result.success).toBe(true);
    expect(result.result).toMatchObject({
      content: "fresh answer",
      citations: ["https://example.com"],
      provider: "perplexity",
    });
    expect(multiSourceSearch).not.toHaveBeenCalled();
  });

  it("falls back to the verified quorum when Perplexity throws", async () => {
    smartWebSearch.mockRejectedValue(new Error("provider auth failed"));
    multiSourceSearch.mockResolvedValue({
      consensus: "verified fallback",
      sources: [{ name: "tavily", content: "verified fallback", model: "tavily" }],
      citations: [{ url: "https://fallback.test", source: "tavily" }],
      disagreement: null,
      confidence: 0.72,
    });

    const result = await handleArsenalWebSearch(
      { query: "latest tire news", recency: "week" },
      "arsenal.webSearch",
    );
    expect(result.success).toBe(true);
    expect(result.result).toMatchObject({
      content: "verified fallback",
      citations: ["https://fallback.test"],
      provider: "verified-multi-source",
      confidence: 0.72,
    });
    expect(multiSourceSearch).toHaveBeenCalledWith("latest tire news", {
      recency: "week",
      domains: { allow: undefined, block: undefined },
    });
  });
});
