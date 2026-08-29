import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// db() -> null makes ensureMetaConfigLoaded return early. Without this the
// module opens a REAL connection (the worktree's DATABASE_URL is production)
// and every test hangs 30s. Same shape as server/reelPublishSafety.test.ts:10.
vi.mock("./db", () => ({ getDbTyped: async () => null, getDb: async () => null }));
vi.mock("./lib/db-helper", () => ({
  db: async () => null,
  dbTyped: async () => null,
  requireDb: async () => { throw new Error("no db"); },
}));

/**
 * Does `is_ai_generated` ARRIVE on the outbound Meta container?
 *
 * Not "is the flag accepted by the zod schema" — that is the accepted-and-
 * dropped shape this repo keeps finding. This captures the real fetch body sent
 * to `/{ig-user}/media` and asserts the key is in it.
 *
 * The manual admin lane (instagramAdmin.publishPost) had no way to set this at
 * all, so an externally produced generated video published through the Studio
 * went to a live brand account with no platform self-disclosure. Caption text
 * is NOT the mechanism; this parameter is.
 */
const ENV = { META_PAGE_ACCESS_TOKEN: "t_test", META_IG_USER_ID: "17841400000000000" };
const saved: Record<string, string | undefined> = {};

function captureFetch() {
  const bodies: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: { body?: string }) => {
    if (init?.body) bodies.push(JSON.parse(init.body));
    // status_code FINISHED so the reel container poll exits immediately; without
    // it the publisher loops on a never-ready container until the test times out.
    return {
      ok: true, status: 200, text: async () => "",
      json: async () => ({ id: "container_1", status_code: "FINISHED", status: "FINISHED" }),
    };
  }));
  return bodies;
}

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
});
afterEach(() => {
  for (const k of Object.keys(ENV)) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("is_ai_generated arrives on the Meta container", () => {
  it("ARRIVES when isAiGenerated: true", async () => {
    const bodies = captureFetch();
    const { postInstagramReel } = await import("./services/metaSocial");
    await postInstagramReel({ videoUrl: "https://example.com/r.mp4", caption: "c", isAiGenerated: true });
    const container = bodies.find((b) => b && typeof b === "object" && "video_url" in (b as object));
    expect(container, "no container body was sent").toBeDefined();
    expect((container as Record<string, unknown>).is_ai_generated).toBe(true);
  });

  it("NEGATIVE CONTROL: the key is ABSENT when the flag is not set — not false", async () => {
    const bodies = captureFetch();
    const { postInstagramReel } = await import("./services/metaSocial");
    await postInstagramReel({ videoUrl: "https://example.com/r.mp4", caption: "c" });
    const container = bodies.find((b) => b && typeof b === "object" && "video_url" in (b as object));
    expect(container).toBeDefined();
    expect(container as Record<string, unknown>).not.toHaveProperty("is_ai_generated");
  });

  it("POSITIVE CONTROL: the capture sees a body at all — it is not vacuously passing", async () => {
    const bodies = captureFetch();
    const { postInstagramReel } = await import("./services/metaSocial");
    await postInstagramReel({ videoUrl: "https://example.com/r.mp4", caption: "hello", isAiGenerated: true });
    const container = bodies.find((b) => b && typeof b === "object" && "video_url" in (b as object));
    expect((container as Record<string, unknown>).caption).toBe("hello");
  });
});
