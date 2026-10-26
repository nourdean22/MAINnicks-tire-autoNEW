/**
 * tests/components/missions-sheets-above-chrome.test.ts · 2026-10-26
 *
 * Nour, iPhone PWA, /missions: "I can't scroll down to get to the delete or save
 * button and the notification ribbon covered it up". The bottom chrome (tab bar plus
 * the pulse ticker that showed "MIND self-model 53/100") is a fixed element at the
 * bottom of the viewport with its own z-index. A bottom sheet whose sticky action bar
 * sits at that same edge must stack ABOVE the chrome, or the chrome paints over the
 * buttons and no amount of scrolling reveals them. The More sheet and the alert
 * dismiss sheet already stack above it (overlay z-[70], sheet z-[71]); the two
 * Missions sheets sat at z-50 / z-[51], under the chrome's z-[55].
 *
 * Source-reading, like focus-clearance.test.ts: the numbers are read from the real
 * files, so a future chrome z-index bump fails this test instead of hiding the bar.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

function zOf(src: string, re: RegExp, what: string): number {
  const m = src.match(re);
  if (!m) throw new Error(`${what}: no z-index match for ${re}`);
  return Number(m[1]);
}

const CHROME = "components/layout/bottom-tab-bar.tsx";
const SHEETS = [
  "components/missions/task-edit-sheet.tsx",
  "components/missions/mission-edit-drawer.tsx",
];

const chromeZ = zOf(
  read(CHROME),
  /className="fixed bottom-0 left-0 right-0 z-\[(\d+)\]"/,
  CHROME,
);

// The house Dialog primitive: the Delete button opens a confirm dialog from INSIDE the
// sheet. It is portalled later in the DOM, so it paints above the sheet only while its
// z-index is at least the sheet's. A sheet raised past it would hide its own confirm.
const dialogZ = zOf(
  read("components/ui/dialog.tsx"),
  /"fixed top-auto sm:top-1\/2 bottom-4 sm:bottom-auto left-1\/2 z-\[(\d+)\]/,
  "components/ui/dialog.tsx content",
);

describe("Missions edit sheets stack above the bottom chrome", () => {
  it("reads the bottom chrome and dialog z-indexes from the real files", () => {
    expect(chromeZ).toBeGreaterThan(0);
    expect(dialogZ).toBeGreaterThan(chromeZ);
  });

  for (const file of SHEETS) {
    it(`${file}: overlay and sheet sit above the chrome (z ${chromeZ}) and not above the confirm dialog (z ${dialogZ})`, () => {
      const src = read(file);
      const overlayZ = zOf(src, /overlayClassName="z-\[?(\d+)\]? /, `${file} overlay`);
      const sheetZ = zOf(
        src,
        /className=\{cn\(\s*"fixed inset-x-0 bottom-0 z-\[(\d+)\]/,
        `${file} sheet`,
      );
      expect(overlayZ).toBeGreaterThan(chromeZ);
      expect(sheetZ).toBeGreaterThanOrEqual(overlayZ);
      expect(sheetZ).toBeLessThanOrEqual(dialogZ);
    });

    it(`${file}: the sheet body scrolls on its own, not the page behind it`, () => {
      expect(read(file)).toMatch(
        /fixed inset-x-0 bottom-0 z-\[\d+\] max-h-\[90dvh\] overflow-y-auto overscroll-contain /,
      );
    });
  }
});
