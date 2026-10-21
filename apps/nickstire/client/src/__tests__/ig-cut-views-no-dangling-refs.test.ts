/**
 * W3 prune (2026-10-19) cut Community/Inbox, the Planning board (DraftBoardPanel, DraftCard,
 * PublishDrawer) and Pattern Lab. Nothing in the client may import them again, and no screen text
 * may send the operator to a place that no longer exists (CampaignPackageCard used to say
 * "Open the Drafts tab to render slides and publish" after the tab was gone).
 *
 * Comments are stripped first: the cut names legitimately appear in history notes. Only code and
 * rendered text are checked.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SRC = path.join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

const FILES = sourceFiles(SRC).map((f) => ({ rel: path.relative(SRC, f).replace(/\\/g, "/"), text: code(f) }));

const CUT_MODULES = [
  /instagram\/Inbox["']/, /["']\.\/Inbox["']/,
  /DraftBoardPanel["']/, /\/DraftCard["']/, /["']\.\/DraftCard["']/, /PublishDrawer["']/,
  /instagram\/PatternLab["']/, /["']\.\/PatternLab["']/,
];
const DEAD_DIRECTIONS = /Draft Board|Drafts tab|Planning board|Open the Drafts|Community.{1,3}Sync/;

describe("nothing in the client reaches a cut Instagram surface", () => {
  it("scans a real tree (positive control: the shell and Controls are in the scan)", () => {
    const rel = FILES.map((f) => f.rel);
    expect(rel).toContain("pages/admin/instagram/InstagramAdmin.tsx");
    expect(rel).toContain("pages/admin/instagram/Controls.tsx");
    expect(FILES.length).toBeGreaterThan(200);
  });

  it("no source imports a removed component", () => {
    const hits = FILES.flatMap((f) => CUT_MODULES.filter((re) => re.test(f.text)).map((re) => `${f.rel}: ${re}`));
    expect(hits).toEqual([]);
  });

  it("no screen text points at the Draft Board, the Drafts tab or the Planning board", () => {
    const hits = FILES.filter((f) => DEAD_DIRECTIONS.test(f.text)).map((f) => f.rel);
    expect(hits).toEqual([]);
  });

  it("positive control: the dead-direction pattern does catch the old CampaignPackageCard wording", () => {
    expect(DEAD_DIRECTIONS.test('description: "Open the Drafts tab to render slides and publish."')).toBe(true);
    expect(DEAD_DIRECTIONS.test('"Draft carousel to Draft Board"')).toBe(true);
    expect(CUT_MODULES.some((re) => re.test('import DraftBoardPanel from "../DraftBoardPanel";'))).toBe(true);
  });
});
