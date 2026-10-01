/**
 * fetchFacebookPostInsights — widest-first metric ladder with graceful
 * "unsupported metric" fallback (same shape as the IG ladder in getMediaInsights).
 *
 * Positive control: a Graph stub that rejects `post_video_views` (a photo post)
 * fails rung 1 and must succeed on rung 2 — a single-call implementation returns
 * ok:false here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchFacebookPostInsights, parseFacebookInsights } from "./services/metaSocial";

function graphRow(name: string, value: unknown) {
  return { name, period: "lifetime", values: [{ value }] };
}

describe("parseFacebookInsights", () => {
  it("maps the Page-post metrics and sums reactions by type", () => {
    const r = parseFacebookInsights({
      data: [
        graphRow("post_impressions_unique", 1200),
        graphRow("post_impressions", 1500),
        graphRow("post_clicks", 40),
        graphRow("post_reactions_by_type_total", { like: 10, love: 3, wow: 1 }),
        graphRow("post_video_views", 800),
      ],
    });
    expect(r).toEqual({ reach: 1200, impressions: 1500, clicks: 40, reactions: 14, videoViews: 800 });
  });
  it("never throws on malformed input", () => {
    expect(parseFacebookInsights(null)).toEqual({});
    expect(parseFacebookInsights({ data: "x" })).toEqual({});
    expect(parseFacebookInsights({ data: [{ name: "post_clicks", values: [{ value: "9" }] }] })).toEqual({});
  });
});

describe("fetchFacebookPostInsights ladder", () => {
  beforeEach(() => {
    vi.stubEnv("META_PAGE_ACCESS_TOKEN", "test-token");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("drops to the next rung when a metric is unsupported, and reports which rung answered", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url);
      const metrics = decodeURIComponent(url.split("metric=")[1] ?? "");
      if (metrics.includes("post_video_views")) {
        return { ok: false, status: 400, json: async () => ({ error: { message: "(#100) The value must be a valid insights metric" } }) };
      }
      return { ok: true, status: 200, json: async () => ({ data: [graphRow("post_impressions_unique", 50), graphRow("post_clicks", 2), graphRow("post_reactions_by_type_total", { like: 4 })] }) };
    }));
    const r = await fetchFacebookPostInsights("123_456");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rung).toBe(2);
      expect(r.reach).toBe(50);
      expect(r.reactions).toBe(4);
      expect(r.videoViews).toBeUndefined();
    }
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("/123_456/insights?metric=");
    const auth = (vi.mocked(fetch).mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(auth.Authorization).toBe("Bearer test-token");
  });

  it("returns ok:false with Meta's message when every rung fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: { message: "Unsupported get request" } }) })));
    const r = await fetchFacebookPostInsights("x");
    expect(r).toEqual({ ok: false, error: "Unsupported get request" });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(4);
  });

  it("is not configured without a token", async () => {
    vi.stubEnv("META_PAGE_ACCESS_TOKEN", "");
    vi.stubEnv("FB_PAGE_ACCESS_TOKEN", "");
    const r = await fetchFacebookPostInsights("x");
    expect(r.ok).toBe(false);
  });
});
