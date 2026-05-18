/**
 * tests/ai/reasoning/idempotency.test.ts · Phase P.1 (2026-05-18 PM)
 *
 * Tests for N.1 idempotency · the double-tap spend-leak fix. Focuses
 * on hashRequest stability + TTL constant · the prisma-touching
 * functions (lookup/reserve/store/release) are covered by e2e flow
 * not unit tests (they're thin wrappers over Prisma writes).
 */

import { describe, expect, it } from "vitest";
import {
  hashRequest,
  IDEMPOTENCY_TTL_MS,
} from "@/lib/ai/reasoning/idempotency";

describe("hashRequest · deterministic + collision-resistant", () => {
  it("returns the same hash for identical bodies", () => {
    const a = hashRequest({ question: "test", tier: "smart" });
    const b = hashRequest({ question: "test", tier: "smart" });
    expect(a).toBe(b);
  });

  it("returns different hashes for different questions", () => {
    const a = hashRequest({ question: "test A" });
    const b = hashRequest({ question: "test B" });
    expect(a).not.toBe(b);
  });

  it("returns different hashes for different tiers", () => {
    const a = hashRequest({ question: "test", tier: "smart" });
    const b = hashRequest({ question: "test", tier: "deep" });
    expect(a).not.toBe(b);
  });

  it("normalizes whitespace in question", () => {
    const a = hashRequest({ question: "test" });
    const b = hashRequest({ question: "  test  " });
    expect(a).toBe(b);
  });

  it("treats missing tier as 'auto'", () => {
    const a = hashRequest({ question: "test" });
    const b = hashRequest({ question: "test", tier: undefined });
    expect(a).toBe(b);
  });

  it("includes brainContext in hash", () => {
    const a = hashRequest({ question: "test", brainContext: "ctx-a" });
    const b = hashRequest({ question: "test", brainContext: "ctx-b" });
    expect(a).not.toBe(b);
  });

  it("returns a non-empty short base36 string", () => {
    const h = hashRequest({ question: "anything" });
    expect(h.length).toBeGreaterThan(0);
    expect(h.length).toBeLessThan(20); // base36 of 32-bit int
    expect(h).toMatch(/^[0-9a-z]+$/);
  });
});

describe("IDEMPOTENCY_TTL_MS · operator-observable window", () => {
  it("is exactly 10 minutes (sized for mega-run + operator confirm)", () => {
    expect(IDEMPOTENCY_TTL_MS).toBe(10 * 60 * 1000);
  });
});
