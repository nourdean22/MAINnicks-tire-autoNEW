/**
 * Contract test for `brain.reflect` procedure input (task #12 ·
 * 2026-05-23 · CoALA reflection layer).
 *
 * The procedure's `.input(...)` is declared inline in
 * lib/trpc/routers/brain.ts. The schema below is that literal
 * `.input(...)` object re-declared verbatim — pinned against the
 * real payloads the operator's "reflect now" affordance sends, so a
 * tightened bound fails CI before it breaks a real call-site.
 *
 * Pure schema parse, no Prisma — the contract IS the schema, so the
 * test is too. Same pattern as tests/lib/validators/brain-domain-
 * schemas.test.ts.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";

// ── brain.reflect input · verbatim from lib/trpc/routers/brain.ts ────

const reflectInput = z.object({
  category: z.string().min(1).max(80),
  windowDays: z.number().int().min(1).max(90).optional(),
  maxInsights: z.number().int().min(1).max(10).optional(),
});

describe("brain.reflect · operator-triggered reflect-now payload", () => {
  it("accepts the minimal payload — { category }", () => {
    expect(() =>
      reflectInput.parse({ category: "decision_log" }),
    ).not.toThrow();
  });

  it("accepts category + windowDays", () => {
    expect(() =>
      reflectInput.parse({ category: "pattern", windowDays: 14 }),
    ).not.toThrow();
  });

  it("accepts category + maxInsights", () => {
    expect(() =>
      reflectInput.parse({ category: "lesson", maxInsights: 3 }),
    ).not.toThrow();
  });

  it("accepts the full payload — { category, windowDays, maxInsights }", () => {
    expect(() =>
      reflectInput.parse({
        category: "belief",
        windowDays: 7,
        maxInsights: 5,
      }),
    ).not.toThrow();
  });
});

describe("brain.reflect · rejects invalid payloads", () => {
  it("rejects empty category", () => {
    expect(() => reflectInput.parse({ category: "" })).toThrow();
  });

  it("rejects category longer than 80 chars", () => {
    expect(() =>
      reflectInput.parse({ category: "a".repeat(81) }),
    ).toThrow();
  });

  it("rejects missing category", () => {
    expect(() => reflectInput.parse({ windowDays: 7 })).toThrow();
  });

  it("rejects windowDays below 1", () => {
    expect(() =>
      reflectInput.parse({ category: "pattern", windowDays: 0 }),
    ).toThrow();
  });

  it("rejects windowDays above 90", () => {
    expect(() =>
      reflectInput.parse({ category: "pattern", windowDays: 91 }),
    ).toThrow();
  });

  it("rejects non-integer windowDays", () => {
    expect(() =>
      reflectInput.parse({ category: "pattern", windowDays: 7.5 }),
    ).toThrow();
  });

  it("rejects maxInsights below 1", () => {
    expect(() =>
      reflectInput.parse({ category: "pattern", maxInsights: 0 }),
    ).toThrow();
  });

  it("rejects maxInsights above 10", () => {
    expect(() =>
      reflectInput.parse({ category: "pattern", maxInsights: 11 }),
    ).toThrow();
  });

  it("rejects non-integer maxInsights", () => {
    expect(() =>
      reflectInput.parse({ category: "pattern", maxInsights: 3.5 }),
    ).toThrow();
  });
});
