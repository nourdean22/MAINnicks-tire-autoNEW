/**
 * tests/lib/chat-scroll-position.test.ts (2026-08-18).
 *
 * The one predicate behind BOTH the chat auto-follow and the
 * jump-to-latest button. jsdom reports scroll metrics as 0, so the
 * arithmetic is tested here as a pure function — the hook consumes it.
 */

import { describe, expect, it } from "vitest";
import { NEAR_BOTTOM_PX, isNearBottom } from "@/features/chat-v2/lib/scroll-position";

describe("isNearBottom · the shared bottom predicate", () => {
  it("pinned to the exact bottom is near", () => {
    // 2000 tall, viewport 800, scrolled fully: 2000 - 1200 - 800 = 0
    expect(isNearBottom(2000, 1200, 800)).toBe(true);
  });

  it("just inside the threshold is near; at the threshold is not", () => {
    expect(isNearBottom(2000, 1200 - (NEAR_BOTTOM_PX - 1), 800)).toBe(true);
    expect(isNearBottom(2000, 1200 - NEAR_BOTTOM_PX, 800)).toBe(false);
  });

  it("scrolled well up is not near — the button's show condition", () => {
    expect(isNearBottom(5000, 0, 800)).toBe(false);
  });

  it("content shorter than the viewport is always near (nothing to scroll)", () => {
    expect(isNearBottom(500, 0, 800)).toBe(true);
  });

  it("honors a custom threshold", () => {
    expect(isNearBottom(2000, 900, 800, 400)).toBe(true); // 300 < 400
    expect(isNearBottom(2000, 900, 800, 200)).toBe(false); // 300 >= 200
  });
});
