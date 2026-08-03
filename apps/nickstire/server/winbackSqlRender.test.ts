/**
 * winbackSqlRender.test.ts · 2026-08-03
 *
 * The win-back engine had never inserted a single row. `winback_sends` was empty
 * in production — COUNT(*) = 0, first_ever NULL — while seven segment templates,
 * a processor cron, an autopilot hook and an Activate button all sat on top of it.
 *
 * Cause: `sql.join(chunk)` was called without a separator. drizzle's join()
 * appends the separator only `if (i > 0 && separator !== void 0)`, so N ids
 * rendered as `IN (???)` — a MySQL parse error — and every activation threw
 * before reaching the insert.
 *
 * WHY THE EXISTING SUITE COULD NOT SEE IT, which is the real lesson:
 * `server/__tests__/winback-tire.test.ts:106` calls the broken function with
 * exactly `[1, 2, 3, 4, 5]` — the breaking input — and passes green, because its
 * mocked `.where()` accepts the SQL object and throws it away. A test that never
 * renders SQL cannot detect malformed SQL, no matter what it passes in.
 *
 * So these tests RENDER. The fake db captures the condition and runs it through
 * the real MySqlDialect, asserting on the string the database would actually see.
 */
import { describe, expect, it } from "vitest";
import { and, sql } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";

import { getVerifiedTirePurchaseCustomerIds } from "./routers/winback";

const dialect = new MySqlDialect();
const render = (condition: unknown) => dialect.sqlToQuery(condition as never).sql;

/**
 * Captures every `where()` argument instead of discarding it — the one change
 * that separates this file from the suite that missed the defect.
 */
function capturingDb() {
  const conditions: unknown[] = [];
  return {
    conditions,
    select: () => ({
      from: () => ({
        where: (c: unknown) => {
          conditions.push(c);
          return Promise.resolve([]);
        },
      }),
    }),
  };
}

describe("win-back id lists render as valid SQL", () => {
  it("renders a multi-id IN clause with separators, not IN (???)", async () => {
    const db = capturingDb();

    await getVerifiedTirePurchaseCustomerIds(db, [1, 2, 3, 4, 5]);

    expect(db.conditions.length).toBeGreaterThan(0);
    for (const condition of db.conditions) {
      const text = render(condition);
      // The exact shape that made every activation throw.
      expect(text).not.toContain("IN (???)");
      expect(text).toMatch(/IN \(\?(, \?)+\)/);
    }
  });

  /**
   * The single-id case is why this survived 54 days: it renders `IN (?)`, which is
   * perfectly valid. winback.ts:401 calls with one id and has always worked, so the
   * feature looked alive from the one code path anybody exercised by hand.
   */
  it("still renders a single-id IN clause correctly", async () => {
    const db = capturingDb();

    await getVerifiedTirePurchaseCustomerIds(db, [7]);

    for (const condition of db.conditions) {
      expect(render(condition)).toContain("IN (?)");
    }
  });

  it("queries all three purchase-evidence tables", async () => {
    const db = capturingDb();

    await getVerifiedTirePurchaseCustomerIds(db, [1, 2, 3]);

    // invoices, tire_orders, service_history — one condition each.
    expect(db.conditions.length).toBe(3);
  });
});

/**
 * The second defect, which had to ship in the same commit as the first. Reviving
 * the engine without this would have made its FIRST action a text to people who
 * had sent STOP.
 */
describe("an OR chain inside and() must be parenthesised", () => {
  it("drizzle does NOT add parentheses around a raw OR fragment", () => {
    // Documents the library behaviour the defect depended on, so the next reader
    // does not have to rediscover why the parens matter.
    const unguarded = and(sql`A`, sql`optOut = 0`, sql`EXISTS(X) OR EXISTS(Y)`);

    expect(render(unguarded)).toBe("(A and optOut = 0 and EXISTS(X) OR EXISTS(Y))");
  });

  it("...so the guard leaks: AND binds tighter than OR", () => {
    const guarded = and(sql`A`, sql`optOut = 0`, sql`(EXISTS(X) OR EXISTS(Y))`);

    expect(render(guarded)).toBe("(A and optOut = 0 and (EXISTS(X) OR EXISTS(Y)))");
  });

  it("the tire_customer segment keeps its OR chain grouped", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile("server/routers/winback.ts", "utf8"),
    );

    // The opt-out guard must be followed by an OPEN paren before the first EXISTS,
    // and the chain must close with a matching one. A future edit that drops either
    // silently reinstates a consent defect, so it is pinned as text.
    expect(source).toMatch(/eq\(customers\.smsOptOut, 0\),[\s\S]{0,600}sql`\(EXISTS \(/);
    expect(source).toContain("))`");
  });
});
