import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * P0 publish-safety gates (audit follow-up 2026-07-16). Two production-armed
 * endpoints published reels without approval provenance; the live-test one
 * additionally set REEL_PUBLISH_ENABLED="true" process-wide, defeating the
 * kill switch for concurrent crons. Both are now disabled by default.
 */
vi.mock("./db", () => ({ getDbTyped: async () => null, getDb: async () => null }));
vi.mock("./lib/db-helper", () => ({ db: async () => null, dbTyped: async () => null, requireDb: async () => { throw new Error("no db"); } }));

import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function ctx(): TrpcContext {
  return {
    user: { id: 1, openId: "admin", email: "a@b.com", name: "A", loginMethod: "manus", role: "admin", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  } as TrpcContext;
}
const admin = () => appRouter.createCaller(ctx());

beforeEach(() => {
  vi.stubEnv("REEL_LIVE_TEST_ENABLED", "");
  vi.stubEnv("REEL_LIVE_TEST_ALLOW_PUBLISH", "");
  vi.stubEnv("REEL_LEGACY_PUBLISH_ENABLED", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("generateAndPublishLiveTestReel gate", () => {
  it("is FORBIDDEN by default — no process.env mutation, no publish", async () => {
    await expect(admin().contentAdmin.generateAndPublishLiveTestReel({ dryRun: true }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    // The endpoint must not have armed publishing as a side effect of being called.
    expect(process.env.REEL_PUBLISH_ENABLED).not.toBe("true");
  });

  it("still blocks a non-dryRun publish even when the test flag is on", async () => {
    vi.stubEnv("REEL_LIVE_TEST_ENABLED", "true");
    // DB is null so a permitted call would fail later; the point is it must
    // reject at the publish gate FIRST with FORBIDDEN, not proceed.
    await expect(admin().contentAdmin.generateAndPublishLiveTestReel({ dryRun: false }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("legacy publishReel live branch", () => {
  it("is FORBIDDEN by default when Meta is configured (bypasses approval provenance)", async () => {
    vi.stubEnv("META_PAGE_ACCESS_TOKEN", "t");
    vi.stubEnv("META_IG_USER_ID", "1");
    vi.stubEnv("META_PAGE_ID", "1");
    // With Meta "ready", the sandbox preview branch is skipped and the live
    // branch is reached — which must refuse without REEL_LEGACY_PUBLISH_ENABLED.
    await expect(admin().contentAdmin.publishReel({ videoUrl: "https://cdn.example.com/r.mp4", caption: "hi" }))
      .rejects.toThrow(/legacy direct reel publisher is disabled/);
    vi.unstubAllEnvs();
  });
});
