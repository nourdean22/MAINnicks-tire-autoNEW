/**
 * Ad Studio containment (2026-07-25). Verified: adStudio.post called
 * postInstagramCarousel DIRECTLY while its comment claimed "the existing
 * gated path" — the kill-switch, per-platform switches and daily-cadence
 * governor all live in publishToSocial, so Ad Studio was the one surface the
 * emergency stop did not stop and the cadence cap did not count. Claim
 * safety trusted the client entirely.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";

const publishToSocialMock = vi.fn();
vi.mock("./services/socialPublish", async (importOriginal) => {
  const real = await importOriginal<typeof import("./services/socialPublish")>();
  return {
    ...real, // REAL captionClaimBlockers + assertPermanentPublicMediaUrl — the gates under test
    publishToSocial: (...args: unknown[]) => publishToSocialMock(...args),
  };
});
vi.mock("./lib/db-helper", () => ({
  db: async () => null,
  dbTyped: async () => null,
  requireDb: async () => { throw new Error("no db"); },
}));

import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function ctx(): TrpcContext {
  return {
    user: {
      id: 1, openId: "admin-user", email: "admin@nickstire.com", name: "Admin",
      loginMethod: "manus", role: "admin",
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  } as TrpcContext;
}
const admin = () => appRouter.createCaller(ctx());
const slides = ["https://cdn.nickstire.org/ads/a.png", "https://cdn.nickstire.org/ads/b.png"];

beforeEach(() => publishToSocialMock.mockReset());

describe("adStudio.post goes through the ONE gated door", () => {
  it("publishes via publishToSocial (kill-switch + cadence governor apply)", async () => {
    publishToSocialMock.mockResolvedValue({ results: [{ platform: "instagram", success: true, postId: "ig_9" }] });
    await expect(admin().adStudio.post({ slideUrls: slides, caption: "Winter tire check — stop by this week." }))
      .resolves.toEqual({ postId: "ig_9" });
    expect(publishToSocialMock).toHaveBeenCalledWith({ platforms: ["instagram"], caption: "Winter tire check — stop by this week.", imageUrls: slides });
  });

  it("REFUSES a banned claim server-side before any Meta call — the client is not the gate", async () => {
    await expect(admin().adStudio.post({ slideUrls: slides, caption: "We guarantee the best deal in Cleveland" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/Claim-safety/) });
    expect(publishToSocialMock).not.toHaveBeenCalled();
  });

  it("REFUSES presigned/temporary slide URLs (they die before Meta re-fetches)", async () => {
    await expect(admin().adStudio.post({
      slideUrls: ["https://bucket.s3.amazonaws.com/a.png?X-Amz-Signature=abc", slides[1]],
      caption: "Winter tire check — stop by this week.",
    })).rejects.toThrow(/presigned|temporary/);
    expect(publishToSocialMock).not.toHaveBeenCalled();
  });

  it("a dispatched-but-unanswered publish reports MAY BE LIVE, never a retryable failure", async () => {
    publishToSocialMock.mockResolvedValue({ results: [{ platform: "instagram", success: false, ambiguous: true, error: "timeout" }] });
    await expect(admin().adStudio.post({ slideUrls: slides, caption: "Winter tire check — stop by this week." }))
      .rejects.toMatchObject({ message: expect.stringMatching(/MAY BE LIVE/) });
  });
});

describe("adStudio.schedule applies the deferred-execution rules NOW", () => {
  it("refuses a banned claim at schedule time — nobody is watching at fire time", async () => {
    await expect(admin().adStudio.schedule({
      slideUrls: slides,
      caption: "We guarantee the best deal in Cleveland",
      scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
    })).rejects.toMatchObject({ message: expect.stringMatching(/Claim-safety/) });
  });
});

describe("the client no longer offers doomed taps", () => {
  it("Post and Schedule disable while claim-safety flags are displayed", () => {
    const s = readFileSync(resolve(process.cwd(), "client/src/pages/admin/AdStudio.tsx"), "utf8");
    expect(s).toMatch(/post\.isPending \|\| result\.issues\.length > 0/);
    expect(s).toMatch(/schedule\.isPending \|\| result\.issues\.length > 0/);
  });
});
