/**
 * Warranty truth pins — ROS-043 close-out (2026-07-25).
 *
 * The shop's printed invoice (mirrored on /warranties and BUSINESS.warranty)
 * grants ONE repair promise: shop-installed PARTS 12 months, shop LABOR 90
 * days, NO mileage cap, NO road hazard unless expressly in writing. Used
 * tires: 7-day defect-only replacement. Everything below pins the surfaces
 * that used to fabricate richer terms (12k-mile caps, 24mo/24k brakes,
 * 36-month batteries) so the fiction cannot regrow.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const FABRICATED = /12,000[- ]mile|12 months \/ 12,000|12mo\/12k|24,000 miles|24 months \/ 24,000|36-month free replacement/;

describe("AI prompts state the real warranty", () => {
  for (const file of [
    "server/gemini.ts",
    "server/_core/index.ts",
    "server/services/adStudio/adCopyGen.ts",
    "server/services/gbpContentGenerator.ts",
  ]) {
    it(`${file} carries no fabricated terms and states parts/labor split`, () => {
      const s = read(file);
      expect(s).not.toMatch(FABRICATED);
      expect(s).toMatch(/12-month parts \/ 90-day labor/);
    });
  }
});

describe("SEO surfaces match the invoice", () => {
  it("the /warranties route meta says parts/labor, never a mileage cap", () => {
    const s = read("shared/routes.ts");
    const entry = s.slice(s.indexOf('path: "/warranties"'), s.indexOf('path: "/tire-rebates"'));
    expect(entry).toMatch(/12-Month Parts \/ 90-Day Labor/);
    expect(entry).not.toMatch(/12,000|12k-mile/);
  });

  it("the committed prerendered /warranties HTML carries no 12k-mile claim", () => {
    expect(read("prerendered/warranties/index.html")).not.toMatch(/12k-mile|12,000-mile/);
  });

  it("the /warranties page tells the used-tire truth (7-day defect-only)", () => {
    expect(read("client/src/pages/Warranties.tsx")).toMatch(/7-day limited replacement warranty/);
  });

  it("the estimate-comparison guide no longer endorses terms longer than the shop's own", () => {
    expect(read("shared/guides.ts")).not.toMatch(/24 months or 24,000 miles is offering more value/);
  });
});
