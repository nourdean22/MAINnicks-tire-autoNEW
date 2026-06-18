import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

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
      // path (INTERNAL_SERVER_ERROR) — proving the price did NOT trip BAD_REQUEST.
      await expect(
        caller.instagramAdmin.publishPost({
          platforms: ["instagram"],
          caption: "Used tires from $60 installed — pull up!",
        }),
      ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    });
  });
});
