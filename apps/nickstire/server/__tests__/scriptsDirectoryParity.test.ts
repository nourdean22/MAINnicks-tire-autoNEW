/**
 * `scripts/` and `scripts/diagnostics/` must never hold the same filename twice.
 *
 * WHY THIS EXISTS. On 2026-06-12, commit 7ca6b129e bulk-COPIED 67 files from
 * `scripts/` into a new `scripts/diagnostics/` without deleting the originals.
 * Forty-two filenames then existed twice, and nothing referenced the
 * diagnostics side — so every future edit was a coin flip about which copy the
 * editor happened to open.
 *
 * IT WENT WRONG IN BOTH DIRECTIONS, which is why a filename check (not a
 * content check) is the right guard:
 *   - `vapi-update-assistant.ts` — the ROOT was fixed (2026-06-14, bfa5ff309,
 *     `sipVerb: "dial"` for warm-transfer failures). The copy stayed stale.
 *   - `vapi-test-new-tools.ts`   — the COPY was fixed (2026-07-20, 60e32183f):
 *     checkTireStock stopped creating a lead and now hands off to a person, and
 *     the assertion was inverted to match. The root kept asserting the REMOVED
 *     behaviour for five weeks.
 *
 * So "just delete the copies" would have destroyed a real fix. The hazard is
 * not staleness in one known direction; it is that nobody can tell which copy
 * is authoritative. ROS-074 (docs/ISSUE-REGISTRY.md) is the expensive version
 * of this same class: a stale `scripts/diagnostics/lint-brand-voice.mjs`
 * carried a fabricated "$60 installed" price that had already been retracted
 * elsewhere, and reinfected it.
 *
 * `scripts/diagnostics/` is NOT banned — 21 files legitimately live only there,
 * including `llm-calls-readback.cjs` behind `pnpm diag:llm-calls`. What is
 * banned is the same basename in both places.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const SCRIPTS = join(__dirname, "..", "..", "scripts");
const DIAGNOSTICS = join(SCRIPTS, "diagnostics");

function filesIn(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => statSync(join(dir, f)).isFile());
}

describe("scripts/ and scripts/diagnostics/ hold no duplicate filenames", () => {
  it("positive control — both directories exist and are populated", () => {
    // Without this, an empty or moved directory would make the real assertion
    // below pass vacuously: zero files trivially collide with nothing.
    expect(filesIn(SCRIPTS).length).toBeGreaterThan(10);
    expect(filesIn(DIAGNOSTICS).length).toBeGreaterThan(5);
  });

  it("no filename appears in BOTH scripts/ and scripts/diagnostics/", () => {
    const rootNames = new Set(filesIn(SCRIPTS));
    const dupes = filesIn(DIAGNOSTICS).filter((f) => rootNames.has(f));

    expect(
      dupes,
      dupes.length
        ? `These filenames exist in BOTH scripts/ and scripts/diagnostics/:\n` +
            dupes.map((d) => `  - ${d}`).join("\n") +
            `\n\nPick ONE home and delete the other. Two copies of a script means every ` +
            `future edit lands in whichever one the editor opened, and the other silently rots. ` +
            `This has already happened twice in opposite directions (see the header of this file), ` +
            `and once expensively as ROS-074.`
        : undefined,
    ).toEqual([]);
  });

  it("the diagnostics-only scripts are still present — dedupe must not have over-deleted", () => {
    // Deleting duplicates is correct; deleting the 21 files that live ONLY in
    // diagnostics/ would lose them. `llm-calls-readback.cjs` in particular is
    // wired to `pnpm diag:llm-calls` in package.json.
    const diag = filesIn(DIAGNOSTICS);
    expect(diag.length).toBeGreaterThanOrEqual(15);
    expect(diag).toContain("llm-calls-readback.cjs");
  });
});
