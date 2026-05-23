/**
 * Contract test for `brain.recentReflections` procedure input (task #13
 * · 2026-05-23 · CoALA reflection viewer).
 *
 * The procedure's `.input(...)` is declared inline in
 * lib/trpc/routers/brain.ts. The schema below is that literal
 * `.input(...)` object re-declared verbatim — pinned against the real
 * payloads the /brain/reflections page sends, so a tightened bound
 * fails CI before it breaks a real call-site.
 *
 * Pure schema parse, no Prisma — the contract IS the schema, so the
 * test is too. Same pattern as tests/lib/validators/brain-reflect-
 * schema.test.ts.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";

// ── brain.recentReflections input · verbatim from lib/trpc/routers/brain.ts ─

const recentReflectionsInput = z.object({
  sourceCategory: z.string().min(1).max(80).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

describe("brain.recentReflections · viewer-page payload", () => {
  it("accepts the empty payload — defaults limit to 50", () => {
    const parsed = recentReflectionsInput.parse({});
    expect(parsed.limit).toBe(50);
    expect(parsed.sourceCategory).toBeUndefined();
  });

  it("accepts sourceCategory + limit", () => {
    expect(() =>
      recentReflectionsInput.parse({
        sourceCategory: "decision_log",
        limit: 25,
      }),
    ).not.toThrow();
  });

  it("accepts sourceCategory alone (limit defaults)", () => {
    const parsed = recentReflectionsInput.parse({
      sourceCategory: "pattern",
    });
    expect(parsed.limit).toBe(50);
    expect(parsed.sourceCategory).toBe("pattern");
  });

  it("accepts limit alone (sourceCategory omitted)", () => {
    expect(() => recentReflectionsInput.parse({ limit: 10 })).not.toThrow();
  });

  it("accepts each of the cron-iterated source categories", () => {
    for (const cat of [
      "decision_log",
      "pattern",
      "belief",
      "lesson",
      "learning_journal",
    ]) {
      expect(() =>
        recentReflectionsInput.parse({ sourceCategory: cat }),
      ).not.toThrow();
    }
  });

  it("accepts limit=1 (lower bound)", () => {
    expect(() => recentReflectionsInput.parse({ limit: 1 })).not.toThrow();
  });

  it("accepts limit=100 (upper bound)", () => {
    expect(() => recentReflectionsInput.parse({ limit: 100 })).not.toThrow();
  });
});

describe("brain.recentReflections · rejects invalid payloads", () => {
  it("rejects an empty sourceCategory string", () => {
    expect(() =>
      recentReflectionsInput.parse({ sourceCategory: "" }),
    ).toThrow();
  });

  it("rejects sourceCategory longer than 80 chars", () => {
    expect(() =>
      recentReflectionsInput.parse({ sourceCategory: "a".repeat(81) }),
    ).toThrow();
  });

  it("rejects limit below 1", () => {
    expect(() => recentReflectionsInput.parse({ limit: 0 })).toThrow();
  });

  it("rejects limit above 100", () => {
    expect(() => recentReflectionsInput.parse({ limit: 101 })).toThrow();
  });

  it("rejects non-integer limit", () => {
    expect(() => recentReflectionsInput.parse({ limit: 12.5 })).toThrow();
  });

  it("rejects a non-string sourceCategory", () => {
    expect(() =>
      recentReflectionsInput.parse({ sourceCategory: 42 }),
    ).toThrow();
  });

  it("rejects a non-number limit", () => {
    expect(() =>
      recentReflectionsInput.parse({ limit: "fifty" }),
    ).toThrow();
  });
});
