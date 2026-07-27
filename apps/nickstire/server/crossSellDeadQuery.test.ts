/**
 * The cross-sell outreach query must be able to match a row.
 *
 * WHAT WAS BROKEN
 * `cross-sell-outreach` is registered hourly (businessHoursOnly, ~5 ticks/day)
 * and could never select a single candidate. TWO independent structural
 * impossibilities in one SELECT, either of which alone kills it:
 *
 *  1. COLUMN NAMES. It read `c.first_name`, `c.last_name`, `c.sms_opt_out` off
 *     `customers` — a camelCase table (`firstName`, `lastName`, `smsOptOut`).
 *     MySQL raises ER_BAD_FIELD_ERROR 1054. The catch converted that to
 *     `return []` under the message "table may not exist yet", so a bug in this
 *     file was reported forever as somebody else's missing data.
 *
 *  2. SCALE. `AND sap.confidence >= 50` against a `DECIMAL(5,4)` column whose
 *     maximum storable value is 9.9999, written by a 0..1 producer. The comment
 *     said "50 = more likely than not" — true on a percentage scale, and the
 *     column is a fraction.
 *
 * WHY IT HID SO WELL
 * The job wrote status='completed' to cron_log ~5x/day with the detail string
 * "No v2 predictions to act on (treatment-arm ≥50% confidence)" — wording that
 * blames the upstream compute job and the operator's feature flag. A previous
 * investigation recorded the job as dormant without finding the cause.
 *
 * The cost is larger than the missing texts: `serviceAffinityPredictions` runs a
 * 50/50 treatment/control A/B, and the treatment arm's ONLY action path is this
 * job. With it dead, every "treatment" customer was silently a control, so the
 * experiment measured nothing.
 *
 * THE ROOT CAUSE IS A MIXED CONVENTION, NOT A TYPO
 * `service_affinity_predictions` is hand-written SQL and IS snake_case
 * (`customer_id`, `ab_arm`, `created_at`). `customers` and `sms_messages` come
 * from drizzle-kit and are camelCase. This query joins the two, and the author
 * used snake_case for both. `crudAutomation.ts` does the identical join
 * correctly, which is what proves the convention rather than assuming it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("./cron/jobs/crossSellOutreach.ts", import.meta.url), "utf8");
const SCHEMA = readFileSync(new URL("../drizzle/schema.ts", import.meta.url), "utf8");

describe("customers columns are referenced as the schema declares them", () => {
  it("the schema really is camelCase (the premise of this whole file)", () => {
    expect(SCHEMA).toMatch(/firstName: varchar\("firstName"/);
    expect(SCHEMA).toMatch(/lastName: varchar\("lastName"/);
    expect(SCHEMA).toMatch(/smsOptOut: tinyint\("smsOptOut"/);
  });

  it("the query uses camelCase for customers", () => {
    expect(SRC).toMatch(/c\.firstName/);
    expect(SRC).toMatch(/c\.lastName/);
    expect(SRC).toMatch(/c\.smsOptOut/);
  });

  it("no snake_case customers column survives anywhere in the file", () => {
    const offenders = ["first_name", "last_name", "sms_opt_out"].filter((n) => SRC.includes(n));
    expect(offenders, `snake_case customers columns remain: ${offenders.join(", ")}`).toEqual([]);
  });

  it("the cooldown query uses camelCase for sms_messages too", () => {
    expect(SRC).toMatch(/m\.conversationId/);
    expect(SRC).toMatch(/m\.variantKey/);
    expect(SRC).toMatch(/m\.createdAt/);
    for (const n of ["conversation_id", "variant_key", "m.created_at"]) {
      expect(SRC.includes(n), `stale snake_case: ${n}`).toBe(false);
    }
  });

  it("STILL uses snake_case for service_affinity_predictions — that table IS snake_case", () => {
    // The fix must not overcorrect. Half this query is legitimately snake_case.
    expect(SRC).toMatch(/sap\.ab_arm/);
    expect(SRC).toMatch(/sap\.created_at/);
    expect(SRC).toMatch(/sap\.features_json/);
  });
});

describe("the confidence threshold is on the column's scale", () => {
  const threshold = Number(/const MIN_CONFIDENCE_TO_ACT = ([\d.]+)/.exec(SRC)?.[1]);

  it("is parseable", () => {
    expect(Number.isFinite(threshold)).toBe(true);
  });

  it("is within DECIMAL(5,4)'s storable range — 50 was not", () => {
    // DECIMAL(5,4) => max 9.9999. A threshold above that can never match.
    expect(threshold).toBeLessThanOrEqual(9.9999);
  });

  it("is on the 0..1 fraction scale the writer produces", () => {
    expect(threshold).toBeGreaterThan(0);
    expect(threshold).toBeLessThanOrEqual(1);
  });

  it("the column is still DECIMAL(5,4), so the bound above is the real one", () => {
    expect(SCHEMA).toMatch(/confidence: decimal\("confidence", \{ precision: 5, scale: 4 \}\)/);
  });
});

describe("a broken query can no longer masquerade as missing data", () => {
  it("an unknown-column error is logged as an ERROR, not a warning about a table", () => {
    expect(SRC).toMatch(/ER_BAD_FIELD_ERROR\|Unknown column\|Unknown table/);
    expect(SRC).toMatch(/log\.error\([^)]*BROKEN/);
  });

  it("a genuinely absent table is still the quiet case", () => {
    expect(SRC).toMatch(/ER_NO_SUCH_TABLE/);
    expect(SRC).toMatch(/log\.warn\("v2 predictions read skipped/);
  });

  it("the zero-result message states the threshold in the column's own units", () => {
    // The old string said "≥50% confidence" and sent every investigation
    // upstream. A zero must be checkable against the data.
    expect(SRC).toMatch(/confidence >= \$\{MIN_CONFIDENCE_TO_ACT\} \(0-1 scale\)/);

    // Scoped to RETURNED strings, not the whole file — the old wording is
    // quoted in a comment above the fix, on purpose, so the next reader knows
    // what the message used to say. A whole-file `includes` check flagged that
    // comment and would have pushed me to delete the explanation to go green.
    const returnedDetails = [...SRC.matchAll(/details:\s*(`[^`]*`|"[^"]*")/g)].map((m) => m[1]!);
    expect(returnedDetails.length).toBeGreaterThan(0);
    expect(returnedDetails.filter((d) => d.includes("≥50%"))).toEqual([]);
  });
});
