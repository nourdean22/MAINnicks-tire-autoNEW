/**
 * Feature-flag registry contract tests — UNMOCKED on purpose.
 *
 * Regression guard for the 2026-07-10 review finding: NICK_MUTATION_LOCK
 * was read via getFlag() in lib/tools/tool-policy.ts and lib/trpc/trpc.ts
 * but never added to FLAG_REGISTRY. getFlag() returns null for
 * unregistered keys, so `getFlag(...)?.isOn ?? false` made the emergency
 * mutation kill-switch permanently false regardless of the env var.
 * The existing tool-policy tests mocked getFlag, so they could never
 * catch this. These tests hit the REAL registry.
 */
import { afterEach, describe, expect, it } from "vitest";
import { FLAG_REGISTRY, getFlag } from "@/lib/feature-flags";

const KEY = "NICK_MUTATION_LOCK";

describe("FLAG_REGISTRY contract", () => {
  afterEach(() => {
    delete process.env[KEY];
  });

  it("registers NICK_MUTATION_LOCK (the kill-switch consumers depend on)", () => {
    expect(FLAG_REGISTRY.some((f) => f.key === KEY)).toBe(true);
  });

  it("getFlag(NICK_MUTATION_LOCK) resolves instead of returning null", () => {
    const flag = getFlag(KEY);
    expect(flag).not.toBeNull();
    expect(flag?.isOn).toBe(false); // unset env -> off
  });

  it.each(["true", "1", "on", "TRUE", "ON"])(
    "env %s activates the lock",
    (val) => {
      process.env[KEY] = val;
      expect(getFlag(KEY)?.isOn).toBe(true);
    },
  );

  it("arbitrary values do NOT activate the lock", () => {
    process.env[KEY] = "yes-please";
    expect(getFlag(KEY)?.isOn).toBe(false);
  });

  it("every registry key is unique", () => {
    const keys = FLAG_REGISTRY.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
