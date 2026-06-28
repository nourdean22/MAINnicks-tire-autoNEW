import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function ctx(role: "admin" | "user" | null): TrpcContext {
  return {
    user:
      role === null
        ? null
        : ({
            id: role === "admin" ? 1 : 2,
            openId: `${role}-user`,
            email: `${role}@nickstire.com`,
            name: `${role} User`,
            loginMethod: "manus",
            role,
            createdAt: new Date(),
            updatedAt: new Date(),
            lastSignedIn: new Date(),
          } as any),
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

describe("instagramAdmin.getHiggsfieldHealth (auth gating)", () => {
  it("is registered in the appRouter", () => {
    expect((appRouter._def.procedures as any)["instagramAdmin.getHiggsfieldHealth"]).toBeDefined();
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

describe("Higgsfield CLI output parsing regex", () => {
  it("extracts decimal credit balances correctly", () => {
    const regex = /([\d,]+(?:\.\d+)?)\s*(?:credits?|\bcr\b)/i;
    const testCases = [
      { input: "nourdean22@gmail.com — ultra plan, 1.42 credits", expected: "1.42" },
      { input: "balance: 15.5 cr", expected: "15.5" },
      { input: "42 credits remaining", expected: "42" },
      { input: "Account balance: 1,234.56 cr", expected: "1,234.56" },
    ];
    for (const { input, expected } of testCases) {
      const m = input.match(regex);
      expect(m).not.toBeNull();
      expect(m![1]).toBe(expected);
    }
  });
});
