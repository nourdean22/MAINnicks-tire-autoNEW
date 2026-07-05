/**
 * arsenalWebSearch · resilient fallback · v10.0.531
 *
 * The tool tries ONE cheap primary source (Perplexity if configured, else
 * Google grounding). Before this fix a single dead source (revoked/leaked key,
 * timeout, retired model) made the whole tool throw → the model surfaced it as
 * a confident failure. Now it degrades to the multi-source quorum, and only
 * ever surfaces an honest note when EVERY source fails.
 *
 * Drives the real systemTools.arsenalWebSearch.execute with mocked sources.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGoogle = vi.fn();
const mockResearch = vi.fn();
const mockMulti = vi.fn();

vi.mock("@/lib/integrations/google-search", () => ({
  askGoogleSearch: (...a: any[]) => mockGoogle(...a),
}));
vi.mock("@/lib/integrations/perplexity", () => ({
  researchTopic: (...a: any[]) => mockResearch(...a),
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
    vi.stubEnv("PERPLEXITY_API_KEY", ""); // no Perplexity key → primary = Google (operator's real config)
    mockGoogle.mockReset();
    mockResearch.mockReset();
    mockMulti.mockReset();
  });

  it("returns the primary Google result when it succeeds — does NOT hit the quorum", async () => {
    mockGoogle.mockResolvedValue({ content: "primary google answer", model: "gemini-2.5-flash", citations: [] });
    const res = await run("nicks tire cleveland");
    expect(res.source).toBe("google");
    expect(res.content).toContain("primary google answer");
    expect(mockMulti).not.toHaveBeenCalled();
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
