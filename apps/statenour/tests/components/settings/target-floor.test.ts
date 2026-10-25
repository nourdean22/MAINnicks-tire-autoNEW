/**
 * bdnick wave E2 round 3 (2026-10-24): the controls CI's target-size gate measured under 44 px on
 * /stats and /settings at 390 px (run 40149675165) each carry the floor in their own tag.
 *
 * tests/e2e/target-size.spec.ts measures the element box (getBoundingClientRect), so the size class
 * must sit on the measured element: the input, the button (a switch gets a 44 px hit area around its
 * 24 px track), the link. Those controls only render with data, which jsdom here and the local e2e
 * cannot provide, so this pins the source of each one; CI's e2e run stays the instrument for the box.
 *
 * Also the focus timer ring (Codex 4369219282): the round 1 sweep turned its transition into
 * transition-colors, which does not animate stroke-dasharray, so the ring jumped once a second.
 *
 * Positive control: a planted control left small fails the same check, and every case must locate
 * its tag (a check that matched nothing would pass on a deleted control).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..");

/** Opening JSX tags of `names` (skips `>` inside {...} and strings). */
function openingTags(src: string, names: string[]): string[] {
  const out: string[] = [];
  const re = new RegExp(`<(${names.join("|")})(?=[\\s/>])`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length;
    let depth = 0;
    let q: string | null = null;
    for (; i < src.length; i++) {
      const c = src[i];
      if (q) {
        if (c === q && src[i - 1] !== "\\") q = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") q = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    out.push(src.slice(m.index, i + 1));
  }
  return out;
}

const NAMES = ["input", "button", "Link", "FreshnessChip", "ConfirmHold", "circle"];
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Every tag carrying `anchor` must carry `floor`. Returns [located, violations]. */
function check(src: string, anchor: RegExp, floor: RegExp): [number, string[]] {
  const tags = openingTags(stripComments(src), NAMES).filter((t) => anchor.test(t));
  return [tags.length, tags.filter((t) => !floor.test(t)).map((t) => t.replace(/\s+/g, " ").slice(0, 120))];
}

type Case = [file: string, control: string, anchor: RegExp, floor: RegExp, located: number];
const H11 = /\bh-11\b/;
const MIN_H11 = /\bmin-h-11\b/;
const CASES: Case[] = [
  ["app/(mastery)/stats/page.tsx", "the three Stats tabs (Goals measured 43 wide)", /role="tab"/, /\bmin-w-11\b/, 1],
  ["components/mastery/level-up-directive-card.tsx", "the Open <stat> rep link", /href=\{directive\.rep\.href\}/, MIN_H11, 1],
  ["components/settings/identity-panel.tsx", "the 'just now' freshness chip", /<FreshnessChip/, MIN_H11, 1],
  ["components/settings/settings-controls.tsx", "Toggle (score every capture, haptic feedback)", /role="switch"/, MIN_H11, 1],
  ["components/settings/settings-controls.tsx", "Toggle names itself", /role="switch"/, /aria-label=\{label\}/, 1],
  ["components/settings/journal-brain-panel.tsx", "Baseline XP slider", /aria-label="Baseline XP per qualifying entry"/, H11, 1],
  ["components/settings/journal-brain-panel.tsx", "Bonus multiplier slider", /aria-label="Bonus multiplier when an entry is linked to a goal"/, H11, 1],
  ["components/settings/journal-brain-panel.tsx", "Auto-confirm slider", /aria-label="Auto-confirm a goal link at or above this confidence"/, H11, 1],
  ["components/settings/journal-brain-panel.tsx", "number inputs (min characters)", /aria-label=\{ariaLabel\}/, H11, 1],
  ["components/settings/people-scoring-panel.tsx", "the five scoring weights, labelled", /aria-label=\{f\.label\}/, MIN_H11, 1],
  ["components/settings/ai-settings-panel.tsx", "Reset (hold to confirm)", /label="Reset"/, MIN_H11, 1],
  ["components/settings/ai-settings-panel.tsx", "tool name to block", /aria-label="Tool name to add to blocklist"/, H11, 1],
  ["components/settings/intelligence-flags-panel.tsx", "flag search", /aria-label="Search feature flags"/, H11, 1],
  ["components/settings/intelligence-flags-panel.tsx", "Force ON (hold to confirm, high-risk flags)", /label="Force ON"/, MIN_H11, 1],
  ["components/settings/operating-rhythm-toggle.tsx", "operating rhythm switch", /role="switch"/, MIN_H11, 1],
  ["components/settings/push-notification-toggle.tsx", "push notifications switch", /role="switch"/, MIN_H11, 1],
  ["components/ultron/preferences-card.tsx", "the eight style sliders (one mapped input)", /type="range"/, H11, 1],
  ["components/goals/execution-coach-sandbox.tsx", "focus timer ring animates its dash", /strokeDasharray=\{`\$\{\(timeLeft/, /transition-\[stroke-dasharray\]/, 1],
];

describe("controls CI measured under the floor carry it in their own tag", () => {
  it.each(CASES)("%s: %s", (file, _control, anchor, floor, located) => {
    const [found, violations] = check(readFileSync(join(ROOT, file), "utf8"), anchor, floor);
    expect(found, "the check located no tag: the control moved or was renamed").toBe(located);
    expect(violations).toEqual([]);
  });

  it("positive control: a planted control left small fails the same check", () => {
    const planted = `<input aria-label="Search feature flags" className="w-full h-8 pl-8" />\n<button role="switch" className="relative w-9 h-5" />`;
    expect(check(planted, /aria-label="Search feature flags"/, H11)[1]).toHaveLength(1);
    expect(check(planted, /role="switch"/, MIN_H11)[1]).toHaveLength(1);
    // and a comment that names the class does not satisfy it
    const commented = `{/* className="h-11" */}<input aria-label="Search feature flags" className="h-8" />`;
    expect(check(commented, /aria-label="Search feature flags"/, H11)[1]).toHaveLength(1);
  });
});
