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

/** `columnName: varchar("columnName", { length: N })` -> N, within one table block. */
function columnWidths(tableExport: string): Record<string, number> {
  const start = SCHEMA.indexOf(`export const ${tableExport} = mysqlTable(`);
  if (start === -1) throw new Error(`table ${tableExport} not found in schema.ts`);
  const block = SCHEMA.slice(start, SCHEMA.indexOf("\n});", start));
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
});
