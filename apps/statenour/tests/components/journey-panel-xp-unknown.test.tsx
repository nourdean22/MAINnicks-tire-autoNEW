/**
 * Brain FU6: the Journey lens's XP section renders an unread window as UNKNOWN.
 *
 * THE DEFECT. With the XP read failed the lens sent `{ current30: 0, prior30: 0 }` and
 * enoughData false, and the panel printed "No XP events in either window yet.", a measured empty
 * month. The lens now flags the section `unknown: true`; the line says unknown and gives no total, no
 * growth and no "no XP" claim. The MEASURED-ZERO control keeps the quiet-month line.
 *
 * Wave E2 (2026-10-24): the Journey panel merged into the Stats verdict, so this canary now pins the
 * verdict's trend line (components/stats/stats-verdict.tsx journeyXpLine); the rendered line is pinned
 * in tests/components/stats/stats-e2-structure.test.tsx.
 */
import { describe, expect, it } from "vitest";
import { journeyXpLine, type JourneyXp } from "@/components/stats/stats-verdict";

const xp = (extra: Partial<JourneyXp> = {}): JourneyXp => ({
  enoughData: false,
  data: { current30: 0, prior30: 0, growthPct: null },
  ...extra,
});

describe("journeyXpLine", () => {
  it("control: a measured empty month keeps the quiet-month line and no unknown line", () => {
    const text = journeyXpLine(xp());
    expect(text).toBe("No XP events in either 30 day window yet.");
    expect(text).not.toMatch(/couldn.t be read/i);
  });

  it("control: real XP shows totals and growth", () => {
    const text = journeyXpLine(xp({ enoughData: true, data: { current30: 150, prior30: 100, growthPct: 50 } }));
    expect(text).toBe("150 XP in the last 30 days, 100 the 30 before (+50%).");
  });

  it("no prior baseline: says so instead of inventing a growth percent", () => {
    const text = journeyXpLine(xp({ enoughData: true, data: { current30: 40, prior30: 0, growthPct: null } }));
    expect(text).toMatch(/no earlier baseline/);
    expect(text).not.toMatch(/%/);
  });

  it("an unread window says unknown: no total, no growth, no quiet-month claim", () => {
    const text = journeyXpLine(xp({ unknown: true }));
    expect(text).toMatch(/couldn.t be read/i);
    expect(text).toMatch(/not a quiet month/i);
    expect(text).not.toMatch(/No XP events/);
    expect(text).not.toMatch(/\b0 XP\b/);
  });
});
