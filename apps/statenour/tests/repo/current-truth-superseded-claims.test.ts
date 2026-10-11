/**
 * tests/repo/current-truth-superseded-claims.test.ts - audit 01-F4 (2026-10-11).
 *
 * CURRENT-TRUTH.md is append-only, so an old line stays after the tree moves
 * on. A claim the audit found false must carry "superseded" on the same line,
 * or a reader takes it as current. Each pair names one stale claim; every line
 * holding all of a pair's terms must also say superseded. The hierarchy block
 * used to rank app docs above live code; it now points at the root AGENTS.md.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DOC = readFileSync(join(__dirname, "../../docs/CURRENT-TRUTH.md"), "utf8");

const STALE: string[][] = [
  ["formatRegenTelemetry", "no live caller"],
  ["CURRENT LIVE TRUTH", "RealityEvent"],
  ["cockpit bridge", "not merged yet"],
  ["no `operator-brief:*`", "row yet at 14:45Z"],
  ["LIVE + UNPROVEN until the first scored forecast"],
  ["waiting on its first mega-evening run"],
  ["11436", "still runs the prior bytes"],
  ["never ones that NEVER RAN"],
  ["127.0.0.1:11436", "is healthy"],
  ["MERGED + LIVE + VERIFIED locally on NattyNour"],
  ["Still unfinished at this checkpoint", "bridge PR/CI/merge"],
];

/** Lines holding every term of a pair that do NOT say superseded. */
function unmarked(text: string, terms: string[]): string[] {
  return text.split("\n").filter((l) => terms.every((t) => l.includes(t)) && !/superseded/i.test(l));
}

describe("CURRENT-TRUTH marks the claims the audit found stale", () => {
  it("CONTROL: the doc is the real file and the matcher finds an unmarked line in a fixture", () => {
    expect(DOC).toContain("# CURRENT-TRUTH.md");
    expect(unmarked("a\n- x has no live caller\nb", ["no live caller"])).toHaveLength(1);
    expect(unmarked("- x has no live caller (superseded 2026-10-11)", ["no live caller"])).toHaveLength(0);
  });

  it.each(STALE.map((t) => [t.join(" + "), t] as const))("%s: every matching line says superseded", (_label, terms) => {
    expect(unmarked(DOC, terms)).toEqual([]);
  });

  it("the hierarchy section defers to the root AGENTS.md instead of ranking app docs above live code", () => {
    const start = DOC.indexOf("## Source-of-truth hierarchy");
    expect(start).toBeGreaterThan(-1);
    const section = DOC.slice(start, DOC.indexOf("\n## ", start + 1));
    expect(section).toContain("../../AGENTS.md");
    expect(section).not.toMatch(/^1\. `apps\/statenour\/AGENTS\.md`/m);
  });
});
