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

/**
 * A FILTER THAT CANNOT SEE ITS OWN INPUT IS A NO-OP, and it fails open.
 *
 * `isContactRow` reads `row.metadata`. If the Prisma read narrows with a
 * `select` that omits `metadata`, every row arrives with `metadata:
 * undefined`, the predicate returns TRUE for all of them, and
 * `contactRowsOnly` quietly filters nothing — no crash, no type error (the
 * rows still satisfy `LedgerRowShape` structurally at runtime), just the
 * contaminated numbers this wave was built to remove, back again.
 *
 * The scan above cannot see that: it checks the CALL exists. This one checks
 * the call is FED. Found 2026-09-16 while auditing the wave's own diff — a
 * `metadata: true` grep flagged `relationship-arc-projection.ts`, which turned
 * out to be a FALSE POSITIVE (its read has no `select` at all, so Prisma
 * returns every scalar including metadata). The code was right; the
 * instrument was not able to tell. A guard that cannot distinguish a working
 * filter from a silently dead one is the defect, whichever way the first
 * reading happened to fall.
 *
 * Rule: a ledger read whose rows reach `contactRowsOnly` must either carry no
 * `select` (all scalars, metadata included) or name `metadata` in it.
 */
function ledgerReadArgs(src: string): string[] {
  const out: string[] = [];
  const re = /relationshipLedger[\s\n]*\.?[\s\n]*(?:findMany|findFirst|aggregate|groupBy)[\s\n]*\(/g;
  for (const m of src.matchAll(re)) {
    // Brace-match the call's argument object so a `select` belonging to a
    // DIFFERENT model's read in the same file cannot be mistaken for this one.
    const start = src.indexOf("{", (m.index ?? 0) + m[0].length - 1);
    if (start < 0) continue;
    let depth = 0;
    for (let i = start; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) {
          out.push(src.slice(start, i + 1));
          break;
        }
      }
    }
  }
  return out;
}

/** Reads that narrow with a `select` but leave `metadata` out of it. */
export function blindLedgerReads(src: string): string[] {
  return ledgerReadArgs(src).filter((args) => /\bselect\s*:/.test(args) && !/\bmetadata\s*:/.test(args));
}

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

  it("no filtered reader narrows its select away from metadata (the filter would silently no-op)", () => {
    const blind: string[] = [];
    for (const file of trackedFiles()) {
      if (file in ALLOWED) continue;
      const src = readFileSync(join(ROOT, file), "utf8");
      if (!READ.test(src) || !CALLS_FILTER.test(src)) continue;
      for (const args of blindLedgerReads(src)) {
        blind.push(`${file}: select without metadata -> ${args.replace(/\s+/g, " ").slice(0, 120)}`);
      }
    }
    expect(
      blind,
      `these readers pipe rows through contactRowsOnly but never SELECT metadata, so isContactRow sees undefined and keeps every row — the filter is dead and fails OPEN:\n${blind.join("\n")}`,
    ).toEqual([]);
  });

  it("the blindness detector fires on a narrowed select and not on a select-less read", () => {
    // Instrument control. Both shapes are real and both appear in this repo:
    // changes-since.ts narrows deliberately; relationship-arc-projection.ts
    // takes every scalar. Only the first can go blind.
    expect(
      blindLedgerReads(`prisma.relationshipLedger.findMany({ where: { a: 1 }, select: { amount: true } })`),
    ).toHaveLength(1);
    expect(
      blindLedgerReads(`prisma.relationshipLedger.findMany({ where: { a: 1 }, select: { amount: true, metadata: true } })`),
    ).toEqual([]);
    expect(blindLedgerReads(`prisma.relationshipLedger.findMany({ where: { a: 1 }, take: 60 })`)).toEqual([]);
    // A select on a DIFFERENT model in the same file must not be attributed here.
    expect(
      blindLedgerReads(
        `prisma.brainMemory.findMany({ select: { content: true } }); prisma.relationshipLedger.findMany({ take: 5 })`,
      ),
    ).toEqual([]);
  });

  it("every allowlist entry still exists and still reads the ledger", () => {
    for (const file of Object.keys(ALLOWED)) {
      expect(allowedSeen.has(file), `${file} is allowlisted but no longer reads the ledger — drop the entry`).toBe(
        true,
      );
    }
  });
});
