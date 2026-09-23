/**
 * arsenalWebSearch · resilient fallback · v10.0.531
 *
 * The tool tries ONE primary source at a time: Tavily (if keyed) → Perplexity
 * (if keyed) → Google grounding. Before v10.0.531 a single dead source
 * (revoked/leaked key, timeout, retired model) made the whole tool throw → the
 * model surfaced it as a confident failure. Now it degrades to the
 * multi-source quorum, and only ever surfaces an honest note when EVERY source
 * fails.
 *
 * Drives the real systemTools.arsenalWebSearch.execute with mocked sources.
 *
 * NOTE: the primary chain is env-gated, so every test must PIN both
 * TAVILY_API_KEY and PERPLEXITY_API_KEY (beforeEach stubs them off by
 * default) — otherwise a key in the real .env leaks in and routes the primary
 * to a branch the test did not set up.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGoogle = vi.fn();
const mockResearch = vi.fn();
const mockTavily = vi.fn();
const mockMulti = vi.fn();

vi.mock("@/lib/integrations/google-search", () => ({
  askGoogleSearch: (...a: any[]) => mockGoogle(...a),
}));
vi.mock("@/lib/integrations/perplexity", () => ({
  researchTopic: (...a: any[]) => mockResearch(...a),
}));
vi.mock("@/lib/integrations/tavily", () => ({
  askTavily: (...a: any[]) => mockTavily(...a),
}));
vi.mock("@/lib/ai/multi-search", () => ({
  multiSourceSearch: (...a: any[]) => mockMulti(...a),
}));
// Identity fence + no-op logger so assertions are clean and deterministic.
vi.mock("@/lib/ai/tool-result-fencing", () => ({
  fenceContent: (_scope: string, _type: string, text: string) => text,
}));
vi.mock("@/lib/logger", () => ({
  logger: { withSurface: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) },
}));

import { systemTools } from "@/lib/ai/tools/system";

const run = (q: string) => (systemTools as any).arsenalWebSearch.execute({ query: q });

describe("arsenalWebSearch · resilient fallback", () => {
  beforeEach(() => {
    // Pin the env-gated primary chain OFF by default so each test opts into
    // exactly one primary.
    vi.stubEnv("TAVILY_API_KEY", ""); // Tavily OFF → chain falls to Perplexity → Google
    vi.stubEnv("PERPLEXITY_API_KEY", ""); // no Perplexity key → primary = Google
    mockGoogle.mockReset();
    mockResearch.mockReset();
    mockTavily.mockReset();
    mockMulti.mockReset();
  });

  it("returns the primary Google result when it succeeds — does NOT hit the quorum", async () => {
    mockGoogle.mockResolvedValue({ content: "primary google answer", model: "gemini-2.5-flash", citations: [] });
    const res = await run("nicks tire cleveland");
    expect(res.source).toBe("google");
    expect(res.content).toContain("primary google answer");
    expect(mockMulti).not.toHaveBeenCalled();
  });

  it("returns the primary Tavily result when keyed + succeeds — no other source, no quorum", async () => {
    vi.stubEnv("TAVILY_API_KEY", "test-tav");
    mockTavily.mockResolvedValue({ content: "tavily primary answer", model: "tavily-basic", citations: [{ url: "https://a.test" }] });
    const res = await run("nicks tire cleveland");
    expect(res.source).toBe("arsenal/tavily");
    expect(res.model).toBe("tavily-basic");
    expect(res.content).toContain("tavily primary answer");
    expect(res.citations).toEqual([{ url: "https://a.test" }]);
    expect(mockGoogle).not.toHaveBeenCalled();
    expect(mockMulti).not.toHaveBeenCalled();
  });

  it("falls through to the next rung when the Tavily primary THROWS — Tavily stays in the quorum", async () => {
    vi.stubEnv("TAVILY_API_KEY", "test-tav");
    mockTavily.mockRejectedValue(new Error("tavily 432 usage limit"));
    mockGoogle.mockResolvedValue({ content: "   ", model: "gemini-2.5-flash", citations: [] });
    mockMulti.mockResolvedValue({ consensus: "quorum consensus answer", sources: [{ name: "exa", content: "x" }], disagreement: null, confidence: 0.6, citations: [] });
    const res = await run("nicks tire cleveland");
    expect(mockTavily).toHaveBeenCalledOnce();
    expect(mockGoogle).toHaveBeenCalledOnce();
    // Default quorum (no source restriction) so Tavily gets its retry there.
    expect(mockMulti).toHaveBeenCalledWith("nicks tire cleveland");
    expect(res.source).toBe("arsenal/fallback");
  });

  it("falls back to the multi-source quorum when the primary THROWS (dead key)", async () => {
    mockGoogle.mockRejectedValue(new Error("Action denied · 403 key reported as leaked"));
    mockMulti.mockResolvedValue({ consensus: "quorum consensus answer", sources: [{ name: "tavily", content: "x" }], disagreement: null, confidence: 0.6, citations: [] });
    const res = await run("nicks tire cleveland");
    expect(mockMulti).toHaveBeenCalledOnce();
    expect(res.source).toBe("arsenal/fallback");
    expect(res.content).toContain("quorum consensus answer");
  });

  it("falls back when the primary returns EMPTY content", async () => {
    mockGoogle.mockResolvedValue({ content: "   ", model: "gemini-2.5-flash", citations: [] });
    mockMulti.mockResolvedValue({ consensus: null, sources: [{ name: "exa", content: "exa body" }], disagreement: null, confidence: 0.3, citations: [] });
    const res = await run("nicks tire cleveland");
    expect(mockMulti).toHaveBeenCalledOnce();
    expect(res.source).toBe("arsenal/fallback");
    expect(res.content).toContain("exa: exa body");
  });

  it("surfaces an HONEST all-sources-failed note (never an empty result)", async () => {
    mockGoogle.mockRejectedValue(new Error("google grounding dead"));
    mockMulti.mockResolvedValue({ consensus: null, sources: [], disagreement: "All sources failed: tavily(timeout) · exa(401)", confidence: 0, citations: [] });
    const res = await run("nicks tire cleveland");
    expect(res.source).toBe("arsenal/fallback");
    expect(res.content).toContain("All sources failed");
  });
});
