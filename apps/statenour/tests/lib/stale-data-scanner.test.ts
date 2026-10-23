/**
 * tests/lib/stale-data-scanner.test.ts — scanner predicate contracts
 *
 * Locks down the predicates that D1 / D9 / D16 fixed. The full
 * scanStaleData() function hits prisma (not unit-testable without a
 * heavy mock), but the pure predicates are the bug-prone parts
 * (double-broken count + false-substring matches).
 */

import { describe, it, expect } from "vitest";
import {
  isOrphanConversation,
} from "@/lib/system/stale-data-scanner";

describe("isOrphanConversation", () => {
  it("flags 0-message conversations as orphan", () => {
    expect(isOrphanConversation({ _count: { messages: 0 } })).toBe(true);
  });

  it("flags 1-message conversations as orphan (X-Conv-Id leftovers)", () => {
    expect(isOrphanConversation({ _count: { messages: 1 } })).toBe(true);
  });

  it("flags 2-message conversations as orphan (user + reply only)", () => {
    expect(isOrphanConversation({ _count: { messages: 2 } })).toBe(true);
  });

  it("does NOT flag 3-message conversations", () => {
    expect(isOrphanConversation({ _count: { messages: 3 } })).toBe(false);
  });

  it("does NOT flag long conversations", () => {
    expect(isOrphanConversation({ _count: { messages: 42 } })).toBe(false);
  });
});

