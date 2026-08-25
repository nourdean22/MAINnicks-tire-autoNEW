/**
 * Canaries for the estimate -> invoice matcher (2026-08-25).
 *
 * THE MISS, measured: 54 of 422 unmatched estimates (12.8%, $46,754.41) had an
 * invoice for the same phone within 45 days. In the last 90 days alone: 23
 * estimates, $15,768.19. Conversion was understated and "declined work"
 * overstated, and some of those customers received a "still interested?" SMS
 * about work they had already paid for.
 *
 * THE RISK IN FIXING IT is the opposite error. A wrong match marks an unsold
 * estimate converted and removes the customer from recovery outreach - a
 * corruption nobody would think to check. So the tuning was chosen by counting
 * CANDIDATES, not guesses.
 *
 * SYNTHETIC FIXTURES ONLY. The rule is exercised through a local
 * reimplementation driven by fabricated rows; the production numbers appear as
 * documentation, never as assertions, so this suite keeps its meaning after
 * the backlog is matched.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

import { MATCH_WINDOW_DAYS, MATCH_AMOUNT_TOLERANCE } from "./services/shopDriverEstimateSync";
import { DECLINED_RECOVERY_WINDOW_DAYS } from "@shared/const";

function stripComments(t: string): string {
  return t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

interface Inv { id: number; phoneKey: string; cents: number; dayOffset: number }

/**
 * The matcher's decision, reimplemented over in-memory rows. Mirrors the SQL:
 * same phone key, amount inside the tolerance band, invoice dated on or after
 * the estimate and within the window - then EXACTLY ONE candidate or nothing.
 */
function decide(estimateCents: number, phoneKey: string, invoices: Inv[]): number | "ambiguous" | null {
  const low = Math.floor(estimateCents * (1 - MATCH_AMOUNT_TOLERANCE));
  const high = Math.ceil(estimateCents * (1 + MATCH_AMOUNT_TOLERANCE));
  const hits = invoices
    .filter((i) => i.phoneKey === phoneKey)
    .filter((i) => i.cents >= low && i.cents <= high)
    .filter((i) => i.dayOffset >= 0 && i.dayOffset < MATCH_WINDOW_DAYS)
    .sort((a, b) => a.dayOffset - b.dayOffset);
  if (hits.length > 1) return "ambiguous";
  return hits.length === 1 ? hits[0].id : null;
}

const PHONE = "2168620005";

describe("canary - the widened rule reaches what the old one could not", () => {
  it("BREAKS: an invoice 40 days later now matches (old window was 30)", () => {
    expect(decide(50_000, PHONE, [{ id: 1, phoneKey: PHONE, cents: 50_000, dayOffset: 40 }])).toBe(1);
  });

  it("BREAKS: a partially-approved job at -20% now matches (old band was +/-10%)", () => {
    // The customer approves some lines and declines others. The estimate and
    // the invoice legitimately differ; +/-10% assumed the quote was accepted
    // verbatim, which is not how a shop works.
    expect(decide(100_000, PHONE, [{ id: 2, phoneKey: PHONE, cents: 80_000, dayOffset: 5 }])).toBe(2);
  });

  it("BREAKS: added work at +20% now matches", () => {
    expect(decide(100_000, PHONE, [{ id: 3, phoneKey: PHONE, cents: 120_000, dayOffset: 5 }])).toBe(3);
  });
});

describe("canary - it refuses rather than guesses", () => {
  it("BREAKS: TWO candidates match nothing - the old code took whichever came first", () => {
    // The pre-fix query was `.limit(1)` with NO ORDER BY: with several
    // candidates it silently marked the estimate against an arbitrary row.
    const out = decide(100_000, PHONE, [
      { id: 4, phoneKey: PHONE, cents: 98_000, dayOffset: 3 },
      { id: 5, phoneKey: PHONE, cents: 101_000, dayOffset: 9 },
    ]);
    expect(out).toBe("ambiguous");
  });

  it("a different customer's invoice is never a candidate", () => {
    expect(decide(50_000, PHONE, [{ id: 6, phoneKey: "9995551234", cents: 50_000, dayOffset: 2 }])).toBeNull();
  });

  it("an invoice BEFORE the estimate is never a candidate", () => {
    // Billing that predates the quote cannot be the quote being accepted.
    expect(decide(50_000, PHONE, [{ id: 7, phoneKey: PHONE, cents: 50_000, dayOffset: -3 }])).toBeNull();
  });

  it("outside the window it stays unmatched", () => {
    expect(decide(50_000, PHONE, [{ id: 8, phoneKey: PHONE, cents: 50_000, dayOffset: MATCH_WINDOW_DAYS }])).toBeNull();
  });

  it("outside the amount band it stays unmatched", () => {
    // The band is what prevents an unrelated later invoice for the same
    // customer becoming a match. Dropping it entirely raised ambiguity from
    // 2 to 11 across the same population.
    expect(decide(100_000, PHONE, [{ id: 9, phoneKey: PHONE, cents: 200_000, dayOffset: 5 }])).toBeNull();
  });

  it("POSITIVE CONTROL: the rule can return all three outcomes", () => {
    // Without this, a `decide` that always returned null would satisfy every
    // negative assertion above.
    const outcomes = new Set([
      typeof decide(50_000, PHONE, [{ id: 1, phoneKey: PHONE, cents: 50_000, dayOffset: 1 }]),
      typeof decide(50_000, PHONE, []),
      decide(50_000, PHONE, [
        { id: 1, phoneKey: PHONE, cents: 50_000, dayOffset: 1 },
        { id: 2, phoneKey: PHONE, cents: 50_000, dayOffset: 2 },
      ]),
    ]);
    expect(outcomes.size).toBe(3);
  });
});

describe("canary - the tuning constants are the measured ones", () => {
  it("45 days, +/-25%", () => {
    // Changing either without re-measuring candidate counts is how a
    // false-positive gets introduced. The measured table is in the source.
    expect(MATCH_WINDOW_DAYS).toBe(45);
    expect(MATCH_AMOUNT_TOLERANCE).toBe(0.25);
  });

  it("BREAKS: the RESCAN window has ONE owner, and it is the shared constant", () => {
    // ROS-093: declinedWorkRecovery texts on a 60-day window. If the matcher
    // rescanned a shorter span, an estimate whose invoice arrived late could
    // never be retired before the customer was texted about work they paid
    // for. The fix was to make BOTH sides import one constant.
    //
    // A second rescan constant defined in the matcher would silently
    // reintroduce that drift, and would be invisible here: the sole call site
    // passes sinceDays explicitly, so a local default governs nothing while
    // still reading like the answer. This asserts the coupling, not a number.
    const src = stripComments(
      readFileSync(join(process.cwd(), "server/services/shopDriverEstimateSync.ts"), "utf-8"),
    );
    expect(src).toMatch(/opts\.sinceDays \?\? DECLINED_RECOVERY_WINDOW_DAYS/);
    expect(src).toMatch(/backfillMatches\(\{ sinceDays: DECLINED_RECOVERY_WINDOW_DAYS \}\)/);
    expect(src).not.toMatch(/MATCH_RESCAN_DAYS/);
  });

  it("the shared window still exceeds the matcher's forward reach", () => {
    // The rescan span must be at least as long as the window an invoice may
    // arrive in, or a match becomes unreachable before it is ever attempted.
    expect(DECLINED_RECOVERY_WINDOW_DAYS).toBeGreaterThanOrEqual(MATCH_WINDOW_DAYS);
  });
});

describe("canary - the ambiguity guard is WIRED, not merely available", () => {
  const src = stripComments(
    readFileSync(join(process.cwd(), "server/services/shopDriverEstimateSync.ts"), "utf-8"),
  );
  const fn = src.slice(src.indexOf("export async function backfillMatches"));

  it("BREAKS: it fetches TWO candidates and orders them deterministically", () => {
    // limit(1) cannot detect ambiguity, and without an ORDER BY the single row
    // it returned was not even stable.
    expect(fn).toMatch(/\.orderBy\(asc\(invoices\.invoiceDate\)\)/);
    expect(fn).toMatch(/\.limit\(2\)/);
    expect(fn).not.toMatch(/\.limit\(1\)/);
  });

  it("more than one candidate SKIPS the write", () => {
    expect(fn).toMatch(/if \(candidates\.length > 1\)/);
    expect(fn).toMatch(/ambiguous\+\+/);
    expect(fn).toMatch(/continue;/);
  });

  it("exactly one is the only path that writes", () => {
    expect(fn).toMatch(/if \(candidates\.length === 1\)/);
  });

  it("ambiguity is REPORTED, not swallowed - a rising count means the band is too loose", () => {
    expect(fn).toMatch(/ambiguous,/);
    expect(src).toMatch(/ambiguous: number;/);
  });

  it("the bounds come from the named constants, not inline literals", () => {
    // Inline 0.9/1.1/30 is how the tuning drifted out of sight in the first
    // place; the constants carry the measurement that justifies them.
    expect(fn).toContain("MATCH_AMOUNT_TOLERANCE");
    expect(fn).toContain("MATCH_WINDOW_DAYS");
  });
});
