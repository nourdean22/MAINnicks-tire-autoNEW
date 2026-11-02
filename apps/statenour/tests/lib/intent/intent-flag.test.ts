/**
 * W6 PR 2 · the real W6_INTENT_SURFACE registry entry behind isIntentSurfaceOn (the route and page tests
 * mock it, so a typo in the key or the on value would pass them). Off by default; env 1 or true turns it
 * on; the Settings panel's override wins.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rows: [] as Array<{ key: string; value: string }> }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  prisma: { userPreference: { findMany: async () => h.rows } },
}));

beforeEach(() => {
  vi.resetModules();
  h.rows = [];
  delete process.env.W6_INTENT_SURFACE;
});

async function on() {
  const { isIntentSurfaceOn } = await import("@/lib/intent/compose");
  return isIntentSurfaceOn();
}

describe("W6_INTENT_SURFACE", () => {
  it("is off when nothing is set", async () => {
    expect(await on()).toBe(false);
  });

  it.each(["1", "true"])("env %s turns it on", async (v) => {
    process.env.W6_INTENT_SURFACE = v;
    expect(await on()).toBe(true);
  });

  it("the Settings panel's true override turns it on without an env change", async () => {
    h.rows = [{ key: "W6_INTENT_SURFACE", value: "true" }];
    expect(await on()).toBe(true);
  });

  it("CONTROL · an unrelated value does not turn it on", async () => {
    process.env.W6_INTENT_SURFACE = "yes please";
    expect(await on()).toBe(false);
  });
});
