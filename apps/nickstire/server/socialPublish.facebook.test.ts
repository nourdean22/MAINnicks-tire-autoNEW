/**
 * publishToSocial — Facebook branch (Wave C "Facebook branch").
 *
 * POSITIVE CONTROL (pre-fix, 2026-10-01): with a reel (`videoUrl`, no image)
 * and platforms ["facebook"], the old branch called `postToFacebook` with
 * `imageUrl: undefined`, which POSTed to `/{page}/feed` with ONLY `message` —
 * the first test's `/video_reels` assertion failed on that code (the only
 * Graph call was `/feed`).
 *
 * Boundaries: global fetch is stubbed (Graph), env carries the token + page id;
 * metaSocial is REAL so the request shapes are under test. Kill switches and
 * the content governor read no DB here (same as socialPublish.reelGate.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publishToSocial } from "./services/socialPublish";

type Call = { url: string; init: RequestInit };

function stubGraph(opts: { finishOk?: boolean } = {}) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    if (url.includes("/video_reels")) {
      const body = JSON.parse(String(init.body ?? "{}")) as Record<string, string>;
      if (body.upload_phase === "start") return { ok: true, status: 200, json: async () => ({ video_id: "vid_1", upload_url: "https://rupload.facebook.com/video-upload/v25.0/vid_1" }) };
      if (opts.finishOk === false) return { ok: false, status: 400, json: async () => ({ error: { message: "finish failed" } }) };
      return { ok: true, status: 200, json: async () => ({ success: true, post_id: "page_post_9" }) };
    }
    if (url.startsWith("https://rupload.facebook.com/")) return { ok: true, status: 200, json: async () => ({ success: true }) };
    if (url.includes("/photos")) return { ok: true, status: 200, json: async () => ({ id: "photo_1", post_id: "page_photo_1" }) };
    if (url.includes("/feed")) return { ok: true, status: 200, json: async () => ({ id: "feed_1" }) };
    return { ok: false, status: 404, json: async () => ({ error: { message: `unexpected ${url}` } }) };
  }));
  return calls;
}

describe("publishToSocial — Facebook", () => {
  beforeEach(() => {
    vi.stubEnv("META_PAGE_ACCESS_TOKEN", "test-token");
    vi.stubEnv("META_PAGE_ID", "777");
    vi.stubEnv("REEL_PUBLISH_ENABLED", "true");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("passes the VIDEO to Facebook for a reel: start → rupload(file_url) → finish(description=fbCaption)", async () => {
    const calls = stubGraph();
    const out = await publishToSocial({
      platforms: ["facebook"],
      caption: "IG caption. #tires #cleveland",
      fbCaption: "Facebook-native caption. What do you think?",
      videoUrl: "https://cdn.example.com/reel.mp4",
    });
    const fb = out.results.find((r) => r.platform === "facebook");
    expect(fb).toEqual({ platform: "facebook", success: true, postId: "page_post_9" });

    expect(calls.map((c) => c.url)).toEqual([
      "https://graph.facebook.com/v25.0/777/video_reels",
      "https://rupload.facebook.com/video-upload/v25.0/vid_1",
      "https://graph.facebook.com/v25.0/777/video_reels",
    ]);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ upload_phase: "start" });
    const uploadHeaders = calls[1]!.init.headers as Record<string, string>;
    expect(uploadHeaders.file_url).toBe("https://cdn.example.com/reel.mp4");
    expect(uploadHeaders.Authorization).toBe("OAuth test-token");
    expect(calls[1]!.init.body).toBeUndefined();
    expect(JSON.parse(String(calls[2]!.init.body))).toEqual({
      upload_phase: "finish",
      video_id: "vid_1",
      video_state: "PUBLISHED",
      description: "Facebook-native caption. What do you think?",
    });
    // no text-only /feed fallback was attempted
    expect(calls.some((c) => c.url.includes("/feed"))).toBe(false);
  });

  it("derives a Facebook-native caption for a reel when no fbCaption is given (no hashtag wall, a question)", async () => {
    const calls = stubGraph();
    await publishToSocial({ platforms: ["facebook"], caption: "Brake pads wear out. Link in bio.\n\n#brakes #cleveland #euclid #autorepair", videoUrl: "https://cdn.example.com/reel.mp4" });
    const finish = JSON.parse(String(calls[2]!.init.body)) as { description: string };
    expect(finish.description).not.toContain("#euclid");
    expect(finish.description).not.toMatch(/link in bio/i);
    expect(finish.description).toMatch(/\?/);
    expect(finish.description).toContain("Brake pads wear out.");
  });

  it("uses fbCaption for a photo post when present, and the IG caption when absent", async () => {
    const calls = stubGraph();
    await publishToSocial({ platforms: ["facebook"], caption: "ig text", fbCaption: "fb text", imageUrl: "https://cdn.example.com/a.jpg" });
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ url: "https://cdn.example.com/a.jpg", caption: "fb text" });
    calls.length = 0;
    await publishToSocial({ platforms: ["facebook"], caption: "ig text", imageUrl: "https://cdn.example.com/a.jpg" });
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ url: "https://cdn.example.com/a.jpg", caption: "ig text" });
  });

  it("a Facebook reel is behind the same REEL_PUBLISH_ENABLED gate and claim-safety as the IG reel", async () => {
    const calls = stubGraph();
    vi.stubEnv("REEL_PUBLISH_ENABLED", "false");
    const off = await publishToSocial({ platforms: ["facebook"], caption: "x", videoUrl: "https://cdn.example.com/reel.mp4" });
    expect(off.results[0]).toMatchObject({ platform: "facebook", success: false });
    expect(off.results[0]!.error).toContain("disabled");
    vi.stubEnv("REEL_PUBLISH_ENABLED", "true");
    const priced = await publishToSocial({ platforms: ["facebook"], caption: "ok", fbCaption: "Oil change only $39.99 this week!", videoUrl: "https://cdn.example.com/reel.mp4" });
    expect(priced.results[0]!.error).toContain("claim-safety");
    expect(calls).toHaveLength(0);
  });

  it("surfaces a Graph finish failure as a plain failure (no ambiguous flag)", async () => {
    stubGraph({ finishOk: false });
    const out = await publishToSocial({ platforms: ["facebook"], caption: "x", videoUrl: "https://cdn.example.com/reel.mp4" });
    expect(out.results[0]).toEqual({ platform: "facebook", success: false, error: "finish failed" });
  });
});
