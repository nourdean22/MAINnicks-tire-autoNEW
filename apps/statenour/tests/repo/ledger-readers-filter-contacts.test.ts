/**
 * Every relationship_ledger reader that DERIVES something must read CONTACT
 * rows (2026-09-16, W8).
 *
 * The ledger carries rows that are deliberately not contacts, and they are not
 * inert — measured on prod 2026-09-16:
 *   · the 8 synthetic mention rows each carry amount **+1**, so they passed
 *     `amount > 0` in `people-credit.ts` and had been earning relationship XP
 *     for chat messages that merely NAMED a person;
 *   · a status-flip row carries −50 (blown_up), −5 (cooling) or 0 (active)
 *     (`task.flipPersonStatus`), against consumers whose thresholds are
 *     `net < -5` and "30-day amount sum". Zero such rows exist yet, so that
 *     half is armed and unfired — the first status flip would have moved
 *     the watchlist, the picks, the power balance and the drainers list.
 *
 * So this scan fails on a `relationshipLedger` read in a file that does not
 * pipe its rows through `contactRowsOnly`, unless the file is in the
 * allowlist below WITH a reason. The allowlist is the interesting half: a
 * reader is exempt only when showing every row IS the product (an audit
 * history), or when it is the contact machinery itself.
 *
 * Positive control (run when this shipped): deleting the `contactRowsOnly`
 * call from `lib/brain/power-balance-engine.ts` turns this test RED naming
 * that file; restoring it turns it green.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");

/** file → why reading every row (contacts AND audit rows) is correct there. */
const ALLOWED: Record<string, string> = {
  "lib/services/people/delete-ledger-row.ts":
    "must FIND the row being deleted whatever kind it is, then re-derives the counters through the predicate itself",
  "lib/services/people/record-interaction.ts": "the writer (create + the once-window count)",
  "lib/trpc/routers/task/power-atlas.ts":
    "LedgerTimeline + AlphaMoments are the person's AUDIT HISTORY — a status flip belongs on that timeline, and neither derives a number from it; the same file WRITES the status-flip row",
};

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files", "app", "lib", "components"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
}

// Matches the read whether it is `prisma.relationshipLedger.findMany(`, a
// `tx.` transaction client, or broken across lines by the formatter.
const READ = /relationshipLedger[\s\n]*\.?[\s\n]*(findMany|findFirst|count|aggregate|groupBy)/;

/**
 * A CALL, not the identifier. The first cut of this scan tested
 * `src.includes("contactRowsOnly")`, which the `import` line alone satisfies —
 * so deleting the call while leaving the import in place kept the scan GREEN.
 * Proven by mutation on 2026-09-16: dropping the call from
 * `power-balance-engine.ts` did not fail the test. A guard that cannot fail is
 * not a guard, so it matches the two real call shapes instead.
 */
const CALLS_FILTER = /contactRowsOnly\s*\(|\.then\(\s*contactRowsOnly\s*\)/;

describe("relationship_ledger readers filter to CONTACT rows", () => {
  const offenders: string[] = [];
  const allowedSeen = new Set<string>();

  for (const file of trackedFiles()) {
    const src = readFileSync(join(ROOT, file), "utf8");
    if (!READ.test(src)) continue;
    if (file in ALLOWED) {
      allowedSeen.add(file);
      continue;
    }
    if (!CALLS_FILTER.test(src)) offenders.push(file);
  }

  it("no reader outside the allowlist reads raw ledger rows", () => {
    expect(
      offenders,
      `these files read relationship_ledger without contactRowsOnly — a status-flip row (−50) or a synthetic mention (+1) would enter the result:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("the scan actually reaches ledger readers (the instrument is not blind)", () => {
    // If the regex ever stops matching, `offenders` would be empty for the
    // wrong reason. 13 filtered readers + 3 allowlisted ones exist as of
    // 2026-09-16, so the scan must still see every allowlist entry.
    expect(allowedSeen.size).toBe(Object.keys(ALLOWED).length);
  });

  it("every allowlist entry still exists and still reads the ledger", () => {
    for (const file of Object.keys(ALLOWED)) {
      expect(allowedSeen.has(file), `${file} is allowlisted but no longer reads the ledger — drop the entry`).toBe(
        true,
      );
    }
  });
});
