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
});
