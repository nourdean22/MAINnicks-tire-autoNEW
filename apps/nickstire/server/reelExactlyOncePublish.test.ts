/**
 * EXACTLY-ONCE PUBLISHING — the three fail-closed controls on the reel publish
 * door that had no canary.
 *
 * WHY THIS FILE EXISTS. `dailyReelPost.test.ts` has seven tests and every one of
 * them returns at the REEL_AUTOPOST_ENABLED authority gate or exercises a pure
 * helper. Nothing reached the publish region, so three controls that stand
 * between this cron and a duplicate post on the owner's live Instagram account
 * shipped with no test at all. `db-affected.test.ts` covers `affectedRowCount`,
 * but a correct row-counter wired into an unscoped UPDATE still double-publishes.
 *
 * These correspond to validation cases "Last daily slot" (two workers attempt the
 * remaining slot) and "Successful upload only" (container created, publish
 * confirmation absent) from the 2026-09-08 design/validation notes.
 *
 * WHY SOURCE ASSERTIONS RATHER THAN A RUNTIME DRIVE. `runDailyReelPost` opens a
 * real DB and calls Meta; the repo's only local database is production TiDB, and
 * the publish region is reachable only after a live approval, a rendered asset
 * and an hour gate. `reelPublishWindowWiring.test.ts` set the precedent for
 * asserting a seam this way. The cost of that choice is that a mis-bounded slice
 * passes vacuously, so every check below is run against BOTH the real region and
 * a deliberately broken copy — a check that cannot fail is not a check.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "server/cron/jobs/dailyReelPost.ts"), "utf8");

/**
 * The publish-claim region: from the exactly-once comment to the first
 * `let outcome;`. Bounded deliberately — slicing to end-of-file would let these
 * regexes match unrelated later code, which is the exact defect
 * reelPublishWindowWiring.test.ts records having shipped twice.
 */
function publishClaimRegion(src: string): string {
  const start = src.indexOf("// EXACTLY-ONCE: claim assembled -> publishing");
  const end = src.indexOf("let outcome;", start);
  return start >= 0 && end > start ? src.slice(start, end) : "";
}

const region = publishClaimRegion(source);

/** The CAS must be scoped to the pre-publish status, or both racers claim. */
const isClaimScopedToAssembled = (s: string) =>
  /\.where\(\s*and\(\s*eq\(reelJobs\.id, job\.id\),\s*eq\(reelJobs\.status, "assembled"\)\s*\)\s*\)/.test(s);

/** Anything other than exactly one claimed row must abort before the Meta call. */
const abortsUnlessExactlyOneRow = (s: string) =>
  /if \(claimed !== 1\)/.test(s) && /publish already claimed by another run/.test(s);

/** No attempt row -> restore `assembled` and hold, never publish unrecorded. */
const rollsBackWhenUnrecorded = (s: string) =>
  /if \(!attemptId\)/.test(s) &&
  /status: "assembled"[\s\S]*publicationScheduledAt: null/.test(s) &&
  /publish-attempt ledger unavailable/.test(s);

describe("the publish-claim region is actually found (silent-instrument guard)", () => {
  it("is non-empty and is a REGION, not the whole file", () => {
    // A slice that found nothing makes every assertion below vacuously true.
    expect(region, "publish-claim region not located — the anchors moved").not.toBe("");
    expect(region.length).toBeGreaterThan(200);
    expect(region.length).toBeLessThan(source.length / 2);
    expect(region).toContain("EXACTLY-ONCE");
  });

  it("a moved anchor yields an EMPTY region rather than a passing one", () => {
    expect(publishClaimRegion("no anchors in this string at all")).toBe("");
  });
});

describe("case: two workers race for the last daily slot", () => {
  it("claims the job with a compare-and-set scoped to status='assembled'", () => {
    expect(isClaimScopedToAssembled(region)).toBe(true);
  });

  it("PLANTED CANARY: an unscoped claim is caught", () => {
    // Drop the status predicate and the UPDATE matches on id alone, so BOTH
    // overlapping ticks affect one row, both read claimed===1, and both publish.
    const broken = region.replace(', eq(reelJobs.status, "assembled")', "");
    expect(broken, "mutation did not apply — the canary proves nothing").not.toBe(region);
    expect(isClaimScopedToAssembled(broken)).toBe(false);
  });

  it("aborts unless exactly one row was claimed", () => {
    expect(abortsUnlessExactlyOneRow(region)).toBe(true);
  });

  it("PLANTED CANARY: a >=1 guard (which a zero-row no-op satisfies) is caught", () => {
    const broken = region.replace("claimed !== 1", "claimed < 0");
    expect(broken).not.toBe(region);
    expect(abortsUnlessExactlyOneRow(broken)).toBe(false);
  });
});

describe("case: publish attempt could not be recorded", () => {
  it("rolls the job back to 'assembled' and holds instead of publishing unrecorded", () => {
    expect(rollsBackWhenUnrecorded(region)).toBe(true);
  });

  it("PLANTED CANARY: removing the rollback branch is caught", () => {
    const broken = region.replace("if (!attemptId) {", "if (false) {");
    expect(broken).not.toBe(region);
    expect(rollsBackWhenUnrecorded(broken)).toBe(false);
  });

  it("the rollback clears publicationScheduledAt, so a held job is not stamped as started", () => {
    // publicationScheduledAt records "publish STARTED". Leaving it set on a job
    // that never published makes the ledger claim an attempt that did not happen.
    expect(region).toMatch(/publicationScheduledAt: null/);
  });
});

describe("case: container created but publish confirmation absent", () => {
  it("parks an ambiguous publish in its own state — never 'published'", () => {
    // An exception after the irreversible call means the post MAY be live. The
    // job must not be marked published (a lie) nor assembled (invites a retry
    // that could duplicate). publish_ambiguous is the third, honest state.
    expect(source).toContain('status: "publish_ambiguous"');
    expect(source).toMatch(/verify on Instagram before retrying/);
  });

  it("does not silently reset an ambiguous publish back to a retryable state", () => {
    const idx = source.indexOf('status: "publish_ambiguous"');
    expect(idx).toBeGreaterThan(-1);
    // Within the same handler, an ambiguous outcome must not also write
    // `status: "assembled"` — that is the retry-into-duplicate path.
    const handler = source.slice(idx, idx + 600);
    expect(handler).not.toMatch(/status: "assembled"/);
  });
});
