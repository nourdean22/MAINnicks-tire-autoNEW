/**
 * Canaries for the declined-work ledger's honesty (2026-08-25).
 *
 * MEASURED against production. getDeclinedWorkLedger() and
 * getDeclinedWorkStats() both read `work_orders` (1 row) and
 * `work_order_items` (0 rows). The ledger loop does
 * `if (items.length === 0) continue;`, so with no item rows it can only ever
 * return []. The stats query can only ever sum to 0.
 *
 * That zero was published as though it were a measurement: statenourSync sent
 * `declinedWork.totalRecoverable: 0` under a section commented "revenue on the
 * table", and nour-os-bridge sent `declinedValue30d: 0`.
 *
 * THE TWIN JOBS that make this visible: two crons run seconds apart every day.
 * `alg-declined-work-recovery` sends the SMS - 14 sends across its last 7 runs.
 * `declined-work-recovery` is the ledger - "0 unrecovered ($0), 0 safety" on
 * EVERY run. They disagree, and the one reporting zero is the one feeding the
 * operator's dashboards.
 *
 * WHAT THIS SUITE DOES NOT CLAIM: that $375,744 of unmatched estimates is
 * "declined work being reported as $0". An unmatched estimate is not the same
 * business fact as a line item declined at the counter. The claim is narrower
 * and provable - the number cannot be non-zero, so it is not evidence of
 * anything.
 *
 * SYNTHETIC INPUTS ONLY - sourceStateFrom is driven with plain numbers.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

import {
  sourceStateFrom,
  isMeasured,
  sourceNote,
  type DeclinedSourceState,
} from "./services/declinedWorkSource";

function stripComments(t: string): string {
  return t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("canary - an unreadable count is never a confident zero", () => {
  it("BREAKS: null reads as unknown, NOT empty", () => {
    // Number(null) === 0 in JS, which is precisely how a failed read becomes
    // "nothing to recover". This app has been bitten by that exact coercion.
    expect(sourceStateFrom(null)).toBe("unknown");
    expect(sourceStateFrom(undefined)).toBe("unknown");
  });

  it("BREAKS: the guard is Number.isFinite, not the coercing global isFinite", () => {
    // isFinite(null) is TRUE - the global coerces - so swapping the two turns
    // an unreadable count into a confident zero. Found by mutation probe: an
    // explicit null check placed above this guard was dead code, and its
    // canary scored green when deleted.
    const src = readFileSync(
      join(process.cwd(), "server/services/declinedWorkSource.ts"), "utf-8",
    ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(src).toContain("Number.isFinite(");
    expect(src).not.toMatch(/[^.\w]isFinite\(/);
  });

  it("NaN is unknown, not empty", () => {
    expect(sourceStateFrom(Number.NaN)).toBe("unknown");
  });

  it("a negative count is unknown - it cannot be a real row count", () => {
    expect(sourceStateFrom(-1)).toBe("unknown");
  });

  it("zero declined rows is EMPTY - the subsystem is unpopulated", () => {
    // The production value on 2026-08-25.
    expect(sourceStateFrom(0)).toBe("empty");
  });

  it("any declined rows makes the total a real measurement", () => {
    expect(sourceStateFrom(1)).toBe("populated");
    expect(sourceStateFrom(4200)).toBe("populated");
  });

  it("POSITIVE CONTROL: all three states are reachable", () => {
    // Without this, a sourceStateFrom that always returned "unknown" would
    // satisfy every assertion about unknown above.
    expect(new Set([sourceStateFrom(null), sourceStateFrom(0), sourceStateFrom(1)]).size).toBe(3);
  });
});

describe("canary - only a populated source counts as measured", () => {
  it("BREAKS: empty and unknown are BOTH unmeasured", () => {
    // Collapsing "unknown" into "measured" is the failure this exists to stop:
    // it would publish a failed read as a confident $0.
    expect(isMeasured("populated")).toBe(true);
    expect(isMeasured("empty")).toBe(false);
    expect(isMeasured("unknown")).toBe(false);
  });

  it("every state carries a note that says NOT ZERO where that is the point", () => {
    for (const s of ["empty", "unknown"] as DeclinedSourceState[]) {
      expect(sourceNote(s), `${s} must disclaim zero`).toMatch(/not zero/i);
    }
    expect(sourceNote("populated")).not.toMatch(/not zero/i);
  });
});

describe("canary - the flag is WIRED into what actually gets published", () => {
  const sync = stripComments(
    readFileSync(join(process.cwd(), "server/cron/jobs/statenourSync.ts"), "utf-8"),
  );
  const bridge = stripComments(
    readFileSync(join(process.cwd(), "server/nour-os-bridge.ts"), "utf-8"),
  );

  it("BREAKS: statenourSync publishes `measured` alongside the total", () => {
    // Assert the import specifier AND the call - a local helper of the same
    // name would satisfy an identifier-only check.
    expect(sync).toContain('"../../services/declinedWorkSource"');
    expect(sync).toMatch(/measured: isMeasured\(sourceState\)/);
    expect(sync).toMatch(/await declinedWorkSourceState\(\)/);
  });

  it("statenourSync still publishes the original numeric keys, unchanged", () => {
    // The flag is additive on purpose. statenour is a separate app this
    // session may not edit; changing a field's type would break its consumer.
    expect(sync).toMatch(/totalRecoverable: unrecovered\.reduce/);
    expect(sync).toMatch(/customerCount: unrecovered\.length/);
  });

  it("BREAKS: the NOUR OS bridge publishes the flag too", () => {
    expect(bridge).toContain('"./services/declinedWorkSource"');
    expect(bridge).toMatch(/declinedMeasured30d: isMeasured\(declinedSource\)/);
    expect(bridge).toMatch(/declinedValue30d: declined\.totalDeclinedValue/);
  });

  it("an unmeasured source is logged, not silently swallowed", () => {
    expect(sync).toMatch(/if \(!isMeasured\(sourceState\)\) log\.warn/);
  });

  it("BREAKS: the state reader cannot throw into the cron", () => {
    // A source-state probe that threw would take down the whole statenour
    // sync, which is a far worse outcome than an unflagged number.
    const src = stripComments(
      readFileSync(join(process.cwd(), "server/services/declinedWorkSource.ts"), "utf-8"),
    );
    const fn = src.slice(src.indexOf("export async function declinedWorkSourceState"));
    expect(fn).toContain("try {");
    expect(fn).toMatch(/catch\s*\{\s*return "unknown";\s*\}/);
  });
});
