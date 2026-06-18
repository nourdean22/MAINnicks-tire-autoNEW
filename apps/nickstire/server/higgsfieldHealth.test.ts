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

describe("instagramAdmin.getHiggsfieldHealth (auth gating)", () => {
  it("is registered in the appRouter", () => {
    expect(appRouter._def.procedures["instagramAdmin.getHiggsfieldHealth"]).toBeDefined();
  });

  it("rejects unauthenticated callers with FORBIDDEN (before any CLI spawn)", async () => {
    const caller = appRouter.createCaller(ctx(null));
    await expect(caller.instagramAdmin.getHiggsfieldHealth()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects non-admin callers with FORBIDDEN", async () => {
    const caller = appRouter.createCaller(ctx("user"));
    await expect(caller.instagramAdmin.getHiggsfieldHealth()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
