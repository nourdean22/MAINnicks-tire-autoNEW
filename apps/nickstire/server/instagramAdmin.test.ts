import { describe, expect, it, vi } from "vitest";

// The claim-safety / scheduling gates under test throw BEFORE any query runs
// (inputs carry no inventoryId), but the routers null-check db() first — so
// these tests were order/connection-dependent: green only when a real TiDB
// connection happened to succeed. Mock the whole helper (complete mock, per
// singleFork hygiene) with a chainable stub that resolves to [] for any
// awaited query, so list endpoints stay shape-stable and gates are reachable.
vi.mock("./lib/db-helper", () => {
  // Query chains are thenable (await → []); the root database object must NOT
  // be thenable, or `await db()` would unwrap it to [] via promise adoption.
  const makeChain = (): unknown =>
    new Proxy(function () {}, {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (value: unknown[]) => void) => resolve([]);
        }
        return () => makeChain();
      },
      apply() {
        return makeChain();
      },
    });
  const database = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") return undefined;
        return () => makeChain();
      },
    },
  );
  return {
    db: async () => database,
    dbTyped: async () => database,
    requireDb: async () => database,
  };
});

// Admin waves #764-767 put MFA enforcement on every adminProcedure
// (requireFreshMfaAndPermission). These router tests exercise claim-safety /
// input-validation / shape logic, not the MFA ceremony — without this mock
// every admin call died with "Admin two-factor authentication setup is
// required" (10/20 tests red since the waves merged). Partial mock: only
// getAdminSecurityState is stubbed; isMfaVerificationFresh and the
// permission helpers stay REAL so the gate's own logic is still exercised.
// `mockSecurityState` is mutable so a test can prove the gate fails closed.
let mockSecurityState: {
  adminRole: string;
  mfaEnabled: boolean;
  mfaVerifiedAt: Date | null;
  encryptedSecret: string | null;
} | null = null;

vi.mock("./services/adminSecurity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./services/adminSecurity")>();
  return {
    ...actual,
    getAdminSecurityState: vi.fn(async () => mockSecurityState),
  };
});

function mfaSatisfied() {
  mockSecurityState = {
    adminRole: "owner",
    mfaEnabled: true,
    mfaVerifiedAt: new Date(),
    encryptedSecret: null,
  };
}

import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { beforeEach } from "vitest";

beforeEach(() => {
  mfaSatisfied();
});

function ctx(role: "admin" | "user" | null): TrpcContext {
  return {
    user:
      role === null
        ? null
        : {
            id: role === "admin" ? 1 : 2,
            openId: `${role}-user`,
            email: `${role}@nickstire.com`,
            name: `${role} User`,
            loginMethod: "manus",
            role,
            createdAt: new Date(),
            updatedAt: new Date(),
            lastSignedIn: new Date(),
          },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

describe("instagramAdmin router", () => {
  it("is registered in the main appRouter", () => {
    expect(appRouter._def.procedures["instagramAdmin.getConnectionStatus"]).toBeDefined();
  });

  describe("auth gating (adminProcedure)", () => {
    it("rejects unauthenticated callers (adminProcedure → FORBIDDEN, no requireUser chain)", async () => {
      const caller = appRouter.createCaller(ctx(null));
      await expect(caller.instagramAdmin.getConnectionStatus()).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("fails closed when MFA is ENFORCED (ADMIN_MFA_REQUIRED=1) and the admin has no MFA set up", async () => {
      // Locks the enforced regime: with the flag on, an admin identity
      // WITHOUT MFA must not reach any adminProcedure body. Env restored
      // per singleFork hygiene.
      const saved = process.env.ADMIN_MFA_REQUIRED;
      process.env.ADMIN_MFA_REQUIRED = "1";
      try {
        mockSecurityState = {
          adminRole: "owner",
          mfaEnabled: false,
          mfaVerifiedAt: null,
          encryptedSecret: null,
        };
        const caller = appRouter.createCaller(ctx("admin"));
        await expect(caller.instagramAdmin.getConnectionStatus()).rejects.toMatchObject({
          code: "PRECONDITION_FAILED",
        });
      } finally {
        if (saved === undefined) delete process.env.ADMIN_MFA_REQUIRED;
        else process.env.ADMIN_MFA_REQUIRED = saved;
      }
    });

    it("default regime (flag unset): no MFA wall for a role that holds the permission", async () => {
      // Operator decision 2026-07-16: Google sign-in alone, "like before".
      // The MFA wall must not fire when enforcement is off — that part stands.
      delete process.env.ADMIN_MFA_REQUIRED;
      mockSecurityState = {
        adminRole: "owner",
        mfaEnabled: false,
        mfaVerifiedAt: null,
        encryptedSecret: null,
      };
      const caller = appRouter.createCaller(ctx("admin"));
      const status = await caller.instagramAdmin.getConnectionStatus();
      expect(status).toHaveProperty("configured");
    });

    it("default regime: a VIEWER is now denied — turning off MFA no longer grants owner", async () => {
      // CORRECTED. This test previously asserted the opposite, in its own words:
      // "Even with an MFA-less viewer security state ... permission checks run as
      // owner." That was C2 written down as an expectation.
      //
      // _core/trpc.ts early-returned when MFA was off, injecting
      // MFA_NOT_REQUIRED_STATE (adminRole "owner") and skipping the permission
      // check entirely — so every admin was an effective owner and the five
      // lesser roles were decorative. Disabling the second factor disabled the
      // whole permission system.
      //
      // MFA posture and authorization are independent now. No MFA wall (correct),
      // AND the role is enforced (new).
      delete process.env.ADMIN_MFA_REQUIRED;
      mockSecurityState = {
        adminRole: "viewer",
        mfaEnabled: false,
        mfaVerifiedAt: null,
        encryptedSecret: null,
      };
      const caller = appRouter.createCaller(ctx("admin"));
      await expect(caller.instagramAdmin.getConnectionStatus()).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      // ...and specifically NOT the MFA error, which would mean the wall fired.
      await expect(caller.instagramAdmin.getConnectionStatus()).rejects.not.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
    });

    it("rejects non-admin callers with FORBIDDEN", async () => {
      const caller = appRouter.createCaller(ctx("user"));
      await expect(caller.instagramAdmin.getConnectionStatus()).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
  });

  describe("getConnectionStatus (admin)", () => {
    it("returns a credential/token status shape without throwing", async () => {
      const caller = appRouter.createCaller(ctx("admin"));
      const status = await caller.instagramAdmin.getConnectionStatus();
      expect(status).toHaveProperty("configured");
      expect(typeof status.configured).toBe("boolean");
      expect(status).toHaveProperty("token");
      expect(status.token).toHaveProperty("present");
    });
  });

  describe("postReply claim-safety gate", () => {
    it("blocks a reply with a banned claim BEFORE any Graph write (BAD_REQUEST, not a network error)", async () => {
      const caller = appRouter.createCaller(ctx("admin"));
      await expect(
        caller.instagramAdmin.postReply({
          commentId: "123",
          message: "We guarantee this is the best shop in Cleveland!",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  describe("input validation", () => {
    it("rejects getComments with an empty mediaId", async () => {
      const caller = appRouter.createCaller(ctx("admin"));
      await expect(caller.instagramAdmin.getComments({ mediaId: "" })).rejects.toBeTruthy();
    });

    it("rejects postReply with a non-numeric commentId", async () => {
      const caller = appRouter.createCaller(ctx("admin"));
      await expect(
        caller.instagramAdmin.postReply({ commentId: "abc", message: "Thanks!" }),
      ).rejects.toBeTruthy();
    });
  });

  describe("getRecentGenerations (admin)", () => {
    it("returns an array without throwing", async () => {
      const caller = appRouter.createCaller(ctx("admin"));
      const rows = await caller.instagramAdmin.getRecentGenerations({ limit: 5 });
      expect(Array.isArray(rows)).toBe(true);
    });
  });

  describe("getProviderHealth (admin)", () => {
    it("returns text/image/autopost health shape without throwing", async () => {
      const caller = appRouter.createCaller(ctx("admin"));
      const h = await caller.instagramAdmin.getProviderHealth();
      expect(h.text).toHaveProperty("provider");
      expect(typeof h.text.configured).toBe("boolean");
      expect(typeof h.text.openaiFallback).toBe("boolean");
      expect(h.image).toHaveProperty("provider");
      expect(typeof h.autopost.recentFailures).toBe("number");
      expect(typeof h.autopost.recentRuns).toBe("number");
    });
  });

  describe("publishPost input validation", () => {
    it("rejects empty or invalid URLs", async () => {
      const caller = appRouter.createCaller(ctx("admin"));
      await expect(
        caller.instagramAdmin.publishPost({
          caption: "Check out this post",
          imageUrl: "invalid-url",
        })
      ).rejects.toBeTruthy();
    });

    it("rejects when no media is provided", async () => {
      const caller = appRouter.createCaller(ctx("admin"));
      await expect(
        caller.instagramAdmin.publishPost({
          caption: "Check out this post",
        })
      ).rejects.toBeTruthy();
    });
  });

  describe("publishPost claim-safety gate (parity with postReply)", () => {
    it("blocks a caption with a banned claim BEFORE publishing (BAD_REQUEST)", async () => {
      const caller = appRouter.createCaller(ctx("admin"));
      await expect(
        caller.instagramAdmin.publishPost({
          platforms: ["instagram"],
          caption: "We guarantee the best tire deal in Cleveland",
          imageUrl: "https://example.com/tire.jpg",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("ALLOWS an advertised price ($) — no-price-talk is excluded for IG captions", async () => {
      const caller = appRouter.createCaller(ctx("admin"));
      // The caption passes the claim-safety gate, then fails on the missing-media
      // path (BAD_REQUEST) — proving the price did NOT trip BAD_REQUEST.
      await expect(
        caller.instagramAdmin.publishPost({
          platforms: ["instagram"],
          caption: "Used tires from $60 installed — pull up!",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  describe("regenerateImage", () => {
    it("rejects non-admin callers (before any image generation)", async () => {
      const caller = appRouter.createCaller(ctx("user"));
      await expect(
        caller.instagramAdmin.regenerateImage({ prompt: "a tire on a studio podium" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("rejects a too-short prompt at input validation (no image call)", async () => {
      const caller = appRouter.createCaller(ctx("admin"));
      await expect(caller.instagramAdmin.regenerateImage({ prompt: "ab" })).rejects.toBeTruthy();
    });
  });

  describe("schedulePost", () => {
    const future = () => new Date(Date.now() + 3_600_000).toISOString();

    it("rejects non-admin callers", async () => {
      const caller = appRouter.createCaller(ctx("user"));
      await expect(
        caller.instagramAdmin.schedulePost({ platforms: ["instagram"], caption: "Pull up for tires", imageUrl: "https://x.com/y.jpg", scheduledAt: future() }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("blocks a banned claim before scheduling (BAD_REQUEST)", async () => {
      const caller = appRouter.createCaller(ctx("admin"));
      await expect(
        caller.instagramAdmin.schedulePost({ platforms: ["instagram"], caption: "We guarantee the best deal in Cleveland", imageUrl: "https://x.com/y.jpg", scheduledAt: future() }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("rejects a scheduled time in the past (BAD_REQUEST)", async () => {
      const caller = appRouter.createCaller(ctx("admin"));
      await expect(
        caller.instagramAdmin.schedulePost({ platforms: ["instagram"], caption: "Pull up for tires", imageUrl: "https://x.com/y.jpg", scheduledAt: new Date(Date.now() - 3_600_000).toISOString() }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  describe("listScheduled (admin)", () => {
    it("returns an array without throwing", async () => {
      const caller = appRouter.createCaller(ctx("admin"));
      expect(Array.isArray(await caller.instagramAdmin.listScheduled({ limit: 10 }))).toBe(true);
    });
  });

  describe("stageDraft validation for Reels", () => {
    // Reels no longer stage through stageDraft at all — the contract moved to
    // enqueueReelJob/finalizeReelDraft (a556ec3a6 · c4e194694). stageDraft
    // categorically rejects the format, regardless of payload completeness.
    it("categorically rejects Reel drafts (BAD_REQUEST), even with a complete payload", async () => {
      const caller = appRouter.createCaller(ctx("admin"));
      await expect(caller.instagramAdmin.stageDraft({
        format: "reel",
        caption: "check this out",
        sourceType: "manual",
      })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(caller.instagramAdmin.stageDraft({
        format: "reel",
        caption: "check this out",
        videoUrl: "https://nickstire.com/assets/video.mp4",
        sourceType: "manual",
      })).rejects.toThrow(/enqueueReelJob/i);
    });
  });
});
