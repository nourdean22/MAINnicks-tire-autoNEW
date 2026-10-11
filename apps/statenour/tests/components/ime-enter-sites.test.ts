/**
 * Single-line Enter submits outside chat go through isSubmitEnter() (audit 09-F9).
 *
 * Nine plain `e.key === "Enter"` submits in eight files had no IME guard: the Enter that confirms a
 * Japanese, Chinese or Korean candidate (Safari reports it only as keyCode 229) submitted a half-typed
 * entry. Each site now calls isSubmitEnter(e) with no options (single-line: no newline to protect).
 *
 * Left alone on purpose: role="button" Enter-or-Space activators (`e.key === "Enter" || e.key === " "`),
 * the goal-board progress log (a type="number" input, no IME composition) and the calibration
 * shortcut in components/stats (not a text submit).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");

/** file -> how many submits it must route through isSubmitEnter(). */
const SITES: Record<string, number> = {
  "components/goals/goal-board.tsx": 1,
  "components/brain/qualitative-identity-panel.tsx": 1,
  "components/missions/mission-card.tsx": 1,
  "components/journal/thread-rail.tsx": 1,
  "components/actions/task-filters.tsx": 1,
  "components/actions/mode-learn.tsx": 1,
  "components/settings/ai-settings-panel.tsx": 1,
  "components/actions/loop-row-item.tsx": 2,
};

/** Code only: a comment line that names the old check is not a site (blanked, so line numbers hold). */
const code = (src: string) =>
  src
    .split("\n")
    .map((line) => (/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line) ? "" : line))
    .join("\n");

/**
 * Raw Enter checks that are not an Enter-or-Space activator and not on a number input. A number input
 * is recognised by `type="number"` in the eight lines above the check (the JSX props of its <Input>).
 */
function rawEnterSites(src: string): number[] {
  const lines = code(src).split("\n");
  const hits: number[] = [];
  lines.forEach((line, i) => {
    // `e.key === "Enter"`, `==`, `e.code`, the operands swapped, or a `case "Enter":` in a switch on the key.
    for (const m of line.matchAll(/\.(?:key|code)\s*===?\s*["']Enter["']|["']Enter["']\s*===?\s*\w+\.(?:key|code)\b|\bcase\s+["']Enter["']\s*:/g)) {
      const rest = line.slice((m.index ?? 0) + m[0].length);
      if (/^\s*\|\|\s*\w+\.key\s*===\s*["'] ["']/.test(rest)) continue;
      if (/type="number"/.test(lines.slice(Math.max(0, i - 8), i).join("\n"))) continue;
      hits.push(i + 1);
    }
  });
  return hits;
}

const calls = (src: string) => (code(src).match(/\bisSubmitEnter\(/g) ?? []).length;

describe("09-F9: single-line Enter submits carry the IME guard", () => {
  it.each(Object.entries(SITES))("%s routes its submit through isSubmitEnter() with no raw Enter check", (file, n) => {
    const src = readFileSync(join(ROOT, file), "utf8");
    expect(rawEnterSites(src), `raw Enter submit at line(s) of ${file}`).toEqual([]);
    expect(calls(src)).toBeGreaterThanOrEqual(n);
    expect(src).toMatch(/import \{ isSubmitEnter \} from "@\/features\/chat-v2\/lib\/submit-enter";/);
  });

  it("POSITIVE CONTROL: a planted raw submit is flagged; an activator, a number input and a comment are not", () => {
    expect(rawEnterSites('onKeyDown={(e) => e.key === "Enter" && run()}')).toEqual([1]);
    expect(rawEnterSites('if (e.key === "Enter" && text.trim()) {')).toEqual([1]);
    expect(rawEnterSites('if (e.key === "Enter" || e.key === " ") {')).toEqual([]);
    expect(rawEnterSites('<Input\n  type="number"\n  onKeyDown={(e) => {\n    if (e.key === "Enter") {')).toEqual([]);
    expect(rawEnterSites('// was: e.key === "Enter" && run()')).toEqual([]);
    // Spellings a narrower scan missed (guard-red-team probes, 2026-10-11).
    expect(rawEnterSites('if ("Enter" === e.key) submit();')).toEqual([1]);
    expect(rawEnterSites("if (e.key == 'Enter') submit();")).toEqual([1]);
    expect(rawEnterSites('if (e.code === "Enter") submit();')).toEqual([1]);
    expect(rawEnterSites('switch (e.key) {\n  case "Enter":\n    submit();')).toEqual([2]);
  });
});
