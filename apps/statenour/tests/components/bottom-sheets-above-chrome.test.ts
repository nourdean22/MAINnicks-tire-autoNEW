/**
 * tests/components/bottom-sheets-above-chrome.test.ts · 2026-10-27 (bug hunt)
 *
 * PR 3315 raised the two Missions edit sheets above the fixed bottom chrome
 * (tab bar plus pulse ticker, z-[55]) because the chrome painted over Save and
 * Delete on an iPhone. It fixed those two files by name and left their siblings:
 * the person edit drawer and the mission retro modal were still at z-50 / z-[51],
 * so the same chrome covered their action bars.
 *
 * This is the class sweep, not a second pair of file names: every component that
 * renders a bottom sheet (`fixed inset-x-0 bottom-0 z-[N]`) must sit above the
 * chrome, and so must the overlay beside it. Source-reading, like
 * missions-sheets-above-chrome.test.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(root, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(root, rel)).isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      walk(rel, out);
    } else if (name.endsWith(".tsx") && !name.endsWith(".test.tsx")) out.push(rel);
  }
  return out;
}

const chromeZ = Number(
  read("components/layout/bottom-tab-bar.tsx").match(/fixed bottom-0 left-0 right-0 z-\[(\d+)\]/)?.[1],
);

const SHEET_Z = /fixed inset-x-0 bottom-0 z-\[(\d+)\]/g;
const OVERLAY_Z = /overlayClassName="z-\[?(\d+)\]?[ "]/g;

const sheets: Array<{ file: string; sheetZ: number[]; overlayZ: number[] }> = [];
for (const file of [...walk("components"), ...walk("app"), ...walk("features")]) {
  const src = read(file);
  const sheetZ = [...src.matchAll(SHEET_Z)].map((m) => Number(m[1]));
  if (sheetZ.length === 0) continue;
  sheets.push({ file, sheetZ, overlayZ: [...src.matchAll(OVERLAY_Z)].map((m) => Number(m[1])) });
}

describe("every bottom sheet stacks above the bottom chrome", () => {
  it("found the chrome and the known sheets (the scanner located its subject)", () => {
    expect(chromeZ).toBeGreaterThan(0);
    const files = sheets.map((s) => s.file);
    expect(files).toContain("components/missions/task-edit-sheet.tsx");
    expect(files).toContain("components/missions/mission-edit-drawer.tsx");
    expect(files).toContain("components/relationships/person-edit-drawer.tsx");
    expect(files).toContain("components/missions/mission-retro-modal.tsx");
  });

  for (const known of [
    "components/relationships/person-edit-drawer.tsx",
    "components/missions/mission-retro-modal.tsx",
  ]) {
    it(`${known} reads at least one overlay z-index (so the overlay assertion below is not vacuous)`, () => {
      expect(sheets.find((s) => s.file === known)?.overlayZ.length ?? 0).toBeGreaterThan(0);
    });
  }

  it("no bottom sheet or its overlay sits at or below the chrome", () => {
    const under = sheets.flatMap((s) => [
      ...s.sheetZ.filter((z) => z <= chromeZ).map((z) => `${s.file}: sheet z-[${z}]`),
      ...s.overlayZ.filter((z) => z <= chromeZ).map((z) => `${s.file}: overlay z-${z}`),
    ]);
    expect(under, `chrome is z-[${chromeZ}]; these paint under it`).toEqual([]);
  });
});
