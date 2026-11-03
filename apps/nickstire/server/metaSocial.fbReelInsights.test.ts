/**
 * fetchFacebookReelInsights — the numbers of a Facebook REEL, read from its VIDEO id.
 *
 * Why a separate function: a reel's `post_id` cannot be read back (Meta #12 "singular statuses API is
 * deprecated", 4 of 4 live reels, 2026-11-03) and the video node has no `/insights` edge (#100). What
 * does answer is `/{video_id}/video_insights?metric=<one metric>` (fb_reels_total_plays,
 * post_video_avg_time_watched; Meta's video_insights reference, read 2026-11-03) plus the node's
 * reactions and comments summaries.
 *
 * Positive controls: a read that fails or returns no row leaves its field UNDEFINED (never 0); a
 * measured 0 stays 0; the rejected-`reactions` fallback still answers; every read failing is ok:false.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchFacebookReelInsights } from "./services/metaSocial";

function graphRow(name: string, value: unknown) {
  return { name, period: "lifetime", values: [{ value }] };
}
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const fail = (message: string) => ({ ok: false, status: 400, json: async () => ({ error: { message } }) });

type Routes = {
  plays?: unknown;
  avg?: unknown;
  node?: (fields: string) => unknown;
};

function stubGraph(routes: Routes) {
  const urls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    urls.push(url);
    if (url.includes("/video_insights?metric=fb_reels_total_plays")) return (routes.plays ?? fail("no plays route")) as never;
    if (url.includes("/video_insights?metric=post_video_avg_time_watched")) return (routes.avg ?? fail("no avg route")) as never;
    if (url.includes("?fields=")) {
      const fields = decodeURIComponent(url.split("?fields=")[1] ?? "");
      return (routes.node ? routes.node(fields) : fail("no node route")) as never;
    }
    return fail(`unexpected ${url}`) as never;
  }));
  return urls;
}

const nodeOk = (reactions: number, comments: number) => () =>
  ok({ id: "vid_1", reactions: { data: [], summary: { total_count: reactions } }, comments: { data: [], summary: { total_count: comments } } });

describe("fetchFacebookReelInsights", () => {
  beforeEach(() => {
    vi.stubEnv("META_PAGE_ACCESS_TOKEN", "test-token");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("reads plays and average watch time from video_insights and reactions and comments from the video node", async () => {
    const urls = stubGraph({
      plays: ok({ data: [graphRow("fb_reels_total_plays", 3)] }),
      avg: ok({ data: [graphRow("post_video_avg_time_watched", 4838)] }),
      node: nodeOk(2, 1),
    });
    const r = await fetchFacebookReelInsights("vid_1");
    expect(r).toEqual({ ok: true, plays: 3, avgWatchMs: 4838, reactions: 2, comments: 1 });
    expect(urls).toEqual([
      "https://graph.facebook.com/v25.0/vid_1/video_insights?metric=fb_reels_total_plays",
      "https://graph.facebook.com/v25.0/vid_1/video_insights?metric=post_video_avg_time_watched",
      "https://graph.facebook.com/v25.0/vid_1?fields=reactions.summary(true).limit(0),comments.summary(true).limit(0)",
    ]);
    // the post-insights edge is the one that answers #100 for a video node: never used here
    expect(urls.some((u) => u.includes("/insights?"))).toBe(false);
    const auth = (vi.mocked(fetch).mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(auth.Authorization).toBe("Bearer test-token");
  });

  it("keeps a MEASURED zero as zero (a reel nobody has played yet is not an unknown)", async () => {
    stubGraph({
      plays: ok({ data: [graphRow("fb_reels_total_plays", 0)] }),
      avg: ok({ data: [graphRow("post_video_avg_time_watched", 0)] }),
      node: nodeOk(0, 0),
    });
    expect(await fetchFacebookReelInsights("vid_1")).toEqual({ ok: true, plays: 0, avgWatchMs: 0, reactions: 0, comments: 0 });
  });

  it("leaves a field UNDEFINED when its read failed or Meta sent no row, never a fabricated 0", async () => {
    stubGraph({
      plays: fail("(#100) The value must be a valid insights metric"),
      avg: ok({ data: [] }),
      node: nodeOk(5, 2),
    });
    const r = await fetchFacebookReelInsights("vid_1");
    expect(r).toEqual({ ok: true, reactions: 5, comments: 2 });
    expect(r).not.toHaveProperty("plays");
    expect(r).not.toHaveProperty("avgWatchMs");
  });

  it("ignores a non-numeric value instead of coercing it", async () => {
    stubGraph({
      plays: ok({ data: [graphRow("fb_reels_total_plays", "3")] }),
      avg: ok({ data: [graphRow("post_video_avg_time_watched", null)] }),
      node: nodeOk(1, 0),
    });
    const r = await fetchFacebookReelInsights("vid_1");
    expect(r).toEqual({ ok: true, reactions: 1, comments: 0 });
  });

  it("falls back to the likes summary (verified live) when Meta rejects the reactions field", async () => {
    const fieldsSeen: string[] = [];
    stubGraph({
      plays: ok({ data: [graphRow("fb_reels_total_plays", 7)] }),
      avg: ok({ data: [graphRow("post_video_avg_time_watched", 2000)] }),
      node: (fields) => {
        fieldsSeen.push(fields);
        if (fields.startsWith("reactions")) return fail("(#100) Tried accessing nonexisting field (reactions)");
        return ok({ id: "vid_1", likes: { data: [], summary: { total_count: 4 } }, comments: { data: [], summary: { total_count: 3 } } });
      },
    });
    const r = await fetchFacebookReelInsights("vid_1");
    expect(r).toEqual({ ok: true, plays: 7, avgWatchMs: 2000, reactions: 4, comments: 3 });
    expect(fieldsSeen).toEqual([
      "reactions.summary(true).limit(0),comments.summary(true).limit(0)",
      "likes.summary(true).limit(0),comments.summary(true).limit(0)",
    ]);
  });

  it("returns ok:false with Meta's message when every read fails (unknown, not zero)", async () => {
    stubGraph({ plays: fail("Unsupported get request"), avg: fail("Unsupported get request"), node: () => fail("Unsupported get request") });
    expect(await fetchFacebookReelInsights("vid_1")).toEqual({ ok: false, error: "Unsupported get request" });
  });

  it("returns ok:false when the network itself throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("socket hang up");
    }));
    expect(await fetchFacebookReelInsights("vid_1")).toEqual({ ok: false, error: "socket hang up" });
  });

  it("is not configured without a token", async () => {
    vi.stubEnv("META_PAGE_ACCESS_TOKEN", "");
    vi.stubEnv("FB_PAGE_ACCESS_TOKEN", "");
    const r = await fetchFacebookReelInsights("vid_1");
    expect(r.ok).toBe(false);
  });
});
