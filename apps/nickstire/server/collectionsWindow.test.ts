/**
 * Canaries for the collections window (2026-08-25).
 *
 * MEASURED against production: 8 unpaid invoices, $3,827.97 total.
 *   5 eligible  ($2,221.35, aged 39-72 days).
 *   3 aged out  ($1,606.62, aged 108/128/138 days) - past the 90-day ceiling.
 *
 * Base rate: 8 of 2,959 invoices (0.27%) are unpaid. This is a small complete
 * backlog, not a systemic leak.
 *
 * The recovery cron that texted this window was removed 2026-10-15; the window
 * now only classifies rows for the admin Unpaid list.
 *
 * SYNTHETIC AGES ONLY - `collectionsState` is driven with numbers, never with
 * a live query, so the test keeps its meaning after the backlog is cleared.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

import {
  collectionsState,
  invoiceAgeDays,
  COLLECTIONS_MIN_AGE_DAYS,
  COLLECTIONS_MAX_AGE_DAYS,
} from "./services/collectionsWindow";

function stripComments(t: string): string {
  return t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("canary - the window has two edges and both are named", () => {
  it("BREAKS: the three real aged-out invoices are classified, not silently dropped", () => {
    // 108 / 128 / 138 days. Previously these fell out of every query and were
    // mentioned by nothing at all.
    for (const age of [108, 128, 138]) {
      expect(collectionsState(age), `${age}d must read aged-out`).toBe("aged-out");
    }
  });

  it("the five real eligible invoices are eligible", () => {
    for (const age of [39, 62, 62, 62, 72]) {
      expect(collectionsState(age), `${age}d must read eligible`).toBe("eligible");
    }
  });

  it("a fresh invoice is too-new, not eligible - the courtesy delay is real", () => {
    expect(collectionsState(0)).toBe("too-new");
    expect(collectionsState(COLLECTIONS_MIN_AGE_DAYS - 1)).toBe("too-new");
  });

  it("the boundaries are inclusive on both ends", () => {
    expect(collectionsState(COLLECTIONS_MIN_AGE_DAYS)).toBe("eligible");
    expect(collectionsState(COLLECTIONS_MAX_AGE_DAYS)).toBe("eligible");
    expect(collectionsState(COLLECTIONS_MAX_AGE_DAYS + 1)).toBe("aged-out");
  });

  it("POSITIVE CONTROL: the three states are actually distinguishable", () => {
    // Without this the function could return one constant and every assertion
    // above about a single state would still pass.
    const seen = new Set([collectionsState(1), collectionsState(30), collectionsState(200)]);
    expect(seen.size).toBe(3);
  });
});

describe("canary - age is computed, not guessed", () => {
  // invoiceDate is the shop's wall clock as stored: 12:00 on Aug 18 is 16:00Z. now is 12:00 EDT on Aug 25.
  const now = new Date("2026-08-25T16:00:00Z");

  it("whole days, floored", () => {
    expect(invoiceAgeDays(new Date("2026-08-18T12:00:00Z"), now)).toBe(7);
    expect(invoiceAgeDays(new Date("2026-08-18T23:00:00Z"), now)).toBe(6);
  });

  it("a missing or unparseable date is 0, never NaN", () => {
    // NaN would flow into collectionsState and compare false against every
    // bound, silently producing "eligible".
    expect(invoiceAgeDays(null, now)).toBe(0);
    expect(invoiceAgeDays("not-a-date", now)).toBe(0);
    expect(collectionsState(invoiceAgeDays(null, now))).toBe("too-new");
  });
});

describe("canary - the unpaid query returns the aged-out figures the admin banner reads", () => {
  const router = stripComments(
    readFileSync(join(process.cwd(), "server/routers/advanced/invoices.ts"), "utf-8"),
  );

  it("BREAKS: the query returns collections state, not just a total", () => {
    expect(router).toContain("collectionsState");
    expect(router).toContain("agedOutCents");
    expect(router).toContain("agedOutCount");
    expect(router).toContain("maxAgeDays");
  });
});
