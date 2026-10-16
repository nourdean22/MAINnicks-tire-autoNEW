/**
 * UI v3 W1a review round 3, items 3 and 4.
 *
 * 3. Commit A removed the uppercase transform that used to hide a .toLowerCase() on stored names, so
 *    authored titles rendered lowercase ("nour os", "nick's tire"). A stored name or title is rendered as
 *    written; enum values (status, energy, a domain abbreviation) may still be lowercased.
 * 4. A `disabled` empty option is a placeholder, right only where empty is not a saved value. Conviction
 *    saves "" as null, so its empty option is a real choice, "No conviction", and stays enabled.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("stored names and titles render as authored", () => {
  it("no mission title, board name or advisor name is lowercased on render", () => {
    const hits: string[] = [];
    for (const f of ["components/actions/loop-row-item.tsx", "components/brain/board-tab.tsx"]) {
      for (const m of read(f).matchAll(/\b(?:title|boardName|advisorName|name)\.toLowerCase\(\)/g)) hits.push(`${f}: ${m[0]}`);
    }
    expect(hits).toEqual([]);
  });
});

describe("goal-board empty options", () => {
  const src = read("components/goals/goal-board.tsx");

  it("conviction keeps an enabled No conviction option, because empty saves as null", () => {
    expect(src).toMatch(/<option value="">No conviction<\/option>/);
    expect(src).not.toMatch(/<option value="" disabled>Pick a conviction<\/option>/);
    expect(src).toMatch(/payload\.conviction = editConviction \? parseInt\(editConviction, 10\) : null;/);
  });

  it("domain and status keep disabled placeholders, because an empty value is never saved for them", () => {
    expect(src).toMatch(/<option value="" disabled>Pick a domain<\/option>/);
    expect(src).toMatch(/<option value="" disabled>Pick a status<\/option>/);
    expect(src).toMatch(/if \(editDomain\)/);
    expect(src).toMatch(/if \(editStatus\)/);
  });
});
