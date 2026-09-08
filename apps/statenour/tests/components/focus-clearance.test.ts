/**
 * tests/components/focus-clearance.test.ts · 2026-09-08 (section 5.8, WCAG 2.4.11)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { focusClearanceDelta } from "@/lib/ui/focus-clearance";

describe("focusClearanceDelta", () => {
  const chromeTop = 746;
  const vh = 844;
  it("a control already clear of the chrome needs no scroll", () => {
    expect(focusClearanceDelta({ top: 600, bottom: 644 }, chromeTop, vh)).toBe(0);
    expect(focusClearanceDelta({ top: 700, bottom: 746 }, chromeTop, vh)).toBe(0);
  });
  it("a control entirely below the viewport is the browser's job", () => {
    expect(focusClearanceDelta({ top: 900, bottom: 944 }, chromeTop, vh)).toBe(0);
  });
  it("a control under the chrome is lifted past the chrome top plus the gap (the /journal case)", () => {
    expect(focusClearanceDelta({ top: 790, bottom: 834 }, chromeTop, vh)).toBe(834 - 746 + 12);
    expect(focusClearanceDelta({ top: 730, bottom: 774 }, chromeTop, vh)).toBe(774 - 746 + 12);
  });
  it("garbage rects are ignored", () => {
    expect(focusClearanceDelta({ top: Number.NaN, bottom: 800 }, chromeTop, vh)).toBe(0);
  });
  it("is wired: the bottom chrome registers a document focusin handler that uses it", () => {
    const src = readFileSync(join(process.cwd(), "components/layout/bottom-tab-bar.tsx"), "utf8");
    expect(src).toMatch(/addEventListener\("focusin", onFocusIn\)/);
    expect(src).toMatch(/focusClearanceDelta\(el\.getBoundingClientRect\(\), chrome\.getBoundingClientRect\(\)\.top, window\.innerHeight\)/);
    expect(src).toMatch(/removeEventListener\("focusin", onFocusIn\)/);
  });
});
