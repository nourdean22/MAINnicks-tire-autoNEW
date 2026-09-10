/**
 * The fabricated-read class may SHRINK, never grow.
 *
 * server/adminReadsDontFabricateZero.test.ts guards this class by HAND-NAMING
 * two functions. That test is good and stays — it renders the outage state and
 * proves the two panels branch on it. But a hand-written list of two is only as
 * wide as itself, and the population is 35 (procedure, helper) pairs, 20 of them
 * on adminProcedure. Everything outside those two names was unmeasured.
 *
 * THE UNIT IS A PAIR, not a helper. This repo's accepted fix (ROS-083) guards at
 * the ROUTER, because the `[]` is frequently load-bearing at the helper —
 * adminBundle.ts consumes getCallbackRequests inside a Promise.allSettled and
 * adminBundleTruth.test.ts pins that shape. Counting helpers would therefore
 * measure a number that a correct fix cannot move.
 *
 * A RATCHET, NOT AN ALLOWLIST-WITH-REASONS. Thirty-five entries each carrying a
 * generic reason is exactly the laundering this repo already has a name for
 * ("pre-existing, not individually reviewed"), and it teaches readers the list
 * is decorative. Names, a total, and a refusal to grow are honest about what was
 * and was not reviewed.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { scanFabricatedAdminReads, pairKey, fabricatingReads } from "../scripts/lib/fabricatedAdminReadScan.mjs";

const APP = process.cwd();
const baseline = JSON.parse(readFileSync(resolve(APP, "config/fabricated-admin-read-baseline.json"), "utf8"));

describe("fabricated admin reads are ratcheted", () => {
  const hits = scanFabricatedAdminReads(APP);
  const keys = hits.map(pairKey);
  const known = new Set(baseline.pairs);

  it("the scanner still finds the class at all — the positive control", () => {
    // A scanner that silently returns nothing would make every assertion below
    // pass while measuring an empty set. That is the failure mode this whole
    // class is about, so it is asserted first.
    expect(fabricatingReads(APP).size).toBeGreaterThan(10);
    expect(hits.length).toBeGreaterThan(10);
  });

  it("the subject is the WHOLE server tree, not one file", () => {
    // Until 2026-09-10 the scanner read exactly server/db.ts, so the ratchet it
    // fed was itself an instrument narrower than its subject — ROS-103's shape
    // inside the gate built to catch ROS-103. It recorded 30 pairs while 46
    // more sat in files it never opened, one of which
    // (getDynamicArticleBySlug) was actively serving Soft 404s to Google.
    //
    // A count alone cannot catch a re-narrowing: drop back to db.ts and the
    // totals simply shrink, which every other assertion here reads as PROGRESS.
    // So assert the SUBJECT — that helpers and pairs are still being found
    // outside db.ts — not just the verdict.
    const files = new Set([...fabricatingReads(APP).values()].map((v) => v.file));
    expect(files.has("server/db.ts"), "db.ts must still be in scope").toBe(true);

    const others = [...files].filter((f) => f !== "server/db.ts");
    expect(
      others.length,
      `the scanner found fabricating helpers in ONLY db.ts — the subject list has been narrowed back. ` +
        `Measured 2026-09-10: 39 other files contribute.`,
    ).toBeGreaterThan(5);

    // And those files must actually reach the PAIR list, not merely be read:
    // a scan that opens every file but whose pair-matching still only resolves
    // db.ts helpers would pass the assertion above while measuring nothing new.
    const fromOtherFiles = hits.filter((h) => h.helperFile && h.helperFile !== "server/db.ts");
    expect(
      fromOtherFiles.length,
      "no (procedure, helper) pair resolves to a helper outside db.ts — widening the file list did not widen the measurement",
    ).toBeGreaterThan(10);
  });

  it("no NEW procedure hands an operator a fabricated value", () => {
    const fresh = keys.filter((k) => !known.has(k));
    expect(
      fresh,
      `NEW unguarded fabricated read(s).\n` +
        fresh.map((f) => `  ${f}`).join("\n") +
        `\n\nEither guard the procedure — if (!(await getDb())) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", ... })\n` +
        `— or give the helper an { available, rows } shape. Then regenerate:\n` +
        `  node scripts/update-fabricated-read-baseline.mjs`,
    ).toEqual([]);
  });

  it("the recorded total is not stale in the growing direction", () => {
    expect(hits.length).toBeLessThanOrEqual(baseline.total);
  });

  it("the baseline names no pair that has since been fixed", () => {
    // A baseline entry for something already guarded is stale paperwork, and it
    // teaches the next reader the list is decorative. Regenerating is cheap.
    const live = new Set(keys);
    const stale = baseline.pairs.filter((p: string) => !live.has(p));
    expect(
      stale,
      `baseline lists ${stale.length} pair(s) that are no longer unguarded — regenerate it:\n` +
        stale.map((s: string) => `  ${s}`).join("\n"),
    ).toEqual([]);
  });
});
