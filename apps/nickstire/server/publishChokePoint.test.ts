/**
 * Every path to Meta must go through the door that holds the controls.
 *
 * WHAT WAS FOUND
 * `publishToSocial` accumulated three protections, each added by a different
 * wave, and each silently assuming all publishing flows through it:
 *   1. the autonomy kill switches (global / publishing / per-platform) + the
 *      DENY audit record,
 *   2. the content governor's daily cap and spacing,
 *   3. claim-safety on the caption (enforced by convention at every caller).
 *
 * Three surfaces reached postToInstagram / postToFacebook /
 * postInstagramCarousel directly and inherited none of them:
 *   - contentAdmin.publishCarousel (admin tRPC, no caller in the repo)
 *   - nickActions.socialPost    (admin tRPC, no caller in the repo)
 *   - igAutopost runIgAutopost  (AUTONOMOUS CRON — 116 live posts in prod)
 *
 * NOT A NEW CLASS. adStudioContainment.test.ts records the identical defect
 * being fixed for Ad Studio on 2026-07-25, naming the same three protections.
 * That fix repaired the surface in front of it and never swept the rest. The
 * structural test at the bottom of this file is the part that makes the sweep
 * stick — it is what would have caught all four at once.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";

const publishToSocialMock = vi.fn();
vi.mock("./services/socialPublish", async (importOriginal) => {
  const real = await importOriginal<typeof import("./services/socialPublish")>();
  return {
    ...real, // REAL captionClaimBlockers + assertPermanentPublicMediaUrl — the gates under test
    publishToSocial: (...args: unknown[]) => publishToSocialMock(...args),
  };
});
vi.mock("./services/metaSocial", async (importOriginal) => {
  const real = await importOriginal<typeof import("./services/metaSocial")>();
  return {
    ...real,
    // Configured + instagramReady, so the procedures take their LIVE branch
    // rather than the Telegram sandbox preview.
    getMetaSocialStatus: async () => ({
      configured: true, instagramReady: true, facebookReady: true,
      pageId: "page_1", igUserId: "ig_1",
    }),
    // If containment fails, these are what a leak would reach. They must never
    // be called: reaching them IS the bug.
    postInstagramCarousel: vi.fn(async () => ({ success: true, postId: "LEAKED" })),
    postToInstagram: vi.fn(async () => ({ success: true, postId: "LEAKED" })),
    postToFacebook: vi.fn(async () => ({ success: true, postId: "LEAKED" })),
    socialPost: vi.fn(async () => ({ results: [{ platform: "facebook", success: true, postId: "LEAKED" }] })),
  };
});
vi.mock("./services/eventBus", () => ({ emit: { socialPosted: () => {} } }));
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

const SLIDES = ["https://cdn.nickstire.org/ads/a.png", "https://cdn.nickstire.org/ads/b.png"];
const CLEAN = "Winter tire check — stop by this week.";
const BANNED = "We guarantee the best deal in Cleveland";

beforeEach(() => publishToSocialMock.mockReset());

describe("contentAdmin.publishCarousel goes through the gated door", () => {
  it("publishes via publishToSocial, so the kill switch and cadence cap apply", async () => {
    publishToSocialMock.mockResolvedValue({ results: [{ platform: "instagram", success: true, postId: "ig_7" }] });
    await expect(admin().contentAdmin.publishCarousel({ imageUrls: SLIDES, caption: CLEAN }))
      .resolves.toMatchObject({ success: true, postId: "ig_7", isSandbox: false });
    expect(publishToSocialMock).toHaveBeenCalledWith({
      platforms: ["instagram"], caption: CLEAN, imageUrls: SLIDES,
    });
  });

  it("REFUSES a banned claim server-side before any publish — the client is not the gate", async () => {
    await expect(admin().contentAdmin.publishCarousel({ imageUrls: SLIDES, caption: BANNED }))
      .rejects.toMatchObject({ message: expect.stringMatching(/claim-safety/i) });
    expect(publishToSocialMock).not.toHaveBeenCalled();
  });

  it("a claim refusal is a BAD_REQUEST, not a 500 — the catch-all used to relabel it", async () => {
    // Without the `err instanceof TRPCError` rethrow, this deliberate refusal
    // surfaced as INTERNAL_SERVER_ERROR and read as "Meta is down, retry".
    await expect(admin().contentAdmin.publishCarousel({ imageUrls: SLIDES, caption: BANNED }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("REFUSES presigned slide URLs (they publish, then 404 when the signature dies)", async () => {
    await expect(admin().contentAdmin.publishCarousel({
      imageUrls: ["https://bucket.s3.amazonaws.com/a.png?X-Amz-Signature=abc", SLIDES[1]],
      caption: CLEAN,
    })).rejects.toThrow(/presigned|temporary/);
    expect(publishToSocialMock).not.toHaveBeenCalled();
  });

  it("a dispatched-but-unanswered publish reports MAY BE LIVE, never a retryable failure", async () => {
    // Retrying an ambiguous publish duplicates a live post. The old code
    // dropped the flag entirely and reported a plain failure.
    publishToSocialMock.mockResolvedValue({
      results: [{ platform: "instagram", success: false, ambiguous: true, error: "timeout" }],
    });
    await expect(admin().contentAdmin.publishCarousel({ imageUrls: SLIDES, caption: CLEAN }))
      .rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/MAY BE LIVE/) });
  });

  it("holds Meta's own 2-10 carousel bound at the boundary", async () => {
    // Asserts BAD_REQUEST specifically, not merely "throws". An earlier draft
    // of this test used toThrow() and passed against a MISTYPED router path,
    // because NOT_FOUND throws too — it was green while testing nothing.
    await expect(admin().contentAdmin.publishCarousel({ imageUrls: [SLIDES[0]], caption: CLEAN }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(admin().contentAdmin.publishCarousel({
      imageUrls: Array.from({ length: 11 }, (_, i) => `https://cdn.nickstire.org/${i}.png`), caption: CLEAN,
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(publishToSocialMock).not.toHaveBeenCalled();
  });
});

describe("nickActions.socialPost goes through the gated door", () => {
  it("publishes via publishToSocial for BOTH platforms", async () => {
    publishToSocialMock.mockResolvedValue({
      results: [{ platform: "facebook", success: true, postId: "fb_1" }, { platform: "instagram", success: true, postId: "ig_1" }],
    });
    await admin().nickActions.socialPost({
      platforms: ["facebook", "instagram"], message: CLEAN, imageUrl: SLIDES[0],
    });
    expect(publishToSocialMock).toHaveBeenCalledWith({
      platforms: ["facebook", "instagram"], caption: CLEAN, imageUrl: SLIDES[0], link: undefined,
    });
  });

  it("carries the Facebook link through — the missing field is WHY this path bypassed the door", async () => {
    // publishToSocial had no `link`, so the only way to attach one was to call
    // metaSocial.socialPost directly. A gap in the safe path is how unsafe
    // paths get created.
    publishToSocialMock.mockResolvedValue({ results: [{ platform: "facebook", success: true }] });
    await admin().nickActions.socialPost({
      platforms: ["facebook"], message: CLEAN, link: "https://nickstire.org/tires",
    });
    expect(publishToSocialMock).toHaveBeenCalledWith(
      expect.objectContaining({ link: "https://nickstire.org/tires" }),
    );
  });

  it("REFUSES a banned claim before any publish, and says so per platform", async () => {
    const r = await admin().nickActions.socialPost({ platforms: ["facebook", "instagram"], message: BANNED });
    expect(publishToSocialMock).not.toHaveBeenCalled();
    expect(r.results).toHaveLength(2);
    for (const one of r.results) {
      expect(one.success).toBe(false);
      expect(one.error).toMatch(/claim-safety/i);
    }
  });
});

/**
 * THE PART THAT MAKES IT STICK.
 *
 * Ad Studio was fixed in isolation and the same defect survived on three other
 * surfaces for two days. A per-surface test cannot catch the NEXT surface; only
 * a rule over the whole tree can.
 *
 * Matches IMPORTS, not mentions — every fix in this arc left comments naming
 * these functions, and a substring scan would flag its own documentation.
 */
describe("no new surface can reach Meta around the door", () => {
  const ROOT = join(new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), ".");

  const LOW_LEVEL = [
    "postInstagramCarousel", "postInstagramReel", "postInstagramStory",
    "postToInstagram", "postToFacebook", "socialPost",
  ];

  /**
   * Files permitted to import them, each for a stated reason. May only SHRINK.
   * Adding an entry means adding a publish path the emergency stop does not
   * cover — which is the whole defect this file exists to prevent.
   */
  const ALLOWED: Record<string, string> = {
    "services/socialPublish.ts":
      "IS the door. Holds the kill switch, the cadence governor, and the reel gate.",
    "services/igAutopost.ts":
      "Autonomous cron doing its own IG+FB dispatch. Cannot route through publishToSocial without also inheriting the feed cap — a live policy question — so it shares the emergency stop via killSwitchBlockedPlatforms instead. Pinned by the test below.",
  };

  function sourceFiles(dir: string, acc: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === "dist" || name === ".git") continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) sourceFiles(p, acc);
      else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) acc.push(p);
    }
    return acc;
  }

  const FILES = sourceFiles(ROOT)
    .filter((p) => !p.replace(/\\/g, "/").endsWith("services/metaSocial.ts")) // the definitions
    .map((p) => ({ rel: p.replace(/\\/g, "/").slice(ROOT.replace(/\\/g, "/").length).replace(/^\/+/, ""), src: readFileSync(p, "utf8") }));

  /** Bindings pulled from metaSocial — static `import {}` or dynamic `const {} = await import()`. */
  function metaSocialImports(src: string): string[] {
    const names: string[] = [];
    const re = /(?:import|const)\s*\{([^}]*)\}\s*(?:=\s*await\s+import\(\s*)?["'][^"']*metaSocial["']/g;
    for (const m of src.matchAll(re)) {
      for (const raw of m[1].split(",")) {
        const n = raw.trim().split(/\s+as\s+/)[0].trim();
        if (n) names.push(n);
      }
    }
    return names;
  }

  it("the scan actually sees source (an empty sweep would pass everything)", () => {
    expect(FILES.length).toBeGreaterThan(200);
    expect(FILES.some((f) => f.rel === "services/socialPublish.ts")).toBe(true);
    // The matcher must genuinely find the door's own imports, or it proves nothing.
    const door = FILES.find((f) => f.rel === "services/socialPublish.ts")!;
    expect(metaSocialImports(door.src)).toEqual(expect.arrayContaining(["postInstagramCarousel", "postToFacebook"]));
  });

  it("only the documented files import the low-level publishers", () => {
    const offenders = FILES
      .filter((f) => !(f.rel in ALLOWED))
      .map((f) => ({ rel: f.rel, hits: metaSocialImports(f.src).filter((n) => LOW_LEVEL.includes(n)) }))
      .filter((f) => f.hits.length);

    expect(
      offenders.map((o) => `${o.rel} -> ${o.hits.join(", ")}`),
      "These reach Meta around publishToSocial, so the operator's emergency stop " +
      "does not stop them and the daily cap does not count them. Route through " +
      "publishToSocial, or share the stop via killSwitchBlockedPlatforms.",
    ).toEqual([]);
  });

  it("the allowlist has no stale entries — it may only SHRINK", () => {
    const stale = Object.keys(ALLOWED).filter((rel) => {
      const f = FILES.find((x) => x.rel === rel);
      return !f || !metaSocialImports(f.src).some((n) => LOW_LEVEL.includes(n));
    });
    expect(stale, `no longer needed; remove from ALLOWED: ${stale.join(", ")}`).toEqual([]);
  });

  it("igAutopost is allowlisted ONLY because it honours the stop itself", () => {
    // Strip the guard while keeping the direct posts and this fails — which is
    // the exact regression the allowlist would otherwise licence.
    const f = FILES.find((x) => x.rel === "services/igAutopost.ts")!;
    expect(f.src).toMatch(/killSwitchBlockedPlatforms\(\s*\[\s*["']instagram["']\s*,\s*["']facebook["']\s*\]/);
    // and it must actually branch on the answer, not just call it
    expect(f.src).toMatch(/igBlocked\s*&&\s*fbBlocked/);
  });
});
