/**
 * Canaries for the margin coverage guard (2026-08-25).
 *
 * THE DEFECT, measured against production in this function's exact 6-month
 * window: 711 paid invoices, 179 (25.2%) carrying any cost detail. The
 * unguarded formula `revenue - parts - labor` reported **76%**; the same maths
 * restricted to invoices that carry cost detail gives **7%**. 532 invoices had
 * partsCost=0 AND laborCost=0, each contributing a free 100% margin.
 *
 * Root cause is upstream: ShopDriver invoices carried cost detail at ~100%
 * through 2026-03, collapsed across April 2026 (33/56 -> 9/31 -> 1/33 -> 0/23
 * by week), and have been at 0% since May.
 *
 * FIXTURE, NOT LIVE DATA. Every assertion below runs against a synthetic set
 * calibrated to reproduce those two numbers exactly. Asserting against the
 * live table would stop testing anything the moment coverage recovers - and
 * would also make the test's meaning depend on production state.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

import {
  summariseMargins,
  MIN_COST_DETAIL_COVERAGE,
  type MarginInvoiceRow,
} from "./services/engines/revenue";

/**
 * 25 invoices, 6 carrying cost detail (24% coverage - below the 80% floor).
 *
 * Calibrated so the OLD formula lands on exactly 76%, matching what production
 * reported on 2026-08-25:
 *   covered revenue   100,000c   cost 93,000c  -> honest margin 7%
 *   uncovered revenue 287,500c   cost      0c
 *   old: (387,500 - 93,000) / 387,500 = 76.0%
 */
function fixture(): MarginInvoiceRow[] {
  const rows: MarginInvoiceRow[] = [];
  // 6 covered invoices: together 100,000c revenue, 93,000c parts+labor.
  for (let i = 0; i < 6; i++) {
    rows.push({
      totalAmount: 100_000 / 6,
      partsCost: 60_000 / 6,
      laborCost: 33_000 / 6,
      serviceDescription: "brake pads and rotors",
    });
  }
  // 19 uncovered invoices: 287,500c revenue, no cost detail at all.
  for (let i = 0; i < 19; i++) {
    rows.push({
      totalAmount: 287_500 / 19,
      partsCost: 0,
      laborCost: 0,
      serviceDescription: "brake pads and rotors",
    });
  }
  return rows;
}

/**
 * POSITIVE CONTROL - the exact computation that shipped before this change.
 * If this ever stops returning ~76 on the fixture, the fixture no longer
 * reproduces the defect and every assertion below is vacuous.
 */
function unguardedMarginPct(rows: MarginInvoiceRow[]): number {
  let rev = 0;
  let cost = 0;
  for (const r of rows) {
    rev += (r.totalAmount || 0) / 100;
    cost += ((r.partsCost || 0) + (r.laborCost || 0)) / 100;
  }
  return rev > 0 ? Math.round(((rev - cost) / rev) * 100) : 0;
}

describe("canary - the fixture actually reproduces the defect", () => {
  it("POSITIVE CONTROL: the OLD formula returns 76% on this fixture", () => {
    // This is the number the operator's morning brief was scoring on.
    expect(unguardedMarginPct(fixture())).toBe(76);
  });

  it("the fixture's honest margin really is 7%", () => {
    const covered = fixture().filter((r) => (r.partsCost || 0) > 0 || (r.laborCost || 0) > 0);
    expect(unguardedMarginPct(covered)).toBe(7);
  });

  it("the fixture sits below the coverage floor, which is what makes it a test", () => {
    const rows = fixture();
    const covered = rows.filter((r) => (r.partsCost || 0) > 0 || (r.laborCost || 0) > 0).length;
    expect(covered / rows.length).toBeLessThan(MIN_COST_DETAIL_COVERAGE);
  });
});

describe("canary - the guard refuses rather than reporting a number", () => {
  it("BREAKS: 24% coverage returns null, not 76", () => {
    const out = summariseMargins(fixture());
    expect(out.overallMargin).toBeNull();
    expect(out.basis).toBe("insufficient-coverage");
  });

  it("and reports the coverage percentage so a consumer can say WHY", () => {
    const out = summariseMargins(fixture());
    expect(out.coveragePct).toBe(24);
    expect(out.costDetailCount).toBe(6);
    expect(out.invoiceCount).toBe(25);
  });

  it("null is NOT zero - a consumer can tell them apart", () => {
    const out = summariseMargins(fixture());
    expect(out.overallMargin).not.toBe(0);
    expect(out.overallMargin).toBeNull();
  });

  it("PASSES: at or above the floor it reports the covered-basis margin", () => {
    // Same 7% covered economics, now with enough coverage to publish.
    const rows: MarginInvoiceRow[] = [];
    for (let i = 0; i < 20; i++) {
      rows.push({ totalAmount: 5_000, partsCost: 3_000, laborCost: 1_650, serviceDescription: "brakes" });
    }
    for (let i = 0; i < 3; i++) {
      rows.push({ totalAmount: 5_000, partsCost: 0, laborCost: 0, serviceDescription: "brakes" });
    }
    const out = summariseMargins(rows);
    expect(out.coveragePct).toBe(87); // 20/23
    expect(out.basis).toBe("cost-detail");
    expect(out.overallMargin).toBe(7);
  });

  it("the published margin uses COVERED revenue as the denominator, not total", () => {
    // weeklyRevenueDigest's first fix divided covered parts by TOTAL revenue and
    // still rendered ~99% with 1 of 32 covered. Same trap, pinned here.
    const rows: MarginInvoiceRow[] = [
      { totalAmount: 10_000, partsCost: 9_000, laborCost: 0, serviceDescription: "x" },
      ...Array.from({ length: 9 }, () => ({ totalAmount: 10_000, partsCost: 0, laborCost: 0, serviceDescription: "x" })),
    ];
    const out = summariseMargins(rows);
    // 10% coverage -> refuses. If it ever published, dividing by total revenue
    // would give 91% instead of the covered-basis 10%.
    expect(out.overallMargin).toBeNull();
    expect(out.coveragePct).toBe(10);
  });

  it("zero invoices is insufficient coverage, not a 0% margin", () => {
    const out = summariseMargins([]);
    expect(out.overallMargin).toBeNull();
    expect(out.basis).toBe("insufficient-coverage");
    expect(out.coveragePct).toBe(0);
  });

  it("a per-service margin with no cost detail is null, not 100%", () => {
    const rows: MarginInvoiceRow[] = Array.from({ length: 10 }, () => ({
      totalAmount: 10_000, partsCost: 0, laborCost: 0, serviceDescription: "oil change",
    }));
    const out = summariseMargins(rows);
    const svc = out.byService.find((s) => s.marginPercent !== undefined);
    expect(svc?.marginPercent).toBeNull();
    expect(svc?.margin).toBeNull();
  });

  it("BREAKS: a per-service margin obeys the SAME floor as the overall one", () => {
    // Self-audit caught this. The first draft published a category margin as
    // soon as ANY invoice in it carried cost detail, so a category at 1-of-50
    // still printed a number - the same defect one level down, and reachable
    // even while the overall basis said "insufficient-coverage".
    //
    // The fixture's single category is 6 covered / 19 not = 24%, below the
    // floor, so every per-service figure must be null.
    const out = summariseMargins(fixture());
    for (const svc of out.byService) {
      expect(svc.marginPercent, `${svc.service} published a margin at 24% coverage`).toBeNull();
      expect(svc.margin).toBeNull();
    }
  });

  it("naming a best/worst service is refused on the same grounds", () => {
    // Naming a "best margin service" while refusing to state a margin is the
    // same claim at smaller scale.
    expect(summariseMargins(fixture()).bestMarginService).toBe("N/A");
    expect(summariseMargins(fixture()).worstMarginService).toBe("N/A");
  });

  it("PASSES: a category that clears the floor IS named and IS measured", () => {
    // The positive half - without this the two assertions above would pass on
    // a function that simply returned N/A and null for everything.
    const rows: MarginInvoiceRow[] = [
      ...Array.from({ length: 9 }, () => ({ totalAmount: 10_000, partsCost: 6_000, laborCost: 1_000, serviceDescription: "brake pads" })),
      { totalAmount: 10_000, partsCost: 0, laborCost: 0, serviceDescription: "brake pads" },
    ];
    const out = summariseMargins(rows);
    expect(out.coveragePct).toBe(90);
    expect(out.bestMarginService).not.toBe("N/A");
    expect(out.byService[0].marginPercent).toBe(30); // (90k - 63k) / 90k
  });
});

/**
 * Strip line and block comments before asserting the ABSENCE of a pattern.
 *
 * Both absence assertions below failed on their first run against this file's
 * own explanatory comments - the same mention-vs-execution false positive
 * guard-red-team names, and the fourth time it has bitten in this codebase. A
 * check that fails on its own documentation gets deleted by the next reader.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("canary - the consumer cannot silently re-fabricate the number", () => {
  const master = stripComments(readFileSync(join(process.cwd(), "server/services/masterIntelligence.ts"), "utf-8"));

  it("BREAKS: the `|| 50` fallback is gone", () => {
    // This is a SOURCE assertion, deliberately, and its limits are stated: it
    // guards against textual reintroduction, not against an equivalent written
    // another way. It exists because `num(margins, ...) || 50` turned an
    // unknown margin into 50, which clamp(round((50-30)*0.4), -8, 8) scores as
    // +8 - the MAXIMUM for this component - while printing "50% average
    // margin". Unknown rendered as best-possible on the operator's brief.
    const marginBlock = master.slice(master.indexOf("if (margins) {"));
    const block = marginBlock.slice(0, marginBlock.indexOf("if (anomalies)"));
    expect(block).not.toMatch(/\|\|\s*50/);
  });

  it("the margin branch reads overallMargin and type-checks it", () => {
    const marginBlock = master.slice(master.indexOf("if (margins) {"));
    const block = marginBlock.slice(0, marginBlock.indexOf("if (anomalies)"));
    expect(block).toContain("margins.overallMargin");
    expect(block).toMatch(/typeof avgMargin === "number"/);
  });

  it("an unmeasurable margin scores ZERO and is flagged hasData:false", () => {
    const marginBlock = master.slice(master.indexOf("if (margins) {"));
    const block = marginBlock.slice(0, marginBlock.indexOf("if (anomalies)"));
    // Neither rewards nor punishes the shop for a data gap.
    expect(block).toMatch(/record\("Margin health", 0, 8, reason, false\)/);
    expect(block).toContain("insufficient cost-detail coverage");
  });

  it("a query failure reads as unavailable, not as 0%", () => {
    const revenue = stripComments(readFileSync(join(process.cwd(), "server/services/engines/revenue.ts"), "utf-8"));
    const start = revenue.indexOf("export async function analyzeProfitMargins");
    // Bound the slice to THIS function - other engines have their own catch
    // blocks and would otherwise be swept into the assertion.
    const tail = revenue.slice(start, revenue.indexOf(String.fromCharCode(10) + "// ", start));
    expect(tail).toContain('basis: "unavailable" as const');
    expect(tail).not.toMatch(/overallMargin:\s*0\b/);
  });
});
