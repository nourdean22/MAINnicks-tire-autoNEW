/**
 * Every `orderBy` on PersonProfile.lastInteraction must say where NULLs go
 * (2026-09-16, W6).
 *
 * The counter reconcile derives lastInteraction from contact rows, so a
 * never-logged person is NULL — before it, no prod profile had ever been
 * NULL (creation stamped `now`). Postgres puts NULLs FIRST on a bare DESC
 * order, so `orderBy: { lastInteraction: "desc" }` with a `take` cap would
 * fill the brain graph's 5 people, the dossier cron's 5, the Greene-law
 * cron's 8 and the /people default sort with never-contacted profiles and
 * hide everyone real. Unknown sorts LAST, everywhere: the object form
 * `{ sort: "desc", nulls: "last" }` (the repo's autoPriority precedent).
 *
 * Positive control: red on the pre-fix tree — six bare orderings in five
 * files — then green.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const SCAN = ["app", "lib", "components"];
const SKIP = new Set(["node_modules", ".next", "generated"]);

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** A bare direction on lastInteraction, e.g. `lastInteraction: "desc"` or `"asc" as const`. */
const BARE_ORDER = /lastInteraction:\s*"(asc|desc)"/;

export function findBareLastInteractionOrderings(root = ROOT): string[] {
  const hits: string[] = [];
  for (const dir of SCAN) {
    for (const file of walk(path.join(root, dir))) {
      const lines = fs.readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (BARE_ORDER.test(line)) hits.push(`${path.relative(root, file)}:${i + 1}: ${line.trim()}`);
      });
    }
  }
  return hits.sort();
}

describe("lastInteraction orderings declare NULL placement", () => {
  it("no bare `lastInteraction: \"asc\" | \"desc\"` survives under app/, lib/, components/", () => {
    expect(findBareLastInteractionOrderings()).toEqual([]);
  });

  it("the scan sees the object form as compliant and the bare form as a hit (instrument check)", () => {
    expect(BARE_ORDER.test('orderBy: { lastInteraction: { sort: "desc", nulls: "last" } },')).toBe(false);
    expect(BARE_ORDER.test('orderBy: { lastInteraction: "desc" },')).toBe(true);
    expect(BARE_ORDER.test('? { lastInteraction: "asc" as const }')).toBe(true);
    // `where` and `select` never carry a direction string, so they are not hits.
    expect(BARE_ORDER.test("where: { lastInteraction: { not: null } },")).toBe(false);
    expect(BARE_ORDER.test("select: { lastInteraction: true },")).toBe(false);
  });
});
