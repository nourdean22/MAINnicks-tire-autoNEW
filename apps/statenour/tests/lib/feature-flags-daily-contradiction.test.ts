/**
 * NICK_DAILY_CONTRADICTION kill switch (2026-10-23). Default ON; the Settings
 * flag panel writes "false" as its off override, so "false" must turn it off,
 * not only "0". The description carries the kill criterion.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rows: [] as Array<{ key: string; value: string }> }));

vi.mock("@/lib/prisma", () => ({
  prisma: { userPreference: { findMany: async () => h.rows } },
}));

beforeEach(() => {
  vi.resetModules();
  h.rows = [];
  delete process.env.NICK_DAILY_CONTRADICTION;
});

async function flag() {
  const ff = await import("@/lib/feature-flags");
  await ff.loadFeatureFlagOverrides();
  return ff.getFlag("NICK_DAILY_CONTRADICTION");
}

describe("NICK_DAILY_CONTRADICTION", () => {
  it("is registered, on when nothing is set, and names its kill criterion", async () => {
    const f = await flag();
    expect(f, "flag is not registered").not.toBeNull();
    expect(f?.isOn).toBe(true);
    const ff = await import("@/lib/feature-flags");
    const def = ff.FLAG_REGISTRY.find((x) => x.key === "NICK_DAILY_CONTRADICTION");
    expect(def?.description).toMatch(/KILL CRITERION/);
    expect(def?.description).toMatch(/1 in 5/);
  });

  it("env 0 turns it off", async () => {
    process.env.NICK_DAILY_CONTRADICTION = "0";
    expect((await flag())?.isOn).toBe(false);
  });

  it("the Settings panel's false override turns it off", async () => {
    h.rows = [{ key: "NICK_DAILY_CONTRADICTION", value: "false" }];
    expect((await flag())?.isOn).toBe(false);
  });

  it("CONTROL: the panel's true override keeps it on", async () => {
    h.rows = [{ key: "NICK_DAILY_CONTRADICTION", value: "true" }];
    expect((await flag())?.isOn).toBe(true);
  });
});
