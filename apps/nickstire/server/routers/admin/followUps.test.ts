/**
 * The retired followUps adapter (PR 3294). An installed PWA on the old bundle keeps polling
 * followUps.pending / followUps.recent until it reloads, so those answer an empty list and the
 * three actions refuse with a reload message, instead of a "No procedure found" error.
 */
import { describe, expect, it } from "vitest";
import { appRouter } from "../../routers";
import type { TrpcContext } from "../../_core/context";
import { permissionForAdminProcedure } from "../../../shared/adminPermissions";

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
const admin = () => appRouter.createCaller(ctx()) as unknown as {
  followUps: Record<"pending" | "recent" | "run" | "cancel" | "retry", (input?: unknown) => Promise<unknown>>;
};

describe("followUps is a retired adapter for old bundles", () => {
  it.each(["pending", "recent"] as const)("%s answers an empty list", async (q) => {
    await expect(admin().followUps[q]()).resolves.toEqual([]);
  });

  it.each([
    ["run", undefined],
    ["cancel", { id: 42 }],
    ["retry", { id: 42 }],
  ] as const)("%s refuses with the reload message and touches nothing", async (m, input) => {
    await expect(admin().followUps[m](input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "The booking follow-ups lane was retired on 2026-10-26; reload the admin.",
    });
  });

  it("keeps the permission the old router used", () => {
    expect(permissionForAdminProcedure("followUps.run", "mutation")).toBe("marketing.manage");
  });
});
