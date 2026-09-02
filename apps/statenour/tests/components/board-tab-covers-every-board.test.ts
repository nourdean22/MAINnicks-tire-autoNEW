/**
 * tests/components/board-tab-covers-every-board.test.ts
 * 2026-09-02 · the Board tab must offer every board the server accepts.
 *
 * `components/brain/board-tab.tsx` carried a hand-maintained mirror of the
 * board list with five of the six entries. The `team` board (Working Team,
 * five AG-12 personas) shipped 2026-07-09 — five weeks AFTER that file was
 * last touched — and was never added. The tRPC procedure accepted it and the
 * chat tool listed it the whole time; only the surface built to SELECT boards
 * could not reach it.
 *
 * The type system could not catch it. `BoardId` was derived from the mirror
 * itself, so a five-of-six subset type-checked cleanly against the server's
 * six-value union. The only guard was a comment instructing the next author to
 * update both files, and a comment cannot fail a build.
 *
 * The fix deletes the mirror and derives the options from BOARD_IDS/BOARDS.
 * This file pins the two properties that makes safe, so the mirror cannot come
 * back quietly.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BOARDS, BOARD_IDS } from "@/lib/ai/board/boards";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const TAB = "components/brain/board-tab.tsx";

/** Source with comments stripped — a tombstone must not satisfy an assertion. */
function liveCode(rel: string): string {
  return readFileSync(resolve(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*/g, "");
}

describe("Board tab · every board the server accepts is selectable", () => {
  it("PLANTED POSITIVE · there really is more than one board", () => {
    // Guards the vacuous case: if BOARD_IDS were empty every loop below
    // would pass while proving nothing.
    expect(BOARD_IDS.length).toBeGreaterThan(1);
  });

  it("REGRESSION · `team` is one of them", () => {
    // The specific board that was invisible for eight weeks. Named rather
    // than counted, so this reads as the defect it guards.
    expect(BOARD_IDS).toContain("team");
    expect(BOARDS.team.name).toBe("Working Team");
  });

  it("every board id resolves to a label and a one-liner", () => {
    // The tab renders BOARDS[id].name / .oneLiner for each id. A board defined
    // without them would render `undefined` in a chip rather than fail here.
    for (const id of BOARD_IDS) {
      expect(BOARDS[id], `${id} missing from BOARDS`).toBeDefined();
      expect(typeof BOARDS[id].name, `${id}.name`).toBe("string");
      expect(BOARDS[id].name.length, `${id}.name is empty`).toBeGreaterThan(0);
      expect(typeof BOARDS[id].oneLiner, `${id}.oneLiner`).toBe("string");
      expect(BOARDS[id].oneLiner.length, `${id}.oneLiner is empty`).toBeGreaterThan(0);
    }
  });

  it("the tab DERIVES its options and does not hardcode a board list", () => {
    // The behaviour above stays true only while the options are derived. A
    // future edit that re-inlines the list would satisfy every assertion above
    // and reintroduce the exact defect, so pin the derivation itself.
    const code = liveCode(TAB);
    expect(code, `${TAB} should build its options from BOARD_IDS`).toContain("BOARD_IDS.map");
    expect(code, `${TAB} should read labels from BOARDS`).toContain("BOARDS[id]");
  });

  it("the tab does not re-declare board ids as string literals", () => {
    // The mirror's tell was a union of quoted ids. Any board id appearing as a
    // literal in this file means a second list has started to grow.
    const code = liveCode(TAB);
    const inlined = BOARD_IDS.filter((id) => code.includes(`"${id}"`));
    expect(
      inlined,
      "Board ids are hardcoded again in board-tab.tsx. That is how `team` went missing:\n" +
        "the mirror type-checked against itself while omitting a board the server accepts.\n" +
        "Derive from BOARD_IDS instead:\n" + inlined.join(", "),
    ).toEqual([]);
  });
});
