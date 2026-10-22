/**
 * NICK_CLAIM_GAP kill switch (2026-10-22). Default ON; the Settings flag panel
 * writes "false" as its off override, so "false" must turn it off, not only "0".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rows: [] as Array<{ key: string; value: string }> }));

vi.mock("@/lib/prisma", () => ({
  prisma: { userPreference: { findMany: async () => h.rows } },
}));

beforeEach(() => {
  vi.resetModules();
  h.rows = [];
  delete process.env.NICK_CLAIM_GAP;
});

async function isOn() {
  const ff = await import("@/lib/feature-flags");
  await ff.loadFeatureFlagOverrides();
  return ff.getFlag("NICK_CLAIM_GAP")?.isOn;
}

describe("NICK_CLAIM_GAP", () => {
  it("is on when nothing is set", async () => {
    expect(await isOn()).toBe(true);
  });

  it("env 0 turns it off", async () => {
    process.env.NICK_CLAIM_GAP = "0";
    expect(await isOn()).toBe(false);
  });

  it("the Settings panel's false override turns it off", async () => {
    h.rows = [{ key: "NICK_CLAIM_GAP", value: "false" }];
    expect(await isOn()).toBe(false);
  });

  it("CONTROL: the panel's true override keeps it on", async () => {
    h.rows = [{ key: "NICK_CLAIM_GAP", value: "true" }];
    expect(await isOn()).toBe(true);
  });
});
