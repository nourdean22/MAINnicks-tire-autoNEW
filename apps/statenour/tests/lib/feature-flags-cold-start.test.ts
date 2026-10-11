/**
 * Feature-flag overrides on a cold start (audit 03-F13b, 2026-10-10).
 *
 * The first getFlag() of a process starts a background load of the DB overrides.
 * A caller that then awaits loadFeatureFlagOverrides() used to return at once
 * (a boolean "in flight" guard), so it read env, not the DB: NICK_MUTATION_LOCK
 * set on the board did not hold for that request. A failed load was swallowed,
 * so the operator toggle's "runtime not applied" branch could never fire.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: { userPreference: { findMany: (...a: unknown[]) => h.findMany(...a) } },
}));

const LOCK_ROW = [{ key: "NICK_MUTATION_LOCK", value: "true" }];
// A slow DB read, so a caller that does not wait for it is caught reading env.
const slowly = <T,>(value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), 25));

beforeEach(() => {
  vi.resetModules(); // fresh cache: lastFetchedAt = 0, nothing in flight
  h.findMany.mockReset();
  delete process.env.NICK_MUTATION_LOCK;
});

describe("loadFeatureFlagOverrides on a cold start", () => {
  it("CONTROL: with nothing in flight, awaiting the load applies the DB override", async () => {
    h.findMany.mockImplementation(() => slowly(LOCK_ROW));
    const ff = await import("@/lib/feature-flags");
    await ff.loadFeatureFlagOverrides();
    expect(ff.getFlag("NICK_MUTATION_LOCK")?.isOn).toBe(true);
  });

  it("a load already in flight (started by getFlag) is awaited, not skipped", async () => {
    h.findMany.mockImplementation(() => slowly(LOCK_ROW));
    const ff = await import("@/lib/feature-flags");

    expect(ff.getFlag("NICK_MUTATION_LOCK")?.isOn).toBe(false); // env only; starts the background load
    await ff.loadFeatureFlagOverrides();

    expect(ff.getFlag("NICK_MUTATION_LOCK")?.isOn).toBe(true);
    expect(h.findMany).toHaveBeenCalledTimes(1); // the second caller shared the first read
  });

  it("a failed load rejects (after logging) so the caller can report it", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    h.findMany.mockRejectedValue(new Error("db down"));
    const ff = await import("@/lib/feature-flags");

    await expect(ff.loadFeatureFlagOverrides()).rejects.toThrow("db down");
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
