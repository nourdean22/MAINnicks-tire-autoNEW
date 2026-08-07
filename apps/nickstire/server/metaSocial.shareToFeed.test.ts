/**
 * Reel grid-visibility regression (2026-08-07).
 *
 * PUBLISHED != VISIBLE. The reel container was created with only
 * `media_type: "REELS"` + `video_url` + caption. Instagram defaults
 * `share_to_feed` to FALSE on REELS containers, so every reel this lane
 * published landed in the Reels tab ONLY and never reached the profile grid.
 *
 * Every internal signal read as success and every one of them was true: the
 * Graph API returned a real media id, `reel_jobs` recorded the publish, and the
 * permalink resolved. Nothing measured whether a human opening the profile
 * could SEE it. The operator looked at the grid after a confirmed publish and
 * said "it didn't post anything" — and was right about the thing that mattered.
 *
 * Measured at the time of the fix: 76 REELS vs 516 FEED on the account; reels
 * average 4.3 likes / 0.59 comments, so they were never unseen — they were
 * unseen ON THE PROFILE. `share_to_feed` is set at container creation and is
 * NOT editable afterward, so this cannot retro-fix published reels.
 *
 * Env + globals are stubbed per test and restored in afterEach (singleFork
 * hygiene, AGENTS §3).
 */
vi.mock("./lib/db-helper", () => ({
  db: async () => null,
  dbTyped: async () => null,
  requireDb: async () => {
    throw new Error("no db in this test");
  },
}));

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postInstagramReel } from "./services/metaSocial";

/** Captures the JSON body of every POST so the container payload can be asserted. */
function stubFetchCapturing(bodies: Array<Record<string, unknown>>) {
  const mock = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === "POST" && init.body) {
      try {
        bodies.push(JSON.parse(init.body) as Record<string, unknown>);
      } catch {
        /* non-JSON body — not a container create */
      }
    }
    // container create → id; status poll → FINISHED; publish → media id
    const body = String(url).includes("media_publish")
      ? { id: "media_1" }
      : init?.method === "POST"
        ? { id: "container_1" }
        : { status_code: "FINISHED" };
    return { ok: true, status: 200, json: async () => body };
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

beforeEach(() => {
  vi.stubEnv("META_PAGE_ACCESS_TOKEN", "test-token");
  vi.stubEnv("META_IG_USER_ID", "1789");
  vi.stubEnv("META_PAGE_ID", "42");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("postInstagramReel — share_to_feed", () => {
  it("sends share_to_feed:true so the reel reaches the PROFILE GRID, not just the Reels tab", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    stubFetchCapturing(bodies);

    await postInstagramReel({ videoUrl: "https://example.com/r.mp4", caption: "hello" });

    const container = bodies.find((b) => b.media_type === "REELS");
    expect(container, "no REELS container was created").toBeDefined();
    // The whole point of the fix. Absent or false = published-but-not-on-profile.
    expect(container?.share_to_feed).toBe(true);
  });

  it("still sends the fields the container has always needed", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    stubFetchCapturing(bodies);

    await postInstagramReel({ videoUrl: "https://example.com/r.mp4", caption: "caption text" });

    const container = bodies.find((b) => b.media_type === "REELS");
    expect(container?.video_url).toBe("https://example.com/r.mp4");
    expect(container?.caption).toBe("caption text");
    // No explicit cover → frame 0, which is the branded hook overlay.
    expect(container?.thumb_offset).toBe(0);
  });

  it("an explicit coverUrl still wins over thumb_offset, and share_to_feed survives it", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    stubFetchCapturing(bodies);

    await postInstagramReel({
      videoUrl: "https://example.com/r.mp4",
      caption: "c",
      coverUrl: "https://example.com/cover.jpg",
    });

    const container = bodies.find((b) => b.media_type === "REELS");
    expect(container?.cover_url).toBe("https://example.com/cover.jpg");
    expect(container?.thumb_offset).toBeUndefined();
    expect(container?.share_to_feed).toBe(true);
  });
});
