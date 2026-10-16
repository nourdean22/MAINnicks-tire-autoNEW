/**
 * UI v3 W1a review round 1: the mastery config carries no icon field, and nothing renders one.
 *
 * The first pass blanked the emoji to "" and left every renderer, so the character sheet drew empty
 * spans and the identity arc a leading space. The field is gone now; this fails if an entry grows an
 * `icon` key again, or if a mastery renderer reads `.icon` off a stat, branch or domain.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BRANCHES, DOMAINS, HABITS } from "@/lib/mastery/config";

const ROOT = join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("mastery config has no icon field", () => {
  it("no habit, branch or domain entry carries an icon key", () => {
    const withIcon = [...HABITS, ...BRANCHES, ...DOMAINS].filter((e) => "icon" in e).map((e) => e.key);
    expect(withIcon).toEqual([]);
  });

  it("no mastery renderer reads .icon off a config object", () => {
    const files = [
      "components/mastery/character-sheet.tsx",
      "components/mastery/level-up-directive-card.tsx",
      "components/mastery/identity-arc-card.tsx",
      "components/goals/goal-board.tsx",
      "lib/mastery/character-sheet.ts",
    ];
    const hits = files.flatMap((f) => (read(f).match(/\b(?:br|stat|g|d|s|nextRep|highestNeglected)\.icon\b/g) ?? []).map((m) => `${f}: ${m}`));
    expect(hits).toEqual([]);
  });

  it("the former readers outside the mastery components stay clean too (review round 2, item 9)", () => {
    const files = ["lib/services/ultron-ticker.ts", "app/api/habits/streaks/route.ts", "lib/trpc/routers/operator.ts"];
    const hits = files.flatMap((f) => (read(f).match(/\b(?:riser|next|h|d|s|stat)\.icon\b/g) ?? []).map((m) => `${f}: ${m}`));
    expect(hits).toEqual([]);
  });
});
