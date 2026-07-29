/**
 * tests/lib/ultron/close-target.test.ts — the drift ticker's daily target
 * (2026-07-29).
 *
 * Reported from the operator's phone: the ticker read "4 open loops.
 * Close 3 today." The count was real; "3" was a string literal that
 * fired at every backlog size — demanding 75% of a 4-item backlog, and
 * an arbitrary slice of a 20-item one. Precise-sounding numbers with
 * nothing behind them are the fabricated specificity the honesty stack
 * blocks in generated text; this one survived because no guard inspects
 * string literals.
 */

import { describe, it, expect } from "vitest";
import { closeTargetFor } from "@/lib/ultron/timelines";

describe("closeTargetFor", () => {
  it("never asks for more than a third of the backlog", () => {
    for (const n of [3, 4, 5, 6, 9, 12, 20, 50]) {
      expect(closeTargetFor(n), `${n} loops`).toBeLessThanOrEqual(Math.ceil(n / 3));
    }
  });

  it("the reported case now asks for 1, not 3", () => {
    expect(closeTargetFor(4)).toBe(1);
  });

  it("stays bounded at 3 — an unmeetable target teaches you to ignore the nudge", () => {
    expect(closeTargetFor(50)).toBe(3);
    expect(closeTargetFor(500)).toBe(3);
  });

  it("always asks for at least one while the ticker is firing (>=3 loops)", () => {
    for (const n of [3, 4, 5]) expect(closeTargetFor(n)).toBe(1);
  });

  it("scales with the backlog rather than being constant", () => {
    expect(closeTargetFor(6)).toBeGreaterThan(closeTargetFor(3));
    expect(closeTargetFor(9)).toBeGreaterThan(closeTargetFor(6));
  });

  it("returns 0 for an empty backlog — no target when there is nothing to close", () => {
    expect(closeTargetFor(0)).toBe(0);
    expect(closeTargetFor(-1)).toBe(0);
  });
});
