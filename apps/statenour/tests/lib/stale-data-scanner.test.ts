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
  isUnresolvedContradiction,
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

describe("isUnresolvedContradiction", () => {
  // Protects against the D9 bug: old code used
  //   content: { not: { contains: "resolved" } }
  // which false-excluded any contradiction whose prose mentioned
  // the word "resolved" (e.g., "I resolved to ...").
  it("includes a contradiction with status=unresolved", () => {
    const c = { content: JSON.stringify({ status: "unresolved", text: "..." }) };
    expect(isUnresolvedContradiction(c)).toBe(true);
  });

  it("excludes a contradiction with status=resolved", () => {
    const c = { content: JSON.stringify({ status: "resolved", text: "..." }) };
    expect(isUnresolvedContradiction(c)).toBe(false);
  });

  it("excludes a contradiction with status=dismissed", () => {
    const c = { content: JSON.stringify({ status: "dismissed", text: "..." }) };
    expect(isUnresolvedContradiction(c)).toBe(false);
  });

  it("excludes a contradiction with status=both_valid", () => {
    const c = { content: JSON.stringify({ status: "both_valid", text: "..." }) };
    expect(isUnresolvedContradiction(c)).toBe(false);
  });

  it("includes a contradiction with MISSING status field", () => {
    // Fail-open: if we can't tell, surface it so Nour can review.
    const c = { content: JSON.stringify({ text: "..." }) };
    expect(isUnresolvedContradiction(c)).toBe(true);
  });

  it("includes a contradiction with malformed JSON content", () => {
    const c = { content: "not json at all { broken" };
    expect(isUnresolvedContradiction(c)).toBe(true);
  });

  it("does NOT false-match prose containing the word 'resolved'", () => {
    // The regression that D9 fixed: content mentions "resolved" but
    // status is "unresolved" → MUST still be flagged.
    const c = {
      content: JSON.stringify({
        status: "unresolved",
        text: "I resolved to stop scrolling at 11pm",
      }),
    };
    expect(isUnresolvedContradiction(c)).toBe(true);
  });

  it("excludes rows even when prose contains 'unresolved'", () => {
    // Inverse sanity check — prose noise must not override status.
    const c = {
      content: JSON.stringify({
        status: "resolved",
        text: "the unresolved question was finally closed",
      }),
    };
    expect(isUnresolvedContradiction(c)).toBe(false);
  });
});
