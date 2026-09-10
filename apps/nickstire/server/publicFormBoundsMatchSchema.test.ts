/**
 * A public form's zod bound must never exceed its DB column width.
 *
 * WHY (2026-09-10): TiDB runs STRICT_TRANS_TABLES — a value wider than its
 * column is REJECTED and the row is LOST, not truncated. `referrals.submit`
 * (the $25/$25 customer program) validated `referrerName: z.string().min(1)`
 * with NO ceiling against a `varchar(255)` column, so a 300-character name
 * passed validation and the referral vanished on insert. Silent, and on a path
 * that owes someone money.
 *
 * This reads the width straight out of drizzle/schema.ts and the bound straight
 * out of the router, so the two cannot drift apart without failing here. It
 * asserts bound <= width rather than equality: a tighter product rule (a
 * 200-char name limit on a 255 column) is a legitimate choice; the unsafe
 * direction is the only one pinned.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (rel: string) => readFileSync(path.resolve(__dirname, rel), "utf8");
const SCHEMA = read("../drizzle/schema.ts");

/**
 * `columnName: varchar("columnName", { length: N })` -> N, within one table block.
 *
 * The block ends at whichever comes FIRST: a plain `\n});`, or the next
 * top-level `\nexport `. The `> start` filter is the load-bearing part.
 *
 * WHY (measured 2026-09-10): every table written since `referrals` closes with
 * `}, (table) => [...]);` for its index list, so a plain `\n});` does not exist
 * in it and `indexOf` returns -1. `slice(start, -1)` does NOT throw or return
 * empty — a negative end counts backwards from the end of the string, so the
 * failed search silently became a slice running to one character before EOF.
 * `technicianReferrals` therefore extracted every table below it, `candidates`
 * included, and the assertions still passed because the column names that
 * overlap happen to agree on width. A failed search turning into a maximally
 * broad match is exactly the silent instrument this file exists to prevent, so
 * the boundary is asserted below, not assumed.
 */
function columnWidths(tableExport: string): Record<string, number> {
  const start = SCHEMA.indexOf(`export const ${tableExport} = mysqlTable(`);
  if (start === -1) throw new Error(`table ${tableExport} not found in schema.ts`);
  const candidateEnds = [SCHEMA.indexOf("\n});", start), SCHEMA.indexOf("\nexport ", start + 10)]
    .filter((i) => i > start);
  if (candidateEnds.length === 0) throw new Error(`could not find the end of table ${tableExport}`);
  const block = SCHEMA.slice(start, Math.min(...candidateEnds));
  const out: Record<string, number> = {};
  for (const m of block.matchAll(/(\w+):\s*varchar\(\s*"[^"]+"\s*,\s*\{\s*length:\s*(\d+)/g)) {
    out[m[1]] = Number(m[2]);
  }
  return out;
}

/**
 * `field: z.string()....max(N)` -> N, for one procedure.
 *
 * Anchored to the ROUTER export first, then to the procedure inside it.
 * services.ts holds several routers and an `all: adminProcedure` appears at
 * line 34, long before referralsRouter at 155 — searching the whole file for
 * the end marker produced an inverted slice and an empty result, which the
 * canary below caught rather than passing vacuously.
 */
function zodMaxes(
  source: string,
  routerExport: string,
  procedureMarker: string,
  endMarker: string,
): Record<string, number> {
  const routerAt = source.indexOf(`export const ${routerExport} = router({`);
  if (routerAt === -1) throw new Error(`router ${routerExport} not found`);
  const start = source.indexOf(procedureMarker, routerAt);
  const end = source.indexOf(endMarker, start);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`could not bracket ${procedureMarker} inside ${routerExport}`);
  }
  const block = source.slice(start, end);
  const out: Record<string, number> = {};
  for (const m of block.matchAll(/(\w+):\s*z\s*\.string\(\)[^,\n]*?\.max\((\d+)\)/g)) {
    out[m[1]] = Number(m[2]);
  }
  return out;
}

describe("public form zod bounds fit their columns (STRICT_TRANS_TABLES loses the row otherwise)", () => {
  const referralWidths = columnWidths("referrals");
  const referralBounds = zodMaxes(
    read("./routers/services.ts"),
    "referralsRouter",
    "submit: publicProcedure",
    "all: adminProcedure",
  );

  it("the extraction found real columns and real bounds — the canary", () => {
    // A regex that silently matched nothing would make every check below
    // vacuously pass, since an empty object has no violating entries.
    expect(referralWidths.referrerName).toBe(255);
    expect(Object.keys(referralWidths).length).toBeGreaterThanOrEqual(6);
    expect(Object.keys(referralBounds).length).toBeGreaterThanOrEqual(6);
  });

  for (const field of ["referrerName", "referrerPhone", "referrerEmail", "refereeName", "refereePhone", "refereeEmail"]) {
    it(`referrals.submit bounds ${field} at or under its column width`, () => {
      const bound = referralBounds[field];
      const width = referralWidths[field];
      expect(width, `${field} missing from the referrals table`).toBeGreaterThan(0);
      expect(bound, `${field} has NO .max() — an over-width write is silently lost`).toBeGreaterThan(0);
      expect(bound).toBeLessThanOrEqual(width);
    });
  }

  const candidateWidths = columnWidths("candidates");
  const candidateBounds = zodMaxes(
    read("./routers/candidates.ts"),
    "candidatesRouter",
    "submit: publicProcedure",
    "list: adminProcedure",
  );

  for (const field of ["name", "phone", "email", "positionTitle", "experienceLevel", "utmSource", "utmMedium", "utmCampaign", "landingPage", "referrer", "sessionId"]) {
    it(`candidates.submit bounds ${field} at or under its column width`, () => {
      const bound = candidateBounds[field];
      const width = candidateWidths[field];
      expect(width, `${field} missing from the candidates table`).toBeGreaterThan(0);
      expect(bound, `${field} has NO .max()`).toBeGreaterThan(0);
      expect(bound).toBeLessThanOrEqual(width);
    });
  }

  // technician_referrals — the THIRD public write into varchar columns, and the
  // one this file did not cover until 2026-09-10. Its bounds were already
  // correct; nothing pinned them, so the next field added there would have had
  // no gate. This is the same "a gate is only as wide as its file list" lesson
  // that the IndexNow guard taught when its twin script was left unguarded.
  const techWidths = columnWidths("technicianReferrals");
  const techSource = read("./routers/technicianReferrals.ts");
  const techBounds = zodMaxes(
    techSource,
    "technicianReferralsRouter",
    "submit: publicProcedure",
    "list: adminProcedure",
  );

  it("the technician-referral extraction reads THAT table, not its neighbour — the boundary canary", () => {
    expect(techWidths.referrerName).toBe(255);
    expect(Object.keys(techBounds).length).toBeGreaterThanOrEqual(3);
    // `email` belongs to `candidates`, which sits immediately below
    // technician_referrals in schema.ts. Under the unfiltered -1 this was
    // pulled in here at width 320, so this assertion is the mutation-proof that
    // the block boundary holds — not merely that the numbers happen to agree.
    // Mutation-verified: dropping the `> start` filter fails this with
    // "expected 320 to be undefined".
    expect(techWidths.email, "extraction leaked into the candidates table").toBeUndefined();
  });

  for (const field of ["referrerName", "referrerPhone", "positionTitle"]) {
    it(`technicianReferrals.submit bounds ${field} at or under its column width`, () => {
      const bound = techBounds[field];
      const width = techWidths[field];
      expect(width, `${field} missing from the technician_referrals table`).toBeGreaterThan(0);
      expect(bound, `${field} has NO .max() — an over-width write is silently lost`).toBeGreaterThan(0);
      expect(bound).toBeLessThanOrEqual(width);
    });
  }

  it("technicianReferrals.disqualify bounds its reason at or under disqualifiedReason's width", () => {
    // Input field and column have DIFFERENT names (reason -> disqualifiedReason),
    // so the generic extractor cannot pair them; asserted explicitly.
    // Admin input is still input: a pasted 600-character reason would be
    // rejected by TiDB, the disqualification would silently not happen, and the
    // audit_log line written beside it would say it did.
    const block = techSource.slice(techSource.indexOf("disqualify: adminProcedure"));
    const m = block.match(/reason:\s*z\s*\.string\(\)[^,\n]*?\.max\((\d+)\)/);
    expect(m, "disqualify.reason has NO .max() — an over-width write is silently lost").not.toBeNull();
    expect(techWidths.disqualifiedReason, "disqualifiedReason missing from the table").toBeGreaterThan(0);
    expect(Number(m![1])).toBeLessThanOrEqual(techWidths.disqualifiedReason);
  });
});
