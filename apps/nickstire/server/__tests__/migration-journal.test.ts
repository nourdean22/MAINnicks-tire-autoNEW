/**
 * Migration-journal drift guard (2026-07-11).
 *
 * scripts/db-migrate.ts applies ONLY what drizzle/meta/_journal.json
 * lists — a .sql file that isn't journaled is silently invisible to
 * every fresh environment. That drift reached 34/90 files (including
 * sms_preferences_optout, the durable TCPA opt-out table) before the
 * 2026-07-11 reconciliation. This test makes the failure loud forever.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..", "..");

function journalTags(): string[] {
  const j = JSON.parse(readFileSync(join(ROOT, "drizzle", "meta", "_journal.json"), "utf8"));
  return j.entries.map((e: { tag: string }) => e.tag);
}

function sqlFiles(): string[] {
  return readdirSync(join(ROOT, "drizzle"))
    .filter((f) => f.endsWith(".sql"))
    .map((f) => f.slice(0, -4));
}

describe("drizzle migration journal", () => {
  it("journals every drizzle/*.sql file (no invisible migrations)", () => {
    const tags = new Set(journalTags());
    const missing = sqlFiles().filter((f) => !tags.has(f));
    expect(missing, `unjournaled migrations (fresh envs will SKIP these — add to _journal.json): ${missing.join(", ")}`).toEqual([]);
  });

  it("has no journal entries pointing at deleted files", () => {
    const files = new Set(sqlFiles());
    const phantom = journalTags().filter((t) => !files.has(t));
    expect(phantom, `journal entries with no .sql file: ${phantom.join(", ")}`).toEqual([]);
  });

  it("keeps idx strictly sequential (drizzle-kit reads it to name the next migration)", () => {
    const j = JSON.parse(readFileSync(join(ROOT, "drizzle", "meta", "_journal.json"), "utf8"));
    const idxs = j.entries.map((e: { idx: number }) => e.idx);
    expect(idxs).toEqual(idxs.map((_: number, i: number) => i));
  });
});

/**
 * Numeric-prefix collision ratchet (2026-09-22).
 *
 * The tests above check that every .sql file is journaled and every journal
 * entry has a file. Neither checks that the NUMBER is unique — so a migration
 * numbered 0103 when the journal already reaches 0124 passes every gate green.
 * That is not hypothetical: it happened in this diff, and the file was renamed
 * to 0125 before it reached production.
 *
 * The prefix is how a human reads apply order. A second 0103 tells every future
 * reader it runs before 0104 when it actually runs last, and any tooling or
 * glob keyed on `0103*` silently gets two files.
 *
 * ROOT CAUSE, visible in the grandfathered names below: each collision pairs a
 * drizzle-kit AUTO-GENERATED name (`gigantic_human_cannonball`, `flimsy_iceman`,
 * `adorable_dark_beast`) with a HAND-WRITTEN one. drizzle-kit picks its next
 * number from its own view of the journal while a human hand-writes the same
 * number — so the two naming paths collide by construction, not by carelessness.
 * That is why attention does not fix this class and a gate does.
 *
 * SHRINK-ONLY. The 10 below are grandfathered because renaming an APPLIED
 * migration is a production change for zero behavioural gain. A NEW collision
 * fails. Removing one is a fix — delete it from this set.
 *
 * The `0021b_` spelling is the deliberate escape hatch for "I need a migration
 * adjacent to 0021", so the key is the underscore-delimited segment rather than
 * the first four characters — `0021` and `0021b` are correctly distinct.
 */
const GRANDFATHERED_COLLISIONS = new Set([
  "0026", "0050", "0052", "0053", "0054",
  "0055", "0056", "0057", "0058", "0074",
]);

/** Prefixes claimed by more than one migration. Pure, so the canary can feed it. */
function collidingPrefixes(tags: string[]): string[] {
  const seen = new Map<string, number>();
  for (const tag of tags) {
    const prefix = tag.split("_")[0];
    seen.set(prefix, (seen.get(prefix) ?? 0) + 1);
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([p]) => p).sort();
}

describe("migration numeric-prefix collisions", () => {
  it("adds no NEW prefix collision", () => {
    const fresh = collidingPrefixes(journalTags()).filter((p) => !GRANDFATHERED_COLLISIONS.has(p));
    expect(
      fresh,
      `migration number(s) already taken: ${fresh.join(", ")}. ` +
        `Renumber your new migration above the highest existing prefix (rename the ` +
        `.sql file AND its _journal.json tag), or use the 'b' suffix if it genuinely ` +
        `belongs next to an existing one.`,
    ).toEqual([]);
  });

  it("does not grandfather a prefix that is no longer duplicated", () => {
    // Keeps the baseline honest: a stale entry would silently re-permit a
    // collision on a number that had been cleaned up.
    const actual = new Set(collidingPrefixes(journalTags()));
    const stale = [...GRANDFATHERED_COLLISIONS].filter((p) => !actual.has(p));
    expect(stale, `no longer collide — delete from GRANDFATHERED_COLLISIONS: ${stale.join(", ")}`).toEqual([]);
  });

  it("POSITIVE CONTROL: the detector fires on a collision and stays quiet without one", () => {
    // Without this, a detector that returned [] unconditionally would score a
    // permanent green — the failure shape this repo keeps paying for. Same
    // function the gate calls, fed synthetic input.
    expect(collidingPrefixes(["0125_alpha", "0126_beta"])).toEqual([]);
    expect(collidingPrefixes(["0125_alpha", "0125_beta"])).toEqual(["0125"]);
    // The exact mistake made in this diff: a low number reused late.
    expect(collidingPrefixes(["0103_recovery", "0124_camera", "0103_promises"])).toEqual(["0103"]);
    // The escape hatch must NOT read as a collision.
    expect(collidingPrefixes(["0021_daily", "0021b_chat"])).toEqual([]);
  });
});
