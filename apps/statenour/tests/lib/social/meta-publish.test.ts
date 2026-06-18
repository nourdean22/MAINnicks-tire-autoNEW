/**
 * meta-publish · Instagram Reels (video) publish flow.
 *
 * Pins the three-step async contract for publishReelToInstagram:
 *   1. POST /{ig}/media  (media_type=REELS, video_url)  -> container id
 *   2. GET  /{container}?fields=status_code  (poll)     -> FINISHED
 *   3. POST /{ig}/media_publish (creation_id)           -> media id
 * Network is fully mocked — no live Meta calls.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publishReelToInstagram } from "@/lib/social/meta-publish";

const IG = "17900000000000000";

beforeEach(() => {
  process.env.META_PAGE_ACCESS_TOKEN = "test-token";
  process.env.META_IG_USER_ID = IG;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("publishReelToInstagram", () => {
  it("creates a REELS container, polls to FINISHED, then publishes", async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body as string | undefined });
      if (url.endsWith(`/${IG}/media`)) return jsonResponse({ id: "CONTAINER_1" });
      if (url.includes("CONTAINER_1") && url.includes("status_code"))
        return jsonResponse({ status_code: "FINISHED" });
      if (url.endsWith(`/${IG}/media_publish`))
        return jsonResponse({ id: "REEL_99" });
      if (url.includes("REEL_99") && url.includes("permalink"))
        return jsonResponse({
          permalink: "https://www.instagram.com/reel/REEL_99/",
        });
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await publishReelToInstagram({
      videoUrl: "https://cdn.example.com/pothole.mp4",
      caption: "test caption",
      pollIntervalMs: 1,
      maxWaitMs: 5_000,
    });

    expect(res.ok).toBe(true);
    expect(res.platform).toBe("instagram");
    expect(res.mediaType).toBe("reel");
    expect(res.postId).toBe("REEL_99");
    expect(res.containerId).toBe("CONTAINER_1");
    expect(res.permalink).toContain("REEL_99");

    const containerCall = calls.find((c) => c.url.endsWith(`/${IG}/media`));
    expect(containerCall?.body).toContain("REELS");
    expect(containerCall?.body).toContain("https://cdn.example.com/pothole.mp4");
  });

  it("surfaces a transcode ERROR instead of publishing", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith(`/${IG}/media`)) return jsonResponse({ id: "CONTAINER_2" });
      if (url.includes("CONTAINER_2") && url.includes("status_code"))
        return jsonResponse({ status_code: "ERROR", status: "bad codec" });
      throw new Error(`should not publish: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await publishReelToInstagram({
      videoUrl: "https://cdn.example.com/bad.mp4",
      caption: "x",
      pollIntervalMs: 1,
      maxWaitMs: 5_000,
    });

    expect(res.ok).toBe(false);
    expect(res.error).toContain("ERROR");
  });

  it("fails clearly when the IG account id is missing", async () => {
    delete process.env.META_IG_USER_ID;
    delete process.env.META_INSTAGRAM_ACCOUNT_ID;
    const res = await publishReelToInstagram({
      videoUrl: "https://cdn.example.com/x.mp4",
      caption: "x",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/ACCOUNT_ID/);
  });
});
