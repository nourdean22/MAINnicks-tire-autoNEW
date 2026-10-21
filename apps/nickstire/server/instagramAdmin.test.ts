import { describe, expect, it, vi } from "vitest";

// The dbAdminProcedure middleware (server/_core/trpc.ts) refuses the call when
// getDbTyped() returns null. That lives in ./db, which is a DIFFERENT module from
// the db-helper this suite already mocks — without this the guard fires before
// any handler and every gate asserted below becomes unreachable. A live-looking
// handle is all it needs; the helpers are still mocked elsewhere.
vi.mock('./db', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getDbTyped: async () => ({}) };
});


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


  describe("autopostLaneStatus (admin)", () => {
    it("is an admin query that returns the v1 contract", async () => {
      const caller = appRouter.createCaller(ctx("admin"));
      const s = await caller.instagramAdmin.autopostLaneStatus();
      expect(s.available).toBe(true);
      if (s.available) {
        expect(s.recent).toEqual([]);
        expect(s.counts7d).toEqual({ posted: 0, failed: 0, aborted: 0, dryrun: 0, runs: 0 });
      }
    });

    it("refuses a non-admin caller", async () => {
      const caller = appRouter.createCaller(ctx("user"));
      await expect(caller.instagramAdmin.autopostLaneStatus()).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("startAutopostRun (admin)", () => {
    it("exists on the real router and refuses a non-admin caller", async () => {
      const caller = appRouter.createCaller(ctx("user"));
      await expect(caller.instagramAdmin.startAutopostRun({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("rejects an unknown archetype at input validation, before any run starts", async () => {
      const caller = appRouter.createCaller(ctx("admin"));
      await expect(
        caller.instagramAdmin.startAutopostRun({ forceArchetype: "not-an-archetype" as never }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  describe("commentResponderStatus (admin)", () => {
    it("is an admin query that returns the v1 contract", async () => {
      const caller = appRouter.createCaller(ctx("admin"));
      const s = await caller.instagramAdmin.commentResponderStatus();
      expect(s.available).toBe(true);
      if (s.available) {
        expect(s.recentReplies).toEqual([]);
        expect(s.counts7d).toEqual({ posted: 0, failed: 0, dryRun: 0 });
      }
    });

    it("refuses a non-admin caller", async () => {
      const caller = appRouter.createCaller(ctx("user"));
      await expect(caller.instagramAdmin.commentResponderStatus()).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("attachExternalClips (admin)", () => {
    const input = { jobId: 2100001, clipUrls: ["https://cdn.example.com/1.mp4"], source: "higgsfield-web" as const, startFrame: "none" as const };

    it("exists on the real router and refuses a non-admin caller", async () => {
      expect(appRouter._def.procedures["instagramAdmin.attachExternalClips"]).toBeDefined();
      const caller = appRouter.createCaller(ctx("user"));
      await expect(caller.instagramAdmin.attachExternalClips(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("rejects an unknown source at input validation, before any download", async () => {
      const caller = appRouter.createCaller(ctx("admin"));
      await expect(
        caller.instagramAdmin.attachExternalClips({ ...input, source: "local-file" as never }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("requires startFrame: an omitted one is rejected at input validation, no default", async () => {
      const caller = appRouter.createCaller(ctx("admin"));
      const { startFrame: _drop, ...bare } = input;
      await expect(caller.instagramAdmin.attachExternalClips(bare as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it.each(["None", "text_only", "", null])("rejects startFrame %j at input validation", async (startFrame) => {
      const caller = appRouter.createCaller(ctx("admin"));
      await expect(
        caller.instagramAdmin.attachExternalClips({ ...input, startFrame: startFrame as never }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
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


  // schedulePost / listScheduled / cancelScheduled were deleted 2026-07-24
  // (zero client callers + integrity holes publishPost had already fixed).
  // Scheduling is owned by instagramStudio.schedule — its guards are pinned in
  // instagramStudioLifecycle.test.ts.

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
