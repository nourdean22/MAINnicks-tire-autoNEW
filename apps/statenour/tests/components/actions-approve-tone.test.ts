/**
 * /system/actions pending approvals: N requests painted N gold Approve fills (audit 09-X5). Gold is the one
 * deliberate accent, so only the first request gets it; the rest are neutral, and critical stays rose.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { approveTone } from "@/app/(mastery)/system/actions/approve-tone";

const isGold = (cls: string) => /\bbg-accent\b/.test(cls);
const goldCount = (tone: (i: number, critical: boolean) => string, n: number) =>
  Array.from({ length: n }, (_, i) => tone(i, false)).filter(isGold).length;

describe("approveTone", () => {
  it("positive control: a tone that paints every row gold fails the one-gold rule", () => {
    expect(goldCount(() => "bg-accent text-black", 3)).not.toBe(1);
  });

  it("three non-critical requests paint exactly one gold fill, on the first", () => {
    expect(goldCount(approveTone, 3)).toBe(1);
    expect(isGold(approveTone(0, false))).toBe(true);
    expect(approveTone(1, false)).toContain("bg-surface-interactive");
  });

  it("critical requests stay rose wherever they sit", () => {
    for (const i of [0, 1, 2]) {
      expect(approveTone(i, true)).toContain("bg-rose-500");
      expect(isGold(approveTone(i, true))).toBe(false);
    }
  });

  it("the page passes the map index to approveTone", () => {
    const src = readFileSync("app/(mastery)/system/actions/page.tsx", "utf8");
    expect(src).toMatch(/approvals\.map\(\(req: any, index: number\)/);
    expect(src).toContain("approveTone(index, isCritical)");
  });
});
