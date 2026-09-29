/**
 * The admin flag list shows only flags the code still defines.
 *
 * seedFlags inserts a row per FLAG_DEFINITIONS entry at boot and nothing ever
 * deletes a retired one. #2777 seeded contact_holdout_drip; #2785 retired it, so
 * the row likely remains in production. The panel listed every raw row, while
 * `toggle` rejects unknown keys — a switch that does nothing when flipped.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("./services/featureFlags", async (importOriginal) => {
  const real = await importOriginal<typeof import("./services/featureFlags")>();
  return {
    ...real,
    getAllFlags: vi.fn(async () => [
      { key: "contact_holdouts_enabled", value: false, description: "master" },
      { key: "contact_holdout_drip", value: false, description: "retired in #2785" },
    ]),
  };
});
vi.mock("./lib/db-helper", () => ({ db: async () => ({}), dbTyped: async () => ({}), requireDb: async () => ({}) }));
vi.mock("./db", () => ({ getDb: async () => ({}), getDbTyped: async () => ({}) }));

import { featureFlagsRouter } from "./routers/featureFlags";
import type { TrpcContext } from "./_core/context";

function ctx(): TrpcContext {
  return {
    user: { id: 1, openId: "admin", email: "a@b.com", name: "A", loginMethod: "manus", role: "admin", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  } as TrpcContext;
}

describe("featureFlags.list", () => {
  it("drops rows for retired keys and keeps defined ones", async () => {
    const rows = await featureFlagsRouter.createCaller(ctx()).list();
    const keys = rows.map((r) => r.key);
    expect(keys).toContain("contact_holdouts_enabled");
    expect(keys).not.toContain("contact_holdout_drip");
  });
});
