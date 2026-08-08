/**
 * tests/ai/specificity-patterns.test.ts · v10.0.493
 *
 * Locks the SPECIFICITY_PATTERNS widening · the prior regex set was
 * tuned for business-only nouns (leads · estimates · invoices · etc).
 * The output-critic.test.ts at v10.0.490 exposed under-counting on
 * technical specifics. The widened set catches ISO dates, file paths,
 * code refs, PascalCase + camelCase identifiers, version refs, ticket
 * refs, size/rate units, and technical nouns.
 *
 * This test asserts each new pattern category triggers at least one
 * match so future edits can't silently remove a category.
 */
import { describe, it, expect } from "vitest";
import { countSpecificity } from "@/lib/ai/nour-voice-profile";

describe("SPECIFICITY_PATTERNS · v10.0.493 widening coverage", () => {
  it("catches ISO dates", () => {
    expect(countSpecificity("Updated on 2026-05-12.")).toBeGreaterThan(0);
    expect(countSpecificity("Window 2026-04-01 to 2026-05-01.")).toBeGreaterThanOrEqual(2);
  });

  it("catches file paths with common extensions", () => {
    expect(countSpecificity("See lib/ai/output-critic.ts for the gate.")).toBeGreaterThan(0);
    expect(countSpecificity("Migration in drizzle/0034_leads.sql applied.")).toBeGreaterThan(0);
  });

  it("catches directory references", () => {
    expect(countSpecificity("Updated scripts/prompt-shadow-summary.")).toBeGreaterThan(0);
    expect(countSpecificity("Check app/api/chat/route.")).toBeGreaterThan(0);
  });

  it("catches PascalCase identifiers", () => {
    expect(countSpecificity("BrainBusEvent rows climbed.")).toBeGreaterThan(0);
    expect(countSpecificity("MissionLink + WorkResult both flagged.")).toBeGreaterThanOrEqual(2);
  });

  it("catches camelCase identifiers", () => {
    expect(countSpecificity("Called critiqueOutput and shouldRegen returned true.")).toBeGreaterThanOrEqual(2);
  });

  it("catches version refs", () => {
    expect(countSpecificity("Landed in v10.0.490.")).toBeGreaterThan(0);
    expect(countSpecificity("From v8.x onward.")).toBeGreaterThan(0);
  });

  it("catches LOC + line-count refs", () => {
    expect(countSpecificity("The audit found 250 LOC of dead code.")).toBeGreaterThan(0);
  });

  it("catches ticket refs", () => {
    expect(countSpecificity("See LINEAR-123 and NICK-42.")).toBeGreaterThanOrEqual(2);
  });

  it("catches size + rate units", () => {
    expect(countSpecificity("Bundle delta 250 KB · 80 RPS sustained.")).toBeGreaterThanOrEqual(2);
  });

  it("catches stack/system names (widened set)", () => {
    expect(countSpecificity("Drizzle + TiDB on Railway.")).toBeGreaterThanOrEqual(3);
    expect(countSpecificity("Next.js 16 + React 19 + Prisma 6.")).toBeGreaterThanOrEqual(3);
  });

  it("catches technical-noun counts", () => {
    expect(countSpecificity("12 rows · 3 migrations · 5 routes.")).toBeGreaterThanOrEqual(3);
    expect(countSpecificity("4 tests passed · 2 errors logged.")).toBeGreaterThanOrEqual(2);
  });

  it("STILL catches the original business patterns (no regression)", () => {
    expect(countSpecificity("3 leads · 5 estimates worth $4,200.")).toBeGreaterThanOrEqual(3);
    expect(countSpecificity("This week Nick closed 8 jobs.")).toBeGreaterThanOrEqual(3);
  });

  it("still rates pure-vague prose at zero", () => {
    const generic =
      "The answer depends on the situation and various factors. " +
      "Consider the options and choose what works best for the goals.";
    expect(countSpecificity(generic)).toBe(0);
  });
});
