/**
 * Codex P1 on #3161: the dismiss sheet sat at z-50 (backdrop z-40) under the BottomTabBar
 * (z-[55]), so on a phone the sheet's Dismiss and Cancel row was covered by the tab bar.
 * Both numbers are read from the source files, so a change to either side breaks this test.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..");
const src = (p: string) => readFileSync(join(root, p), "utf8");

/** z values in a className: z-50 or z-[55]. */
const zOf = (cls: string): number => {
  const m = /(?:^|\s)z-(?:\[(\d+)\]|(\d+))(?=\s|$)/.exec(cls);
  if (!m) throw new Error(`no z class in: ${cls}`);
  return Number(m[1] ?? m[2]);
};

describe("the dismiss sheet layers above the bottom tab bar", () => {
  const bar = src("components/layout/bottom-tab-bar.tsx");
  const barClass = /className="(fixed bottom-0[^"]*)"/.exec(bar)?.[1];
  const sheet = src("components/alerts/alert-dismiss-sheet.tsx");
  // The sheet is a Base UI Dialog: overlayClassName is the backdrop, the DialogContent className the panel.
  const backdropClass = /overlayClassName="([^"]*)"/.exec(sheet)?.[1];
  const panelClass = /<DialogContent[\s\S]*?\sclassName="([^"]*)"/.exec(sheet)?.[1];

  it("is built on the Dialog primitive, not a hand-rolled modal", () => {
    expect(sheet).toContain('from "@/components/ui/dialog"');
    expect(sheet).not.toContain("aria-modal");
  });

  it("found the three classes it compares", () => {
    expect(barClass).toBeTruthy();
    expect(backdropClass).toBeTruthy();
    expect(panelClass).toBeTruthy();
  });

  it("backdrop and panel are strictly above the tab bar, and the panel above its backdrop", () => {
    const tab = zOf(barClass!);
    expect(zOf(backdropClass!)).toBeGreaterThan(tab);
    expect(zOf(panelClass!)).toBeGreaterThan(zOf(backdropClass!));
  });

  it("the panel still clears the safe area", () => {
    expect(panelClass).toContain("safe-area-inset-bottom");
  });

  it("CONTROL: the parser reads both z spellings", () => {
    expect(zOf("fixed z-50 p-2")).toBe(50);
    expect(zOf("fixed z-[71] p-2")).toBe(71);
  });
});
