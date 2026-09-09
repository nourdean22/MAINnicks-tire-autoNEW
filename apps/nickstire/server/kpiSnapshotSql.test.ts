/**
 * A LANE THAT NEVER WORKED, AND NOTHING COULD SEE IT.
 *
 * kpi-snapshot ran 5 times and succeeded 0 times between 2026-09-03 and
 * 2026-09-09. It did not degrade; it never once worked. The cause was a single
 * identifier: the review_replies subquery asked for `createdAt`, and that table
 * spells it `created_at`.
 *
 * What makes this worth a gate rather than a one-line fix is WHY it was
 * invisible. The table directly above it in the same statement, review_requests,
 * genuinely uses camelCase `sentAt`. Both spellings are correct in this schema,
 * on different tables. And a column name inside a raw `sql` template is an
 * opaque string: tsc cannot see it, Drizzle's typing cannot see it, and no lint
 * reads SQL. The first and only signal was a cron failure in production.
 *
 * So this checks every column kpiSnapshot names against the schema that
 * defines it, and carries a positive control proving the checker can fail.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const SCHEMA = readFileSync(path.join(__dirname, "..", "drizzle", "schema.ts"), "utf8");
const JOB = readFileSync(path.join(__dirname, "cron", "jobs", "kpiSnapshot.ts"), "utf8");

/** Column names declared for one mysqlTable("<dbName>", { ... }) block. */
function columnsOf(dbTableName: string): Set<string> {
  const start = SCHEMA.indexOf(`mysqlTable("${dbTableName}"`);
  if (start < 0) return new Set();
  // The block ends at the first line that closes the object at column 0-ish.
  const rest = SCHEMA.slice(start);
  const end = rest.indexOf("\n});");
  const body = rest.slice(0, end < 0 ? 4000 : end);
  const cols = new Set<string>();
  // Both forms: varchar("dbName", ...) and timestamp("dbName")
  for (const m of body.matchAll(/\b(?:varchar|int|timestamp|text|mediumtext|decimal|boolean|mysqlEnum|json|datetime|date|tinyint|bigint|float|double)\(\s*"([^"]+)"/g)) {
    cols.add(m[1]);
  }
  return cols;
}

/** The (table, column) pairs kpiSnapshot actually asks the database for. */
const USED: Array<{ table: string; column: string }> = [
  { table: "review_requests", column: "sentAt" },
  { table: "review_replies", column: "created_at" },
  { table: "customers", column: "createdAt" },
  { table: "leads", column: "createdAt" },
  { table: "invoices", column: "paymentStatus" },
  { table: "invoices", column: "totalAmount" },
];

describe("every column kpi-snapshot names exists, spelled that way", () => {
  it("PLANTED CANARY: the checker can actually fail", () => {
    // A checker that cannot fail is the same defect one level up. This is the
    // exact spelling that broke production, asserted to be absent.
    const cols = columnsOf("review_replies");
    expect(cols.size, "review_replies not found in the schema at all").toBeGreaterThan(0);
    expect(cols.has("createdAt"), "review_replies really does have createdAt - the premise is wrong").toBe(false);
    expect(cols.has("created_at")).toBe(true);
  });

  for (const { table, column } of USED) {
    it(`${table}.${column}`, () => {
      const cols = columnsOf(table);
      expect(cols.size, `${table} not found in drizzle/schema.ts`).toBeGreaterThan(0);
      expect(
        cols.has(column),
        `kpiSnapshot queries ${table}.${column}, but the schema declares: ${[...cols].join(", ")}`,
      ).toBe(true);
    });
  }

  it("the job no longer contains the spelling that broke it", () => {
    // Narrow on purpose: `createdAt` is CORRECT for customers and leads in the
    // same file, so this asserts the review_replies subquery specifically.
    const sub = JOB.slice(JOB.indexOf("FROM review_replies"));
    const body = sub.slice(0, 400);
    expect(body, "review_replies is being queried by createdAt again").not.toContain("createdAt");
    expect(body).toContain("created_at");
  });

  it("and the camelCase neighbour that made it look like a typo is untouched", () => {
    // review_requests.sentAt is genuinely camelCase. A well-meaning sweep to
    // snake_case "for consistency" would break the half that currently works.
    const sub = JOB.slice(JOB.indexOf("FROM review_requests"));
    expect(sub.slice(0, 400)).toContain("sentAt");
    expect(columnsOf("review_requests").has("sentAt")).toBe(true);
  });
});
