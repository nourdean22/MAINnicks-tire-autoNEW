/**
 * shopMedia router: admin-only, bounded inputs, and a missing database is an
 * error (never an empty library). Behaviour of list/review/stats is pinned in
 * services/shopMediaLibrary.test.ts; this file pins the procedure boundary.
 */
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ db: {} as unknown, calls: [] as Array<[string, unknown]>, security: null as unknown }));
vi.mock("../lib/db-helper", () => ({ db: async () => h.db, dbTyped: async () => h.db, requireDb: async () => h.db }));
vi.mock("../db", () => ({ getDb: async () => h.db, getDbTyped: async () => h.db }));
// A missing admin_security row is the owner fallback; a THROWING read would refuse every mutation (fail closed).
vi.mock("../services/adminSecurity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/adminSecurity")>()),
  getAdminSecurityState: async () => h.security,
}));
vi.mock("../services/shopMediaLibrary", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/shopMediaLibrary")>()),
  listShopMedia: async (_db: unknown, input: unknown) => { h.calls.push(["list", input]); return { items: [], nextCursor: null }; },
  reviewShopMedia: async (_db: unknown, ids: string[], decision: string) => { h.calls.push(["review", { ids, decision }]); return { changed: ids, skipped: [] }; },
  shopMediaStats: async () => { h.calls.push(["stats", null]); return { quarantined: { photo: 0, video: 0 }, approved: { photo: 0, video: 0 }, rejected: { photo: 0, video: 0 }, other: { photo: 0, video: 0 } }; },
}));

import { shopMediaRouter } from "./shopMedia";
import { permissionForAdminProcedure } from "../../shared/adminPermissions";
import type { TrpcContext } from "../_core/context";

function ctx(role: "admin" | "user"): TrpcContext {
  return {
    user: { id: 1, openId: role, email: "a@b.com", name: "A", loginMethod: "manus", role, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  } as TrpcContext;
}

describe("shopMedia router", () => {
  it("OWNER-ONLY: a viewer-role admin gets FORBIDDEN on list, review and stats (quarantined rows carry faces and plates)", async () => {
    h.security = { adminRole: "viewer", mfaEnabled: false, mfaVerifiedAt: null, mfaAgeMinutes: null, encryptedSecret: null };
    try {
      // Through the REAL app router: RBAC keys on the full path (shopMedia.list), which a sub-router caller never sees.
      const { appRouter } = await import("../routers");
      const caller = appRouter.createCaller(ctx("admin")).shopMedia;
      await expect(caller.list({ state: "quarantined" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller.stats()).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller.review({ assetIds: ["ma_1"], decision: "approve" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      h.security = { adminRole: "owner", mfaEnabled: false, mfaVerifiedAt: null, mfaAgeMinutes: null, encryptedSecret: null };
      await expect(caller.list({ state: "quarantined" })).resolves.toEqual({ items: [], nextCursor: null });
      for (const path of ["shopMedia.list", "shopMedia.stats"]) expect(permissionForAdminProcedure(path, "query")).toBe("security.manage");
      expect(permissionForAdminProcedure("shopMedia.review", "mutation")).toBe("security.manage");
    } finally { h.security = null; }
  });

  it("is admin-only", async () => {
    await expect(shopMediaRouter.createCaller(ctx("user")).stats()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("passes list and review through for an admin", async () => {
    h.db = {}; h.calls.length = 0;
    const caller = shopMediaRouter.createCaller(ctx("admin"));
    await caller.list({ state: "quarantined", kind: "video", orientation: "vertical", limit: 60 });
    expect(await caller.review({ assetIds: ["ma_1"], decision: "approve" })).toEqual({ changed: ["ma_1"], skipped: [] });
    expect(h.calls.map((c) => c[0])).toEqual(["list", "review"]);
  });

  it("bounds its inputs: limit <= 60, 1..100 asset ids", async () => {
    const caller = shopMediaRouter.createCaller(ctx("admin"));
    await expect(caller.list({ state: "approved", limit: 61 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.review({ assetIds: [], decision: "approve" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.review({ assetIds: Array.from({ length: 101 }, (_, i) => `ma_${i}`), decision: "reject" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("a missing database is an error, not an empty library", async () => {
    h.db = null;
    try {
      await expect(shopMediaRouter.createCaller(ctx("admin")).list({ state: "approved" })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    } finally { h.db = {}; }
  });
});
