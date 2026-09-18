/**
 * tests/brain/memory-admission-ratchet.test.ts — 2026-09-18.
 *
 * `brainMemory.remember()` is the admission gate where provenance, confidence,
 * supersession and category policy are applied to a durable belief. Measured
 * 2026-09-18: **172 direct write call sites across 123 files** bypass it, vs 119
 * remember() sites — and there was NO write-side gate or allowlist at all.
 *
 * This pins the RATCHET's arithmetic. The gate's end-to-end behaviour was proven
 * live: a fixture file with a direct write made it exit 1 naming that file, and
 * removing the fixture made it clean again.
 */
import { describe, it, expect } from "vitest";
import { compareToBaseline } from "@/scripts/check-memory-admission";

describe("the admission ratchet fails on additions and rewards removals", () => {
  const base = ["lib/a.ts", "lib/b.ts", "app/c.ts"];

  it("CONTROL: an unchanged set passes", () => {
    // Without this, a gate hard-wired to fail would satisfy every test below.
    const r = compareToBaseline(base, base);
    expect(r.ok).toBe(true);
    expect(r.added).toEqual([]);
  });

  it("★ a NEW direct writer FAILS the gate and is named", () => {
    const r = compareToBaseline([...base, "lib/sneaky.ts"], base);
    expect(r.ok).toBe(false);
    expect(r.added).toEqual(["lib/sneaky.ts"]);
  });

  it("★ CANARY: a REMOVAL is progress, not a failure", () => {
    // A ratchet that demanded the list stay identical would block the very
    // cleanup it exists to encourage — so paying down debt must never go red.
    const r = compareToBaseline(["lib/a.ts"], base);
    expect(r.ok).toBe(true);
    expect(r.removed).toEqual(["lib/b.ts", "app/c.ts"]);
  });

  it("an addition still fails even when something was also removed", () => {
    // The mixed case is where a naive count-based ratchet silently passes:
    // 3 - 1 + 1 = 3 looks unchanged while a new bypass slipped in.
    const r = compareToBaseline(["lib/a.ts", "lib/b.ts", "lib/new.ts"], base);
    expect(r.ok).toBe(false);
    expect(r.added).toEqual(["lib/new.ts"]);
    expect(r.removed).toEqual(["app/c.ts"]);
  });

  it("an empty baseline means every current writer is an addition", () => {
    expect(compareToBaseline(base, []).added).toEqual(base);
  });
});
